# HTML → Figma（原型导入）

一个 Figma 插件：把 AI 生成的本地 HTML 原型文件一键转为**可编辑**的 Figma 设计页，用于快速绘制原型图。

## 这是什么

本插件能把一个本地 HTML 文件（例如 AI 生成的单文件网页原型）解析并还原到 Figma 中：

- 每个路由 / 页面自动生成一个独立的 Figma **Page**
- 页面里的元素都是**可编辑**的 Frame / Text / Rectangle / Image，而不是一张图片
- 自动识别文本内容、字体、字号、颜色、背景、圆角、对齐等样式

## 前置条件

- **Figma 桌面版**（Windows / macOS）——网页版不支持导入本地插件，必须安装桌面端（[figma.com/downloads](https://www.figma.com/downloads/)）
- 一个**本地 HTML 文件**，满足以下条件效果最佳：
  - 单文件、资源全内联（CSS / 图片以 base64 内嵌）
  - 支持 hash 路由（`#/home` 这种）的多页面原型，每个路由会生成一个页面
  - 依赖远程 CDN 的 HTML 可以导入，但远程样式 / 图片会缺失（见「常见问题」）

## 安装（只需一次）

1. 把本项目代码拿到本地：`git clone https://github.com/lived0223/html-to-figma.git`（或打开仓库页面点 **Code → Download ZIP** 后解压）
2. 打开 **Figma 桌面版**并登录账号
3. 顶部菜单 → **Plugins** → **Development** → **Import plugin from manifest…**
4. 在弹出的文件选择框中，选中项目里的 **`manifest.json`**
5. 导入成功后，插件出现在 **Plugins → Development** 列表中，点击即可运行

> 提示：改了代码后需要重新加载插件时，在 **Development** 菜单里点 **Reload** 即可，不用重新导入。

## 使用教程

打开插件后，按面板从上到下的顺序操作：

1. **① 选择 HTML 文件** —— 点击选择框，选中你的 HTML 原型文件。选中后插件会自动探测该文件支持的所有页面路由，并填入第 ③ 步的文本框
2. **② 设计稿宽度 (px)** —— 默认 `1280`，对应原型的设计稿宽度（前台站点常用 1280 / 1440），生成前可调整
3. **③ 要导出的路由 / 页面** —— 自动填充了探测到的路由（每行一个，如 `#/home`）。只想导出部分页面就删掉不需要的行；也可以手动添加
4. 点击 **「生成到 Figma」**，等待进度条走完
5. 生成完成后，Figma 会自动切换到新建的页面，可直接在画布上编辑每个元素

## 常见问题

**生成出来的页面缺少样式 / 图片是灰色的？**
插件默认禁止访问网络（`manifest.json` 中 `networkAccess.allowedDomains: ["none"]`），依赖 CDN 的 HTML 会缺样式。解决办法：
- 优先使用资源全内联（CSS / 图片内嵌在 HTML 里）的文件
- 若必须支持远程资源，修改 `manifest.json` 中 `networkAccess.allowedDomains`（如 `["https://cdn.example.com"]`），保存后重新导入插件

**提示「自动探测失败 / 未发现路由」？**
插件没有自动识别出页面。可以在第 ③ 步手动填写路由（如 `#/home`、`#/about`，支持 `#/` 前缀）后再生成。

**生成后页面在哪里？**
每次生成会创建新的 Figma Page（以路由命名，如 `Home`），并自动切换到第一个新页面。

**为什么某些元素变成了灰色占位块？**
SVG、canvas、表单输入框等无法直接转成 Figma 节点的元素会以占位矩形表示，属于正常现象。

## 开发者

```bash
npm install
npm run build     # 构建 dist/code.js 与 dist/ui.html
npm run watch     # 监听模式
npm run typecheck # TypeScript 类型检查
```

`manifest.json` 直接指向 `dist/code.js` 与 `dist/ui.html`，修改 `src/` 后需重新构建（`dist/` 已随仓库分发，克隆后可直接导入插件）。

### 项目结构

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

### 工作原理

1. 选择 HTML 文件后，将内容注入同源 iframe（`srcdoc`），页面 JS 正常运行
2. 注入的探针脚本自动探测可用路由（读取全局数据 + 控制台子页）
3. 确认路由后逐个设置 hash 触发渲染，测量 DOM 提取节点树（文本 / 图片 / 矩形 / 容器）
4. 节点树通过 `postMessage` 传给主线程，在 Figma 中递归重建为可编辑页面
