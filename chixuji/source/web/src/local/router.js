// 纯前端版的“服务器”：网址和返回内容与服务器版一致，界面代码可以不改直接用
import { bad, HttpError, int, notFound, Router, str } from '../../../server/lib/http.mjs';
import { cleanSettings, SETTING_FIELDS } from '../../../server/lib/fields.mjs';
import { CORRECTION_TYPES } from '../../../server/lib/prompt.mjs';
import {
  appendEvent, createSettingVersion, effectiveSettings, generateReply, getBranch, invalidateMemoriesFromSources,
  MESSAGE_KINDS, newId, now, processBranch, processedUpTo, visibleControlEvents, visibleEventBySeq, visibleEvents, visibleMemories,
} from './logic.js';
import { DEFAULT_MODEL_SETTINGS } from './model.js';
import { fetchForecast, localDate, recordDailyWeather, refreshWeather, reverseCity, searchCity } from './weather.js';
import { unpackDoll } from '../doll.js';
import { characterAsk, doPhoneCheck, openRequest, placeText, sameWorldOthers } from './phone.js';
import { askState, askToSee, closePhone, localDay, openPhone, phoneDays, phoneView } from './charphone.js';
import { afterPhoto, FRAMES, ITEMS, memorySnippet, PHOTO_SLOTS, removePhoto, roomState, SHELF_SLOTS } from './room.js';
import { AUDIO_PREFIX, COVER_PREFIX, endSession, listenedTogether, planRemarks, replyDuringSong, TEXT_FIELDS, trackView } from './music.js';
import { characterReact, characterReplyComment, diaryCoverage, feed, notifications, NOTIFY_TYPES, removeMoment, tick, unreadCounts, writeDiary } from './social.js';

const MAX_CHARACTERS = 50;
const MAX_BRANCHES = 200;
const COLORS = ['#e8a0b4', '#9db4e8', '#a8d5ba', '#f2c48d', '#c3a6e0', '#8fd0d6', '#e6b8a2', '#b5c99a'];
const UI_KINDS = ['user_message', 'char_message', 'settings_change', 'correction', 'phone_request', 'phone_check'];
export const LOCAL_USER = { id: 'local', email: '本机', isAdmin: false, points: 0, local: true };

