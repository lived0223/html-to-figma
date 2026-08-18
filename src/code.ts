/**
 * 主线程（Figma 环境，无 DOM）。
 * 接收 UI 提取的结构化节点树，递归重建为可编辑的 Figma 节点。
 */
import type { ExtractedNode, ExtractedPage, UIMessage } from './types';

figma.showUI(__html__, { width: 420, height: 640, title: 'HTML → Figma' });

/** 缓存可用字体列表 */
let fontCache: Font[] | null = null;
async function listFonts(): Promise<Font[]> {
  if (!fontCache) fontCache = await figma.listAvailableFontsAsync();
  return fontCache;
}

/** 把 CSS 颜色 hex（#rrggbb / #rrggbbaa）转 Figma RGB */
function hexToColor(hex?: string | null): { color: RGB; opacity: number } {
  const fallback = { color: { r: 0, g: 0, b: 0 } as RGB, opacity: 1 };
  if (!hex) return { ...fallback, opacity: 1 };
  let h = hex.replace('#', '');
  if (h.length === 6) h += 'ff';
  if (h.length !== 8) return fallback;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const opacity = parseInt(h.slice(6, 8), 16) / 255;
  return { color: { r, g, b }, opacity };
}

function solidFill(hex?: string | null): Paint[] {
  const { color, opacity } = hexToColor(hex);
  return [{ type: 'SOLID', color, opacity }];
}

/** 根据 family + weight 解析并加载一个 Figma 字体，带 fallback */
async function resolveFont(family: string, weight: number): Promise<FontName> {
  const style = weight >= 700 ? 'Bold' : 'Regular';
  const desired: FontName = { family: family || 'Inter', style };
  const tryLoad = async (f: FontName): Promise<FontName | null> => {
    try {
      await figma.loadFontAsync(f);
      return f;
    } catch {
      return null;
    }
  };
  const direct = await tryLoad(desired);
  if (direct) return direct;
  // fallback：在可用字体中模糊匹配
  const fonts = await listFonts();
  const hit =
    fonts.find((f) => f.fontName.family === desired.family && f.fontName.style === style) ||
    fonts.find((f) => f.fontName.family.toLowerCase() === desired.family.toLowerCase()) ||
    fonts.find((f) => /inter|roboto|arial/i.test(f.fontName.family) && f.fontName.style === style);
  if (hit) {
    const r = await tryLoad(hit.fontName);
    if (r) return r;
  }
  const lastResort = await tryLoad({ family: 'Inter', style });
  if (lastResort) return lastResort;
  // 兜底：用已加载列表里第一个可用的
  for (const f of fonts) {
    const r = await tryLoad(f.fontName);
    if (r) return r;
  }
  throw new Error('无法加载任何字体');
}

function toTextAlignH(a?: string): TextNode['textAlignHorizontal'] {
  if (a === 'center') return 'CENTER';
  if (a === 'right') return 'RIGHT';
  return 'LEFT';
}
function toTextAlignV(a?: string): TextNode['textAlignVertical'] {
  if (a === 'middle') return 'CENTER';
  if (a === 'bottom') return 'BOTTOM';
  return 'TOP';
}

