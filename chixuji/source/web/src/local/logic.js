// 纯前端版的故事规则：和服务器版（server/lib/story.mjs、memory.mjs、chat.mjs）逐条对应
import { HttpError } from '../../../server/lib/http.mjs';
import { buildHistory, buildSystemPrompt, memorySystemPrompt, memoryUserPrompt } from '../../../server/lib/prompt.mjs';
import { validateCandidates } from '../../../server/lib/memrules.mjs';
import { ModelError } from './model.js';
import { weatherLine } from './weather.js';

export const now = () => new Date().toISOString();
export const newId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export const MESSAGE_KINDS = ['user_message', 'char_message'];
// 记忆整理时一起看的内容：聊天 + 朋友圈动态和评论
export const MEMORY_KINDS = ['user_message', 'char_message', 'moment', 'moment_comment', 'room_photo', 'room_note', 'music_session'];

// 用户删除时选了「让 TA 也忘掉」的朋友圈和评论：之后整理记忆时跳过（只在这条世界线上）
export function forgottenSeqs(s, branch) {
  const out = new Set();
  const evs = visibleEvents(s, branch, { limit: 1e9, kinds: ['moment_remove', 'moment_comment', 'room_photo_remove', 'room_note'] });
  const commentsOf = new Map();
  for (const e of evs) if (e.kind === 'moment_comment') (commentsOf.get(e.data.momentSeq) || commentsOf.set(e.data.momentSeq, []).get(e.data.momentSeq)).push(e.seq);
  const notesOf = new Map();
  for (const e of evs) if (e.kind === 'room_note') notesOf.set(e.data.photoSeq, e.seq);
  for (const e of evs) {
    if (e.kind !== 'room_photo_remove' || !e.data.forget) continue;
    out.add(e.data.photoSeq);
    if (notesOf.has(e.data.photoSeq)) out.add(notesOf.get(e.data.photoSeq));
  }
  for (const e of evs) {
    if (e.kind !== 'moment_remove' || !e.data.forget) continue;
    out.add(e.data.targetSeq);
    if (e.data.target === 'moment') for (const c of commentsOf.get(e.data.targetSeq) || []) out.add(c);
  }
  return out;
}

const copyEvent = (e) => ({ seq: e.seq, branchId: e.branchId, kind: e.kind, data: JSON.parse(JSON.stringify(e.data)), createdAt: e.createdAt });

export const getBranch = (s, id) => s.t.branches.find((b) => b.id === id) || null;

