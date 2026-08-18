"use strict";

// src/code.ts
figma.showUI(__html__, { width: 420, height: 640, title: "HTML \u2192 Figma" });
var fontCache = null;
async function listFonts() {
  if (!fontCache) fontCache = await figma.listAvailableFontsAsync();
  return fontCache;
}
function hexToColor(hex) {
  const fallback = { color: { r: 0, g: 0, b: 0 }, opacity: 1 };
  if (!hex) return { ...fallback, opacity: 1 };
  let h = hex.replace("#", "");
  if (h.length === 6) h += "ff";
  if (h.length !== 8) return fallback;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const opacity = parseInt(h.slice(6, 8), 16) / 255;
  return { color: { r, g, b }, opacity };
}
function solidFill(hex) {
  const { color, opacity } = hexToColor(hex);
  return [{ type: "SOLID", color, opacity }];
}
async function resolveFont(family, weight) {
  const style = weight >= 700 ? "Bold" : "Regular";
  const desired = { family: family || "Inter", style };
  const tryLoad = async (f) => {
    try {
      await figma.loadFontAsync(f);
      return f;
    } catch {
      return null;
    }
  };
  const direct = await tryLoad(desired);
  if (direct) return direct;
  const fonts = await listFonts();
  const hit = fonts.find((f) => f.fontName.family === desired.family && f.fontName.style === style) || fonts.find((f) => f.fontName.family.toLowerCase() === desired.family.toLowerCase()) || fonts.find((f) => /inter|roboto|arial/i.test(f.fontName.family) && f.fontName.style === style);
  if (hit) {
    const r = await tryLoad(hit.fontName);
    if (r) return r;
  }
  const lastResort = await tryLoad({ family: "Inter", style });
  if (lastResort) return lastResort;
  for (const f of fonts) {
    const r = await tryLoad(f.fontName);
    if (r) return r;
  }
  throw new Error("\u65E0\u6CD5\u52A0\u8F7D\u4EFB\u4F55\u5B57\u4F53");
}
function toTextAlignH(a) {
  if (a === "center") return "CENTER";
  if (a === "right") return "RIGHT";
  return "LEFT";
}
function toTextAlignV(a) {
  if (a === "middle") return "CENTER";
  if (a === "bottom") return "BOTTOM";
  return "TOP";
}
async function buildNode(n, parent, parentAbsX, parentAbsY) {
  const x = Math.round(n.x - parentAbsX);
  const y = Math.round(n.y - parentAbsY);
  const w = Math.max(1, Math.round(n.width));
  const h = Math.max(1, Math.round(n.height));
  if (n.kind === "text") {
    const t = figma.createText();
    t.name = "\u6587\u672C";
    const font = await resolveFont(n.fontFamily || "Inter", n.fontWeight || 400);
    t.fontName = font;
    t.fontSize = n.fontSize && n.fontSize > 0 ? n.fontSize : 14;
    if (n.lineHeight && n.lineHeight > 0) {
      t.lineHeight = { value: n.lineHeight, unit: "PIXELS" };
    }
    if (n.letterSpacing !== void 0 && isFinite(n.letterSpacing)) {
      t.letterSpacing = { value: n.letterSpacing, unit: "PIXELS" };
    }
    t.textAlignHorizontal = toTextAlignH(n.textAlign);
    t.textAlignVertical = toTextAlignV(n.textAlignVertical);
    t.fills = solidFill(n.textColor);
    t.characters = n.chars || "";
    t.x = x;
    t.y = y;
    t.resize(w, h);
    t.opacity = n.opacity ?? 1;
    parent.appendChild(t);
    return 1;
  }
  if (n.kind === "image") {
    const r = figma.createRectangle();
    r.name = "\u56FE\u7247";
    r.x = x;
    r.y = y;
    r.resize(w, h);
    if (n.imageDataUrl) {
      try {
        const image = await figma.createImageAsync(n.imageDataUrl);
        r.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
      } catch {
        r.fills = solidFill("#D9D9D9");
      }
    } else {
      r.fills = solidFill("#D9D9D9");
    }
    r.opacity = n.opacity ?? 1;
    parent.appendChild(r);
    return 1;
  }
  if (n.kind === "rect") {
    const r = figma.createRectangle();
    r.name = n.name || "\u5360\u4F4D";
    r.x = x;
    r.y = y;
    r.resize(w, h);
    r.fills = solidFill(n.background || "#D9D9D9");
    if (n.cornerRadius) r.cornerRadius = n.cornerRadius;
    r.opacity = n.opacity ?? 1;
    parent.appendChild(r);
    return 1;
  }
  const f = figma.createFrame();
  f.name = n.name || "Frame";
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
async function createPages(pages) {
  let nodeCount = 0;
  let firstPage = null;
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
    frame.fills = solidFill(p.background || "#FFFFFF");
    frame.clipsContent = true;
    page.appendChild(frame);
    for (const n of p.nodes) {
      nodeCount += await buildNode(n, frame, 0, 0);
    }
    figma.ui.postMessage({ type: "progress", done: i + 1, total: pages.length, page: p.name });
  }
  return { nodeCount, firstPage };
}
figma.ui.onmessage = async (msg) => {
  if (msg.type === "cancel") {
    figma.closePlugin();
    return;
  }
  if (msg.type === "create-frames") {
    try {
      figma.ui.postMessage({ type: "status", text: "\u5F00\u59CB\u751F\u6210\u2026" });
      const { nodeCount, firstPage } = await createPages(msg.pages);
      if (firstPage) {
        await figma.setCurrentPageAsync(firstPage);
        figma.viewport.scrollAndZoomIntoView([firstPage.children[0]]);
      }
      figma.ui.postMessage({ type: "done", created: nodeCount, pages: msg.pages.length });
    } catch (e) {
      figma.ui.postMessage({ type: "error", text: String(e) });
    }
  }
};
