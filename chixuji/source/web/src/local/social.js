// 纯前端版：朋友圈和日记。都记成所在世界线上的事件，所以同样按世界线隔离、不倒灌。
// 事件类型：
//   moment          { author: 'user'|'character', text, imageIds, imageDescs }
//   moment_like     { momentSeq, author }
//   moment_comment  { momentSeq, author, text }
//   moment_seen     { momentSeq }             角色看过用户的这条朋友圈
//   diary           { text, fromSeq, toSeq }  角色写的日记，覆盖这段聊天
//   moment_remove   { target: 'moment'|'comment', targetSeq, mode: 'delete'|'hide', forget }
//                   用户删掉自己的动态/评论（delete），或隐藏 TA 的（hide，TA 照样记得）
import { buildSystemPrompt } from '../../../server/lib/prompt.mjs';
import { weatherLine } from './weather.js';
import { appendEvent, effectiveSettings, forgottenSeqs, getBranch, invalidateMemoriesFromSources, MESSAGE_KINDS, now, processBranch, visibleControlEvents, visibleEvents, visibleMemories } from './logic.js';

const DAY_MS = 86400e3;
export const SOCIAL_KINDS = ['moment', 'moment_like', 'moment_comment', 'moment_seen', 'moment_remove'];
const MAX_POSTS_PER_DAY = 3;
const SESSION_IDLE_MS = 15 * 60e3;
const MIN_DIARY_MESSAGES = 4;

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

// 角色视角的系统提示：人设 + 世界观 + 记忆（和聊天用同一份）
export function persona(s, character, branch) {
  const controls = visibleControlEvents(s, branch);
  const world = character.worldId ? s.t.worlds.find((w) => w.id === character.worldId) : null;
  return buildSystemPrompt({
    name: character.name,
    settings: effectiveSettings(s, branch),
    memories: visibleMemories(s, branch, { controls }).slice(-150),
    corrections: controls.filter((e) => e.kind === 'correction').slice(-10).map((e) => e.data),
    world,
    weather: weatherLine(s),
  });
}

export function recentChat(s, branch, name, limit = 20) {
  return visibleEvents(s, branch, { limit, kinds: MESSAGE_KINDS })
    .map((e) => `${e.kind === 'user_message' ? '用户' : name}：${e.data.text || '（图片）'}`).join('\n') || '（还没有聊过天）';
}

// —— 朋友圈：整理成界面要的样子 ——
export function feed(s, branch, character) {
  const evs = visibleEvents(s, branch, { limit: 1e9, kinds: SOCIAL_KINDS });
  const gone = removedSeqs(evs);
  const posts = evs.filter((e) => e.kind === 'moment' && !gone.has(e.seq)).map((e) => ({
    seq: e.seq, author: e.data.author, text: e.data.text, imageIds: e.data.imageIds || [], createdAt: e.createdAt,
    likes: [], comments: [], seen: false,
  }));
  const bySeq = new Map(posts.map((p) => [p.seq, p]));
  for (const e of evs) {
    const p = bySeq.get(e.data.momentSeq);
    if (!p) continue;
    if (e.kind === 'moment_like') {
      if (e.data.unlike) p.likes = p.likes.filter((a) => a !== e.data.author);
      else if (!p.likes.includes(e.data.author)) p.likes.push(e.data.author);
    }
    if (e.kind === 'moment_comment' && !gone.has(e.seq)) p.comments.push({ seq: e.seq, author: e.data.author, text: e.data.text, createdAt: e.createdAt });
    if (e.kind === 'moment_seen') p.seen = true;
  }
  return { characterName: character.name, posts: posts.reverse() };
}

function removedSeqs(evs) {
  return new Set(evs.filter((e) => e.kind === 'moment_remove').map((e) => e.data.targetSeq));
}
export function removedSet(s, branch) {
  return removedSeqs(visibleEvents(s, branch, { limit: 1e9, kinds: ['moment_remove'] }));
}

