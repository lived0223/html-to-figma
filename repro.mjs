/**
 * 复现测试：用无头 Chrome 真实加载 index-v3.html，
 * 执行与插件相同逻辑的「注入探测脚本 + 逐个路由提取」，
 * 验证：1) 页面名与内容是否对应 2) header 站点名文字是否缺失
 *
 * Node 启动参数：--experimental-fetch 不需要；直接用 puppeteer-core
 */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML_PATH = path.join(__dirname, 'index-v3.html');
const INJECT_PATH = path.join(__dirname, 'src', 'ui', 'inject.js');

const htmlText = fs.readFileSync(HTML_PATH, 'utf-8');
const injectText = fs.readFileSync(INJECT_PATH, 'utf-8');
const shimScript = `<script>
(function(){try{
  var orig = history.replaceState.bind(history);
  history.replaceState = function(s, t, url){
    try { return orig(s, t, url); }
    catch(e){ if(url && url.indexOf('#') === 0){ location.hash = url.slice(1); } else if(url){ location.hash = String(url).split('#')[1] || ''; } }
  };
}catch(e){}})();
</script>`;

function buildSrcdoc() {
  let doc = htmlText.replace('</head>', shimScript + '</head>');
  const idx = doc.lastIndexOf('</body>');
  if (idx >= 0) {
    doc = doc.slice(0, idx) + '<script>' + injectText + '</script></body>' + doc.slice(idx + '</body>'.length);
  } else {
    doc += '<script>' + injectText + '</script>';
  }
  return doc;
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// 宿主页：与插件 UI 相同的行为——建 iframe srcdoc，通信
await page.setContent(`<body><div id="host"></div></body>`);

const srcdoc = buildSrcdoc();
console.log('srcdoc 长度:', srcdoc.length);

// 挂一个 iframe
const frameInfo = await page.evaluate((src) => {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-100000px;top:0;width:1280px;height:900px;border:0;';
    f.addEventListener('load', () => setTimeout(() => resolve('loaded'), 800));
    f.srcdoc = src;
    document.body.appendChild(f);
    window.__frame = f;
  });
}, srcdoc);
console.log('iframe:', frameInfo);

// 宿主页发布消息到 iframe
async function callIframe(type, payload, timeout = 15000) {
  return await page.evaluate(({ type, payload, timeout }) => {
    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9);
      const f = window.__frame;
      const handler = (e) => {
        const d = e.data;
        if (d && d.channel === 'html2figma' && d.id === id) {
          window.removeEventListener('message', handler);
          resolve(d);
        }
      };
      window.addEventListener('message', handler);
      f.contentWindow.postMessage({ channel: 'html2figma', type, id, ...payload }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve({ error: 'timeout' });
      }, timeout);
    });
  }, { type, payload, timeout });
}

// 1) 探测路由
const routesRes = await callIframe('routes', {});
console.log('路由探测结果:', JSON.stringify(routesRes).slice(0, 500));
if (routesRes.error) { console.log('探测失败：', routesRes.error); process.exit(1); }

// 2) 逐个提取
const routes = routesRes.routes || [];
console.log('\n--- 逐个提取校验 ---');
let summary = [];
for (let i = 0; i < routes.length; i++) {
  const res = await callIframe('extract', { hash: routes[i] });
  if (res.error || !res.result) {
    console.log(`[${i}] ${routes[i]} → 失败 ${res.error || ''}`);
    continue;
  }
  const r = res.result;
  // 找页面主标题：第一个文本节点/容器内比较长的文本
  const title = (r.nodes || []).length ? findTitle(r.nodes) : '(无节点)';
  summary.push({ route: routes[i], name: r.name, title, nodes: countNodes(r.nodes), w: r.width, h: r.height });
  console.log(`[${i}] route=${routes[i]} name=${r.name} title="${title}" 节点数=${summary[summary.length - 1].nodes}`);
}
console.log('\n--- header 站点名检查 ---');
// 单独再提取 home，看 shell 里的站点名文本
const homeRes = await callIframe('extract', { hash: '#/home' });
if (homeRes.result) {
  const chips = collectTextByTag(homeRes.result.nodes, 'chip');
  console.log('home header 里提取到的 chip 文本:', chips);
}
await browser.close();

function findTitle(nodes) {
  // 按 DOM 顺序取第一个文本内容较长的文本节点
  const texts = [];
  const walk = (ns) => ns.forEach((n) => {
    if (n.kind === 'text' && n.chars && n.chars.trim().length > 2) texts.push(n.chars.trim());
    if (n.children) walk(n.children);
  });
  walk(nodes);
  return texts.slice(0, 5).join(' | ');
}
function countNodes(ns) {
  let c = 0;
  const walk = (arr) => arr.forEach((n) => { c++; if (n.children) walk(n.children); });
  walk(ns);
  return c;
}
// 提取包含 "chip" 文本的文本节点（站点名在 .chip a 里）
function collectTextByTag(nodes, tag) {
  const out = [];
  const walk = (ns) => ns.forEach((n) => {
    if (n.tag === 'a') out.push(n.chars || '(无chars)');
    if (n.children) walk(n.children);
  });
  walk(nodes);
  return out.filter(Boolean);
}