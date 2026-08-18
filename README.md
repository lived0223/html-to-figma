# HTML → Figma（原型导入）

一个 Figma 插件：把 AI 生成的本地 HTML 原型文件一键转为**可编辑**的 Figma 设计页，用于快速绘制原型图。

## 功能

- 选择本地 HTML 文件后自动探测可用路由（页面）
- 每个路由生成一个独立 Figma Page，节点均为可编辑的 Frame / Text / Rectangle / Image
- 支持自动识别文本、图片、圆角、背景色、字体、行高、对齐等样式
- 可自定义设计稿宽度（默认 1280px）
- 资源全内联的 HTML 开箱即用，无需网络

## 使用方法

1. Figma 桌面端 → `Plugins` → `Development` → `Import plugin from manifest` → 选择 `manifest.json`
2. 运行插件 → 选择 HTML 文件 → 确认路由 → 点击「生成到 Figma」

## 两点提示

- `manifest.json` 中设置了 `"networkAccess": {"allowedDomains": ["none"]}`，因此依赖远程资源（CDN 样式/图片）的 HTML 会缺样式。资源全内联的 HTML 不受影响；若需要支持远程资源，需放开域名白名单。
- 设计稿宽度默认 1280，可在插件面板中调整。

## 开发

```bash
npm install
npm run build     # 构建 dist/code.js 与 dist/ui.html
npm run watch     # 监听模式
npm run typecheck # TypeScript 类型检查
```

`manifest.json` 直接指向 `dist/code.js` 与 `dist/ui.html`，修改 `src/` 后需重新构建（`dist/` 已随仓库分发，克隆后可直接导入插件）。

## 项目结构

```
src/
  code.ts          # 主线程（Figma 环境）：把节点树重建为可编辑的 Figma 节点
  types.ts         # UI 与主线程共享的类型与通信协议
  ui/
    ui.html        # 插件面板 UI
    main.ts        # UI 逻辑：读取 HTML、路由探测、提取节点树
    inject.js      # 注入到 iframe 的探针/提取脚本
dist/              # 构建产物（manifest 指向此处）
build.mjs          # esbuild 构建脚本
repro.mjs          # 无头 Chrome 复现测试脚本（需本机 Chrome）
```

## 工作原理

1. 选择 HTML 文件后，将内容注入同源 iframe（`srcdoc`），页面 JS 正常运行
2. 注入的探针脚本自动探测可用路由（读取全局数据 + 控制台子页）
3. 确认路由后逐个设置 hash 触发渲染，测量 DOM 提取节点树（文本/图片/矩形/容器）
4. 节点树通过 `postMessage` 传给主线程，在 Figma 中递归重建为可编辑页面
