// 世界（多个人物共用的世界观）、头像、人设草稿
import fs from 'node:fs';
import path from 'node:path';
import { now } from '../lib/db.mjs';
import { bad, notFound, str } from '../lib/http.mjs';
import { requireUser } from '../lib/auth.mjs';
import { newId } from '../lib/story.mjs';
import { sniffImage } from '../lib/chat.mjs';

const MAX_WORLDS = 30;
const MAX_DRAFTS = 50;
const AVATAR_MAX = 3 * 1024 * 1024;

export const avatarPath = (config, a) => path.join(config.dataDir, 'avatars', `${a.id}.${a.mime.split('/')[1] === 'jpeg' ? 'jpg' : a.mime.split('/')[1]}`);

export default function worldRoutes(r, { db, config, limiter }) {
  const worldView = (w) => ({
    id: w.id, name: w.name, lore: w.lore, createdAt: w.created_at, updatedAt: w.updated_at,
    characters: db.prepare('SELECT id, name FROM characters WHERE world_id = ? ORDER BY created_at').all(w.id),
  });
  function ownWorld(ctx, id) {
    const u = requireUser(ctx);
    const w = db.prepare('SELECT * FROM worlds WHERE id = ? AND user_id = ?').get(id, u.id);
    if (!w) throw notFound('找不到这个世界');
    return w;
  }

  // —— 世界 ——
  r.get('/api/worlds', async (ctx) => {
    const u = requireUser(ctx);
    return { worlds: db.prepare('SELECT * FROM worlds WHERE user_id = ? ORDER BY created_at').all(u.id).map(worldView) };
  });

  r.post('/api/worlds', async (ctx) => {
    const u = requireUser(ctx);
    const name = str(ctx.body.name, { name: '世界名称', min: 1, max: 30 });
    const lore = str(ctx.body.lore, { name: '世界观', min: 1, max: 8000 });
    if (db.prepare('SELECT COUNT(*) AS n FROM worlds WHERE user_id = ?').get(u.id).n >= MAX_WORLDS) throw bad(`最多可以创建 ${MAX_WORLDS} 个世界`);
    const id = newId();
    db.prepare('INSERT INTO worlds (id, user_id, name, lore, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, u.id, name, lore, now(), now());
    return { world: worldView(db.prepare('SELECT * FROM worlds WHERE id = ?').get(id)) };
  });

  r.patch('/api/worlds/:id', async (ctx) => {
    const w = ownWorld(ctx, ctx.params.id);
    const name = ctx.body.name !== undefined ? str(ctx.body.name, { name: '世界名称', min: 1, max: 30 }) : w.name;
    const lore = ctx.body.lore !== undefined ? str(ctx.body.lore, { name: '世界观', min: 1, max: 8000 }) : w.lore;
    db.prepare('UPDATE worlds SET name = ?, lore = ?, updated_at = ? WHERE id = ?').run(name, lore, now(), w.id);
    return { world: worldView(db.prepare('SELECT * FROM worlds WHERE id = ?').get(w.id)) };
  });

  r.delete('/api/worlds/:id', async (ctx) => {
    const w = ownWorld(ctx, ctx.params.id);
    const n = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE world_id = ?').get(w.id).n;
    if (n) throw bad(`这个世界里还有 ${n} 个人物，先把他们移到别的世界或删除`);
    db.prepare('DELETE FROM worlds WHERE id = ?').run(w.id);
    return { ok: true };
  });

  // —— 头像 ——
  r.post('/api/avatars', async (ctx) => {
    const u = requireUser(ctx);
    limiter.check(`avatar:${u.id}`, 30, 3600e3, '换头像太频繁了，请稍后再试');
    const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(ctx.body.dataUrl || ''));
    if (!m) throw bad('图片格式不对');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > AVATAR_MAX) throw bad('头像太大了');
    const kind = sniffImage(buf);
    if (!kind) throw bad('只支持 JPG、PNG、WebP、GIF 图片');
    const a = { id: newId(), mime: kind.mime };
    fs.mkdirSync(path.join(config.dataDir, 'avatars'), { recursive: true });
    fs.writeFileSync(avatarPath(config, a), buf);
    db.prepare('INSERT INTO avatars (id, user_id, mime, size, created_at) VALUES (?, ?, ?, ?, ?)').run(a.id, u.id, a.mime, buf.length, now());
    return { avatar: { id: a.id, url: `/api/avatars/${a.id}` } };
  });

  r.get('/api/avatars/:id', async (ctx) => {
    const u = requireUser(ctx);
    const a = db.prepare('SELECT * FROM avatars WHERE id = ? AND user_id = ?').get(ctx.params.id, u.id);
    if (!a || !fs.existsSync(avatarPath(config, a))) throw notFound('找不到这个头像');
    return { __file: { path: avatarPath(config, a), mime: a.mime } };
  });

  // —— 草稿箱：新建人物时自动保存 ——
  function cleanDraft(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('草稿格式不对');
    const json = JSON.stringify(data);
    if (json.length > 64 * 1024) throw bad('草稿太长了');
    return json;
  }
  const draftView = (d) => ({ id: d.id, data: JSON.parse(d.data), createdAt: d.created_at, updatedAt: d.updated_at });

  r.get('/api/drafts', async (ctx) => {
    const u = requireUser(ctx);
    return { drafts: db.prepare('SELECT * FROM drafts WHERE user_id = ? ORDER BY updated_at DESC').all(u.id).map(draftView) };
  });

  r.post('/api/drafts', async (ctx) => {
    const u = requireUser(ctx);
    const json = cleanDraft(ctx.body.data);
    if (db.prepare('SELECT COUNT(*) AS n FROM drafts WHERE user_id = ?').get(u.id).n >= MAX_DRAFTS) throw bad(`草稿箱最多存 ${MAX_DRAFTS} 份，先删掉一些`);
    const id = newId();
    db.prepare('INSERT INTO drafts (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, u.id, json, now(), now());
    return { draft: draftView(db.prepare('SELECT * FROM drafts WHERE id = ?').get(id)) };
  });

  r.patch('/api/drafts/:id', async (ctx) => {
    const u = requireUser(ctx);
    const json = cleanDraft(ctx.body.data);
    const res = db.prepare('UPDATE drafts SET data = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(json, now(), ctx.params.id, u.id);
    if (!res.changes) throw notFound('找不到这份草稿');
    return { ok: true };
  });

  r.delete('/api/drafts/:id', async (ctx) => {
    const u = requireUser(ctx);
    const res = db.prepare('DELETE FROM drafts WHERE id = ? AND user_id = ?').run(ctx.params.id, u.id);
    if (!res.changes) throw notFound('找不到这份草稿');
    return { ok: true };
  });
}
