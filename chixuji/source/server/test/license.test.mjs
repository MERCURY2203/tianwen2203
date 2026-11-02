// 卡密：生成、联网激活、设备上限、停用、重置；以及纯前端版的验签逻辑
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { createApp } from '../app.mjs';

let app, base, admin, lic;
const ADMIN = 'admin@test.com';

function client() {
  let cookie = '';
  const call = async (method, url, body, { csrf = true } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (csrf) headers['x-xsj'] = '1';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return { get: (u) => call('GET', u), post: (u, b, o) => call('POST', u, b || {}, o) };
}

// 模拟浏览器环境，加载纯前端版的卡密模块
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsj-lic-'));
  const config = loadConfig({
    DATA_DIR: dir, ADMIN_EMAIL: ADMIN, MAIL_MODE: 'screen', REGISTRATION: 'invite',
    DISABLE_BACKUPS: '1', DISABLE_RATE_LIMIT: '1', APP_SECRET: 'test-secret',
  });
  config.licenseRoot = dir; // 测试时不要去动项目根目录
  app = createApp(config, { info() {}, error() {} });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  admin = client();
  const r1 = await admin.post('/api/auth/request-code', { email: ADMIN });
  const r2 = await admin.post('/api/auth/verify', { email: ADMIN, code: r1.body.devCode, adultConfirmed: true, termsAccepted: true });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.ok(fs.existsSync(path.join(dir, 'license-private.pem')));
  globalThis.__XSJ_LICENSE__ = { server: base, publicKey: app.licenseKey.publicJwk };
  lic = await import('../../web/src/local/license.js');
});
after(() => app.close());

const pub = (url, body) => fetch(base + url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://xsj.example' }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json(), headers: r.headers }));
const dev = (n) => `device-${String(n).padStart(12, '0')}`;

test('只有管理员能生成卡密', async () => {
  const anon = client();
  assert.equal((await anon.post('/api/admin/licenses', { count: 1 })).status, 401);
  const r = await admin.post('/api/admin/licenses', { count: 3, maxDevices: 2, note: '测试' });
  assert.equal(r.status, 200);
  assert.equal(r.body.codes.length, 3);
  for (const c of r.body.codes) assert.match(c, /^XSJ-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('激活：跨站可调用、限制设备数、停用、重置', async () => {
  const code = (await admin.post('/api/admin/licenses', { count: 1, maxDevices: 2 })).body.codes[0];
  // 预检请求
  const pre = await fetch(base + '/api/license/activate', { method: 'OPTIONS', headers: { origin: 'https://xsj.example', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');

  assert.equal((await pub('/api/license/activate', { code: 'XSJ-AAAA-BBBB-CCCC', deviceId: dev(1) })).body.reason, 'not_found');
  assert.equal((await pub('/api/license/activate', { code: 'abc', deviceId: dev(1) })).body.reason, 'bad_code');
  // 小写、没有横线也能认
  const a1 = await pub('/api/license/activate', { code: code.toLowerCase().replace(/-/g, ''), deviceId: dev(1) });
  assert.equal(a1.status, 200, JSON.stringify(a1.body));
  assert.equal(a1.headers.get('access-control-allow-origin'), '*');
  assert.ok(a1.body.token.includes('.'));
  assert.equal((await pub('/api/license/activate', { code, deviceId: dev(1) })).status, 200, '同一台设备重复激活不占名额');
  assert.equal((await pub('/api/license/activate', { code, deviceId: dev(2) })).status, 200);
  const a3 = await pub('/api/license/activate', { code, deviceId: dev(3) });
  assert.equal(a3.status, 403);
  assert.equal(a3.body.reason, 'device_limit');

  // 检查/续期
  const c1 = await pub('/api/license/check', { token: a1.body.token });
  assert.equal(c1.status, 200);
  const forged = a1.body.token.replace(/^[^.]+/, Buffer.from(JSON.stringify({ l: 'x', d: dev(9), exp: 9e9 })).toString('base64url'));
  assert.equal((await pub('/api/license/check', { token: forged })).body.reason, 'invalid');

  const list = await admin.get('/api/admin/licenses');
  const row = list.body.licenses.find((l) => l.code === code);
  assert.equal(row.devices.length, 2);
  assert.equal(list.body.publicKey.d, undefined, '公钥里不能带私钥');

  // 重置设备后，旧凭证失效，新设备可以激活
  await admin.post(`/api/admin/licenses/${row.id}/reset-devices`);
  assert.equal((await pub('/api/license/check', { token: a1.body.token })).body.reason, 'device_removed');
  assert.equal((await pub('/api/license/activate', { code, deviceId: dev(3) })).status, 200);

  // 停用
  await admin.post(`/api/admin/licenses/${row.id}/revoke`, { revoked: true });
  assert.equal((await pub('/api/license/activate', { code, deviceId: dev(3) })).body.reason, 'revoked');
  await admin.post(`/api/admin/licenses/${row.id}/revoke`, { revoked: false });
  assert.equal((await pub('/api/license/activate', { code, deviceId: dev(3) })).status, 200);
});

test('纯前端版：激活后本机验签通过，停用后联网检查会要求重新激活', async () => {
  assert.equal(lic.LICENSE_ENABLED, true);
  assert.equal((await lic.checkLicense()).ok, false);
  const code = (await admin.post('/api/admin/licenses', { count: 1 })).body.codes[0];
  await assert.rejects(lic.activate('XSJ-2222-3333-4444'), /不存在/);
  await lic.activate(code);
  assert.equal((await lic.checkLicense()).ok, true);
  assert.ok(lic.licenseInfo().expiresAt);

  // 篡改凭证 → 本机验签失败，联网检查也不认
  const saved = JSON.parse(localStorage.getItem('xsj-license'));
  const [body, sig] = saved.token.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64url'));
  p.exp += 365 * 86400;
  localStorage.setItem('xsj-license', JSON.stringify({ ...saved, token: Buffer.from(JSON.stringify(p)).toString('base64url') + '.' + sig }));
  assert.equal((await lic.checkLicense()).ok, false);

  // 恢复正常凭证，然后后台停用，过了检查周期 → 不能用了
  await lic.activate(code);
  const id = (await admin.get('/api/admin/licenses')).body.licenses.find((l) => l.code === code).id;
  await admin.post(`/api/admin/licenses/${id}/revoke`, { revoked: true });
  assert.equal((await lic.checkLicense()).ok, true, '还没到联网检查的时间，离线可用');
  const cur = JSON.parse(localStorage.getItem('xsj-license'));
  localStorage.setItem('xsj-license', JSON.stringify({ ...cur, checkedAt: Date.now() - 4 * 86400e3 }));
  const r = await lic.checkLicense();
  assert.equal(r.ok, false);
  assert.match(r.message, /停用/);
});
