// 聊天、图片、重新生成、纠错、记忆
import fs from 'node:fs';
import { now } from '../lib/db.mjs';
import { bad, HttpError, int, notFound, str } from '../lib/http.mjs';
import { requireUser } from '../lib/auth.mjs';
import { appendEvent, newId, visibleEventBySeq, visibleEvents } from '../lib/story.mjs';
import { generateReply, imageDir, imagePath, sniffImage } from '../lib/chat.mjs';
import { CORRECTION_TYPES } from '../lib/prompt.mjs';
import {
  invalidateMemoriesFromSources, processBranch, processedUpTo, visibleControlEvents, visibleMemories,
} from '../lib/memory.mjs';

const UI_KINDS = ['user_message', 'char_message', 'settings_change', 'correction'];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export default function chatRoutes(r, { db, model, config, limiter, log }) {
  function ownBranch(ctx, id) {
    const u = requireUser(ctx);
    const b = db
      .prepare('SELECT b.* FROM branches b JOIN characters c ON c.id = b.character_id WHERE b.id = ? AND c.user_id = ?')
      .get(id, u.id);
    if (!b) throw notFound('找不到这条世界线');
    return b;
  }
  const characterOf = (b) => db.prepare('SELECT * FROM characters WHERE id = ?').get(b.character_id);
  const touch = (c) => db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now(), c.id);

  function eventsSince(b, seq) {
    return visibleEvents(db, b, { afterSeq: seq - 1, limit: 20, kinds: UI_KINDS });
  }

  r.get('/api/branches/:id/events', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    const before = ctx.query.get('before');
    const limit = int(ctx.query.get('limit'), { name: '数量', min: 1, max: 200, fallback: 50 });
    const events = visibleEvents(db, b, {
      beforeSeq: before ? int(before, { name: '位置', min: 1, max: Number.MAX_SAFE_INTEGER }) : null,
      limit: limit + 1, kinds: UI_KINDS,
    });
    const hasMore = events.length > limit;
    const list = hasMore ? events.slice(1) : events;
    const lastMsg = visibleEvents(db, b, { limit: 1, kinds: ['user_message', 'char_message'] })[0];
    return {
      events: list, hasMore,
      needsReply: lastMsg?.kind === 'user_message',
      branch: { id: b.id, name: b.name, archived: !!b.archived_at },
    };
  });

  // —— 图片 ——
  r.post('/api/images', async (ctx) => {
    const u = requireUser(ctx);
    limiter.check(`img:${u.id}`, 30, 3600e3, '发图片太频繁了，请稍后再试');
    const c = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(String(ctx.body.characterId || ''), u.id);
    if (!c) throw notFound('找不到这个角色');
    const m = /^data:image\/[a-z+]+;base64,(.+)$/i.exec(String(ctx.body.dataUrl || ''));
    if (!m) throw bad('图片格式不对');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_IMAGE_BYTES) throw bad('图片太大了（最多 6MB）');
    const kind = sniffImage(buf);
    if (!kind) throw bad('只支持 JPG、PNG、WebP、GIF 图片');
    const img = { id: newId(), mime: kind.mime };
    fs.mkdirSync(imageDir(config), { recursive: true });
    fs.writeFileSync(imagePath(config, img), buf);
    db.prepare('INSERT INTO images (id, user_id, character_id, mime, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(img.id, u.id, c.id, img.mime, buf.length, int(ctx.body.width, { name: '宽', min: 1, max: 20000, fallback: null }), int(ctx.body.height, { name: '高', min: 1, max: 20000, fallback: null }), now());
    return { image: { id: img.id } };
  });

  r.get('/api/images/:id', async (ctx) => {
    const u = requireUser(ctx);
    const img = db.prepare('SELECT * FROM images WHERE id = ? AND user_id = ?').get(ctx.params.id, u.id);
    if (!img) throw notFound('找不到这张图片');
    const file = imagePath(config, img);
    if (!fs.existsSync(file)) throw notFound('图片文件丢失了');
    return { __file: { path: file, mime: img.mime } };
  });

  // —— 发消息 ——
  r.post('/api/branches/:id/messages', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    if (b.archived_at) throw bad('这条世界线已归档，恢复后才能继续聊天');
    limiter.check(`msg:${ctx.user.id}`, 20, 60e3, '发得太快了，歇一会儿再发');
    const text = str(ctx.body.text, { name: '消息', max: 4000 });
    const c = characterOf(b);
    let imageId = null;
    if (ctx.body.imageId) {
      const img = db.prepare('SELECT * FROM images WHERE id = ? AND user_id = ? AND character_id = ?').get(String(ctx.body.imageId), ctx.user.id, c.id);
      if (!img) throw bad('图片找不到了，请重新选择');
      imageId = img.id;
    }
    if (!text && !imageId) throw bad('请填写消息');
    const pendingLast = visibleEvents(db, b, { limit: 1, kinds: ['user_message', 'char_message'] })[0];
    const userSeq = appendEvent(db, { characterId: c.id, branchId: b.id, kind: 'user_message', data: imageId ? { text, imageId } : { text } });
    touch(c);
    try {
      await generateReply({ db, model, config, branch: b, character: c, log });
    } catch (err) {
      // 回复失败：用户消息已经保存，前端显示“重新生成”
      if (err instanceof HttpError) { err.extra = { ...err.extra, userSeq }; }
      throw err;
    }
    return { events: eventsSince(b, pendingLast?.kind === 'user_message' ? pendingLast.seq : userSeq) };
  });

  // —— 重新生成：替换最后一条角色回复，或补上失败的回复 ——
  r.post('/api/branches/:id/retry', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    if (b.archived_at) throw bad('这条世界线已归档');
    limiter.check(`msg:${ctx.user.id}`, 20, 60e3, '操作太快了，歇一会儿再试');
    const c = characterOf(b);
    const last = visibleEvents(db, b, { limit: 1, kinds: ['user_message', 'char_message'] })[0];
    if (!last) throw bad('还没有可以重新生成的内容');
    if (last.kind === 'char_message') {
      if (last.branchId !== b.id) throw bad('这条回复属于更早的世界线。想换个回复的话，先从上一条消息分出新世界线');
      db.prepare('UPDATE events SET hidden_at = ? WHERE seq = ?').run(now(), last.seq);
      invalidateMemoriesFromSources(db, b, [last.seq], 'regenerated');
    }
    const { userSeq } = await generateReply({ db, model, config, branch: b, character: c, log });
    return { replaced: last.kind === 'char_message' ? last.seq : null, events: eventsSince(b, userSeq) };
  });

  // —— 纠错：崩人设 / 记错事实 / 知道了不该知道的事 ——
  r.post('/api/branches/:id/corrections', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    const seq = int(ctx.body.seq, { name: '消息', min: 1, max: Number.MAX_SAFE_INTEGER });
    const type = String(ctx.body.type || '');
    if (!CORRECTION_TYPES[type]) throw bad('请选择问题类型');
    const note = str(ctx.body.note, { name: '补充说明', max: 200 });
    const ev = visibleEventBySeq(db, b, seq);
    if (!ev || ev.kind !== 'char_message') throw bad('只能对这条世界线里的角色回复纠错');
    const correctionSeq = appendEvent(db, { characterId: b.character_id, branchId: b.id, kind: 'correction', data: { targetSeq: seq, type, note } });
    const removed = invalidateMemoriesFromSources(db, b, [seq], `correction:${type}`);
    return { ok: true, removedMemories: removed, event: visibleEventBySeq(db, b, correctionSeq) };
  });

  // —— 记忆 ——
  r.get('/api/branches/:id/memories', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    const controls = visibleControlEvents(db, b);
    const upto = processedUpTo(controls);
    const unprocessed = visibleEvents(db, b, { afterSeq: upto, limit: 500, kinds: ['user_message', 'char_message'] }).length;
    return { memories: visibleMemories(db, b, { statuses: ['active', 'pending'], controls }), unprocessed };
  });

  r.post('/api/branches/:id/memories/process', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    limiter.check(`memproc:${ctx.user.id}`, 10, 3600e3, '整理太频繁了，请稍后再试');
    const res = await processBranch({ db, model, config, branchId: b.id, force: true, log });
    if (res.skipped === 'error') throw new HttpError(502, res.error || '整理失败，请稍后再试');
    if (res.skipped === 'running') throw new HttpError(409, '正在整理中，请稍等');
    return res;
  });

  r.post('/api/branches/:id/memories/:memoryId', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    const action = ctx.body.action;
    if (action !== 'confirm' && action !== 'delete') throw bad('不支持的操作');
    const m = visibleMemories(db, b, { statuses: ['active', 'pending'] }).find((x) => x.id === ctx.params.memoryId);
    if (!m) throw notFound('找不到这条记忆');
    appendEvent(db, { characterId: b.character_id, branchId: b.id, kind: 'memory_override', data: { memoryId: m.id, action, reason: action === 'delete' ? 'user_deleted' : null } });
    return { ok: true };
  });
}
