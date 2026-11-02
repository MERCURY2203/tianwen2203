// 邮箱验证码登录 / 注册（需年满 18 岁、同意协议、内测期间需要邀请码）
import crypto from 'node:crypto';
import { now, tx } from '../lib/db.mjs';
import { bad, HttpError, str } from '../lib/http.mjs';
import {
  createSession, hashCode, publicUser, requireUser, safeEqual, sessionCookie, sha256, COOKIE,
} from '../lib/auth.mjs';
import { newId } from '../lib/story.mjs';
import { deleteImageFiles } from '../lib/chat.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function cleanEmail(v) {
  const e = str(v, { name: '邮箱', min: 1, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(e)) throw bad('邮箱格式不对');
  return e;
}

// 测试模式下，验证码只显示给本机或家里局域网里的设备；从外网（经 Cloudflare 等）来的请求一律拒绝
function isLocalRequest(req) {
  if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return false;
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

export function findInvite(db, code) {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null;
  const inv = db.prepare('SELECT * FROM invite_codes WHERE code = ?').get(c);
  if (!inv || inv.disabled || inv.used_count >= inv.max_uses) return null;
  if (inv.expires_at && inv.expires_at < now()) return null;
  return inv;
}

export default function authRoutes(r, { db, config, limiter }) {
  r.post('/api/auth/request-code', async (ctx) => {
    const email = cleanEmail(ctx.body.email);
    if (config.mailMode === 'screen' && !isLocalRequest(ctx.req)) {
      throw new HttpError(403, '现在是测试模式，只能在本机或同一 WiFi 下登录');
    }
    limiter.check(`code-ip:${ctx.ip}`, 20, 3600e3);
    limiter.check(`code-email-min:${email}`, 1, 60e3, '刚发过验证码，请 1 分钟后再试');
    limiter.check(`code-email-day:${email}`, 10, 86400e3, '今天获取验证码的次数太多了');

    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    tx(db, () => {
      db.prepare('UPDATE email_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL').run(now(), email);
      db.prepare('INSERT INTO email_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(newId(), email, hashCode(config.secret, email, code), new Date(Date.now() + CODE_MINUTES * 60e3).toISOString(), now());
    });

    if (config.mailMode === 'screen') {
      // 开发测试模式：直接把验证码返回给页面显示。正式上线前必须改成 smtp。
      return { ok: true, devCode: code, minutes: CODE_MINUTES };
    }
    throw new HttpError(500, '邮件发送功能还没配置（第 3 阶段接入）');
  });

  r.post('/api/auth/verify', async (ctx) => {
    limiter.check(`verify-ip:${ctx.ip}`, 30, 600e3);
    const email = cleanEmail(ctx.body.email);
    const code = str(ctx.body.code, { name: '验证码', min: 1, max: 12 }).replace(/\s/g, '');

    const row = db
      .prepare('SELECT * FROM email_codes WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1')
      .get(email);
    if (!row || row.expires_at < now()) throw bad('验证码已过期，请重新获取');
    if (row.attempts >= MAX_ATTEMPTS) throw bad('输错次数太多，请重新获取验证码');
    if (!safeEqual(row.code_hash, hashCode(config.secret, email, code))) {
      db.prepare('UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
      throw bad('验证码不对');
    }

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user?.disabled_at) throw new HttpError(403, '这个账号已被停用');

    if (!user) {
      const isAdmin = !!config.adminEmail && email === config.adminEmail;
      const needInvite = !isAdmin && config.registration !== 'open';
      if (ctx.body.adultConfirmed !== true || ctx.body.termsAccepted !== true) {
        // 新用户：验证码正确，但还需要补充注册信息（验证码暂不作废）
        return { needSignup: true, needInvite };
      }
      let invite = null;
      if (needInvite) {
        invite = findInvite(db, ctx.body.inviteCode);
        if (!invite) throw bad('邀请码无效、已过期或已用完');
      }
      user = tx(db, () => {
        if (invite) {
          const upd = db
            .prepare('UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses AND disabled = 0')
            .run(invite.id);
          if (upd.changes !== 1) throw bad('邀请码已用完');
        }
        const id = newId();
        const t = now();
        db.prepare(
          `INSERT INTO users (id, email, is_admin, adult_confirmed_at, terms_accepted_at, invite_code_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, email, isAdmin ? 1 : 0, t, t, invite?.id || null, t);
        return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      });
    }

    db.prepare('UPDATE email_codes SET consumed_at = ? WHERE id = ?').run(now(), row.id);
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), user.id);
    const token = createSession(db, user.id);
    ctx.setHeader('Set-Cookie', sessionCookie(token, ctx.secure));
    return { user: publicUser(user) };
  });

  r.post('/api/auth/logout', async (ctx) => {
    const token = ctx.cookies[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
    ctx.setHeader('Set-Cookie', sessionCookie('', ctx.secure, 0));
    return { ok: true };
  });

  r.get('/api/me', async (ctx) => ({ user: publicUser(requireUser(ctx)) }));

  // 删除账号：连同所有角色、世界线和聊天一起删除，不可恢复
  r.delete('/api/me', async (ctx) => {
    const u = requireUser(ctx);
    const confirm = str(ctx.body.confirmEmail, { name: '确认邮箱', min: 1, max: 254 }).toLowerCase();
    if (confirm !== u.email) throw bad('输入的邮箱和当前账号不一致');
    deleteImageFiles(db, config, { userId: u.id });
    db.prepare('DELETE FROM users WHERE id = ?').run(u.id);
    ctx.setHeader('Set-Cookie', sessionCookie('', ctx.secure, 0));
    return { ok: true };
  });
}
