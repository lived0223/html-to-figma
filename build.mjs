import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// UI 打包：把 src/ui/* 编译为一个自包含 ui.html（注入内联脚本）
const uiEntry = path.join(__dirname, 'src', 'ui', 'main.ts');
const uiOutDir = path.join(__dirname, 'dist', 'ui-assets');
const injectEntry = path.join(__dirname, 'src', 'ui', 'inject.js');

const uiBuild = async () => {
  // 先把 inject.js 打包为单一字符串导出，供 main.ts 内嵌使用
  const injectResult = await esbuild.build({
    entryPoints: [injectEntry],
    bundle: true,
    format: 'iife',
    write: false,
    minify: true,
    platform: 'browser',
    target: 'chrome100',
  });
  const injectedText = injectResult.outputFiles[0].text;

  await esbuild.build({
    entryPoints: [uiEntry],
    bundle: true,
    format: 'iife',
    outfile: path.join(uiOutDir, 'ui.js'),
    platform: 'browser',
    target: 'chrome100',
    minify: false,
    sourcemap: false,
    define: {
      'process.env.NODE_ENV': '"production"',
      // 注入脚本以字符串常量形式进入 main.ts
      __INJECTED_SCRIPT__: JSON.stringify(injectedText),
    },
  });
  // 组装 ui.html
  const html = fs.readFileSync(path.join(__dirname, 'src', 'ui', 'ui.html'), 'utf-8');
  const js = fs.readFileSync(path.join(uiOutDir, 'ui.js'), 'utf-8');
  const out = html.replace('<!--__UI_SCRIPT__-->', `<script>${js}</script>`);
  fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'dist', 'ui.html'), out);
  console.log('ui.html built');
};

// 主线程打包
const codeBuild = async () => {
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'code.ts')],
    bundle: true,
    format: 'cjs',
    outfile: path.join(__dirname, 'dist', 'code.js'),
    platform: 'node',
    target: 'chrome100',
    minify: false,
    sourcemap: false,
    external: [],
  });
  console.log('code.js built');
};

const run = async () => {
  fs.mkdirSync(uiOutDir, { recursive: true });
  if (watch) {
    const ctx = await esbuild.context({
      entryPoints: [uiEntry, path.join(__dirname, 'src', 'code.ts')],
      bundle: true,
      format: 'esm',
      outdir: uiOutDir,
      logLevel: 'info',
    });
    await ctx.watch();
    console.log('watching...');
  } else {
    await uiBuild();
    await codeBuild();
  }
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
