// 在本机试用纯前端版：把 web/dist-local 当成普通网页提供出来（不需要服务器版的数据库）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist-local');
const PORT = Number(process.env.LOCAL_PORT || 8081);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(400); return res.end(); }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `\n  ✘ 端口 ${PORT} 已被占用：可能已经开着一个迟叙机窗口，先关掉它。` : err);
  if (!process.env.XSJ_EMBED) process.exit(1);
}).listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  迟叙机（纯前端版）已在本机打开 ✔');
  console.log(`  地址：http://localhost:${PORT}`);
  console.log('  数据保存在浏览器里，和服务器版（8080）互不相通。');
  console.log('');
  if (!process.env.NO_BROWSER && !process.env.XSJ_EMBED) {
    const url = `http://localhost:${PORT}`;
    exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`, () => {});
  }
});
