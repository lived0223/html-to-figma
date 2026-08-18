/**
 * UI 逻辑（浏览器环境，有 DOM）。
 * 流程：
 *  1. 用户选择本地 HTML 文件；
 *  2. 将 HTML 注入同源 iframe（srcdoc），页面 JS 正常运行；
 *  3. 注入的探针脚本自动探测可用路由（读取 SITES/ARTICLES 等全局数据 + 控制台子页）；
 *  4. 用户确认路由后，逐个路由设置 hash 触发渲染，测量 DOM 提取节点树；
 *  5. 将节点树 postMessage 给主线程生成 Figma 页面。
 */
import type { ExtractedPage, PluginMessage } from '../types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const fileInput = $('file') as HTMLInputElement;
const widthInput = $('width') as HTMLInputElement;
const routesInput = $('routes') as HTMLTextAreaElement;
const goBtn = $('go') as HTMLButtonElement;
const logEl = $('log');
const progressEl = $('progress');
const progressBar = $('progressBar');

let htmlText = '';
let iframe: HTMLIFrameElement | null = null;
let pagesList: ExtractedPage[] = [];

function log(text: string, cls = '') {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}
function setProgress(pct: number) {
  progressEl.style.display = 'block';
  progressBar.style.width = pct + '%';
}

/**
 * 注入到 iframe 的探针脚本：由 esbuild 在构建时打包为字符串常量，
 * 避免在 TS 模板字符串里手写转义导致的语法/正则错误。
 * 声明在 src/ui/inject.js。
 */
declare const __INJECTED_SCRIPT__: string;
const INJECTED_SCRIPT = __INJECTED_SCRIPT__;

/** history.replaceState 打补丁：srcdoc(about:srcdoc) 环境下 replaceState 会抛错，改为设置 hash */
const SHIM_SCRIPT = `<script>
(function(){try{
  var orig = history.replaceState.bind(history);
  history.replaceState = function(s, t, url){
    try { return orig(s, t, url); }
    catch(e){ if(url && url.indexOf('#') === 0){ location.hash = url.slice(1); } else if(url){ location.hash = String(url).split('#')[1] || ''; } }
  };
}catch(e){}})();
</script>`;

function buildSrcdoc(html: string): string {
  let doc = html.replace('</head>', SHIM_SCRIPT + '</head>');
  const idx = doc.lastIndexOf('</body>');
  if (idx >= 0) {
    doc = doc.slice(0, idx) + '<script>' + INJECTED_SCRIPT + '</script></body>' + doc.slice(idx + '</body>'.length);
  } else {
    doc += '<script>' + INJECTED_SCRIPT + '</script>';
  }
  return doc;
}

function normalizeRoute(r: string): string {
  r = r.trim();
  if (!r) return '';
  if (r.startsWith('#')) return r;
  if (r.startsWith('/')) return '#' + r;
  return '#/' + r;
}

/* ============================================================
   iframe 通信（request/response）
   ============================================================ */
let msgId = 0;
const pending = new Map<number, (d: any) => void>();
window.addEventListener('message', (e) => {
  const d = e.data;
  if (d && d.channel === 'html2figma' && d.id != null && pending.has(d.id)) {
    const resolve = pending.get(d.id)!;
    pending.delete(d.id);
    resolve(d);
  }
});
function callIframe(type: string, payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    iframe!.contentWindow!.postMessage({ channel: 'html2figma', type, id, ...payload }, '*');
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ error: 'timeout' });
      }
    }, 12000);
  });
}

function createIframe(width: number): Promise<void> {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:-30000px;top:0;width:${width}px;height:900px;border:0;background:#fff;`;
    f.addEventListener('load', () => setTimeout(resolve, 500));
    f.srcdoc = buildSrcdoc(htmlText);
    document.body.appendChild(f);
    iframe = f;
  });
}

function ensureIframe(): Promise<void> {
  const desired = parseInt(widthInput.value, 10) || 1280;
  if (!iframe) return createIframe(desired);
  // 若用户改了设计稿宽度，则重建 iframe
  if (Math.abs(parseFloat(iframe.style.width) - desired) > 1) {
    iframe.remove();
    iframe = null;
    return createIframe(desired);
  }
  return Promise.resolve();
}

/* ============================================================
   文件读取 + 路由探测
   ============================================================ */
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  log('读取文件：' + file.name);
  htmlText = await file.text();
  const trimmed = htmlText.trim();
  // 提取 <style> 中的站点主色做提示（非必需）
  log('文件大小：' + (htmlText.length / 1024).toFixed(1) + ' KB', 'ok');
  goBtn.disabled = false;
  await ensureIframe();
  log('正在探测可用路由…');
  const res = await callIframe('routes', {});
  if (res.error || !res.routes || res.routes.length === 0) {
    log('自动探测失败：' + (res.error || '未发现路由') + '（可手动填写路由）', 'err');
    return;
  }
  routesInput.value = res.routes.join('\n');
  log('探测到 ' + res.routes.length + ' 个路由', 'ok');
});

/* ============================================================
   生成
   ============================================================ */
goBtn.addEventListener('click', async () => {
  if (!htmlText) { log('请先选择 HTML 文件', 'err'); return; }
  const routes = routesInput.value.split('\n').map(normalizeRoute).filter(Boolean);
  const wanted = parseInt(widthInput.value, 10) || 1280;
  if (routes.length === 0) { log('请至少填写一个路由', 'err'); return; }
  goBtn.disabled = true;
  log('开始提取 ' + routes.length + ' 个页面…');
  setProgress(0);
  pagesList = [];
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i];
    const res = await callIframe('extract', { hash: r });
    setProgress(Math.round(((i + 1) / routes.length) * 50));
    if (res.error || !res.result) {
      log('跳过 ' + r + '：' + (res.error || '提取失败'), 'err');
      continue;
    }
    pagesList.push(res.result);
    log('✓ ' + res.result.name + ' (' + res.result.width + '×' + res.result.height + ', ' + countNodes(res.result.nodes) + ' 个节点)');
  }
  if (pagesList.length === 0) { log('没有提取到任何页面', 'err'); goBtn.disabled = false; return; }
  log('提交给 Figma 生成…');
  // 通知主线程生成
  parent.postMessage({ pluginMessage: { type: 'create-frames', pages: pagesList } }, '*');
});

function countNodes(nodes: ExtractedPage['nodes']): number {
  let c = 0;
  const walk = (ns: any[]) => {
    for (const n of ns) { c++; if (n.children) walk(n.children); }
  };
  walk(nodes);
  return c;
}

/* ============================================================
   主线程消息回显
   ============================================================ */
window.addEventListener('message', (e) => {
  const pm = e.data.pluginMessage as PluginMessage | undefined;
  if (!pm) return;
  if (pm.type === 'status') {
    log(pm.text);
  } else if (pm.type === 'progress') {
    setProgress(50 + Math.round(((pm.done) / pm.total) * 50));
  } else if (pm.type === 'done') {
    setProgress(100);
    log(`完成：创建 ${pm.pages} 个页面、${pm.created} 个节点`, 'ok');
    goBtn.disabled = false;
  } else if (pm.type === 'error') {
    log('生成失败：' + pm.text, 'err');
    goBtn.disabled = false;
  }
});

log('选择 HTML 文件后自动探测页面路由。');