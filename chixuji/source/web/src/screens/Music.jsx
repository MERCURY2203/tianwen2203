// 音乐（纯前端版）：歌曲库、导入歌曲、播放页、和 TA 一起听
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { del, get, patch, post } from '../api.js';
import { cropImage } from '../crop.jsx';
import { compressImage } from '../image.js';
import { Avatar, Button, Sheet, toast, TopBar } from '../ui.jsx';
import { readTags } from '../music/id3.js';
import { decodeText, FORMAT_NAMES, lineAt, parseLyrics } from '../music/lyrics.js';
import * as P from '../music/player.js';

const fmt = (t) => { t = Math.max(0, Math.floor(t || 0)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

// —— 封面：小缓存 ——
const coverCache = new Map(); // key = id:updatedAt
export function useCover(t) {
  const key = t ? `${t.id}:${t.updatedAt}` : '';
  const [src, setSrc] = useState(coverCache.get(key) || null);
  useEffect(() => {
    if (!t?.hasCover) { setSrc(null); return undefined; }
    if (coverCache.has(key)) { setSrc(coverCache.get(key)); return undefined; }
    let alive = true;
    get(`/api/local/music/${t.id}/cover`).then((r) => { coverCache.set(key, r.cover); if (alive) setSrc(r.cover); }, () => {});
    return () => { alive = false; };
  }, [key, t?.hasCover]);
  return src;
}
export function Cover({ track, size = 48, className = '' }) {
  const src = useCover(track);
  return (
    <span className={'mu-cover ' + className} style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="6.5" cy="18" r="2.5" fill="currentColor" /><circle cx="16.5" cy="16" r="2.5" fill="currentColor" /></svg>}
    </span>
  );
}

// —— 封面取色：播放页背景跟着封面走 ——
function useCoverColor(src) {
  const [c, setC] = useState(null);
  useEffect(() => {
    if (!src) { setC(null); return; }
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas'); cv.width = 24; cv.height = 24;
        const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 24, 24);
        const d = g.getImageData(0, 0, 24, 24).data;
        // 偏向饱和、不太亮也不太暗的颜色
        let r = 0, gg = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]); const mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const sat = mx ? (mx - mn) / mx : 0; const k = 0.25 + sat * 2 + (mx > 30 && mx < 235 ? 0.5 : 0);
          r += d[i] * k; gg += d[i + 1] * k; b += d[i + 2] * k; w += k;
        }
        r /= w; gg /= w; b /= w;
        // 压暗到适合白字的程度
        const lum = 0.299 * r + 0.587 * gg + 0.114 * b;
        const f = lum > 90 ? 90 / lum : 1;
        setC([r * f, gg * f, b * f].map(Math.round));
      } catch { setC(null); }
    };
    img.src = src;
  }, [src]);
  return c;
}

// —— 导入 / 编辑歌曲 ——
const EMPTY = { title: '', artist: '', album: '', lyricist: '', composer: '', arranger: '', producer: '' };
const LABELS = [['title', '歌名'], ['artist', '歌手'], ['album', '专辑'], ['lyricist', '作词'], ['composer', '作曲'], ['arranger', '编曲'], ['producer', '制作人']];

async function blobToCover(blob) {
  const f = blob instanceof File ? blob : new File([blob], 'cover', { type: blob.type || 'image/jpeg' });
  return (await compressImage(f, 800, 0.88)).dataUrl;
}
function audioDuration(file) {
  return new Promise((resolve) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    a.src = url;
  });
}