// 一个分支能看到：自己的全部事件 + 每层祖先在分叉点之前（含）的事件
export function lineage(s, branch) {
  const out = [{ branchId: branch.id, maxSeq: null }];
  let cur = branch;
  let limit = null;
  const seen = new Set([branch.id]);
  while (cur.parentId) {
    limit = limit === null ? cur.forkSeq : Math.min(limit, cur.forkSeq);
    const parent = getBranch(s, cur.parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    out.push({ branchId: parent.id, maxSeq: limit });
    cur = parent;
  }
  return out;
}

export function visibleTest(s, branch, seqKey = 'seq') {
  const lin = new Map(lineage(s, branch).map((l) => [l.branchId, l.maxSeq]));
  return (row) => {
    if (!lin.has(row.branchId)) return false;
    const max = lin.get(row.branchId);
    return max === null || row[seqKey] <= max;
  };
}

/** 可见事件（时间正序）。order: 'latest' 取最后 limit 条；'earliest' 取最前 limit 条 */
export function visibleEvents(s, branch, { beforeSeq = null, afterSeq = null, limit = 50, kinds = null, order = 'latest' } = {}) {
  const ok = visibleTest(s, branch);
  const kindSet = kinds ? new Set(kinds) : null;
  const list = s.t.events.filter((e) => e.characterId === branch.characterId && !e.hiddenAt && ok(e)
    && (beforeSeq === null || e.seq < beforeSeq) && (afterSeq === null || e.seq > afterSeq)
    && (!kindSet || kindSet.has(e.kind)));
  const picked = order === 'earliest' ? list.slice(0, limit) : list.slice(Math.max(0, list.length - limit));
  return picked.map(copyEvent);
}

export function visibleEventBySeq(s, branch, seq) {
  const e = s.eventIndex.get(seq);
  if (!e || e.hiddenAt || e.characterId !== branch.characterId || !visibleTest(s, branch)(e)) return null;
  return copyEvent(e);
}

export function effectiveSettings(s, branch) {
  const [ev] = visibleEvents(s, branch, { limit: 1, kinds: ['settings_change'] });
  if (!ev) return null;
  const v = s.t.settingVersions.find((x) => x.id === ev.data.versionId);
  if (!v) return null;
  return { versionId: v.id, version: v.version, data: v.data, note: v.note, createdAt: v.createdAt, changedAtSeq: ev.seq };
}

export function appendEvent(s, { characterId, branchId, kind, data }) {
  const seq = s.nextSeq();
  s.insert('events', { seq, characterId, branchId, kind, data, createdAt: now(), hiddenAt: null });
  return seq;
}

export function createSettingVersion(s, characterId, data, note) {
  const version = s.t.settingVersions.filter((v) => v.characterId === characterId).reduce((m, v) => Math.max(m, v.version), 0) + 1;
  const id = newId();
  s.insert('settingVersions', { id, characterId, version, data, note: note || null, createdAt: now() });
  return { id, version };
}

// —— 记忆（规则同服务器版 memory.mjs） ——
export function visibleControlEvents(s, branch) {
  return visibleEvents(s, branch, { limit: 1e9, kinds: ['correction', 'memory_override', 'memory_commit'] });
}
export function correctionsMap(controls) {
  const map = new Map();
  for (const e of controls) if (e.kind === 'correction') map.set(e.data.targetSeq, e.data);
  return map;
}
export function processedUpTo(controls) {
  let upto = 0;
  for (const e of controls) if (e.kind === 'memory_commit') upto = Math.max(upto, e.data.uptoSeq);
  return upto;
}
export function visibleMemories(s, branch, { statuses = ['active'], controls = null } = {}) {
  const ok = visibleTest(s, branch, 'anchorSeq');
  const ctl = controls || visibleControlEvents(s, branch);
  const override = new Map();
  for (const e of ctl) if (e.kind === 'memory_override') override.set(e.data.memoryId, e.data);
  return s.t.memories
    .filter((m) => m.characterId === branch.characterId && ok(m))
    .sort((a, b) => a.anchorSeq - b.anchorSeq)
    .map((m) => {
      const o = override.get(m.id);
      let status = m.status;
      if (o?.action === 'delete') status = 'invalid';
      else if (o?.action === 'confirm' && status === 'pending') status = 'active';
      return { id: m.id, branchId: m.branchId, kind: m.kind, holder: m.holder, content: m.content, sourceSeqs: m.sourceSeqs, important: m.important, status, createdAt: m.createdAt };
    })
    .filter((m) => statuses.includes(m.status));
}
export function invalidateMemoriesFromSources(s, branch, seqs, reason) {
  const set = new Set(seqs);
  const hit = visibleMemories(s, branch, { statuses: ['active', 'pending'] }).filter((m) => m.sourceSeqs.some((x) => set.has(x)));
  for (const m of hit) appendEvent(s, { characterId: branch.characterId, branchId: branch.id, kind: 'memory_override', data: { memoryId: m.id, action: 'delete', reason } });
  return hit.length;
}

const running = new Set();
export async function processBranch({ s, model, settings: cfg, branchId, force = false }) {
  if (running.has(branchId)) return { skipped: 'running' };
  running.add(branchId);
  try {
    const branch = getBranch(s, branchId);
    if (!branch) return { skipped: 'gone' };
    const character = s.t.characters.find((c) => c.id === branch.characterId);
    const controls = visibleControlEvents(s, branch);
    const upto = processedUpTo(controls);
    const msgs = visibleEvents(s, branch, { afterSeq: upto, limit: 60, kinds: MEMORY_KINDS, order: 'earliest' });
    if (!msgs.length || (!force && msgs.length < cfg.memoryEvery)) return { skipped: 'not_enough', unprocessed: msgs.length };
    const corrected = correctionsMap(controls);
    const forgot = forgottenSeqs(s, branch);
    const usable = msgs.filter((m) => !(m.kind === 'char_message' && corrected.has(m.seq)) && !forgot.has(m.seq));
    const existing = visibleMemories(s, branch, { statuses: ['active', 'pending'], controls });
    const raw = await model.extractMemories({
      system: memorySystemPrompt(character.name),
      user: memoryUserPrompt(character.name, existing.slice(-80), usable),
      who: { characterId: character.id, branchId: branch.id },
    });
    // 提交前重新核对来源：仍然可见、没被纠错
    const corrNow = correctionsMap(visibleControlEvents(s, branch));
    const forgotNow = forgottenSeqs(s, branch);
    const still = new Set(visibleEvents(s, branch, { afterSeq: upto, limit: 1e9, kinds: MEMORY_KINDS }).filter((e) => !corrNow.has(e.seq) && !forgotNow.has(e.seq)).map((e) => e.seq));
    const allowed = new Set(usable.map((m) => m.seq).filter((x) => still.has(x)));
    const { ok, rejected } = validateCandidates(raw, allowed, existing.map((m) => m.content));
    const commitSeq = appendEvent(s, {
      characterId: branch.characterId, branchId: branch.id, kind: 'memory_commit',
      data: { uptoSeq: msgs[msgs.length - 1].seq, added: ok.length, rejected: rejected.length },
    });
    let pending = 0;
    for (const m of ok) {
      const status = m.important ? 'pending' : 'active';
      if (m.important) pending++;
      s.insert('memories', { id: newId(), characterId: branch.characterId, branchId: branch.id, anchorSeq: commitSeq, kind: m.kind, holder: m.holder, content: m.content, sourceSeqs: m.source, important: m.important, status, createdAt: now() });
    }
    return { added: ok.length, pending, rejected: rejected.length };
  } catch (err) {
    return { skipped: 'error', error: err.message };
  } finally {
    running.delete(branchId);
  }
}

// 心声的分隔标记
export const VOICE_MARK = '【心声】';
export function splitVoice(raw) {
  const t = String(raw || '');
  const i = t.lastIndexOf(VOICE_MARK);
  if (i < 0) return { text: t.trim(), thought: '' };
  const text = t.slice(0, i).trim();
  const thought = t.slice(i + VOICE_MARK.length).replace(/^[：:\s]+/, '').trim().slice(0, 200);
  return text ? { text, thought } : { text: thought, thought: '' };
}

// —— 一次聊天回复（规则同服务器版 chat.mjs） ——
const busy = new Set();
export async function generateReply({ s, model, settings: cfg, branch, character }) {
  if (busy.has(branch.id)) throw new HttpError(409, '上一条还在回复中，请稍等');
  busy.add(branch.id);
  try {
    const who = { characterId: character.id, branchId: branch.id };
    const events = visibleEvents(s, branch, { limit: cfg.historyMessages, kinds: MESSAGE_KINDS });
    const last = events[events.length - 1];
    if (!last || last.kind !== 'user_message') throw new HttpError(400, '没有需要回复的消息');

    if (last.data.imageId && !last.data.imageDesc) {
      const dataUrl = await s.getBlob(last.data.imageId);
      if (!dataUrl) throw new HttpError(400, '图片找不到了');
      const desc = await model.describeImage({ dataUrl, userText: last.data.text, who });
      last.data.imageDesc = desc;
      s.eventIndex.get(last.seq).data.imageDesc = desc;
      s.touch('events');
    }

    const controls = visibleControlEvents(s, branch);
    const corrected = correctionsMap(controls);
    const settings = effectiveSettings(s, branch);
    const memories = visibleMemories(s, branch, { controls }).slice(-150);
    const corrections = controls.filter((e) => e.kind === 'correction').slice(-10).map((e) => e.data);
    const world = character.worldId ? s.t.worlds.find((w) => w.id === character.worldId) : null;
    // TA 的心声：打开后让模型在回复末尾另起一行写一句心里话，存起来只给用户看
    let system = buildSystemPrompt({ name: character.name, settings, memories, corrections, world, weather: weatherLine(s) });
    if (cfg.innerVoice) system += `\n\n【心声】回复写完后，另起一行，以「${VOICE_MARK}」开头，用${character.name}自己的口吻写一句此刻真实的内心想法（不超过 40 字，可以和嘴上说的不一样）。这一行用户在聊天里看不到。`;
    const raw = await model.reply({
      system,
      history: buildHistory(events, corrected),
      who,
      meta: { characterName: character.name, settingsVersion: settings?.version ?? null, userText: last.data.text },
    });
    const { text, thought } = splitVoice(raw);
    const data = { text, model: model.name, settingsVersion: settings?.version ?? null };
    if (thought) data.thought = thought;
    const seq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data });
    setTimeout(() => processBranch({ s, model, settings: cfg, branchId: branch.id }).then(() => s.flush()), 0);
    return { userSeq: last.seq, replySeq: seq };
  } catch (err) {
    if (err instanceof ModelError) throw new HttpError(err.status === 422 ? 422 : 502, err.message, { modelError: err.code });
    throw err;
  } finally {
    busy.delete(branch.id);
  }
}
