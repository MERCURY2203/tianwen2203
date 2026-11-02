// 登录会话：浏览器只保存一串随机令牌，数据库里只存它的哈希
import crypto from 'node:crypto';
import { now } from './db.mjs';
import { HttpError } from './http.mjs';

export const COOKIE = 'xsj_sid';
const SESSION_DAYS = 30;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const hashCode = (secret, email, code) => sha256(`${secret}:code:${email}:${code}`);

export function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, now(), expires);
  return token;
}

export function sessionCookie(token, secure, maxAgeSeconds = SESSION_DAYS * 86400) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

export function userFromToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  if (row.session_expires < now() || row.disabled_at) return null;
  return row;
}

export function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    isAdmin: !!u.is_admin,
    points: u.points,
    createdAt: u.created_at,
  };
}

export function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, '请先登录');
  return ctx.user;
}

export function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (!u.is_admin) throw new HttpError(403, '只有管理员可以操作');
  return u;
}