async function buildNode(
  n: ExtractedNode,
  parent: BaseNode & ChildrenMixin,
  parentAbsX: number,
  parentAbsY: number
): Promise<number> {
  const x = Math.round(n.x - parentAbsX);
  const y = Math.round(n.y - parentAbsY);
  const w = Math.max(1, Math.round(n.width));
  const h = Math.max(1, Math.round(n.height));

  // ---- 文本节点 ----
  if (n.kind === 'text') {
    const t = figma.createText();
    t.name = '文本';
    const font = await resolveFont(n.fontFamily || 'Inter', n.fontWeight || 400);
    t.fontName = font;
    t.fontSize = n.fontSize && n.fontSize > 0 ? n.fontSize : 14;
    if (n.lineHeight && n.lineHeight > 0) {
      t.lineHeight = { value: n.lineHeight, unit: 'PIXELS' };
    }
    if (n.letterSpacing !== undefined && isFinite(n.letterSpacing)) {
      t.letterSpacing = { value: n.letterSpacing, unit: 'PIXELS' };
    }
    t.textAlignHorizontal = toTextAlignH(n.textAlign);
    t.textAlignVertical = toTextAlignV(n.textAlignVertical);
    t.fills = solidFill(n.textColor);
    t.characters = n.chars || '';
    t.x = x;
    t.y = y;
    t.resize(w, h);
    t.opacity = n.opacity ?? 1;
    parent.appendChild(t);
    return 1;
  }

  // ---- 图片节点 ----
  if (n.kind === 'image') {
    const r = figma.createRectangle();
    r.name = '图片';
    r.x = x;
    r.y = y;
    r.resize(w, h);
    if (n.imageDataUrl) {
      try {
        const image = await figma.createImageAsync(n.imageDataUrl);
        r.fills = [{ type: 'IMAGE', imageHash: image.hash, scaleMode: 'FILL' }];
      } catch {
        r.fills = solidFill('#D9D9D9');
      }
    } else {
      r.fills = solidFill('#D9D9D9');
    }
    r.opacity = n.opacity ?? 1;
    parent.appendChild(r);
    return 1;
  }

  // ---- 矩形占位（svg 等） ----
  if (n.kind === 'rect') {
    const r = figma.createRectangle();
    r.name = n.name || '占位';
    r.x = x;
    r.y = y;
    r.resize(w, h);
    r.fills = solidFill(n.background || '#D9D9D9');
    if (n.cornerRadius) r.cornerRadius = n.cornerRadius;
    r.opacity = n.opacity ?? 1;
    parent.appendChild(r);
    return 1;
  }

  // ---- 容器 Frame ----
  const f = figma.createFrame();
  f.name = n.name || 'Frame';
  f.x = x;
  f.y = y;
  f.resize(w, h);
  f.fills = n.background ? solidFill(n.background) : [];
  if (n.cornerRadius) f.cornerRadius = n.cornerRadius;
  f.clipsContent = true;
  f.opacity = n.opacity ?? 1;
  parent.appendChild(f);

  let count = 1;
  for (const c of n.children || []) {
    count += await buildNode(c, f, n.x, n.y);
  }
  return count;
}

async function createPages(pages: ExtractedPage[]): Promise<{ nodeCount: number; firstPage: PageNode }> {
  let nodeCount = 0;
  let firstPage: PageNode | null = null;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const page = figma.createPage();
    page.name = p.name;
    if (!firstPage) firstPage = page;

    const frame = figma.createFrame();
    frame.name = p.name;
    frame.x = 0;
    frame.y = 0;
    frame.resize(Math.max(1, Math.round(p.width)), Math.max(1, Math.round(p.height)));
    frame.fills = solidFill(p.background || '#FFFFFF');
    frame.clipsContent = true;
    page.appendChild(frame);

    for (const n of p.nodes) {
      nodeCount += await buildNode(n, frame, 0, 0);
    }
    figma.ui.postMessage({ type: 'progress', done: i + 1, total: pages.length, page: p.name });
  }
  return { nodeCount, firstPage: firstPage! };
}

figma.ui.onmessage = async (msg: UIMessage) => {
  if (msg.type === 'cancel') {
    figma.closePlugin();
    return;
  }
  if (msg.type === 'create-frames') {
    try {
      figma.ui.postMessage({ type: 'status', text: '开始生成…' });
      const { nodeCount, firstPage } = await createPages(msg.pages);
      if (firstPage) {
        // 切换到第一个新页面，方便用户立即查看
        await figma.setCurrentPageAsync(firstPage);
        figma.viewport.scrollAndZoomIntoView([firstPage.children[0]]);
      }
      figma.ui.postMessage({ type: 'done', created: nodeCount, pages: msg.pages.length });
    } catch (e) {
      figma.ui.postMessage({ type: 'error', text: String(e) });
    }
  }
};
