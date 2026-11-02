// 组装整个程序：数据库 + 网址路由 + 网页文件
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openDb, startBackups } from './lib/db.mjs';
import { HttpError, parseCookies, readJson, Router, SECURITY_HEADERS, sendJson } from './lib/http.mjs';
import { RateLimiter } from './lib/ratelimit.mjs';
import { COOKIE, userFromToken } from './lib/auth.mjs';
import { createModel } from './lib/model.mjs';
import authRoutes from './routes/auth.mjs';
import storyRoutes from './routes/story.mjs';
import adminRoutes from './routes/admin.mjs';
import chatRoutes from './routes/chat.mjs';
import worldRoutes from './routes/worlds.mjs';
import licenseRoutes from './routes/license.mjs';
import { loadLicenseKey } from './lib/license.mjs';
import { ROOT } from './lib/config.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

export function createApp(config, log = console) {
  const db = openDb(config.dbFile);
  const limiter = new RateLimiter(config.disableRateLimit);
  const model = createModel(config, db);
  const router = new Router();
  const licenseKey = loadLicenseKey(config.dataDir, config.licenseRoot ?? ROOT);
  const deps = { db, config, limiter, model, log, licenseKey };
  authRoutes(router, deps);
  storyRoutes(router, deps);
  chatRoutes(router, deps);
  worldRoutes(router, deps);
  adminRoutes(router, deps);
  licenseRoutes(router, deps);
  const stopBackups = startBackups(db, config, log);

  async function handleApi(req, res, url) {
    const match = router.match(req.method, url.pathname);
    if (!match) return sendJson(res, 404, { error: '没有这个接口' });
    if (match.methodNotAllowed) return sendJson(res, 405, { error: '不支持这种请求' });
    const isLicense = url.pathname.startsWith('/api/license/');
    // 防止别的网站冒用你的登录状态：所有修改类请求必须带这个自定义请求头（卡密接口除外，它不用登录）
    if (!isLicense && req.method !== 'GET' && req.headers['x-xsj'] !== '1') return sendJson(res, 403, { error: '请求来源不正确' });

    const cookies = parseCookies(req.headers.cookie);
    const headers = {};
    const ctx = {
      req, params: match.params, query: url.searchParams, cookies,
      ip: (req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '').toString(),
      secure: req.headers['x-forwarded-proto'] === 'https',
      user: userFromToken(db, cookies[COOKIE]),
      body: req.method === 'GET' ? {} : await readJson(req, (url.pathname === '/api/images' || url.pathname === '/api/avatars') ? 9 * 1024 * 1024 : 256 * 1024),
      setHeader: (k, v) => (headers[k] = v),
    };
    const result = await match.handler(ctx);
    if (result?.__file) {
      // 私密图片：只给登录的拥有者，浏览器只在本机短暂缓存
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': result.__file.mime, 'Cache-Control': 'private, max-age=86400' });
      return fs.createReadStream(result.__file.path).pipe(res);
    }
    sendJson(res, 200, result ?? { ok: true }, headers);
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.join(config.webDir, path.normalize(rel).replace(/^([/\\])+/, ''));
    if (!file.startsWith(config.webDir)) return sendJson(res, 400, { error: 'bad path' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(rel)) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
      file = path.join(config.webDir, 'index.html'); // 单页应用：其他网址都交给 index.html
      if (!fs.existsSync(file)) { res.writeHead(500); return res.end('网页文件缺失，请先构建 web/dist'); }
    }
    const ext = path.extname(file);
    const immutable = rel.startsWith('/assets/');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/license/')) {
      // 纯前端版放在别的网址上，需要允许跨站调用（不带 cookie）
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'content-type');
      res.setHeader('Access-Control-Max-Age', '86400');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    }
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, url);
      else sendJson(res, 405, { error: '不支持这种请求' });
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message, ...err.extra });
      log.error?.(err);
      if (!res.headersSent) sendJson(res, 500, { error: '服务器出错了，请稍后再试' });
      else res.end();
    }
  });

  return {
    server,
    db,
    licenseKey,
    close: () => new Promise((resolve) => {
      stopBackups();
      server.close(() => { db.close(); resolve(); });
      server.closeAllConnections?.();
    }),
  };
}
