/**
 * UI 与主线程共享的类型与通信协议。
 * 注意：UI 运行在浏览器 iframe（有 DOM），主线程运行在 Figma（无 DOM）。
 */

/** 提取到的单个可编辑节点 */
export interface ExtractedNode {
  kind: 'frame' | 'text' | 'image' | 'rect' | 'line';
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 是否拥有自己的背景色（frame 用） */
  background?: string | null;
  /** 圆角 */
  cornerRadius?: number;
  /** 文本内容（text 用） */
  chars?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  textColor?: string;
  /** 图片 data URL（image 用） */
  imageDataUrl?: string;
  /** 边框色（line / rect 用） */
  strokeColor?: string;
  strokeWeight?: number;
  opacity?: number;
  children?: ExtractedNode[];
  /** 标签，用于日志/统计 */
  tag?: string;
}

/** 一个 Figma 页面（对应一个 HTML 路由/视图） */
export interface ExtractedPage {
  /** 页面名，如 "Home"、"Console-Factory" */
  name: string;
  /** 页面总宽（设计稿宽度） */
  width: number;
  /** 页面总高 */
  height: number;
  /** 页面背景色（取自 body 背景） */
  background?: string | null;
  nodes: ExtractedNode[];
}

/** UI -> 主线程 消息 */
export type UIMessage =
  | { type: 'create-frames'; pages: ExtractedPage[] }
  | { type: 'cancel' };

/** 主线程 -> UI 消息 */
export type PluginMessage =
  | { type: 'status'; text: string }
  | { type: 'progress'; done: number; total: number; page: string }
  | { type: 'done'; created: number; pages: number }
  | { type: 'error'; text: string };
