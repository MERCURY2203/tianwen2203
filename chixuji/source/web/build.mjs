// 把 web/src 打包成浏览器能直接用的文件，输出到 web/dist（开发者用，普通使用不需要运行）
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const globalRoot = (() => { try { return execSync('npm root -g').toString().trim(); } catch { return ''; } })();
const require = createRequire(import.meta.url);
const searchPaths = [here, path.join(here, 'node_modules'), globalRoot, '/opt/npm-tools/node_modules'].filter(Boolean);
const esbuild = require(require.resolve('esbuild', { paths: searchPaths }));

// node web/build.mjs --local  → 打包纯前端版到 web/dist-local
// node web/build.mjs --app    → 安卓 App 用的纯前端版（测试版，不需要卡密），直接放进 android 工程
const APP = process.argv.includes('--app');
// node web/build.mjs --pages  → 公开网址（GitHub Pages）用的纯前端测试版：不需要卡密，放到 web/dist-pages
const PAGES = process.argv.includes('--pages');
const LOCAL = APP || PAGES || process.argv.includes('--local');
const dist = APP ? path.join(here, '..', 'android', 'app', 'src', 'main', 'assets') : PAGES ? path.join(here, 'dist-pages') : path.join(here, LOCAL ? 'dist-local' : 'dist');
const localApi = path.join(here, 'src', 'local', 'api.js');
const swapApi = {
  name: 'local-api',
  setup(b) {
    if (!LOCAL) return;
    // 界面代码里所有 import '…/api.js' 换成纯前端版的实现
    b.onResolve({ filter: /(^|\/)api\.js$/ }, (args) => {
      if (args.importer.includes(`${path.sep}local${path.sep}`)) return undefined;
      return { path: localApi };
    });
  },
};
// 纯前端版的卡密设置：web/license.config.json 里写激活服务器网址和公钥（公钥可以公开，私钥绝不能放进来）
let licenseCfg = null;
if (LOCAL && !APP && !PAGES) {
  const f = path.join(here, 'license.config.json');
  if (fs.existsSync(f)) {
    const c = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (c.publicKey?.d) throw new Error('license.config.json 里混进了私钥（d），请删掉！');
    licenseCfg = { server: c.server, publicKey: c.publicKey };
  } else console.log('提示：没有 web/license.config.json，这次打包不需要卡密');
}
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(here, 'src/main.jsx')],
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome90'],
  outdir: path.join(dist, 'assets'),
  entryNames: 'app-[hash]',
  assetNames: '[name]-[hash]',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  nodePaths: searchPaths,
  define: { 'process.env.NODE_ENV': '"production"', __XSJ_LICENSE__: JSON.stringify(licenseCfg), __XSJ_APP__: JSON.stringify(APP) },
  plugins: [swapApi],
  metafile: true,
  logLevel: 'warning',
});

const outs = Object.keys(result.metafile.outputs).map((f) => path.basename(f));
const js = outs.find((f) => f.endsWith('.js'));
const css = outs.find((f) => f.endsWith('.css'));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8').replace('__JS__', js).replace('__CSS__', css);
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.cpSync(path.join(here, 'public'), dist, { recursive: true });

const size = (f) => (fs.statSync(path.join(dist, 'assets', f)).size / 1024).toFixed(0) + ' KB';
if (APP) for (const f of ['sw.js', 'manifest.webmanifest']) fs.rmSync(path.join(dist, f), { force: true });
if (PAGES) fs.writeFileSync(path.join(dist, '.nojekyll'), ''); // GitHub Pages：原样发布，不做额外处理
console.log(`网页已打包到 ${APP ? 'android/app/src/main/assets' : PAGES ? 'web/dist-pages' : 'web/' + (LOCAL ? 'dist-local' : 'dist')}：${js}（${size(js)}），${css}（${size(css)}）`);