export function createRouter({ s, model, avatarCache, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  const r = new Router();
  const meta = (key, fallback = null) => s.t.meta.find((m) => m.key === key)?.value ?? fallback;
  const setMeta = (key, value) => {
    const row = s.t.meta.find((m) => m.key === key);
    if (row) row.value = value; else s.t.meta.push({ key, value });
    s.touch('meta');
  };
  // 填了密钥就一定用真模型：体验模式只在还没有密钥时生效（以前有人勾着体验模式又填了密钥，结果一直是测试回复）
  const modelSettings = () => {
    const c = { ...DEFAULT_MODEL_SETTINGS, ...(meta('modelSettings') || {}) };
    if (c.apiKey) c.mock = false;
    return c;
  };

  const character = (id) => { const c = s.t.characters.find((x) => x.id === id); if (!c) throw notFound('找不到这个角色'); return c; };
  const branch = (id) => { const b = getBranch(s, id); if (!b) throw notFound('找不到这条世界线'); return b; };
  const branchName = (id) => (id ? getBranch(s, id)?.name ?? null : null);

  function characterView(c) {
    const view = c.viewBranchId ? getBranch(s, c.viewBranchId) : null;
    const settings = view ? effectiveSettings(s, view) : null;
    const w = c.worldId ? s.t.worlds.find((x) => x.id === c.worldId) : null;
    return {
      id: c.id, name: c.name, avatarColor: c.avatarColor, look: c.look || null, doll: c.doll || null,
      avatarUrl: c.avatarId ? avatarCache.get(c.avatarId) ?? null : null,
      world: w ? { id: w.id, name: w.name } : null,
      viewBranch: view ? { id: view.id, name: view.name, archived: !!view.archivedAt } : null,
      background: { enabled: !!c.backgroundEnabled, branchId: c.backgroundBranchId, branchName: branchName(c.backgroundBranchId) },
      settingsVersion: settings?.version ?? null, createdAt: c.createdAt, updatedAt: c.updatedAt,
    };
  }
  const touchChar = (c) => { c.updatedAt = now(); s.touch('characters'); };

  // —— 本机“账号” ——
  const meView = () => { const a = meta('myAvatarId'); return { ...LOCAL_USER, avatarUrl: a ? avatarCache.get(a) ?? null : null, name: meta('myName', '我') }; };
  r.get('/api/me', async () => {
    if (!meta('adultConfirmedAt')) throw new HttpError(401, '需要先完成首次设置');
    return { user: meView() };
  });
  // 玩家自己的头像和名字（聊天、朋友圈里都用这个）
  r.post('/api/local/profile', async (ctx) => {
    if (ctx.body.avatarId !== undefined) {
      const id = ctx.body.avatarId ? String(ctx.body.avatarId) : null;
      if (id && !s.t.avatars.some((a) => a.id === id)) throw bad('头像找不到了，请重新上传');
      setMeta('myAvatarId', id);
    }
    if (ctx.body.name !== undefined) setMeta('myName', str(ctx.body.name, { name: '名字', min: 1, max: 20 }));
    return { user: meView() };
  });
  r.post('/api/local/welcome', async (ctx) => {
    if (ctx.body.adultConfirmed !== true || ctx.body.termsAccepted !== true) throw bad('需要确认年满 18 周岁并同意说明');
    setMeta('adultConfirmedAt', now());
    return { user: LOCAL_USER };
  });
  r.get('/api/meta', async () => ({ settingFields: SETTING_FIELDS }));

  // —— 角色 ——
  r.get('/api/characters', async () => ({ characters: [...s.t.characters].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(characterView) }));

  r.post('/api/characters', async (ctx) => {
    const name = str(ctx.body.name, { name: '角色名', min: 1, max: 30 });
    const settings = cleanSettings(ctx.body.settings || {});
    const worldId = ctx.body.worldId ? String(ctx.body.worldId) : null;
    if (!worldId || !s.t.worlds.some((w) => w.id === worldId)) throw bad('请选择 TA 生活在哪个世界');
    const avatarId = ctx.body.avatarId ? String(ctx.body.avatarId) : null;
    if (avatarId && !s.t.avatars.some((a) => a.id === avatarId)) throw bad('头像找不到了，请重新上传');
    const count = s.t.characters.length;
    if (count >= MAX_CHARACTERS) throw bad(`最多可以创建 ${MAX_CHARACTERS} 个角色`);
    const t = now();
    const c = { id: newId(), name, avatarColor: COLORS[count % COLORS.length], worldId, avatarId, viewBranchId: null, backgroundEnabled: false, backgroundBranchId: null, createdAt: t, updatedAt: t };
    s.insert('characters', c);
    const b = { id: newId(), characterId: c.id, name: '主线', parentId: null, forkSeq: null, createdAt: t, archivedAt: null };
    s.insert('branches', b);
    const v = createSettingVersion(s, c.id, settings, '初始设定');
    appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'settings_change', data: { versionId: v.id, version: v.version, note: '初始设定' } });
    c.viewBranchId = b.id;
    if (ctx.body.draftId) s.remove('drafts', (d) => d.id === String(ctx.body.draftId));
    return { character: characterView(c) };
  });

  r.get('/api/characters/:id', async (ctx) => ({ character: characterView(character(ctx.params.id)) }));

  r.patch('/api/characters/:id', async (ctx) => {
    const c = character(ctx.params.id);
    if (ctx.body.name !== undefined) c.name = str(ctx.body.name, { name: '角色名', min: 1, max: 30 });
    if (ctx.body.worldId !== undefined) {
      const w = ctx.body.worldId ? s.t.worlds.find((x) => x.id === String(ctx.body.worldId)) : null;
      if (ctx.body.worldId && !w) throw bad('找不到这个世界');
      c.worldId = w?.id ?? null;
    }
    if (ctx.body.avatarId !== undefined) {
      const a = ctx.body.avatarId ? s.t.avatars.find((x) => x.id === String(ctx.body.avatarId)) : null;
      if (ctx.body.avatarId && !a) throw bad('头像找不到了，请重新上传');
      c.avatarId = a?.id ?? null;
    }
    // 房间里的形象：预设的几套小人
    if (ctx.body.look !== undefined) {
      if (ctx.body.look === 'doll' && !c.doll) throw bad('还没有画小人');
      if (ctx.body.look !== null && ctx.body.look !== 'doll' && !LOOKS.includes(ctx.body.look)) throw bad('没有这个形象');
      c.look = ctx.body.look;
    }
    touchChar(c);
    return { character: characterView(c) };
  });

  r.delete('/api/characters/:id', async (ctx) => {
    const c = character(ctx.params.id);
    if (str(ctx.body.confirmName, { name: '角色名', min: 1, max: 30 }) !== c.name) throw bad('输入的角色名不一致');
    for (const img of s.t.images.filter((i) => i.characterId === c.id)) await s.deleteBlob(img.id);
    s.remove('images', (i) => i.characterId === c.id);
    s.remove('events', (e) => e.characterId === c.id);
    s.remove('memories', (m) => m.characterId === c.id);
    s.remove('settingVersions', (v) => v.characterId === c.id);
    s.remove('branches', (b) => b.characterId === c.id);
    s.remove('phones', (x) => x.characterId === c.id);
    s.remove('characters', (x) => x.id === c.id);
    return { ok: true };
  });

  // —— 设定 ——
  r.get('/api/characters/:id/settings', async (ctx) => {
    const c = character(ctx.params.id);
    const b = ctx.query.get('branchId') ? branch(ctx.query.get('branchId')) : getBranch(s, c.viewBranchId);
    if (b.characterId !== c.id) throw notFound();
    return { branchId: b.id, branchName: b.name, settings: effectiveSettings(s, b), fields: SETTING_FIELDS };
  });
  r.get('/api/characters/:id/setting-versions', async (ctx) => {
    const c = character(ctx.params.id);
    return { versions: s.t.settingVersions.filter((v) => v.characterId === c.id).sort((a, b) => b.version - a.version).map((v) => ({ id: v.id, version: v.version, note: v.note, createdAt: v.createdAt })) };
  });
  r.post('/api/characters/:id/settings', async (ctx) => {
    const c = character(ctx.params.id);
    const data = cleanSettings(ctx.body.data);
    const note = str(ctx.body.note, { name: '修改说明', max: 100 });
    const scope = ctx.body.scope === 'all' ? 'all' : 'current';
    const b = ctx.body.branchId ? branch(ctx.body.branchId) : getBranch(s, c.viewBranchId);
    if (b.characterId !== c.id) throw notFound();
    const targets = scope === 'all' ? s.t.branches.filter((x) => x.characterId === c.id && !x.archivedAt) : [b];
    const v = createSettingVersion(s, c.id, data, note);
    for (const t of targets) appendEvent(s, { characterId: c.id, branchId: t.id, kind: 'settings_change', data: { versionId: v.id, version: v.version, note } });
    touchChar(c);
    return { version: v.version, appliedTo: targets.map((x) => ({ id: x.id, name: x.name })) };
  });

  // —— 世界线 ——
  r.get('/api/characters/:id/branches', async (ctx) => {
    const c = character(ctx.params.id);
    const rows = s.t.branches.filter((b) => b.characterId === c.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const mainId = rows.find((b) => !b.parentId)?.id;
    const counts = new Map();
    const firstOf = new Map(); const lastOf = new Map();
    for (const e of s.t.events) {
      if (e.characterId !== c.id || !MESSAGE_KINDS.includes(e.kind) || e.hiddenAt) continue;
      counts.set(e.branchId, (counts.get(e.branchId) || 0) + 1);
      if (!firstOf.has(e.branchId) || e.seq < firstOf.get(e.branchId).seq) firstOf.set(e.branchId, e);
      if (!lastOf.has(e.branchId) || e.seq > lastOf.get(e.branchId).seq) lastOf.set(e.branchId, e);
    }
    const brief = (e) => (e ? { seq: e.seq, kind: e.kind, text: (e.data.text || '（图片）').slice(0, 40), at: e.createdAt } : null);
    return {
      viewBranchId: c.viewBranchId, background: characterView(c).background,
      branches: rows.map((b) => {
        let forkPreview = null;
        if (b.parentId) {
          const [ev] = visibleEvents(s, getBranch(s, b.parentId), { beforeSeq: b.forkSeq + 1, limit: 1, kinds: MESSAGE_KINDS });
          forkPreview = ev ? { seq: ev.seq, kind: ev.kind, text: (ev.data.text || '（图片）').slice(0, 40) } : null;
        }
        return { id: b.id, name: b.name, parentId: b.parentId, forkSeq: b.forkSeq, forkPreview, ownMessages: counts.get(b.id) || 0, first: brief(firstOf.get(b.id)), last: brief(lastOf.get(b.id)), archived: !!b.archivedAt, isMain: b.id === mainId, createdAt: b.createdAt, isView: b.id === c.viewBranchId, isBackground: b.id === c.backgroundBranchId };
      }),
    };
  });

  r.post('/api/characters/:id/branches', async (ctx) => {
    const c = character(ctx.params.id);
    const name = str(ctx.body.name, { name: '世界线名称', min: 1, max: 30 });
    if (s.t.branches.filter((b) => b.characterId === c.id).length >= MAX_BRANCHES) throw bad(`每个角色最多 ${MAX_BRANCHES} 条世界线`);
    const settings = effectiveSettings(s, getBranch(s, c.viewBranchId));
    const b = { id: newId(), characterId: c.id, name, parentId: null, forkSeq: null, createdAt: now(), archivedAt: null };
    s.insert('branches', b);
    if (settings) appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'settings_change', data: { versionId: settings.versionId, version: settings.version, note: '新世界线' } });
    c.viewBranchId = b.id;
    touchChar(c);
    return { branch: { id: b.id, name } };
  });

  r.post('/api/branches/:id/fork', async (ctx) => {
    const from = branch(ctx.params.id);
    const seq = int(ctx.body.seq, { name: '消息位置', min: 1, max: Number.MAX_SAFE_INTEGER });
    const mode = ctx.body.mode === 'before' ? 'before' : 'include';
    const name = str(ctx.body.name, { name: '世界线名称', min: 1, max: 30 });
    const ev = visibleEventBySeq(s, from, seq);
    if (!ev || !MESSAGE_KINDS.includes(ev.kind)) throw bad('只能从这条世界线里的消息分叉');
    if (s.t.branches.filter((b) => b.characterId === from.characterId).length >= MAX_BRANCHES) throw bad(`每个角色最多 ${MAX_BRANCHES} 条世界线`);
    const b = { id: newId(), characterId: from.characterId, name, parentId: ev.branchId, forkSeq: mode === 'include' ? ev.seq : ev.seq - 1, createdAt: now(), archivedAt: null };
    s.insert('branches', b);
    const c = character(from.characterId);
    c.viewBranchId = b.id;
    touchChar(c);
    return { branch: { id: b.id, name, parentId: b.parentId, forkSeq: b.forkSeq }, prefill: mode === 'before' && ev.kind === 'user_message' ? ev.data.text : null };
  });

  r.patch('/api/branches/:id', async (ctx) => {
    const b = branch(ctx.params.id);
    const c = character(b.characterId);
    if (ctx.body.name !== undefined) b.name = str(ctx.body.name, { name: '世界线名称', min: 1, max: 30 });
    const main = s.t.branches.filter((x) => x.characterId === c.id && !x.parentId).sort((a, b2) => a.createdAt.localeCompare(b2.createdAt))[0];
    if (ctx.body.archived === true && !b.archivedAt) {
      if (main.id === b.id) throw bad('主线不能归档');
      b.archivedAt = now();
      if (c.viewBranchId === b.id) c.viewBranchId = main.id;
      if (c.backgroundBranchId === b.id) { c.backgroundBranchId = null; c.backgroundEnabled = false; }
    }
    if (ctx.body.archived === false) b.archivedAt = null;
    s.touch('branches');
    touchChar(c);
    return { ok: true };
  });

  r.post('/api/characters/:id/view', async (ctx) => {
    const c = character(ctx.params.id);
    const b = branch(str(ctx.body.branchId, { name: '世界线', min: 1, max: 64 }));
    if (b.characterId !== c.id) throw notFound();
    c.viewBranchId = b.id;
    touchChar(c);
    return { character: characterView(c) };
  });

  r.post('/api/characters/:id/background', async (ctx) => {
    const c = character(ctx.params.id);
    let branchId = c.backgroundBranchId;
    if (ctx.body.branchId !== undefined) {
      if (ctx.body.branchId === null) branchId = null;
      else {
        const b = branch(String(ctx.body.branchId));
        if (b.characterId !== c.id) throw notFound();
        if (b.archivedAt) throw bad('已归档的世界线不能设为后台活动线');
        branchId = b.id;
      }
    }
    let enabled = ctx.body.enabled !== undefined ? ctx.body.enabled === true : !!c.backgroundEnabled;
    if (enabled && !branchId) throw bad('请先指定一条后台活动世界线');
    if (!branchId) enabled = false;
    c.backgroundEnabled = enabled;
    c.backgroundBranchId = branchId;
    touchChar(c);
    return { character: characterView(c) };
  });

  // —— 聊天 ——
  const eventsSince = (b, seq) => visibleEvents(s, b, { afterSeq: seq - 1, limit: 20, kinds: UI_KINDS, order: 'earliest' });
  r.get('/api/branches/:id/events', async (ctx) => {
    const b = branch(ctx.params.id);
    const before = ctx.query.get('before');
    const limit = int(ctx.query.get('limit'), { name: '数量', min: 1, max: 200, fallback: 50 });
    const events = visibleEvents(s, b, { beforeSeq: before ? Number(before) : null, limit: limit + 1, kinds: UI_KINDS });
    const hasMore = events.length > limit;
    const lastMsg = visibleEvents(s, b, { limit: 1, kinds: MESSAGE_KINDS })[0];
    return { events: hasMore ? events.slice(1) : events, hasMore, needsReply: lastMsg?.kind === 'user_message', branch: { id: b.id, name: b.name, archived: !!b.archivedAt } };
  });

  r.post('/api/images', async (ctx) => {
    const c = character(String(ctx.body.characterId || ''));
    const dataUrl = String(ctx.body.dataUrl || '');
    if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(dataUrl)) throw bad('只支持 JPG、PNG、WebP、GIF 图片');
    if (dataUrl.length > 9 * 1024 * 1024) throw bad('图片太大了');
    const id = newId();
    await s.putBlob(id, dataUrl);
    s.insert('images', { id, characterId: c.id, size: dataUrl.length, createdAt: now() });
    return { image: { id } };
  });

  r.post('/api/branches/:id/messages', async (ctx) => {
    const b = branch(ctx.params.id);
    if (b.archivedAt) throw bad('这条世界线已归档，恢复后才能继续聊天');
    const text = str(ctx.body.text, { name: '消息', max: 4000 });
    const c = character(b.characterId);
    let imageId = null;
    if (ctx.body.imageId) {
      const img = s.t.images.find((i) => i.id === String(ctx.body.imageId) && i.characterId === c.id);
      if (!img) throw bad('图片找不到了，请重新选择');
      imageId = img.id;
    }
    let music = null;
    if (ctx.body.musicTrackId) {
      const t = s.t.tracks.find((x) => x.id === String(ctx.body.musicTrackId));
      if (!t) throw bad('这首歌找不到了');
      music = { trackId: t.id, title: t.title, artist: t.artist || '' };
    }
    if (!text && !imageId && !music) throw bad('请填写消息');
    const pendingLast = visibleEvents(s, b, { limit: 1, kinds: MESSAGE_KINDS })[0];
    const msgData = { text };
    if (imageId) msgData.imageId = imageId;
    if (music) msgData.music = music;
    const userSeq = appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'user_message', data: msgData });
    touchChar(c);
    try {
      await generateReply({ s, model, settings: modelSettings(), branch: b, character: c });
    } catch (err) {
      if (err instanceof HttpError) err.extra = { ...err.extra, userSeq };
      throw err;
    }
    return { events: eventsSince(b, pendingLast?.kind === 'user_message' ? pendingLast.seq : userSeq) };
  });

  r.post('/api/branches/:id/retry', async (ctx) => {
    const b = branch(ctx.params.id);
    if (b.archivedAt) throw bad('这条世界线已归档');
    const c = character(b.characterId);
    const last = visibleEvents(s, b, { limit: 1, kinds: MESSAGE_KINDS })[0];
    if (!last) throw bad('还没有可以重新生成的内容');
    if (last.kind === 'char_message') {
      if (last.branchId !== b.id) throw bad('这条回复属于更早的世界线。想换个回复的话，先从上一条消息分出新世界线');
      s.eventIndex.get(last.seq).hiddenAt = now();
      s.touch('events');
      invalidateMemoriesFromSources(s, b, [last.seq], 'regenerated');
    }
    const { userSeq } = await generateReply({ s, model, settings: modelSettings(), branch: b, character: c });
    return { replaced: last.kind === 'char_message' ? last.seq : null, events: eventsSince(b, userSeq) };
  });

  r.post('/api/branches/:id/corrections', async (ctx) => {
    const b = branch(ctx.params.id);
    const seq = int(ctx.body.seq, { name: '消息', min: 1, max: Number.MAX_SAFE_INTEGER });
    const type = String(ctx.body.type || '');
    if (!CORRECTION_TYPES[type]) throw bad('请选择问题类型');
    const note = str(ctx.body.note, { name: '补充说明', max: 200 });
    const ev = visibleEventBySeq(s, b, seq);
    if (!ev || ev.kind !== 'char_message') throw bad('只能对这条世界线里的角色回复纠错');
    const cs = appendEvent(s, { characterId: b.characterId, branchId: b.id, kind: 'correction', data: { targetSeq: seq, type, note } });
    const removed = invalidateMemoriesFromSources(s, b, [seq], `correction:${type}`);
    return { ok: true, removedMemories: removed, event: visibleEventBySeq(s, b, cs) };
  });

  r.get('/api/branches/:id/memories', async (ctx) => {
    const b = branch(ctx.params.id);
    const controls = visibleControlEvents(s, b);
    const upto = processedUpTo(controls);
    return { memories: visibleMemories(s, b, { statuses: ['active', 'pending'], controls }), unprocessed: visibleEvents(s, b, { afterSeq: upto, limit: 1e9, kinds: MESSAGE_KINDS }).length };
  });
  r.post('/api/branches/:id/memories/process', async (ctx) => {
    const b = branch(ctx.params.id);
    const res = await processBranch({ s, model, settings: modelSettings(), branchId: b.id, force: true });
    if (res.skipped === 'error') throw new HttpError(502, res.error || '整理失败，请稍后再试');
    if (res.skipped === 'running') throw new HttpError(409, '正在整理中，请稍等');
    return res;
  });
  r.post('/api/branches/:id/memories/:memoryId', async (ctx) => {
    const b = branch(ctx.params.id);
    const action = ctx.body.action;
    if (action !== 'confirm' && action !== 'delete') throw bad('不支持的操作');
    const m = visibleMemories(s, b, { statuses: ['active', 'pending'] }).find((x) => x.id === ctx.params.memoryId);
    if (!m) throw notFound('找不到这条记忆');
    appendEvent(s, { characterId: b.characterId, branchId: b.id, kind: 'memory_override', data: { memoryId: m.id, action, reason: action === 'delete' ? 'user_deleted' : null } });
    return { ok: true };
  });

  // —— 世界 ——
  const worldView = (w) => ({ id: w.id, name: w.name, lore: w.lore, createdAt: w.createdAt, updatedAt: w.updatedAt, characters: s.t.characters.filter((c) => c.worldId === w.id).map((c) => ({ id: c.id, name: c.name })) });
  const world = (id) => { const w = s.t.worlds.find((x) => x.id === id); if (!w) throw notFound('找不到这个世界'); return w; };
  r.get('/api/worlds', async () => ({ worlds: [...s.t.worlds].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(worldView) }));
  r.post('/api/worlds', async (ctx) => {
    const w = { id: newId(), name: str(ctx.body.name, { name: '世界名称', min: 1, max: 30 }), lore: str(ctx.body.lore, { name: '世界观', min: 1, max: 8000 }), createdAt: now(), updatedAt: now() };
    s.insert('worlds', w);
    return { world: worldView(w) };
  });
  r.patch('/api/worlds/:id', async (ctx) => {
    const w = world(ctx.params.id);
    if (ctx.body.name !== undefined) w.name = str(ctx.body.name, { name: '世界名称', min: 1, max: 30 });
    if (ctx.body.lore !== undefined) w.lore = str(ctx.body.lore, { name: '世界观', min: 1, max: 8000 });
    w.updatedAt = now();
    s.touch('worlds');
    return { world: worldView(w) };
  });
  r.delete('/api/worlds/:id', async (ctx) => {
    const w = world(ctx.params.id);
    const n = s.t.characters.filter((c) => c.worldId === w.id).length;
    if (n) throw bad(`这个世界里还有 ${n} 个人物，先把他们移到别的世界或删除`);
    s.remove('worlds', (x) => x.id === w.id);
    return { ok: true };
  });

  // —— 头像 ——
  r.post('/api/avatars', async (ctx) => {
    const dataUrl = String(ctx.body.dataUrl || '');
    if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(dataUrl)) throw bad('只支持 JPG、PNG、WebP、GIF 图片');
    if (dataUrl.length > 4 * 1024 * 1024) throw bad('头像太大了');
    const id = newId();
    await s.putBlob(id, dataUrl);
    avatarCache.set(id, dataUrl);
    s.insert('avatars', { id, size: dataUrl.length, createdAt: now() });
    return { avatar: { id, url: dataUrl } };
  });

  // —— 草稿箱 ——
  const draftView = (d) => ({ id: d.id, data: d.data, createdAt: d.createdAt, updatedAt: d.updatedAt });
  const cleanDraft = (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw bad('草稿格式不对');
    if (JSON.stringify(data).length > 5 * 1024 * 1024) throw bad('草稿太长了');
    const copy = JSON.parse(JSON.stringify(data));
    if (copy.avatarUrl && copy.avatarUrl.startsWith('data:')) copy.avatarUrl = null; // 头像只存编号，不重复存图片
    return copy;
  };
  const withAvatar = (d) => { const v = draftView(d); if (v.data.avatarId) v.data = { ...v.data, avatarUrl: avatarCache.get(v.data.avatarId) ?? null }; return v; };
  r.get('/api/drafts', async () => ({ drafts: [...s.t.drafts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(withAvatar) }));
  r.post('/api/drafts', async (ctx) => {
    const d = { id: newId(), data: cleanDraft(ctx.body.data), createdAt: now(), updatedAt: now() };
    s.insert('drafts', d);
    return { draft: withAvatar(d) };
  });
  r.patch('/api/drafts/:id', async (ctx) => {
    const d = s.t.drafts.find((x) => x.id === ctx.params.id);
    if (!d) throw notFound('找不到这份草稿');
    d.data = cleanDraft(ctx.body.data);
    d.updatedAt = now();
    s.touch('drafts');
    return { ok: true };
  });
  r.delete('/api/drafts/:id', async (ctx) => {
    if (!s.remove('drafts', (x) => x.id === ctx.params.id)) throw notFound('找不到这份草稿');
    return { ok: true };
  });

  // —— 纯前端版专属：模型设置、用量、备份 ——
  r.get('/api/local/settings', async () => {
    const m = modelSettings();
    return { settings: { ...m, notify: m.notify || DEFAULT_NOTIFY, apiKey: m.apiKey ? maskKey(m.apiKey) : '', auxApiKey: m.auxApiKey ? maskKey(m.auxApiKey) : '' }, hasKey: !!m.apiKey, hasAuxKey: !!m.auxApiKey };
  });
  r.post('/api/local/settings', async (ctx) => {
    const cur = modelSettings();
    const b = ctx.body || {};
    const next = { ...cur };
    for (const k of ['baseUrl', 'auxBaseUrl', 'chatModel', 'visionModel', 'memoryModel']) {
      if (b[k] !== undefined) next[k] = str(b[k], { name: k, max: 300 });
    }
    for (const k of ['apiKey', 'auxApiKey']) {
      // 显示的是打码的密钥：没改动就保留原来的
      if (b[k] !== undefined && !String(b[k]).includes('•')) next[k] = str(b[k], { name: '密钥', max: 500 });
    }
    if (b.reasoning !== undefined) next.reasoning = ['none', 'low', 'high'].includes(b.reasoning) ? b.reasoning : 'none';
    if (b.memoryEvery !== undefined) next.memoryEvery = int(b.memoryEvery, { name: '整理间隔', min: 2, max: 100 });
    if (b.mock !== undefined) next.mock = b.mock === true;
    for (const k of ['autoMoments', 'readMoments', 'autoDiary', 'innerVoice', 'phoneCheck', 'locationMemory']) if (b[k] !== undefined) next[k] = b[k] === true;
    if (b.locationLevel !== undefined) next.locationLevel = b.locationLevel === 'city' ? 'city' : 'street';
    if (b.notify !== undefined) next.notify = cleanNotify(b.notify, next.notify);
    if (next.baseUrl && !/^https?:\/\//.test(next.baseUrl)) throw bad('接口地址要以 https:// 开头');
    if (next.auxBaseUrl && !/^https?:\/\//.test(next.auxBaseUrl)) throw bad('看图和记忆的接口地址要以 https:// 开头');
    setMeta('modelSettings', next);
    return { ok: true };
  });
  r.post('/api/local/test', async (ctx) => {
    const kind = ctx.body.kind === 'aux' ? 'aux' : 'reply';
    try {
      const text = await model.test(kind);
      return { ok: true, reply: text };
    } catch (err) { throw new HttpError(502, err.message); }
  });
  r.get('/api/local/usage', async () => {
    const since = (days) => Date.now() - days * 86400e3;
    const sum = (rows) => {
      const by = {};
      for (const x of rows) { const k = x.purpose; by[k] ||= { purpose: k, calls: 0, failed: 0, costYuan: 0 }; by[k].calls++; if (!x.ok) by[k].failed++; by[k].costYuan += x.costYuan || 0; }
      return Object.values(by);
    };
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    return {
      today: sum(s.t.modelCalls.filter((x) => Date.parse(x.createdAt) >= startToday.getTime())),
      week: sum(s.t.modelCalls.filter((x) => Date.parse(x.createdAt) >= since(7))),
      topUsersToday: [],
    };
  });

  // —— 朋友圈 ——
  const later = (fn, ms) => setTimeout(() => { fn().catch(() => {}).finally(() => s.flush()); }, ms);
  const reactDelay = () => 2000 + Math.floor(Math.random() * 6000);
  r.get('/api/branches/:id/moments', async (ctx) => {
    const b = branch(ctx.params.id);
    return feed(s, b, character(b.characterId));
  });
  r.post('/api/branches/:id/moments', async (ctx) => {
    const b = branch(ctx.params.id);
    if (b.archivedAt) throw bad('这条世界线已归档');
    const c = character(b.characterId);
    const text = str(ctx.body.text, { name: '内容', max: 2000 });
    const imageIds = Array.isArray(ctx.body.imageIds) ? ctx.body.imageIds.map(String).slice(0, 9) : [];
    for (const id of imageIds) if (!s.t.images.some((i) => i.id === id && i.characterId === c.id)) throw bad('图片找不到了，请重新选择');
    if (!text && !imageIds.length) throw bad('写点什么或者选张图片');
    const seq = appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'moment', data: { author: 'user', text, imageIds } });
    const cfg = modelSettings();
    // TA 过一会儿才看到你的朋友圈
    if (cfg.readMoments) later(async () => { if (await characterReact(s, model, c, b, seq)) await processBranch({ s, model, settings: cfg, branchId: b.id, force: true }); }, reactDelay());
    return { seq };
  });
  r.post('/api/branches/:id/moments/:seq/like', async (ctx) => {
    const b = branch(ctx.params.id);
    const seq = Number(ctx.params.seq);
    const post = feed(s, b, character(b.characterId)).posts.find((p) => p.seq === seq);
    if (!post) throw notFound('找不到这条朋友圈');
    const liked = post.likes.includes('user');
    appendEvent(s, { characterId: b.characterId, branchId: b.id, kind: 'moment_like', data: { momentSeq: seq, author: 'user', unlike: liked } });
    return { liked: !liked };
  });
  r.post('/api/branches/:id/moments/:seq/comments', async (ctx) => {
    const b = branch(ctx.params.id);
    const c = character(b.characterId);
    const seq = Number(ctx.params.seq);
    const post = feed(s, b, c).posts.find((p) => p.seq === seq);
    if (!post) throw notFound('找不到这条朋友圈');
    const text = str(ctx.body.text, { name: '评论', min: 1, max: 300 });
    appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'moment_comment', data: { momentSeq: seq, author: 'user', text } });
    const cfg = modelSettings();
    if (cfg.readMoments && post.author === 'character') later(() => characterReplyComment(s, model, c, b, seq, text), reactDelay());
    return { ok: true };
  });

  // 删除自己的 / 隐藏 TA 的（动态或评论）
  const removeRoute = (target) => async (ctx) => {
    const b = branch(ctx.params.id);
    const r = await removeMoment(s, b, { target, targetSeq: Number(ctx.params.seq), forget: ctx.body.forget === true });
    if (r.error === 'not_found') throw notFound(target === 'moment' ? '找不到这条朋友圈' : '找不到这条评论');
    if (r.error) throw bad('已经删除过了');
    return r;
  };
  r.post('/api/branches/:id/moments/:seq/remove', removeRoute('moment'));
  r.post('/api/branches/:id/comments/:seq/remove', removeRoute('comment'));

  function okImage(v) { const d = String(v || ''); if (!/^data:image\/(jpeg|png|webp|gif);base64,/i.test(d)) throw bad('只支持 JPG、PNG、WebP、GIF 图片'); if (d.length > 9 * 1024 * 1024) throw bad('图片太大了'); return d; }
  // —— TA 查你的手机 ——
  r.get('/api/characters/:id/phone', async (ctx) => {
    const c = character(ctx.params.id);
    const cfg = modelSettings();
    const b = getBranch(s, c.viewBranchId);
    const req = b ? openRequest(s, b) : null;
    return { enabled: !!cfg.phoneCheck, level: cfg.locationLevel || 'street', others: sameWorldOthers(s, c).map((o) => ({ id: o.id, name: o.name })), openRequest: req ? { seq: req.seq, what: req.data.what } : null };
  });
  r.post('/api/branches/:id/phone', async (ctx) => {
    const b = branch(ctx.params.id);
    if (b.archivedAt) throw bad('这条世界线已归档');
    const c = character(b.characterId);
    const cfg = modelSettings();
    if (!cfg.phoneCheck) throw bad('「TA 查手机」在设置里关着');
    const what = ctx.body.what === 'chats' ? 'chats' : 'location';
    const approve = ctx.body.approve !== false;
    let place = null;
    if (approve && what === 'location') {
      const lat = Number(ctx.body.lat); const lon = Number(ctx.body.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw bad('没拿到位置');
      place = await placeText(fetchImpl, lat, lon, cfg.locationLevel || 'street');
    }
    const requestSeq = ctx.body.requestSeq ? Number(ctx.body.requestSeq) : null;
    const before = s.seq;
    try {
      const r2 = await doPhoneCheck(s, model, cfg, c, b, { what, approve, requestSeq, place, chatIds: Array.isArray(ctx.body.chatIds) ? ctx.body.chatIds.map(String) : [] });
      return { ...r2, place, events: visibleEvents(s, b, { afterSeq: before, limit: 20, kinds: UI_KINDS, order: 'earliest' }) };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw bad(err.message);
    }
  });

  // —— 聊天背景（按人物） ——
  r.get('/api/characters/:id/chatbg', async (ctx) => {
    const c = character(ctx.params.id);
    const bg = c.chatBg || {};
    return { image: bg.has ? (await s.getBlob('chatbg:' + c.id)) || null : null, dim: bg.dim ?? 25, blur: bg.blur ?? 0 };
  });
  r.post('/api/characters/:id/chatbg', async (ctx) => {
    const c = character(ctx.params.id);
    const bg = { dim: 25, blur: 0, has: false, ...(c.chatBg || {}) };
    if (ctx.body.dataUrl !== undefined) {
      if (ctx.body.dataUrl) { await s.putBlob('chatbg:' + c.id, okImage(ctx.body.dataUrl)); bg.has = true; }
      else { await s.deleteBlob('chatbg:' + c.id); bg.has = false; bg.dim = 25; bg.blur = 0; }
    }
    if (ctx.body.dim !== undefined) bg.dim = int(ctx.body.dim, { name: '变暗程度', min: 0, max: 85 });
    if (ctx.body.blur !== undefined) bg.blur = int(ctx.body.blur, { name: '模糊程度', min: 0, max: 20 });
    c.chatBg = bg;
    touchChar(c);
    return { ok: true };
  });

  // —— 自己画的像素小人（人物的 / 玩家自己的）——
  function okDoll(v) {
    if (v === null) return null;
    let j = v;
    if (typeof v === 'string') { if (v.length > 40000) throw bad('小人太大了'); try { j = JSON.parse(v); } catch { throw bad('小人数据不对'); } }
    try { unpackDoll(j); } catch (e) { throw bad(e.message); }
    if (JSON.stringify(j).length > 40000) throw bad('小人太大了');
    return j;
  }
  r.post('/api/characters/:id/doll', async (ctx) => {
    const c = character(ctx.params.id);
    const d = okDoll(ctx.body.doll ?? null);
    c.doll = d;
    if (d && ctx.body.use !== false) c.look = 'doll';
    if (!d && c.look === 'doll') c.look = null;
    touchChar(c);
    return { character: characterView(c) };
  });
  r.get('/api/local/mydoll', async () => ({ doll: meta('myDoll', null) }));
  r.post('/api/local/mydoll', async (ctx) => {
    setMeta('myDoll', okDoll(ctx.body.doll ?? null));
    return { doll: meta('myDoll', null) };
  });

  // —— 桌面：壁纸、唱片机、天气 ——
  // 桌面图标：玩家自己换图、改名字
  const ICON_KEYS = ['chat', 'moments', 'diary', 'room', 'worldlines', 'memories', 'settings', 'characters', 'account', 'more', 'music'];
  async function iconsView() {
    const m = meta('appIcons', {});
    const out = {};
    for (const k of Object.keys(m)) out[k] = { name: m[k].name || '', image: m[k].has ? (await s.getBlob('icon:' + k)) || null : null };
    return out;
  }
  r.post('/api/local/icons/:key', async (ctx) => {
    const k = ctx.params.key;
    if (!ICON_KEYS.includes(k)) throw notFound('没有这个图标');
    const all = { ...meta('appIcons', {}) };
    const cur = { name: '', has: false, ...(all[k] || {}) };
    if (ctx.body.reset === true) { await s.deleteBlob('icon:' + k); delete all[k]; setMeta('appIcons', all); return { ok: true }; }
    if (ctx.body.name !== undefined) cur.name = str(ctx.body.name, { name: '名字', max: 8 });
    if (ctx.body.dataUrl !== undefined) {
      if (ctx.body.dataUrl) { await s.putBlob('icon:' + k, okImage(ctx.body.dataUrl)); cur.has = true; } else { await s.deleteBlob('icon:' + k); cur.has = false; }
    }
    all[k] = cur;
    setMeta('appIcons', all);
    return { ok: true };
  });
  r.get('/api/local/home', async () => {
    const rec = meta('record', {});
    const w = meta('weather', null);
    return {
      wallpaper: meta('wallpaper') ? await s.getBlob('home:wallpaper') : null,
      clock: meta('clock', null),
      iconAlpha: meta('iconAlpha', 100),
      iconLines: meta('iconLines', 'dark'),
      icons: await iconsView(),
      record: { title: rec.title || '', artist: rec.artist || '', playing: rec.playing !== false, cover: rec.cover ? await s.getBlob('home:record') : null },
      weather: w ? { city: w.city, share: w.share !== false, today: w.today?.date === localDate() ? w.today : null, current: w.today?.date === localDate() ? w.current : null, fetchedAt: w.fetchedAt } : null,
    };
  });
  // —— 查角色的手机 ——
  const phoneOut = (c, b, day) => ({ days: phoneDays(s, c.id), view: phoneView(s, c, b, day || localDay()), ask: askState(meta, c.id) });
  r.get('/api/characters/:id/charphone', async (ctx) => {
    const c = character(ctx.params.id); const b = branch(c.viewBranchId);
    const day = ctx.query.get('day'); return phoneOut(c, b, day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null);
  });
  r.post('/api/characters/:id/charphone/open', async (ctx) => {
    const c = character(ctx.params.id); const b = branch(c.viewBranchId);
    await openPhone(s, model, c, b);
    return phoneOut(c, b);
  });
  r.post('/api/characters/:id/charphone/ask', async (ctx) => {
    const c = character(ctx.params.id); const b = branch(c.viewBranchId);
    if (b.archivedAt) throw bad('这条世界线已经归档了');
    const res = await askToSee(s, model, c, b, setMeta, meta);
    return { ...res, ask: askState(meta, c.id) };
  });
  r.post('/api/characters/:id/charphone/close', async (ctx) => {
    const c = character(ctx.params.id); const b = branch(c.viewBranchId);
    const seen = Array.isArray(ctx.body.seen) ? ctx.body.seen.map(String).slice(0, 8) : [];
    try { return await closePhone(s, model, c, b, meta, { seen }); } catch { return { discovered: false }; }
  });

  // 聊天软件首页：和当前人物同一个世界的所有人物，每人一个会话（最后一条消息、时间）
  r.get('/api/local/chats', async (ctx) => {
    const cur = ctx.query.get('characterId') ? s.t.characters.find((c) => c.id === ctx.query.get('characterId')) : null;
    const list = s.t.characters.filter((c) => !cur || !cur.worldId || c.worldId === cur.worldId);
    const rows = list.map((c) => {
      const b = getBranch(s, c.viewBranchId);
      const [last] = b ? visibleEvents(s, b, { limit: 1, kinds: ['user_message', 'char_message'] }) : [];
      return {
        character: characterView(c),
        last: last ? { mine: last.kind === 'user_message', text: last.data.text || (last.data.imageId || last.data.localImage ? '[图片]' : ''), at: last.createdAt } : null,
      };
    });
    rows.sort((a, b) => (b.last?.at || b.character.createdAt).localeCompare(a.last?.at || a.character.createdAt));
    const w = cur?.worldId ? s.t.worlds.find((x) => x.id === cur.worldId) : null;
    return { world: w ? { id: w.id, name: w.name } : null, chats: rows };
  });

  // 每个软件自己的背景（聊天里每个人物还可以单独设）
  const APP_BG = ['chat', 'moments', 'diary', 'room', 'worldlines', 'memories', 'settings', 'characters', 'account', 'doll'];
  r.get('/api/local/app-bg', async () => {
    const m = meta('appBg', {});
    const out = {};
    for (const k of APP_BG) if (m[k]) out[k] = { image: await s.getBlob(`appbg:${k}`), dim: m[k].dim ?? 30 };
    return { bgs: out, apps: APP_BG };
  });
  r.post('/api/local/app-bg', async (ctx) => {
    const app = String(ctx.body.app || '');
    if (!APP_BG.includes(app)) throw bad('没有这个软件');
    const m = { ...meta('appBg', {}) };
    if (ctx.body.dataUrl === null) { await s.deleteBlob(`appbg:${app}`); delete m[app]; }
    else {
      if (ctx.body.dataUrl) await s.putBlob(`appbg:${app}`, okImage(ctx.body.dataUrl));
      if (!ctx.body.dataUrl && !m[app]) throw bad('先选一张图片');
      m[app] = { dim: ctx.body.dim !== undefined ? Math.max(0, Math.min(90, Number(ctx.body.dim) || 0)) : (m[app]?.dim ?? 30) };
    }
    setMeta('appBg', m);
    return { ok: true };
  });
  // 朋友圈封面
  r.get('/api/local/moments-cover', async () => ({ cover: meta('momentsCover') ? await s.getBlob('moments:cover') : null }));
  r.post('/api/local/moments-cover', async (ctx) => {
    if (ctx.body.dataUrl) { await s.putBlob('moments:cover', okImage(ctx.body.dataUrl)); setMeta('momentsCover', true); }
    else { await s.deleteBlob('moments:cover'); setMeta('momentsCover', false); }
    return { ok: true };
  });
  // 桌面时间的样式
  r.post('/api/local/clock', async (ctx) => {
    const b = ctx.body || {};
    const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : d);
    const pick = (v, list, d) => (list.includes(v) ? v : d);
    setMeta('clock', {
      font: pick(b.font, ['sans', 'rounded', 'serif', 'mono', 'condensed', 'hand'], 'sans'),
      weight: pick(Number(b.weight), [200, 400, 600, 800], 200),
      color: hex(b.color, '#ffffff'),
      size: Math.max(40, Math.min(104, Number(b.size) || 64)),
      layout: pick(b.layout, ['plain', 'stack', 'outline', 'glow'], 'plain'),
    });
    return { clock: meta('clock') };
  });
  // 桌面图标：底色的不透明度（%，100 = 不透明；线条一直不透明）、线条颜色（深 / 白）
  r.post('/api/local/icon-alpha', async (ctx) => {
    if (ctx.body.value !== undefined) setMeta('iconAlpha', Math.max(0, Math.min(100, Math.round(Number(ctx.body.value)))) || 0);
    if (ctx.body.lines !== undefined) setMeta('iconLines', ctx.body.lines === 'light' ? 'light' : 'dark');
    return { iconAlpha: meta('iconAlpha', 100), iconLines: meta('iconLines', 'dark') };
  });
  r.post('/api/local/wallpaper', async (ctx) => {
    if (ctx.body.dataUrl) { await s.putBlob('home:wallpaper', okImage(ctx.body.dataUrl)); setMeta('wallpaper', true); }
    else { await s.deleteBlob('home:wallpaper'); setMeta('wallpaper', false); }
    return { ok: true };
  });
  r.post('/api/local/record', async (ctx) => {
    const cur = meta('record', {});
    const next = { ...cur };
    if (ctx.body.title !== undefined) next.title = str(ctx.body.title, { name: '歌名', max: 40 });
    if (ctx.body.artist !== undefined) next.artist = str(ctx.body.artist, { name: '歌手', max: 40 });
    if (ctx.body.playing !== undefined) next.playing = ctx.body.playing === true;
    if (ctx.body.cover !== undefined) {
      if (ctx.body.cover) { await s.putBlob('home:record', okImage(ctx.body.cover)); next.cover = true; } else { await s.deleteBlob('home:record'); next.cover = false; }
    }
    setMeta('record', next);
    return { ok: true };
  });
  // —— 音乐 ——
  const track = (id) => { const t = s.t.tracks.find((x) => x.id === id); if (!t) throw notFound('找不到这首歌'); return t; };
  function trackFields(t, body) {
    for (const [k, [label, max]] of Object.entries(TEXT_FIELDS)) if (body[k] !== undefined) t[k] = str(body[k], { name: label, max });
    if (!t.title) throw bad('请填写歌名');
    if (body.duration !== undefined) t.duration = Math.max(0, Math.min(36000, Number(body.duration) || 0));
    if (body.lyrics !== undefined) {
      const ly = body.lyrics;
      if (!ly || !Array.isArray(ly.lines) || !ly.lines.length) t.lyrics = null;
      else {
        const lines = ly.lines.slice(0, 600).map((l) => ({ t: l.t === null || l.t === undefined ? null : Math.max(0, Number(l.t) || 0), text: String(l.text || '').slice(0, 200) }));
        t.lyrics = { format: String(ly.format || 'txt').slice(0, 8), timed: lines.some((l) => l.t !== null), lines };
      }
    }
  }
  async function trackCover(t, cover) {
    if (cover === undefined) return;
    if (cover) { await s.putBlob(COVER_PREFIX + t.id, okImage(cover)); t.hasCover = true; } else { await s.deleteBlob(COVER_PREFIX + t.id); t.hasCover = false; }
  }
  r.get('/api/local/music', async () => {
    const list = [...s.t.tracks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const ids = new Set(await s.allBlobIds());
    return { tracks: list.map((t) => ({ ...trackView(t), missing: !ids.has(AUDIO_PREFIX + t.id) })) };
  });
  r.get('/api/local/music/:id/cover', async (ctx) => ({ cover: track(ctx.params.id).hasCover ? (await s.getBlob(COVER_PREFIX + ctx.params.id)) || null : null }));
  r.post('/api/local/music', async (ctx) => {
    const audio = ctx.body.audio;
    if (!audio || typeof audio.size !== 'number' || typeof audio.slice !== 'function') throw bad('请选择歌曲文件');
    if (audio.size > 80 * 1024 * 1024) throw bad('歌曲文件太大了（最大 80 MB）');
    if (s.t.tracks.length >= 500) throw bad('歌曲最多 500 首');
    const t = { id: newId(), title: '', fav: false, hasCover: false, audioType: audio.type || '', audioSize: audio.size, createdAt: now(), updatedAt: now() };
    trackFields(t, ctx.body);
    await s.putBlob(AUDIO_PREFIX + t.id, audio);
    await trackCover(t, ctx.body.cover);
    s.insert('tracks', t);
    return { track: trackView(t) };
  });
  r.patch('/api/local/music/:id', async (ctx) => {
    const t = track(ctx.params.id);
    trackFields(t, ctx.body);
    if (ctx.body.fav !== undefined) t.fav = ctx.body.fav === true;
    await trackCover(t, ctx.body.cover);
    if (ctx.body.audio && typeof ctx.body.audio.slice === 'function') {
      if (ctx.body.audio.size > 80 * 1024 * 1024) throw bad('歌曲文件太大了（最大 80 MB）');
      await s.putBlob(AUDIO_PREFIX + t.id, ctx.body.audio); t.audioType = ctx.body.audio.type || ''; t.audioSize = ctx.body.audio.size;
    }
    t.updatedAt = now();
    s.touch('tracks');
    return { track: trackView(t) };
  });
  r.delete('/api/local/music/:id', async (ctx) => {
    const t = track(ctx.params.id);
    await s.deleteBlob(AUDIO_PREFIX + t.id);
    if (t.hasCover) await s.deleteBlob(COVER_PREFIX + t.id);
    s.remove('tracks', (x) => x.id === t.id);
    return { ok: true };
  });
  // 音乐的设置：播放页背景（跟封面 / 纯色 / 自己的图片）、一起听时 TA 会不会主动说话
  const MUSIC_LOOK = { mode: 'cover', color: '#2a2840', dim: 35, blur: 0, image: false, autoTalk: true };
  const musicLook = () => ({ ...MUSIC_LOOK, ...(meta('musicLook') || {}) });
  r.get('/api/local/music/look', async () => {
    const l = musicLook();
    return { look: { ...l, image: l.image ? (await s.getBlob('music:bg')) || null : null } };
  });
  r.post('/api/local/music/look', async (ctx) => {
    const b = ctx.body || {};
    const l = musicLook();
    if (b.mode !== undefined) { if (!['cover', 'color', 'image'].includes(b.mode)) throw bad('不支持的背景'); l.mode = b.mode; }
    if (b.color !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(String(b.color))) throw bad('颜色不对'); l.color = String(b.color).toLowerCase(); }
    if (b.dim !== undefined) l.dim = Math.max(0, Math.min(90, Math.round(Number(b.dim) || 0)));
    if (b.blur !== undefined) l.blur = Math.max(0, Math.min(30, Math.round(Number(b.blur) || 0)));
    if (b.autoTalk !== undefined) l.autoTalk = b.autoTalk === true;
    if (b.image !== undefined) {
      if (b.image) { await s.putBlob('music:bg', okImage(b.image)); l.image = true; if (b.mode === undefined) l.mode = 'image'; }
      else { await s.deleteBlob('music:bg'); l.image = false; if (l.mode === 'image') l.mode = 'cover'; }
    }
    if (l.mode === 'image' && !l.image) throw bad('先选一张图片');
    setMeta('musicLook', l);
    return { ok: true };
  });
  // 一起听：开头先让 TA 想好整首歌要说的话
  const listenBranch = (id) => {
    const b = branch(id);
    if (b.archivedAt) throw bad('这条世界线已经归档了，恢复后才能一起听');
    return b;
  };
  r.post('/api/branches/:id/music/plan', async (ctx) => {
    const b = listenBranch(ctx.params.id);
    return planRemarks(s, model, character(b.characterId), b, track(String(ctx.body.trackId || '')));
  });
  r.post('/api/branches/:id/music/say', async (ctx) => {
    const b = listenBranch(ctx.params.id);
    const text = str(ctx.body.text, { name: '想说的话', min: 1, max: 200 });
    const reply = await replyDuringSong(s, model, character(b.characterId), b, track(String(ctx.body.trackId || '')), {
      text, at: Number(ctx.body.at) || 0, lyric: str(ctx.body.lyric || '', { name: '歌词', max: 200 }), log: Array.isArray(ctx.body.log) ? ctx.body.log : [],
    });
    return { text: reply };
  });
  r.post('/api/branches/:id/music/end', async (ctx) => {
    const b = branch(ctx.params.id);
    const t = s.t.tracks.find((x) => x.id === String(ctx.body.trackId || '')) || { id: String(ctx.body.trackId || ''), title: str(ctx.body.title || '一首歌', { name: '歌名', max: 80 }) || '一首歌', artist: '' };
    return endSession(s, model, modelSettings(), character(b.characterId), b, t, { log: ctx.body.log, startedAt: ctx.body.startedAt, listened: ctx.body.listened });
  });
  r.get('/api/branches/:id/music/history', async (ctx) => ({ sessions: listenedTogether(s, branch(ctx.params.id)) }));
  r.get('/api/local/weather/search', async (ctx) => ({ results: await searchCity(fetchImpl, str(ctx.query.get('q'), { name: '城市', min: 1, max: 40 })) }));
  r.post('/api/local/weather/location', async (ctx) => {
    const lat = Number(ctx.body.lat); const lon = Number(ctx.body.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw bad('位置不正确');
    const city = ctx.body.name ? str(ctx.body.name, { name: '城市', max: 40 }) : await reverseCity(fetchImpl, lat, lon);
    const cur = meta('weather', {}) || {};
    const f = await fetchForecast(fetchImpl, lat, lon);
    const next = { share: cur.share !== false, city, lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, ...f, fetchedAt: now() };
    setMeta('weather', next);
    recordDailyWeather(s, next);
    return { ok: true, city };
  });
  r.post('/api/local/weather/refresh', async (ctx) => {
    const w = await refreshWeather(s, fetchImpl, setMeta, { force: ctx.body.force === true });
    return { ok: true, has: !!w?.city };
  });
  r.post('/api/local/weather/settings', async (ctx) => {
    const cur = meta('weather', {}) || {};
    if (ctx.body.share !== undefined) cur.share = ctx.body.share === true;
    if (ctx.body.clear === true) { setMeta('weather', null); return { ok: true }; }
    setMeta('weather', { ...cur });
    if (cur.share) recordDailyWeather(s, cur);
    return { ok: true };
  });

  // —— 房间 ——
  r.get('/api/branches/:id/room', async (ctx) => {
    const b = branch(ctx.params.id);
    return { ...roomState(s, b), photoSlots: PHOTO_SLOTS, shelfSlots: SHELF_SLOTS, frames: FRAMES, items: ITEMS };
  });
  const slotOf = (v, max) => int(v, { name: '位置', min: 0, max: max - 1 });
  r.post('/api/branches/:id/room/photos', async (ctx) => {
    const b = branch(ctx.params.id);
    if (b.archivedAt) throw bad('这条世界线已归档');
    const c = character(b.characterId);
    const imageId = String(ctx.body.imageId || '');
    if (!s.t.images.some((i) => i.id === imageId && i.characterId === c.id)) throw bad('图片找不到了，请重新选择');
    const slot = slotOf(ctx.body.slot, PHOTO_SLOTS);
    const st = roomState(s, b);
    if (st.photos.length >= PHOTO_SLOTS) throw bad('照片墙满了，先取下一张');
    if (st.photos.some((p) => p.slot === slot)) throw bad('这个位置已经有照片了');
    const caption = str(ctx.body.caption, { name: '照片说明', max: 40 });
    const frame = FRAMES.includes(ctx.body.frame) ? ctx.body.frame : 'wood';
    const seq = appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'room_photo', data: { slot, imageId, caption, frame } });
    // TA 看照片、写纸条（后台进行）
    later(() => afterPhoto(s, model, modelSettings(), c, b, seq), 1500);
    return { seq };
  });
  r.post('/api/branches/:id/room/photos/:seq/move', async (ctx) => {
    const b = branch(ctx.params.id);
    const seq = Number(ctx.params.seq);
    if (!roomState(s, b).photos.some((p) => p.seq === seq)) throw notFound('找不到这张照片');
    appendEvent(s, { characterId: b.characterId, branchId: b.id, kind: 'room_photo_move', data: { photoSeq: seq, slot: slotOf(ctx.body.slot, PHOTO_SLOTS) } });
    return { ok: true };
  });
  r.post('/api/branches/:id/room/photos/:seq/remove', async (ctx) => {
    const b = branch(ctx.params.id);
    const res = removePhoto(s, b, Number(ctx.params.seq), ctx.body.forget === true);
    if (res.error) throw notFound('找不到这张照片');
    return res;
  });
  r.post('/api/branches/:id/room/keepsakes', async (ctx) => {
    const b = branch(ctx.params.id);
    const memoryId = String(ctx.body.memoryId || '');
    if (!visibleMemories(s, b).some((m) => m.id === memoryId)) throw notFound('找不到这条记忆');
    const item = ITEMS.includes(ctx.body.item) ? ctx.body.item : 'gift';
    const slot = slotOf(ctx.body.slot, SHELF_SLOTS);
    appendEvent(s, { characterId: b.characterId, branchId: b.id, kind: 'room_keepsake', data: { memoryId, item, slot } });
    return { ok: true };
  });
  r.post('/api/branches/:id/room/keepsakes/off', async (ctx) => {
    const b = branch(ctx.params.id);
    appendEvent(s, { characterId: b.characterId, branchId: b.id, kind: 'room_keepsake_off', data: { memoryId: String(ctx.body.memoryId || '') } });
    return { ok: true };
  });
  r.get('/api/branches/:id/room/memory/:mid', async (ctx) => {
    const b = branch(ctx.params.id);
    const r2 = memorySnippet(s, b, ctx.params.mid);
    if (!r2) throw notFound('这条记忆已经不在了');
    return r2;
  });

  // —— 日记 ——
  r.get('/api/branches/:id/diary', async (ctx) => {
    const b = branch(ctx.params.id);
    const entries = visibleEvents(s, b, { limit: 1e9, kinds: ['diary'] }).reverse()
      .map((e) => ({ seq: e.seq, text: e.data.text, createdAt: e.createdAt, fromSeq: e.data.fromSeq, toSeq: e.data.toSeq }));
    return { entries, pending: diaryCoverage(s, b).pending.length, auto: !!modelSettings().autoDiary };
  });
  r.post('/api/branches/:id/diary', async (ctx) => {
    const b = branch(ctx.params.id);
    const seq = await writeDiary(s, model, character(b.characterId), b, { force: true });
    if (!seq) throw bad('最近的聊天太少了，多聊几句再让 TA 写吧');
    return { seq };
  });

  // —— 自动行为 & 未读 ——
  r.post('/api/local/tick', async (ctx) => {
    const cfg = modelSettings();
    if (!cfg.autoMoments && !cfg.readMoments && !cfg.autoDiary && !cfg.phoneCheck) return { posts: [], dms: [], diaries: [], errors: [] };
    if (!cfg.apiKey && !cfg.mock) return { posts: [], dms: [], diaries: [], errors: [] };
    const res = await tick(s, model, cfg, { leftChatCharacterId: ctx.body.leftChatCharacterId || null });
    // TA 偶尔开口要看手机：最近 3 小时聊过天、一天最多一次
    if (cfg.phoneCheck && !res.skipped) {
      for (const c of s.t.characters) {
        const b = getBranch(s, c.viewBranchId);
        if (!b || b.archivedAt || openRequest(s, b)) continue;
        const last = visibleEvents(s, b, { limit: 1, kinds: MESSAGE_KINDS })[0];
        if (!last || Date.now() - Date.parse(last.createdAt) > 3 * 3600e3 || Math.random() > (ctx.body.forcePhoneAsk ? 1 : 0.12)) continue;
        try { const a = await characterAsk(s, model, c, b); if (a) res.dms.push({ characterId: c.id, name: c.name, seq: a.askSeq }); } catch (e) { res.errors.push(`${c.name}：${e.message}`); }
      }
    }
    return res;
  });
  r.get('/api/local/unread', async () => {
    const u = unreadCounts(s, meta('readMarks', {}));
    return { unread: u.chat, moments: u.moments, diary: u.diary, room: u.room };
  });
  // 已读：area = chat（默认）| moments | diary
  r.post('/api/characters/:id/read', async (ctx) => {
    const c = character(ctx.params.id);
    const area = ['chat', 'moments', 'diary', 'room'].includes(ctx.body.area) ? ctx.body.area : 'chat';
    const all = meta('readMarks', {});
    const cur = typeof all[c.id] === 'number' ? { chat: all[c.id] } : (all[c.id] || {});
    setMeta('readMarks', { ...all, [c.id]: { ...cur, [area]: s.seq } });
    return { ok: true };
  });
  // 提醒：某个位置之后 TA 主动做的事（界面据此弹横幅 / 系统通知）
  r.get('/api/local/notifications', async (ctx) => {
    const after = Number(ctx.query.get('after') || 0) || 0;
    return { latestSeq: s.seq, items: notifications(s, after).slice(-50), notify: modelSettings().notify || DEFAULT_NOTIFY };
  });

  return { router: r, modelSettings };
}

