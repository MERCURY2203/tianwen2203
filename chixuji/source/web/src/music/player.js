// 音乐播放器：整个迟叙机只有一个，换页面也不会停。
// 「一起听」：选一个角色当耳机的另一半。每首歌开始时问一次 TA 要说的话，到点冒出来；用户说一句，TA 回一句。
// 听完（换歌、不一起听了、关掉）就把这次的对话交给 TA 的记忆，不进聊天记录。
import { useEffect, useState } from 'react';
import { get, getAudioBlob, patch, post } from '../api.js';
import { lineAt } from './lyrics.js';

const LAST_KEY = 'xsj:music:last';
const MODE_KEY = 'xsj:music:mode';
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 无痕模式 */ } },
};

const audio = typeof Audio !== 'undefined' ? new Audio() : null;
if (audio) { audio.preload = 'auto'; audio.setAttribute('playsinline', ''); }

const st = {
  tracks: [], // 歌曲库（顺序 = 播放顺序）
  track: null, // 当前这首
  cover: null,
  url: null,
  playing: false,
  time: 0,
  duration: 0,
  mode: ls.get(MODE_KEY) || 'list', // list 列表循环 / one 单曲循环 / shuffle 随机
  companion: null, // { characterId, branchId, name, avatarUrl, avatarColor }
  session: null, // { trackId, startedAt, log, remarks, fired, listened, planning, saved }
  bubbles: [], // { id, who, text, born }
  thinking: false, // TA 正在想怎么回
  loaded: false,
  look: { mode: 'cover', color: '#2a2840', dim: 35, blur: 0, image: null, autoTalk: true }, // 播放页背景、TA 会不会主动说话（设置 → 音乐）
};
const subs = new Set();
let ver = 0;
function emit() { ver++; for (const f of subs) f(ver); }
export const music = st;

export function useMusic() {
  const [, setV] = useState(0);
  useEffect(() => { subs.add(setV); return () => subs.delete(setV); }, []);
  return st;
}

const errorOut = (msg) => window.dispatchEvent(new CustomEvent('xsj:music-error', { detail: msg }));

// —— 歌曲库 ——
export async function loadLook() {
  try { st.look = (await get('/api/local/music/look')).look; emit(); } catch { /* 用默认 */ }
}
if (typeof window !== 'undefined') window.addEventListener('xsj:musiclook', loadLook);

export async function loadLibrary() {
  if (!st.loaded) loadLook();
  const r = await get('/api/local/music');
  st.tracks = r.tracks;
  st.loaded = true;
  if (st.track) {
    const t = st.tracks.find((x) => x.id === st.track.id);
    if (t) { st.track = t; if (!t.hasCover) st.cover = null; } else { stop(); }
  } else {
    // 上次听的那首：小组件上先显示出来（不自动播）
    const last = ls.get(LAST_KEY);
    const t = last && st.tracks.find((x) => x.id === last.trackId);
    if (t) await load(t, { autoplay: false, at: last.time || 0 });
  }
  emit();
  return st.tracks;
}

async function coverOf(t) {
  if (!t.hasCover) return null;
  try { return (await get(`/api/local/music/${t.id}/cover`)).cover; } catch { return null; }
}

export async function refreshCover() {
  if (!st.track) return;
  st.cover = await coverOf(st.track);
  setMediaSession();
  emit();
}

async function load(t, { autoplay = true, at = 0 } = {}) {
  if (!audio) return;
  const prev = st.track;
  if (prev && prev.id !== t.id) await finishSession();
  st.track = t;
  st.time = at;
  st.duration = t.duration || 0;
  st.cover = await coverOf(t);
  const blob = await getAudioBlob(t.id);
  if (st.url) URL.revokeObjectURL(st.url);
  st.url = null;
  if (!blob) {
    st.playing = false;
    emit();
    if (autoplay) errorOut('这首歌的文件不在这台设备上了，请在歌曲信息里重新选一次文件');
    return;
  }
  st.url = URL.createObjectURL(blob);
  audio.src = st.url;
  if (at) { try { audio.currentTime = at; } catch { /* 还没加载好 */ } }
  ls.set(LAST_KEY, { trackId: t.id, time: at });
  setMediaSession();
  emit();
  if (st.companion) startSession();
  if (autoplay) await play();
}