function TrackSheet({ open, track, onClose, onSaved }) {
  const editing = !!track;
  const [file, setFile] = useState(null);
  const [f, setF] = useState(EMPTY);
  const [cover, setCover] = useState(undefined); // undefined = 不改
  const [lyrics, setLyrics] = useState(undefined); // undefined = 不改；null = 清空
  const [paste, setPaste] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [duration, setDuration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const audioRef = useRef(null);
  const coverRef = useRef(null);
  const lyricRef = useRef(null);
  const oldCover = useCover(editing ? track : null);
  useEffect(() => {
    if (!open) return;
    setFile(null); setCover(undefined); setLyrics(undefined); setPaste(false); setPasteText(''); setDuration(0);
    setF(editing ? Object.fromEntries(LABELS.map(([k]) => [k, track[k] || ''])) : EMPTY);
  }, [open, track?.id]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function pickAudio(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > 80 * 1024 * 1024) { toast('歌曲文件太大了（最大 80 MB）'); return; }
    setFile(file);
    setReading(true);
    try {
      setDuration(await audioDuration(file));
      const tags = await readTags(file).catch(() => null);
      const base = file.name.replace(/\.[^.]+$/, '');
      // 文件名常见「歌手 - 歌名」
      const m = base.match(/^(.+?)\s*[-–—]\s*(.+)$/);
      setF((x) => ({
        ...x,
        title: x.title || tags?.title || (m ? m[2] : base),
        artist: x.artist || tags?.artist || (m ? m[1] : ''),
        album: x.album || tags?.album || '',
        lyricist: x.lyricist || tags?.lyricist || '',
        composer: x.composer || tags?.composer || '',
        arranger: x.arranger || tags?.arranger || '',
        producer: x.producer || tags?.producer || '',
      }));
      if (tags?.cover && cover === undefined && !(editing && track.hasCover)) { try { setCover(await blobToCover(tags.cover)); } catch { /* 封面坏了 */ } }
      if (lyrics === undefined && !(editing && track.lyrics)) {
        if (tags?.syncedLyrics?.length) setLyrics({ format: 'id3', timed: true, lines: tags.syncedLyrics.filter((l) => l.text) });
        else if (tags?.lyricsText) { const p = parseLyrics(tags.lyricsText); setLyrics({ ...p, format: p.timed ? p.format : 'id3' }); }
      }
      const got = [tags?.title && '歌名', tags?.artist && '歌手', tags?.cover && '封面', (tags?.syncedLyrics || tags?.lyricsText) && '歌词'].filter(Boolean);
      if (got.length) toast(`从歌曲文件里读到了：${got.join('、')}`);
    } finally { setReading(false); }
  }
  async function pickCover(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { const d = await cropImage(file, { aspect: 1, size: 800, title: '裁剪封面' }); if (d) setCover(d); } catch (err) { toast(err.message); }
  }
  async function pickLyrics(e) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('歌词文件太大了'); return; }
    const text = decodeText(await file.arrayBuffer());
    const p = parseLyrics(text, file.name);
    if (!p.lines.length) { toast('没从这个文件里读到歌词'); return; }
    setLyrics(p); setPaste(false);
  }
  function usePaste() {
    const p = parseLyrics(pasteText);
    if (!p.lines.length) { toast('先粘贴歌词'); return; }
    setLyrics(p); setPaste(false); setPasteText('');
  }
  async function save() {
    if (!editing && !file) { toast('先选歌曲文件'); return; }
    if (!f.title.trim()) { toast('请填写歌名'); return; }
    setBusy(true);
    try {
      const body = { ...f };
      if (cover !== undefined) body.cover = cover;
      if (lyrics !== undefined) body.lyrics = lyrics;
      if (file) { body.audio = file; if (duration) body.duration = duration; }
      if (editing) await patch(`/api/local/music/${track.id}`, body);
      else await post('/api/local/music', body);
      toast(editing ? '改好了' : '导入好了');
      onSaved();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  const shownCover = cover === undefined ? oldCover : cover;
  const ly = lyrics === undefined ? track?.lyrics : lyrics;
  return (
    <Sheet open={open} onClose={onClose} title={editing ? '歌曲信息' : '导入歌曲'}>
      <div className="mu-form">
        <input ref={audioRef} type="file" accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus" hidden onChange={pickAudio} />
        <input ref={coverRef} type="file" accept="image/*" hidden onChange={pickCover} />
        <input ref={lyricRef} type="file" accept=".lrc,.srt,.vtt,.txt,text/plain" hidden onChange={pickLyrics} />
        <button type="button" className={'mu-file' + (file ? ' is-on' : '')} onClick={() => audioRef.current?.click()}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
          <span>
            <b>{reading ? '正在读取…' : file ? file.name : editing ? (track.missing ? '这台设备上没有歌曲文件，点这里重新选' : '换一个歌曲文件（可不换）') : '选歌曲文件'}</b>
            <small>{file ? `${(file.size / 1048576).toFixed(1)} MB${duration ? ` · ${fmt(duration)}` : ''}` : 'mp3、m4a、flac、wav 都可以；mp3 自带的信息会自动填上'}</small>
          </span>
        </button>

        <div className="mu-form-top">
          <button type="button" className="mu-cover-pick" onClick={() => coverRef.current?.click()} aria-label="选封面">
            {shownCover ? <img src={shownCover} alt="" /> : <span>＋<br />封面</span>}
          </button>
          <div className="mu-form-main">
            <label className="field"><span>歌名</span><input value={f.title} maxLength={80} onChange={set('title')} /></label>
            <label className="field"><span>歌手</span><input value={f.artist} maxLength={80} onChange={set('artist')} /></label>
          </div>
        </div>
        {shownCover && <button type="button" className="text-btn danger mu-small" onClick={() => setCover(null)}>不要封面</button>}

        <div className="mu-grid">
          {LABELS.slice(2).map(([k, label]) => (
            <label className="field" key={k}><span>{label}</span><input value={f[k]} maxLength={80} onChange={set(k)} /></label>
          ))}
        </div>

        <div className="mu-lyrics">
          <div className="mu-lyrics-head">
            <b>歌词</b>
            <span>{ly?.lines?.length ? `${FORMAT_NAMES[ly.format] || '歌词'} · ${ly.lines.length} 行${ly.timed ? '' : '（不会跟着滚动）'}` : '还没有'}</span>
          </div>
          {ly?.lines?.length > 0 && <div className="mu-lyrics-preview">{ly.lines.slice(0, 4).map((l, i) => <p key={i}>{l.t !== null ? <em>{fmt(l.t)}</em> : null}{l.text}</p>)}{ly.lines.length > 4 && <p className="mu-more">……</p>}</div>}
          <div className="mu-lyrics-btns">
            <button type="button" className="btn btn-ghost" onClick={() => lyricRef.current?.click()}>导入歌词文件</button>
            <button type="button" className="btn btn-ghost" onClick={() => setPaste((x) => !x)}>粘贴歌词</button>
            {ly?.lines?.length > 0 && <button type="button" className="btn btn-ghost" onClick={() => setLyrics(null)}>清空</button>}
          </div>
          <small className="mu-hint">支持 LRC（滚动歌词）、SRT / VTT 字幕、TXT 纯文字；中文编码自动识别</small>
          {paste && (
            <div className="mu-paste">
              <textarea rows={6} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'把歌词粘贴到这里\n带 [00:12.34] 这种时间的会跟着歌曲滚动'} />
              <Button kind="ghost" onClick={usePaste}>用这段歌词</Button>
            </div>
          )}
        </div>
        <Button busy={busy || reading} onClick={save}>{editing ? '保存' : '导入'}</Button>
      </div>
    </Sheet>
  );
}

