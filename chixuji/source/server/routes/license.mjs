// 卡密：纯前端版联网激活 + 管理后台生成/停用
import { now, tx } from '../lib/db.mjs';
import { HttpError, int, notFound, str } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { newId } from '../lib/story.mjs';
import { newLicenseCode, normalizeCode, signToken, TOKEN_DAYS, verifyToken } from '../lib/license.mjs';

const deny = (msg, reason) => new HttpError(403, msg, { reason });

export default function licenseRoutes(r, { db, limiter, licenseKey }) {
  function issue(lic, deviceId) {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + TOKEN_DAYS * 86400;
    return { token: signToken(licenseKey, { l: lic.id, d: deviceId, iat, exp }), exp };
  }
  function deviceIdOf(v) {
    const d = String(v || '');
    if (!/^[A-Za-z0-9-]{16,64}$/.test(d)) throw deny('设备信息不正确，请刷新页面再试', 'bad_device');
    return d;
  }

  // —— 公开接口（纯前端版从别的网址调用）——
  r.post('/api/license/activate', async (ctx) => {
    limiter.check(`lic-ip:${ctx.ip}`, 20, 3600e3, '尝试太多次了，请 1 小时后再试');
    const code = normalizeCode(ctx.body.code);
    const deviceId = deviceIdOf(ctx.body.deviceId);
    if (!code) throw deny('卡密格式不对，应该像 XSJ-ABCD-EFGH-JKLM', 'bad_code');
    const lic = db.prepare('SELECT * FROM licenses WHERE code = ?').get(code);
    if (!lic) throw deny('卡密不存在，请检查有没有输错', 'not_found');
    if (lic.revoked) throw deny('这个卡密已经停用', 'revoked');
    const t = now();
    tx(db, () => {
      const has = db.prepare('SELECT 1 FROM license_devices WHERE license_id = ? AND device_id = ?').get(lic.id, deviceId);
      if (has) {
        db.prepare('UPDATE license_devices SET last_at = ?, ip = ? WHERE license_id = ? AND device_id = ?').run(t, ctx.ip, lic.id, deviceId);
        return;
      }
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM license_devices WHERE license_id = ?').get(lic.id);
      if (n >= lic.max_devices) throw deny(`这个卡密已经在 ${lic.max_devices} 台设备上用过了。换设备请联系卖家重置`, 'device_limit');
      db.prepare('INSERT INTO license_devices (license_id, device_id, first_at, last_at, ip) VALUES (?, ?, ?, ?, ?)').run(lic.id, deviceId, t, t, ctx.ip);
    });
    return issue(lic, deviceId);
  });

  // 定期联网检查：卡密没被停用、设备没被移除，就续期
  r.post('/api/license/check', async (ctx) => {
    limiter.check(`lic-check:${ctx.ip}`, 120, 3600e3);
    const p = verifyToken(licenseKey, ctx.body.token);
    if (!p?.l || !p?.d) throw deny('激活信息无效，请重新输入卡密', 'invalid');
    const lic = db.prepare('SELECT * FROM licenses WHERE id = ?').get(p.l);
    if (!lic) throw deny('卡密不存在', 'not_found');
    if (lic.revoked) throw deny('这个卡密已经停用', 'revoked');
    const dev = db.prepare('SELECT 1 FROM license_devices WHERE license_id = ? AND device_id = ?').get(lic.id, p.d);
    if (!dev) throw deny('这台设备的激活已被移除，请重新输入卡密', 'device_removed');
    db.prepare('UPDATE license_devices SET last_at = ?, ip = ? WHERE license_id = ? AND device_id = ?').run(now(), ctx.ip, lic.id, p.d);
    return issue(lic, p.d);
  });

  // —— 管理后台 ——
  r.get('/api/admin/licenses', async (ctx) => {
    requireAdmin(ctx);
    const rows = db.prepare('SELECT * FROM licenses ORDER BY created_at DESC LIMIT 1000').all();
    const devs = db.prepare('SELECT device_id, first_at, last_at FROM license_devices WHERE license_id = ? ORDER BY first_at');
    return {
      publicKey: licenseKey.publicJwk,
      licenses: rows.map((x) => ({
        id: x.id, code: x.code, maxDevices: x.max_devices, note: x.note, revoked: !!x.revoked, createdAt: x.created_at,
        devices: devs.all(x.id).map((d) => ({ id: d.device_id.slice(0, 8), firstAt: d.first_at, lastAt: d.last_at })),
      })),
    };
  });

  r.post('/api/admin/licenses', async (ctx) => {
    const admin = requireAdmin(ctx);
    const count = int(ctx.body.count, { name: '数量', min: 1, max: 200, fallback: 1 });
    const maxDevices = int(ctx.body.maxDevices, { name: '每个可用设备数', min: 1, max: 20, fallback: 2 });
    const note = str(ctx.body.note, { name: '备注', max: 100 });
    const codes = tx(db, () => {
      const out = [];
      const ins = db.prepare('INSERT INTO licenses (id, code, max_devices, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      while (out.length < count) {
        const code = newLicenseCode();
        if (db.prepare('SELECT 1 FROM licenses WHERE code = ?').get(code)) continue;
        ins.run(newId(), code, maxDevices, note, admin.id, now());
        out.push(code);
      }
      return out;
    });
    return { codes };
  });

  r.post('/api/admin/licenses/:id/revoke', async (ctx) => {
    requireAdmin(ctx);
    const res = db.prepare('UPDATE licenses SET revoked = ? WHERE id = ?').run(ctx.body.revoked === false ? 0 : 1, ctx.params.id);
    if (!res.changes) throw notFound('找不到这个卡密');
    return { ok: true };
  });

  r.post('/api/admin/licenses/:id/reset-devices', async (ctx) => {
    requireAdmin(ctx);
    if (!db.prepare('SELECT 1 FROM licenses WHERE id = ?').get(ctx.params.id)) throw notFound('找不到这个卡密');
    db.prepare('DELETE FROM license_devices WHERE license_id = ?').run(ctx.params.id);
    return { ok: true };
  });
}
