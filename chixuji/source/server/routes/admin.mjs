// 管理后台：邀请码、用户列表（只看必要信息，不看私聊内容）
import crypto from 'node:crypto';
import { now, tx } from '../lib/db.mjs';
import { int, notFound, str } from '../lib/http.mjs';
import { requireAdmin } from '../lib/auth.mjs';
import { newId } from '../lib/story.mjs';

// 去掉容易看混的字符（0/O、1/I/L）
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  return s;
}

export default function adminRoutes(r, { db }) {
  r.get('/api/admin/invites', async (ctx) => {
    requireAdmin(ctx);
    const rows = db.prepare('SELECT * FROM invite_codes ORDER BY created_at DESC LIMIT 500').all();
    return {
      invites: rows.map((x) => ({
        id: x.id, code: x.code, maxUses: x.max_uses, usedCount: x.used_count,
        expiresAt: x.expires_at, disabled: !!x.disabled, note: x.note, createdAt: x.created_at,
      })),
    };
  });

  r.post('/api/admin/invites', async (ctx) => {
    const admin = requireAdmin(ctx);
    const count = int(ctx.body.count, { name: '数量', min: 1, max: 50, fallback: 1 });
    const maxUses = int(ctx.body.maxUses, { name: '每个可用次数', min: 1, max: 100, fallback: 1 });
    const days = int(ctx.body.expiresDays, { name: '有效天数', min: 0, max: 365, fallback: 0 });
    const note = str(ctx.body.note, { name: '备注', max: 100 });
    const expiresAt = days ? new Date(Date.now() + days * 86400e3).toISOString() : null;
    const codes = tx(db, () => {
      const out = [];
      const ins = db.prepare(
        'INSERT INTO invite_codes (id, code, max_uses, expires_at, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      while (out.length < count) {
        const code = randomCode();
        if (db.prepare('SELECT 1 FROM invite_codes WHERE code = ?').get(code)) continue;
        ins.run(newId(), code, maxUses, expiresAt, note || null, admin.id, now());
        out.push(code);
      }
      return out;
    });
    return { codes };
  });

  r.post('/api/admin/invites/:id/disable', async (ctx) => {
    requireAdmin(ctx);
    const res = db.prepare('UPDATE invite_codes SET disabled = 1 WHERE id = ?').run(ctx.params.id);
    if (!res.changes) throw notFound();
    return { ok: true };
  });

  r.get('/api/admin/users', async (ctx) => {
    requireAdmin(ctx);
    const rows = db.prepare(
      `SELECT u.id, u.email, u.is_admin, u.points, u.created_at, u.last_seen_at, u.disabled_at,
              (SELECT COUNT(*) FROM characters c WHERE c.user_id = u.id) AS characters,
              i.code AS invite_code
       FROM users u LEFT JOIN invite_codes i ON i.id = u.invite_code_id
       ORDER BY u.created_at DESC LIMIT 1000`,
    ).all();
    return {
      users: rows.map((u) => ({
        id: u.id, email: u.email, isAdmin: !!u.is_admin, points: u.points, characters: u.characters,
        inviteCode: u.invite_code, createdAt: u.created_at, lastSeenAt: u.last_seen_at, disabled: !!u.disabled_at,
      })),
    };
  });

  // 模型花费（估算）：今天、最近 7 天，按用途和用户
  r.get('/api/admin/usage', async (ctx) => {
    requireAdmin(ctx);
    const bjToday = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    const todayStart = new Date(Date.parse(bjToday + 'T00:00:00+08:00')).toISOString();
    const weekStart = new Date(Date.parse(bjToday + 'T00:00:00+08:00') - 6 * 86400e3).toISOString();
    const sum = (since) => db.prepare(
      `SELECT purpose, COUNT(*) AS calls, SUM(ok) AS ok, COALESCE(SUM(cost_micro_yuan),0) AS cost
       FROM model_calls WHERE created_at >= ? GROUP BY purpose`,
    ).all(since);
    const topUsers = db.prepare(
      `SELECT u.email, COUNT(*) AS calls, COALESCE(SUM(m.cost_micro_yuan),0) AS cost
       FROM model_calls m JOIN users u ON u.id = m.user_id WHERE m.created_at >= ?
       GROUP BY m.user_id ORDER BY cost DESC LIMIT 20`,
    ).all(todayStart);
    const fmt = (rows) => rows.map((x) => ({ purpose: x.purpose, calls: x.calls, failed: x.calls - x.ok, costYuan: x.cost / 1e6 }));
    return { today: fmt(sum(todayStart)), week: fmt(sum(weekStart)), topUsersToday: topUsers.map((x) => ({ email: x.email, calls: x.calls, costYuan: x.cost / 1e6 })) };
  });
}