// —— 删除 / 隐藏 ——
// 用户自己的：删除（可选让 TA 忘掉）；TA 的：只能隐藏（只是你看不到，TA 照样记得）
export async function removeMoment(s, branch, { target, targetSeq, forget = false }) {
  const ev = visibleEvents(s, branch, { limit: 1e9, kinds: [target === 'moment' ? 'moment' : 'moment_comment'] }).find((e) => e.seq === targetSeq);
  if (!ev) return { error: 'not_found' };
  if (removedSet(s, branch).has(targetSeq)) return { error: 'already' };
  const mine = ev.data.author === 'user';
  const mode = mine ? 'delete' : 'hide';
  const doForget = mine && forget === true;
  appendEvent(s, { characterId: branch.characterId, branchId: branch.id, kind: 'moment_remove', data: { target, targetSeq, mode, forget: doForget } });
  let forgotten = 0;
  if (doForget) {
    forgotten = invalidateMemoriesFromSources(s, branch, [...forgottenSeqs(s, branch)], target === 'moment' ? '用户删除了这条朋友圈' : '用户删除了这条评论');
  }
  // 删掉的动态如果带图，而且其他世界线已经看不到它了，就把图片从本机清掉
  let freed = 0;
  if (mode === 'delete' && target === 'moment') {
    for (const id of ev.data.imageIds || []) {
      const stillUsed = s.t.branches.some((b) => b.id !== branch.id && b.characterId === branch.characterId
        && visibleEvents(s, b, { limit: 1e9, kinds: ['moment'] }).some((e) => e.seq === targetSeq) && !removedSet(s, b).has(targetSeq));
      if (stillUsed) continue;
      s.remove('images', (i) => i.id === id);
      await s.deleteBlob(id);
      freed++;
    }
  }
  return { mode, forgotten, freed };
}

// —— 角色发一条朋友圈 ——
export async function characterPost(s, model, character, branch) {
  const who = { characterId: character.id, branchId: branch.id };
  const mine = visibleEvents(s, branch, { limit: 5, kinds: ['moment'] }).filter((e) => e.data.author === 'character').map((e) => `- ${e.data.text}`).join('\n');
  const task = [
    '【任务：发朋友圈】',
    `以${character.name}的身份，发一条朋友圈。`,
    '要求：内容来自已经发生的剧情，或符合你设定和世界观的日常；不能编造用户参与过、但聊天里没发生过的事；不要直接对用户喊话；口吻和长度符合人设，一般不超过 60 字；不加话题标签。',
    `你最近发过的朋友圈（别重复）：\n${mine || '（还没有发过）'}`,
    `最近的聊天：\n${recentChat(s, branch, character.name, 12)}`,
    '如果现在实在没什么可发的，可以不发。只输出 JSON：{"post":"内容","skip":false}，不发就 {"post":"","skip":true}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'moment', system: persona(s, character, branch), task, json: true, who });
  const text = typeof r?.post === 'string' ? r.post.trim().slice(0, 500) : '';
  if (r?.skip || !text) return null;
  return appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'moment', data: { author: 'character', text, imageIds: [] } });
}

