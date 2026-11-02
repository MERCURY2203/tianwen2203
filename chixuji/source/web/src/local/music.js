// 纯前端版：音乐。歌曲库是全局的（不分角色）；「一起听」时 TA 说的话按世界线记成事件，只进记忆、不进聊天记录。
// 存储：
//   表 tracks                  歌曲信息（歌名、歌手、专辑、作词、作曲、编曲、制作人、时长、歌词、收藏）
//   blob music:audio:<id>      歌曲文件本身（Blob，不进备份文件，太大）
//   blob music:cover:<id>      封面（dataURL 图片）
// 事件：
//   music_session { trackId, title, artist, lines:[{ who:'user'|'character', text, at }], startedAt, endedAt, listened }
import { appendEvent, now, processBranch, visibleEvents } from './logic.js';
import { persona, recentChat } from './social.js';
import { lyricsForPrompt } from '../music/lyrics.js';

export const AUDIO_PREFIX = 'music:audio:';
export const COVER_PREFIX = 'music:cover:';
export const TEXT_FIELDS = { title: ['歌名', 80], artist: ['歌手', 80], album: ['专辑', 80], lyricist: ['作词', 80], composer: ['作曲', 80], arranger: ['编曲', 80], producer: ['制作人', 80] };

const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function trackView(t) {
  return {
    id: t.id, title: t.title, artist: t.artist || '', album: t.album || '', lyricist: t.lyricist || '', composer: t.composer || '',
    arranger: t.arranger || '', producer: t.producer || '', duration: t.duration || 0, lyrics: t.lyrics || null,
    hasCover: !!t.hasCover, fav: !!t.fav, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

function songBlock(track) {
  const info = [`歌名：《${track.title}》`];
  if (track.artist) info.push(`歌手：${track.artist}`);
  if (track.album) info.push(`专辑：${track.album}`);
  if (track.lyricist) info.push(`作词：${track.lyricist}`);
  if (track.composer) info.push(`作曲：${track.composer}`);
  if (track.duration) info.push(`时长：${mmss(track.duration)}`);
  const ly = lyricsForPrompt(track.lyrics);
  return info.join('\n') + (ly ? `\n\n歌词：\n${ly}` : '\n\n（没有歌词）');
}
const RULES = (name) => [
  `你（${name}）和用户正戴着同一副耳机，一起听这首歌。你能「听到」的只有上面的歌名、歌手和歌词。`,
  '熟悉这首歌可以自然地聊；不熟悉就围绕歌词和此刻的感受说，不要编造歌词里没有的内容，不要瞎说歌曲背景。',
  '口吻完全按人设，像贴在耳边小声说话：短、口语、可以有停顿，不要书面腔，不要括号动作描写。',
].join('\n');

const logText = (log, name) => (log || []).slice(-30).map((l) => `[${mmss(l.at || 0)}] ${l.who === 'user' ? '用户' : name}：${l.text}`).join('\n');

// 开始一起听：一次问好整首歌要说的几句话（省钱，不会边听边花）
export async function planRemarks(s, model, character, branch, track) {
  const timed = track.lyrics?.timed;
  const task = [
    '【任务：一起听歌】',
    songBlock(track),
    `最近的聊天：\n${recentChat(s, branch, character.name, 8)}`,
    RULES(character.name),
    `写下这首歌播放过程中你会小声说的话：一句开头（刚戴上耳机时），再加 3～5 句在歌曲进行中说的。每句不超过 30 字。`,
    timed
      ? '歌曲中的那几句，at 写成秒数，必须对应上面某一句歌词的时间（听到那句时说），不要都挤在前面。'
      : `没有带时间的歌词，at 就在 15 秒到 ${Math.max(30, Math.round((track.duration || 200) - 10))} 秒之间分散开。`,
    '只输出 JSON：{"opening":"开头那句","remarks":[{"at":秒数,"text":"说的话"}]}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'music', system: persona(s, character, branch), task, json: true, maxTokens: 700, who: { characterId: character.id, branchId: branch.id } });
  const max = track.duration ? track.duration - 3 : 1e9;
  const remarks = (Array.isArray(r?.remarks) ? r.remarks : [])
    .map((x) => ({ at: Math.max(3, Math.min(max, Number(x?.at) || 0)), text: String(x?.text || '').trim().slice(0, 80) }))
    .filter((x) => x.text && Number.isFinite(x.at)).sort((a, b) => a.at - b.at).slice(0, 6);
  const opening = String(r?.opening || '').trim().slice(0, 80);
  return { opening, remarks };
}

// 用户在听歌时说了一句：TA 回一句
export async function replyDuringSong(s, model, character, branch, track, { text, at, lyric, log }) {
  const task = [
    '【任务：一起听歌时的对话】',
    songBlock(track),
    RULES(character.name),
    `现在播到 ${mmss(at || 0)}${lyric ? `，正在唱：「${lyric}」` : ''}。`,
    `这次一起听时说过的话：\n${logText(log, character.name) || '（还没有）'}`,
    `用户刚刚小声对你说：「${text}」`,
    '回一句（不超过 50 字）。只输出 JSON：{"text":"你的回复"}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'music', system: persona(s, character, branch), task, json: true, maxTokens: 300, who: { characterId: character.id, branchId: branch.id } });
  const out = String(r?.text || '').trim().slice(0, 160);
  if (!out) throw new Error('TA 好像没听清，再说一次？');
  return out;
}

// 听完 / 不听了：记成一件事，交给记忆整理
export function endSession(s, model, settings, character, branch, track, { log, startedAt, listened }) {
  const lines = (Array.isArray(log) ? log : []).slice(0, 80)
    .map((l) => ({ who: l.who === 'user' ? 'user' : 'character', text: String(l.text || '').slice(0, 300), at: Math.max(0, Number(l.at) || 0) }))
    .filter((l) => l.text);
  const secs = Math.max(0, Math.round(Number(listened) || 0));
  if (!lines.some((l) => l.who === 'user') && secs < 20) return { saved: false }; // 只是点开又关掉
  const seq = appendEvent(s, {
    characterId: character.id, branchId: branch.id, kind: 'music_session',
    data: { trackId: track.id, title: track.title, artist: track.artist || '', lines, startedAt: startedAt || now(), endedAt: now(), listened: secs },
  });
  setTimeout(() => processBranch({ s, model, settings, branchId: branch.id, force: true }).then(() => s.flush()), 0);
  return { saved: true, seq };
}

// 「一起听过的歌」：这个角色（当前世界线能看到的）
export function listenedTogether(s, branch) {
  return visibleEvents(s, branch, { limit: 200, kinds: ['music_session'] }).reverse()
    .map((e) => ({ seq: e.seq, trackId: e.data.trackId, title: e.data.title, artist: e.data.artist, lines: e.data.lines, at: e.createdAt, listened: e.data.listened }));
}