// 消息提醒设置：默认打开提醒（横幅），系统通知和提示音也开；免打扰默认关闭
export const DEFAULT_NOTIFY = {
  enabled: true, system: true, sound: true,
  types: { dm: true, like: true, comment: true, reply: true, moment: true, diary: true, note: true },
  dnd: { on: false, start: '23:00', end: '08:00' },
};
function cleanNotify(v, cur) {
  const base = { ...DEFAULT_NOTIFY, ...(cur || {}) };
  const o = v && typeof v === 'object' ? v : {};
  const time = (t, d) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t)) ? String(t) : d);
  const types = { ...DEFAULT_NOTIFY.types, ...(base.types || {}) };
  for (const k of NOTIFY_TYPES) if (o.types?.[k] !== undefined) types[k] = o.types[k] === true;
  const dnd = { ...DEFAULT_NOTIFY.dnd, ...(base.dnd || {}) };
  if (o.dnd) { if (o.dnd.on !== undefined) dnd.on = o.dnd.on === true; dnd.start = time(o.dnd.start, dnd.start); dnd.end = time(o.dnd.end, dnd.end); }
  const out = { ...base, types, dnd };
  for (const k of ['enabled', 'system', 'sound']) if (o[k] !== undefined) out[k] = o[k] === true;
  return out;
}

export const LOOKS = ['m01', 'm02', 'f01', 'f02'];

export function maskKey(k) { return k.length <= 8 ? '••••' : `${k.slice(0, 3)}••••${k.slice(-4)}`; }