// —— 角色看用户的朋友圈：可能点赞、评论、私聊 ——
export async function characterReact(s, model, character, branch, momentSeq) {
  const post = visibleEvents(s, branch, { limit: 1e9, kinds: ['moment'] }).find((e) => e.seq === momentSeq);
  if (!post || post.data.author !== 'user' || removedSet(s, branch).has(momentSeq)) return null;
  const already = visibleEvents(s, branch, { limit: 1e9, kinds: ['moment_seen'] }).some((e) => e.data.momentSeq === momentSeq);
  if (already) return null;
  const who = { characterId: character.id, branchId: branch.id };
  // 有图先看图
  const descs = [];
  for (const id of post.data.imageIds || []) {
    const dataUrl = await s.getBlob(id);
    if (dataUrl) descs.push(await model.describeImage({ dataUrl, userText: post.data.text, who }));
  }
  if (descs.length) {
    const ev = s.eventIndex.get(momentSeq);
    ev.data.imageDescs = descs;
    s.touch('events');
  }
  const task = [
    '【任务：看朋友圈】',
    `用户刚发了一条朋友圈：「${post.data.text || ''}」${descs.length ? `\n配图内容：${descs.join('；')}` : ''}`,
    `最近的聊天：\n${recentChat(s, branch, character.name, 12)}`,
    `以${character.name}的身份决定怎么回应，完全按人设和你们现在的关系来：可以只看不回应，可以点赞，可以评论，也可以私聊。`,
    '如果这条动态透露出用户情绪低落、遇到麻烦或需要关心，而且符合你的性格，就私聊用户（不要只在评论里说）。',
    '评论要短（不超过 30 字）。私聊写成你会直接发给用户的消息。',
    '只输出 JSON：{"like":true或false,"comment":"评论内容，不评论就空字符串","dm":"私聊内容，不私聊就空字符串"}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'moment', system: persona(s, character, branch), task, json: true, who });
  appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'moment_seen', data: { momentSeq } });
  const out = { liked: false, commented: false, dmSeq: null };
  if (r?.like === true) { appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'moment_like', data: { momentSeq, author: 'character' } }); out.liked = true; }
  const comment = typeof r?.comment === 'string' ? r.comment.trim().slice(0, 200) : '';
  if (comment) { appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'moment_comment', data: { momentSeq, author: 'character', text: comment } }); out.commented = true; }
  const dm = typeof r?.dm === 'string' ? r.dm.trim().slice(0, 1000) : '';
  if (dm && !branch.archivedAt) {
    out.dmSeq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data: { text: dm, model: model.name, via: 'moment', momentSeq } });
  }
  return out;
}

// —— 用户评论了角色的朋友圈：角色回一句 ——
export async function characterReplyComment(s, model, character, branch, momentSeq, commentText) {
  const post = visibleEvents(s, branch, { limit: 1e9, kinds: ['moment'] }).find((e) => e.seq === momentSeq);
  if (!post) return null;
  const task = [
    '【任务：回复评论】',
    `你之前发的朋友圈：「${post.data.text}」`,
    `用户在下面评论：「${commentText}」`,
    `以${character.name}的身份在评论区回一句（不超过 30 字），按人设来；觉得不需要回也可以不回。`,
    '只输出 JSON：{"reply":"内容，不回就空字符串"}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'moment', system: persona(s, character, branch), task, json: true, who: { characterId: character.id, branchId: branch.id } });
  const reply = typeof r?.reply === 'string' ? r.reply.trim().slice(0, 200) : '';
  if (!reply) return null;
  return appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'moment_comment', data: { momentSeq, author: 'character', text: reply } });
}

// —— 日记：一段聊天结束后，角色写下心里的感受 ——
export function diaryCoverage(s, branch) {
  const diaries = visibleEvents(s, branch, { limit: 1e9, kinds: ['diary'] });
  const upto = diaries.reduce((m, d) => Math.max(m, d.data.toSeq), 0);
  const pending = visibleEvents(s, branch, { afterSeq: upto, limit: 200, kinds: MESSAGE_KINDS, order: 'earliest' });
  return { upto, pending };
}

export async function writeDiary(s, model, character, branch, { force = false } = {}) {
  const { pending } = diaryCoverage(s, branch);
  if (pending.length < (force ? 2 : MIN_DIARY_MESSAGES)) return null;
  const last = pending[pending.length - 1];
  const convo = pending.map((e) => `${e.kind === 'user_message' ? '用户' : character.name}：${e.data.text || '（图片）'}`).join('\n');
  const task = [
    '【任务：写日记】',
    `以${character.name}的第一人称写今天的日记，记录刚才这段聊天里你注意到的细节、你的感受、你怎么理解对方、之后想怎么做。`,
    '要求：这是你的内心独白，不是写给用户看的信；篇幅和情绪强度符合人设（一般 80–200 字）；你的担心和猜测只是你的想法，不要写成确定的事实；不要编造聊天里没发生的事；不要写日期标题。',
    `刚才的聊天：\n${convo}`,
  ].join('\n\n');
  const text = await model.complete({ purpose: 'diary', system: persona(s, character, branch), task, maxTokens: 900, who: { characterId: character.id, branchId: branch.id } });
  if (!text?.trim()) return null;
  return appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'diary', data: { text: text.trim().slice(0, 3000), fromSeq: pending[0].seq, toSeq: last.seq } });
}