export async function playTrack(id) {
  const t = st.tracks.find((x) => x.id === id);
  if (!t) return;
  if (st.track?.id === id && st.url) { if (!st.playing) await play(); return; }
  await load(t);
}

export async function play() {
  if (!audio || !st.url) { if (st.track) await load(st.track); return; }
  try { await audio.play(); } catch (e) { if (e?.name !== 'AbortError') errorOut('播放不了这首歌：' + (e?.message || '格式可能不支持')); }
}
export function pause() { audio?.pause(); }
export function toggle() { if (st.playing) pause(); else play(); }
export function seek(t) {
  if (!audio || !st.url) return;
  audio.currentTime = Math.max(0, Math.min(t, st.duration || t));
  // 往回拖：拖过的那些话不重复说；往前拖：跳过的话也不补
  if (st.session) for (const r of st.session.remarks) if (r.at <= audio.currentTime && !r.done) r.done = true;
  st.time = audio.currentTime;
  emit();
}
function nextIndex(step) {
  const n = st.tracks.length;
  if (!n) return -1;
  const i = st.tracks.findIndex((x) => x.id === st.track?.id);
  if (st.mode === 'shuffle' && n > 1) { let j; do j = Math.floor(Math.random() * n); while (j === i); return j; }
  return ((i < 0 ? 0 : i + step) + n) % n;
}
export async function next() { const j = nextIndex(1); if (j >= 0) await load(st.tracks[j]); }
export async function prev() {
  if (audio && audio.currentTime > 5) { seek(0); return; }
  const j = nextIndex(-1); if (j >= 0) await load(st.tracks[j]);
}
export function cycleMode() {
  st.mode = st.mode === 'list' ? 'one' : st.mode === 'one' ? 'shuffle' : 'list';
  ls.set(MODE_KEY, st.mode);
  emit();
  return st.mode;
}
export async function stop() {
  await finishSession();
  audio?.pause();
  if (st.url) URL.revokeObjectURL(st.url);
  st.url = null; st.track = null; st.cover = null; st.playing = false; st.time = 0;
  ls.set(LAST_KEY, null);
  emit();
}

if (audio) {
  let lastT = 0;
  audio.addEventListener('play', () => { st.playing = true; emit(); });
  audio.addEventListener('pause', () => { st.playing = false; ls.set(LAST_KEY, st.track ? { trackId: st.track.id, time: audio.currentTime } : null); emit(); });
  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration)) {
      st.duration = audio.duration;
      // 记下时长（导入时没读到的话）
      if (st.track && Math.abs((st.track.duration || 0) - audio.duration) > 1) {
        st.track.duration = audio.duration;
        patch(`/api/local/music/${st.track.id}`, { duration: audio.duration }).catch(() => {});
      }
    }
    emit();
  });
  audio.addEventListener('timeupdate', () => {
    const t = audio.currentTime;
    const d = t - lastT;
    lastT = t;
    if (st.session && st.playing && d > 0 && d < 1.5) st.session.listened += d;
    st.time = t;
    fireRemarks(t);
    if (Math.floor(t) % 5 === 0 && st.track) ls.set(LAST_KEY, { trackId: st.track.id, time: t });
    emit();
  });
  audio.addEventListener('ended', async () => {
    if (st.mode === 'one') { audio.currentTime = 0; if (st.companion) startSession(); play(); return; }
    await next();
  });
  audio.addEventListener('error', () => { if (st.url) errorOut('这首歌播放出错了，可能是格式不支持（试试 mp3）'); });
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { finishSession(); });
}

// —— 锁屏 / 控制中心的播放控件 ——
function setMediaSession() {
  const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : null;
  if (!ms || !st.track) return;
  try {
    ms.metadata = new MediaMetadata({ title: st.track.title, artist: st.track.artist || '', album: st.track.album || '', artwork: st.cover ? [{ src: st.cover, sizes: '512x512' }] : [] });
    ms.setActionHandler('play', play);
    ms.setActionHandler('pause', pause);
    ms.setActionHandler('previoustrack', prev);
    ms.setActionHandler('nexttrack', next);
    ms.setActionHandler('seekto', (e) => seek(e.seekTime));
  } catch { /* 有的浏览器不全支持 */ }
}