// —— 选一起听的人 ——
export function CompanionSheet({ open, characters, onClose, onPick, allowAlone }) {
  const m = P.useMusic();
  return (
    <Sheet open={open} onClose={onClose} title="和谁一起听">
      <div className="mu-people">
        {characters.map((c) => (
          <button type="button" key={c.id} className={'mu-person' + (m.companion?.characterId === c.id ? ' is-on' : '')} disabled={!c.viewBranch || c.viewBranch.archived} onClick={() => onPick(c)}>
            <Avatar name={c.name} color={c.avatarColor} url={c.avatarUrl} size={44} />
            <span><b>{c.name}</b><small>{!c.viewBranch ? '还没有世界线' : c.viewBranch.archived ? '世界线已归档' : `世界线：${c.viewBranch.name}`}</small></span>
            {m.companion?.characterId === c.id && <i>正在一起听</i>}
          </button>
        ))}
        {allowAlone && m.companion && <button type="button" className="btn btn-ghost" onClick={() => onPick(null)}>不一起听了，自己听</button>}
      </div>
    </Sheet>
  );
}

// —— 歌曲库 ——
function Library({ go, onOpenPlayer, characters }) {
  const m = P.useMusic();
  const [tab, setTab] = useState('all');
  const [sheet, setSheet] = useState(null); // { track } | { create: true }
  const [menu, setMenu] = useState(null);
  const reload = () => P.loadLibrary().catch((e) => toast(e.message));
  useEffect(() => { reload(); }, []);
  const list = tab === 'fav' ? m.tracks.filter((t) => t.fav) : m.tracks;
  async function remove(t) {
    if (!window.confirm(`删除《${t.title}》？歌曲文件会从迟叙机里删掉。`)) return;
    try { if (m.track?.id === t.id) await P.stop(); await del(`/api/local/music/${t.id}`); setMenu(null); reload(); } catch (e) { toast(e.message); }
  }
  async function fav(t) {
    try { await patch(`/api/local/music/${t.id}`, { fav: !t.fav }); reload(); } catch (e) { toast(e.message); }
  }
  return (
    <div className="page mu-lib">
      <TopBar title="音乐" onBack={() => go('home')} right={<button className="icon-btn" onClick={() => setSheet({ create: true })} aria-label="导入歌曲"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>} />
      <div className="mu-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'is-on' : ''} onClick={() => setTab('all')}>全部 {m.tracks.length || ''}</button>
        <button role="tab" aria-selected={tab === 'fav'} className={tab === 'fav' ? 'is-on' : ''} onClick={() => setTab('fav')}>收藏</button>
      </div>
      <div className="page-body mu-list">
        {m.loaded && !m.tracks.length && (
          <div className="mu-empty">
            <p>这里还没有歌。</p>
            <p>导入手机里的歌曲文件，就能和 TA 戴着同一副耳机一起听。</p>
            <Button onClick={() => setSheet({ create: true })}>导入第一首歌</Button>
          </div>
        )}
        {m.loaded && tab === 'fav' && m.tracks.length > 0 && !list.length && <p className="mu-none">还没有收藏的歌，在播放页点 ♡ 收藏。</p>}
        {list.map((t) => (
          <div className={'mu-row' + (m.track?.id === t.id ? ' is-now' : '')} key={t.id}>
            <button type="button" className="mu-row-main" onClick={() => { if (t.missing) { setSheet({ track: t }); toast('这台设备上没有这首歌的文件，重新选一次就好'); return; } P.playTrack(t.id); onOpenPlayer(); }}>
              <Cover track={t} size={48} />
              <span className="mu-row-text">
                <b>{t.title}</b>
                <small>{t.missing ? <em>缺少歌曲文件</em> : null}{[t.artist, t.album].filter(Boolean).join(' · ') || '未知歌手'}</small>
              </span>
              {m.track?.id === t.id && <span className={'mu-eq' + (m.playing ? ' is-on' : '')} aria-label="正在播放"><i /><i /><i /></span>}
            </button>
            {t.fav && <span className="mu-heart" aria-label="已收藏">♥</span>}
            <button type="button" className="icon-btn mu-more-btn" onClick={() => setMenu(t)} aria-label="更多">⋯</button>
          </div>
        ))}
      </div>
      {m.track && <MiniBar onOpen={onOpenPlayer} />}
      <TrackSheet open={!!sheet} track={sheet?.track || null} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload().then(() => P.refreshCover()); }} />
      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu ? `《${menu.title}》` : ''}>
        {menu && (
          <div className="mu-menu">
            <Button kind="ghost" onClick={() => { const t = menu; setMenu(null); setSheet({ track: t }); }}>编辑歌曲信息和歌词</Button>
            <Button kind="ghost" onClick={() => { fav(menu); setMenu(null); }}>{menu.fav ? '取消收藏' : '收藏'}</Button>
            <button type="button" className="text-btn danger" onClick={() => remove(menu)}>删除这首歌</button>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function MiniBar({ onOpen }) {
  const m = P.useMusic();
  const pct = m.duration ? (m.time / m.duration) * 100 : 0;
  return (
    <div className="mu-mini">
      <i className="mu-mini-bar" style={{ width: `${pct}%` }} />
      <button type="button" className="mu-mini-main" onClick={onOpen}>
        <span className={'mu-mini-disc' + (m.playing ? ' is-on' : '')}>{m.cover ? <img src={m.cover} alt="" /> : null}</span>
        <span className="mu-row-text"><b>{m.track.title}</b><small>{m.companion ? `和${m.companion.name}一起听` : m.track.artist || '未知歌手'}</small></span>
      </button>
      <button type="button" className="icon-btn" onClick={P.toggle} aria-label={m.playing ? '暂停' : '播放'}>{m.playing ? <IconPause size={22} /> : <IconPlay size={22} />}</button>
    </div>
  );
}

// —— 图标 ——
const IconPlay = ({ size = 28 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>;
const IconPause = ({ size = 28 }) => <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><rect x="5.5" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" /><rect x="14" y="4" width="4.5" height="16" rx="1.5" fill="currentColor" /></svg>;
const IconPrev = () => <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M18 5v14L8 12z" fill="currentColor" /><rect x="5" y="5" width="2.6" height="14" rx="1" fill="currentColor" /></svg>;
const IconNext = () => <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M6 5v14l10-7z" fill="currentColor" /><rect x="16.4" y="5" width="2.6" height="14" rx="1" fill="currentColor" /></svg>;
const IconList = () => <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M3.5 4.5l2.5 1.5-2.5 1.5z" fill="currentColor" /></svg>;
function IconMode({ mode }) {
  if (mode === 'shuffle') return <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M3 7h3.5c3 0 4.5 10 8 10H20M3 17h3.5c1.4 0 2.4-2 3.3-4.3M14.5 7H20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /><path d="M18 4.5L20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.6-5.9" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18.5 3.5v3.2h-3.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      {mode === 'one' && <text x="12" y="15.5" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor">1</text>}
    </svg>
  );
}
const IconChat = () => <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 6.5C4 5.1 5.1 4 6.5 4h7C14.9 4 16 5.1 16 6.5v4c0 1.4-1.1 2.5-2.5 2.5H9l-3.2 2.6V13h0C4.8 13 4 12.1 4 11z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="M18 8.5c1.1.2 2 1.2 2 2.4v3.6c0 1.3-1 2.4-2.3 2.5v2.4L14.8 17H11.5c-1 0-1.8-.5-2.2-1.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="7.5" cy="8.6" r=".9" fill="currentColor" /><circle cx="10" cy="8.6" r=".9" fill="currentColor" /><circle cx="12.5" cy="8.6" r=".9" fill="currentColor" /></svg>;
const IconHeart = ({ on }) => <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.1C4.5 7.2 6.5 5 9 5c1.4 0 2.4.7 3 1.7C12.6 5.7 13.6 5 15 5c2.5 0 4.5 2.2 4.5 4.9C19.5 15.4 12 20 12 20z" fill={on ? '#ff4d5e' : 'none'} stroke={on ? '#ff4d5e' : 'currentColor'} strokeWidth="1.6" strokeLinejoin="round" /></svg>;
const MODE_NAMES = { list: '列表循环', one: '单曲循环', shuffle: '随机播放' };

// —— 播放页 ——
function Player({ me, characters, onClose, onEdit, go }) {
  const m = P.useMusic();
  const t = m.track;
  const color = useCoverColor(m.cover);
  const [view, setView] = useState('music'); // music / talk
  const [showLyrics, setShowLyrics] = useState(false);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [pick, setPick] = useState(false);
  const [queue, setQueue] = useState(false);
  const [more, setMore] = useState(false);
  const [drag, setDrag] = useState(null);
  const inputRef = useRef(null);
  const lyricsRef = useRef(null);
  useEffect(() => { if (typing) inputRef.current?.focus(); }, [typing]);
  const lines = t?.lyrics?.lines || [];
  const cur = t?.lyrics?.timed ? lineAt(lines, m.time) : -1;
  useEffect(() => {
    if (!showLyrics || cur < 0) return;
    const el = lyricsRef.current?.querySelector(`[data-i="${cur}"]`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [cur, showLyrics]);
  if (!t) {
    return (
      <div className="mu-player" style={{ '--mu-bg': '#2a2840' }}>
        <div className="mu-top"><button className="icon-btn" onClick={onClose} aria-label="收起"><Chevron /></button></div>
        <p className="mu-none" style={{ color: '#fff', textAlign: 'center', marginTop: 120 }}>还没有在放的歌</p>
      </div>
    );
  }
  const look = m.look || {};
  const useImage = look.mode === 'image' && look.image;
  const bg = look.mode === 'color' ? look.color : useImage ? '#1d1b26' : color ? `rgb(${color.join(',')})` : '#2a2840';
  const now = Date.now();
  const bubbles = m.bubbles.filter((b) => now - b.born < 9000);
  const mine = bubbles.filter((b) => b.who === 'user').slice(-1)[0];
  const theirs = bubbles.filter((b) => b.who === 'character').slice(-1)[0];
  const c = m.companion;
  async function send(e) {
    e?.preventDefault();
    const v = text.trim();
    if (!v) return;
    if (!c) { setPick(true); return; }
    setText('');
    await P.say(v);
  }
  const shownTime = drag ?? m.time;
  const pct = m.duration ? Math.min(100, (shownTime / m.duration) * 100) : 0;
  return (
    <div className={'mu-player' + (useImage ? ' has-image' : '')} style={{ '--mu-bg': bg }}>
      {useImage && (
        <div className="mu-bgimg" aria-hidden="true">
          <div style={{ backgroundImage: `url(${look.image})`, filter: look.blur ? `blur(${look.blur}px)` : undefined, inset: look.blur ? `-${look.blur * 2}px` : 0 }} />
          <i style={{ opacity: (look.dim ?? 35) / 100 }} />
        </div>
      )}
      <div className="mu-top">
        <button className="icon-btn" onClick={onClose} aria-label="收起"><Chevron /></button>
        <button className="icon-btn mu-dots" onClick={() => setMore(true)} aria-label="更多"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="5.5" r="1.7" fill="currentColor" /><circle cx="12" cy="12" r="1.7" fill="currentColor" /><circle cx="12" cy="18.5" r="1.7" fill="currentColor" /></svg></button>
      </div>

      {/* 两个头像共用一副耳机 */}
      <div className="mu-pair">
        <div className="mu-pair-heads">
          <svg className="mu-wire" viewBox="0 0 200 90" aria-hidden="true" preserveAspectRatio="none">
            <path d="M28 40 C 18 70, 70 86, 100 88" /><path d="M172 40 C 182 70, 130 86, 100 88" />
          </svg>
          <span className="mu-head mu-head-me">
            <Avatar name={me?.name || '我'} color="#8a8496" url={me?.avatarUrl} size={64} />
          </span>
          <button type="button" className="mu-head mu-head-them" onClick={() => setPick(true)} aria-label={c ? `和${c.name}一起听，点这里换人` : '邀请 TA 一起听'}>
            {c ? <Avatar name={c.name} color={c.avatarColor} url={c.avatarUrl} size={64} /> : <span className="mu-head-add">＋</span>}
          </button>
        </div>
        <p className="mu-pair-text">
          {c ? <>和 {c.name} 戴着同一副耳机{m.session?.planning ? '…' : ''}</> : <button type="button" className="mu-invite" onClick={() => setPick(true)}>邀请 TA 一起听 &gt;</button>}
        </p>
        {/* 说话的气泡：左边是我、右边是 TA，放不下自动换行 */}
        <div className="mu-bubbles" aria-live="polite">
          <div className="mu-bslot mu-bslot-me">{mine && <span className="mu-bubble" key={mine.id}>{mine.text}</span>}</div>
          <div className="mu-bslot mu-bslot-them">
            {theirs && <span className="mu-bubble" key={theirs.id}>{theirs.text}</span>}
            {c && m.thinking && !theirs && <span className="mu-bubble mu-bubble-dots"><i /><i /><i /></span>}
          </div>
        </div>
      </div>

      {view === 'music' ? (
        <div className="mu-stage" onClick={() => setShowLyrics((x) => !x)}>
          {showLyrics ? (
            <div className="mu-lyrics-full" ref={lyricsRef}>
              {lines.length ? lines.map((l, i) => (
                <p key={i} data-i={i} className={i === cur ? 'is-on' : ''} onClick={(e) => { if (l.t !== null) { e.stopPropagation(); P.seek(l.t); } }}>{l.text}</p>
              )) : <p className="mu-none">这首歌还没有歌词，在「⋯ → 编辑歌曲信息」里导入</p>}
            </div>
          ) : (
            <>
              <div className="mu-disc-wrap">
                <div className={'mu-disc' + (m.playing ? ' is-on' : '')}>
                  <div className="mu-disc-label">{m.cover ? <img src={m.cover} alt="" /> : <span className="mu-disc-blank" />}</div>
                </div>
              </div>
              <p className="mu-line">{cur >= 0 ? lines[cur].text : lines.length && !t.lyrics.timed ? '点唱片看歌词' : ''}</p>
            </>
          )}
        </div>
      ) : (
        <div className="mu-talk">
          {!c && <p className="mu-none">还没有人和你一起听。<button type="button" className="mu-invite" onClick={() => setPick(true)}>邀请 TA &gt;</button></p>}
          {c && !P.sessionLog().length && <p className="mu-none">{m.session?.planning ? `${c.name}正在戴上耳机…` : '说点什么吧，TA 听得见。'}</p>}
          {P.sessionLog().map((l, i) => (
            <div key={i} className={'mu-talk-row' + (l.who === 'user' ? ' is-me' : '')}>
              {l.who === 'user' ? <Avatar name={me?.name || '我'} color="#8a8496" url={me?.avatarUrl} size={30} /> : <Avatar name={c?.name} color={c?.avatarColor} url={c?.avatarUrl} size={30} />}
              <span className="mu-talk-bubble">{l.text}<em>{fmt(l.at)}</em></span>
            </div>
          ))}
          {m.thinking && <div className="mu-talk-row"><Avatar name={c?.name} color={c?.avatarColor} url={c?.avatarUrl} size={30} /><span className="mu-talk-bubble mu-bubble-dots"><i /><i /><i /></span></div>}
        </div>
      )}

      <div className="mu-info">
        <div className="mu-title"><b>{t.title}</b><small>{t.artist || '未知歌手'}</small></div>
        <button type="button" className="mu-round" onClick={() => (c ? setTyping((x) => !x) : setPick(true))} aria-label="说点什么"><IconChat /></button>
        <button type="button" className="icon-btn mu-fav" onClick={async () => { try { await patch(`/api/local/music/${t.id}`, { fav: !t.fav }); P.loadLibrary(); } catch (e) { toast(e.message); } }} aria-label={t.fav ? '取消收藏' : '收藏'}><IconHeart on={t.fav} /></button>
      </div>

      {typing && (
        <form className="mu-say" onSubmit={send}>
          <input ref={inputRef} value={text} maxLength={200} placeholder={c ? `小声跟${c.name}说…` : '先邀请 TA'} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={!text.trim() || m.thinking}>发送</button>
        </form>
      )}

      <div className="mu-progress">
        <input type="range" min={0} max={m.duration || 1} step={0.5} value={shownTime} aria-label="播放进度"
          style={{ '--p': `${pct}%` }}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={(e) => { P.seek(Number(e.currentTarget.value)); setDrag(null); }}
          onTouchEnd={(e) => { P.seek(Number(e.currentTarget.value)); setDrag(null); }}
          onKeyUp={(e) => { P.seek(Number(e.currentTarget.value)); setDrag(null); }} />
        <div className="mu-times"><span>{fmt(shownTime)}</span><span>{fmt(m.duration)}</span></div>
      </div>

      <div className="mu-controls">
        <button type="button" className="icon-btn" onClick={() => toast(MODE_NAMES[P.cycleMode()])} aria-label={MODE_NAMES[m.mode]}><IconMode mode={m.mode} /></button>
        <button type="button" className="icon-btn" onClick={P.prev} aria-label="上一首"><IconPrev /></button>
        <button type="button" className="icon-btn mu-play" onClick={P.toggle} aria-label={m.playing ? '暂停' : '播放'}>{m.playing ? <IconPause size={44} /> : <IconPlay size={44} />}</button>
        <button type="button" className="icon-btn" onClick={P.next} aria-label="下一首"><IconNext /></button>
        <button type="button" className="icon-btn" onClick={() => setQueue(true)} aria-label="播放列表"><IconList /></button>
      </div>

      <div className="mu-switch" role="tablist" aria-label="切换">
        <button role="tab" aria-selected={view === 'music'} className={view === 'music' ? 'is-on' : ''} onClick={() => setView('music')} aria-label="唱片">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="6.5" cy="18" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="16.5" cy="16" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" /></svg>
        </button>
        <button role="tab" aria-selected={view === 'talk'} className={view === 'talk' ? 'is-on' : ''} onClick={() => setView('talk')} aria-label="说过的话">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 6.5C5 5.1 6.1 4 7.5 4h9C17.9 4 19 5.1 19 6.5v7c0 1.4-1.1 2.5-2.5 2.5H11l-4 3.5V16h-.5C5.6 16 5 15.1 5 14z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
        </button>
      </div>

      <CompanionSheet open={pick} characters={characters} allowAlone onClose={() => setPick(false)} onPick={async (who) => { setPick(false); if (who) { await P.listenWith(who); toast(`${who.name}戴上了另一只耳机`); } else await P.listenAlone(); }} />
      <Sheet open={queue} onClose={() => setQueue(false)} title={`播放列表 · ${MODE_NAMES[m.mode]}`}>
        <div className="mu-queue">
          {m.tracks.map((x) => (
            <button type="button" key={x.id} className={'mu-queue-row' + (x.id === t.id ? ' is-now' : '')} onClick={() => { setQueue(false); P.playTrack(x.id); }} disabled={x.missing}>
              <b>{x.title}</b><small>{x.missing ? '缺少歌曲文件' : x.artist || '未知歌手'}</small>
            </button>
          ))}
        </div>
      </Sheet>
      <Sheet open={more} onClose={() => setMore(false)} title={t.title}>
        <div className="mu-menu">
          <dl className="mu-credits">
            {[['歌手', t.artist], ['专辑', t.album], ['作词', t.lyricist], ['作曲', t.composer], ['编曲', t.arranger], ['制作人', t.producer]].filter(([, v]) => v).map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
          </dl>
          <Button kind="ghost" onClick={() => { setMore(false); onEdit(t); }}>编辑歌曲信息和歌词</Button>
          <Button kind="ghost" onClick={() => { setMore(false); go('account', { section: 'music' }); }}>换播放页背景</Button>
          <Button kind="ghost" onClick={() => { setMore(false); setShowLyrics(true); setView('music'); }}>看歌词</Button>
          <Button kind="ghost" onClick={() => { setMore(false); setPick(true); }}>{c ? '换个人一起听' : '邀请 TA 一起听'}</Button>
          {c && <Button kind="ghost" onClick={() => { setMore(false); P.listenAlone(); }}>不一起听了</Button>}
        </div>
      </Sheet>
    </div>
  );
}
const Chevron = () => <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export default function Music({ me, characters, go, route }) {
  const [edit, setEdit] = useState(null);
  useEffect(() => { if (!P.music.loaded) P.loadLibrary().catch(() => {}); }, []);
  // 每秒刷新一次，让气泡到时间消失
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(i); }, []);
  const track = useMemo(() => edit && P.music.tracks.find((x) => x.id === edit.id), [edit, P.music.tracks]);
  if (route.section === 'player') {
    return (
      <>
        <Player me={me} characters={characters} onClose={() => go('music')} onEdit={setEdit} go={go} />
        <TrackSheet open={!!edit} track={track || edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); P.loadLibrary().then(() => P.refreshCover()); }} />
      </>
    );
  }
  return <Library go={go} characters={characters} onOpenPlayer={() => go('music', { section: 'player' })} />;
}