// —— 定时检查：打开迟叙机时、以及开着的时候每隔几分钟跑一次 ——
const ticking = { on: false };
// 自动动作失败后（比如没填密钥、余额不足），先歇一会儿再试，不要每 5 分钟都重试一遍
const RETRY_AFTER_MS = 60 * 60e3;
const failedAt = new Map();
const resting = (key) => Date.now() - (failedAt.get(key) || 0) < RETRY_AFTER_MS;
async function attempt(key, fn) {
  if (resting(key)) return null;
  try {
    const r = await fn();
    failedAt.delete(key);
    return r;
  } catch (err) {
    failedAt.set(key, Date.now());
    throw err;
  }
}

export async function tick(s, model, cfg, { leftChatCharacterId = null, random = Math.random } = {}) {
  if (ticking.on) return { skipped: true };
  ticking.on = true;
  const result = { posts: [], dms: [], diaries: [], errors: [] };
  try {
    for (const c of s.t.characters) {
      const branch = getBranch(s, c.viewBranchId);
      if (!branch || branch.archivedAt) continue;
      try {
        // 1) 角色发朋友圈：每天至少 1 条，之后偶尔多发
        if (cfg.autoMoments) {
          const mine = visibleEvents(s, branch, { limit: 1e9, kinds: ['moment'] }).filter((e) => e.data.author === 'character' && e.branchId === branch.id);
          const today = mine.filter((e) => Date.parse(e.createdAt) >= startOfToday());
          const lastAt = mine.length ? Date.parse(mine[mine.length - 1].createdAt) : 0;
          const wantFirst = today.length === 0;
          const wantExtra = today.length > 0 && today.length < MAX_POSTS_PER_DAY && Date.now() - lastAt > 3 * 3600e3 && random() < 0.15;
          if (wantFirst || wantExtra) {
            const seq = await attempt(`${c.id}:moment`, () => characterPost(s, model, c, branch));
            if (seq) result.posts.push({ characterId: c.id, name: c.name, seq });
          }
        }
        // 2) 角色看用户还没看过的朋友圈
        if (cfg.readMoments) {
          const posts = visibleEvents(s, branch, { limit: 1e9, kinds: ['moment'] }).filter((e) => e.data.author === 'user' && Date.now() - Date.parse(e.createdAt) < 2 * DAY_MS);
          const seen = new Set(visibleEvents(s, branch, { limit: 1e9, kinds: ['moment_seen'] }).map((e) => e.data.momentSeq));
          for (const x of removedSet(s, branch)) seen.add(x);
          let reacted = false;
          for (const p of posts.filter((x) => !seen.has(x.seq)).slice(-3)) {
            const r = await attempt(`${c.id}:react`, () => characterReact(s, model, c, branch, p.seq));
            if (r) reacted = true;
            if (r?.dmSeq) result.dms.push({ characterId: c.id, name: c.name, seq: r.dmSeq });
          }
          // 看过的朋友圈马上记进记忆
          if (reacted) await processBranch({ s, model, settings: cfg, branchId: branch.id, force: true });
        }
        // 3) 日记：离开聊天，或者 15 分钟没有新消息，就把这段聊天写成日记
        if (cfg.autoDiary) {
          const { pending } = diaryCoverage(s, branch);
          const idle = pending.length && Date.now() - Date.parse(pending[pending.length - 1].createdAt) > SESSION_IDLE_MS;
          if (pending.length >= MIN_DIARY_MESSAGES && (idle || leftChatCharacterId === c.id)) {
            const seq = await attempt(`${c.id}:diary`, () => writeDiary(s, model, c, branch));
            if (seq) result.diaries.push({ characterId: c.id, name: c.name, seq });
          }
        }
        // 角色自己发的朋友圈也会进记忆（攒够条数时）
        if (result.posts.some((p) => p.characterId === c.id)) processBranch({ s, model, settings: cfg, branchId: branch.id });
      } catch (err) {
        result.errors.push(`${c.name}：${err.message}`);
      }
    }
  } finally {
    ticking.on = false;
  }
  return result;
}