// —— 歌词 ——
export function currentLine() {
  const ly = st.track?.lyrics;
  if (!ly?.timed) return null;
  const i = lineAt(ly.lines, st.time);
  return i >= 0 ? ly.lines[i].text : null;
}

// —— 一起听 ——
let bubbleId = 0;
function bubble(who, text) {
  const b = { id: ++bubbleId, who, text, born: Date.now() };
  st.bubbles = [...st.bubbles.filter((x) => Date.now() - x.born < 9000), b].slice(-6);
  emit();
  setTimeout(emit, 9100); // 到时间让气泡消失
}
function log(who, text) {
  if (!st.session) return;
  st.session.log.push({ who, text, at: Math.round(st.time) });
}
function fireRemarks(t) {
  const se = st.session;
  if (!se || !st.playing) return;
  for (const r of se.remarks) {
    if (!r.done && t >= r.at && t - r.at < 8) { r.done = true; bubble('character', r.text); log('character', r.text); }
    else if (!r.done && t - r.at >= 8) r.done = true; // 错过太久就不说了
  }
}

async function startSession() {
  const c = st.companion;
  const t = st.track;
  if (!c || !t) return;
  await finishSession();
  const se = { trackId: t.id, title: t.title, startedAt: new Date().toISOString(), log: [], remarks: [], listened: 0, planning: true, saved: false, branchId: c.branchId };
  st.session = se;
  emit();
  if (st.look?.autoTalk === false) { se.planning = false; emit(); return; } // 设置里关掉了「TA 主动说话」：只在你说话时回
  try {
    const r = await post(`/api/branches/${c.branchId}/music/plan`, { trackId: t.id });
    if (st.session !== se) return;
    se.remarks = r.remarks.map((x) => ({ ...x, done: x.at <= st.time }));
    if (r.opening) { bubble('character', r.opening); log('character', r.opening); }
  } catch (e) {
    if (st.session === se) errorOut(`${c.name}没能跟上：${e.message}`);
  } finally {
    if (st.session === se) { se.planning = false; emit(); }
  }
}

async function finishSession() {
  const se = st.session;
  if (!se || se.saved) return;
  se.saved = true;
  st.session = null;
  st.bubbles = [];
  emit();
  try { await post(`/api/branches/${se.branchId}/music/end`, { trackId: se.trackId, title: se.title, log: se.log, startedAt: se.startedAt, listened: se.listened }); } catch { /* 静默 */ }
}

export async function listenWith(c) {
  if (!c?.viewBranch?.id) { errorOut('先给 TA 选一条世界线'); return; }
  if (c.viewBranch.archived) { errorOut('这条世界线已经归档了，恢复后才能一起听'); return; }
  if (st.companion?.characterId === c.id) return;
  await finishSession();
  st.companion = { characterId: c.id, branchId: c.viewBranch.id, name: c.name, avatarUrl: c.avatarUrl, avatarColor: c.avatarColor };
  emit();
  if (st.track) await startSession();
}
export async function listenAlone() {
  await finishSession();
  st.companion = null;
  emit();
}

export async function say(text) {
  const c = st.companion;
  const se = st.session;
  const t = st.track;
  const msg = String(text || '').trim();
  if (!msg || !c || !se || !t) return false;
  bubble('user', msg);
  const before = se.log.slice();
  log('user', msg);
  st.thinking = true;
  emit();
  try {
    const r = await post(`/api/branches/${c.branchId}/music/say`, { trackId: t.id, text: msg, at: st.time, lyric: currentLine() || '', log: before });
    if (st.session === se) { bubble('character', r.text); log('character', r.text); }
  } catch (e) {
    errorOut(e.message);
  } finally {
    st.thinking = false;
    emit();
  }
  return true;
}

export function sessionLog() { return st.session?.log || []; }