// —— 消息提醒 ——
// 只提醒“TA 主动做的事”：主动私聊、给你点赞/评论、回复评论、发朋友圈、写日记。
// 普通聊天里 TA 的回复不算（你就在聊天里看着）。
export const NOTIFY_TYPES = ['dm', 'like', 'comment', 'reply', 'moment', 'diary', 'note'];
export const AREA_OF = { dm: 'chat', like: 'moments', comment: 'moments', reply: 'moments', moment: 'moments', diary: 'diary', note: 'room' };
const NOTIFY_KINDS = ['char_message', 'moment', 'moment_like', 'moment_comment', 'moment_remove', 'diary', 'room_note'];

function notificationsFor(s, c, branch, afterSeq) {
  const evs = visibleEvents(s, branch, { limit: 1e9, kinds: NOTIFY_KINDS });
  const gone = removedSeqs(evs);
  const posts = new Map(evs.filter((e) => e.kind === 'moment').map((e) => [e.seq, e]));
  const out = [];
  for (const e of evs) {
    if (e.seq <= afterSeq || gone.has(e.seq)) continue;
    const base = { seq: e.seq, characterId: c.id, name: c.name, createdAt: e.createdAt };
    if (e.kind === 'char_message' && e.data.via) out.push({ ...base, type: 'dm', text: e.data.text });
    else if (e.kind === 'moment' && e.data.author === 'character') out.push({ ...base, type: 'moment', text: e.data.text });
    else if (e.kind === 'diary') out.push({ ...base, type: 'diary', text: e.data.text });
    else if (e.kind === 'room_note') out.push({ ...base, type: 'note', text: e.data.text, photoSeq: e.data.photoSeq });
    else if ((e.kind === 'moment_like' || e.kind === 'moment_comment') && e.data.author === 'character') {
      const post = posts.get(e.data.momentSeq);
      if (!post || gone.has(post.seq)) continue;
      if (e.kind === 'moment_like') { if (!e.data.unlike && post.data.author === 'user') out.push({ ...base, type: 'like', text: post.data.text, momentSeq: post.seq }); }
      else out.push({ ...base, type: post.data.author === 'user' ? 'comment' : 'reply', text: e.data.text, momentSeq: post.seq });
    }
  }
  return out;
}

// 所有人物（各自正在看的那条世界线）上，某个位置之后的提醒
export function notifications(s, afterSeq = 0) {
  const out = [];
  for (const c of s.t.characters) {
    const branch = getBranch(s, c.viewBranchId);
    if (branch) out.push(...notificationsFor(s, c, branch, afterSeq));
  }
  return out.sort((a, b) => a.seq - b.seq);
}

// 未读红点：聊（主动私聊）、圈（赞/评论/新动态）、记（新日记），各自记已读位置
export function unreadCounts(s, readMarks) {
  const out = { chat: {}, moments: {}, diary: {}, room: {} };
  for (const c of s.t.characters) {
    const branch = getBranch(s, c.viewBranchId);
    if (!branch) continue;
    const marks = typeof readMarks[c.id] === 'number' ? { chat: readMarks[c.id] } : (readMarks[c.id] || {});
    for (const area of Object.keys(out)) out[area][c.id] = 0;
    for (const n of notificationsFor(s, c, branch, 0)) {
      const area = AREA_OF[n.type];
      if (n.seq > (marks[area] || 0)) out[area][c.id]++;
    }
  }
  return out;
}

export { now };
