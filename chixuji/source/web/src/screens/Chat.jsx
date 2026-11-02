import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cropImage, screenAspect } from '../crop.jsx';
import { get, post, useImageSrc, IS_LOCAL } from '../api.js';
import { compressImage } from '../image.js';
import { Avatar, Button, ErrorBox, fmtTime, Loading, PickButton, Sheet, Thread, toast, TopBar } from '../ui.jsx';
import { Cover } from './Music.jsx';
import { listenWith, loadLibrary, music, playTrack, useMusic } from '../music/player.js';

const CORRECTIONS = [
  { type: 'ooc', label: '崩人设', hint: '说话方式或做法不像 TA' },
  { type: 'wrong_fact', label: '记错了事实', hint: '把发生过的事说错了' },
  { type: 'overknow', label: '知道了不该知道的事', hint: '提到了 TA 不可能知道的内容' },
  { type: 'other', label: '其他问题', hint: '' },
];
const CORRECTION_LABEL = Object.fromEntries(CORRECTIONS.map((c) => [c.type, c.label]));

function MsgImage({ id, local, alt }) {
  const src = useImageSrc(id, local);
  return src ? <img className="msg-img" src={src} alt={alt || '图片'} loading="lazy" /> : <div className="msg-img msg-img-loading" />;
}

// 给 TA 看手机：位置 / 和同一个世界里其他人物的聊天
function PhoneSheet({ state, phone, current, busy, onClose, onLocation, onChats }) {
  const [what, setWhat] = useState(null);
  const [picked, setPicked] = useState([]);
  useEffect(() => { setWhat(state?.what || null); setPicked([]); }, [state]);
  const others = phone?.others || [];
  return (
    <Sheet open={!!state} onClose={onClose} title={`给${current.name}看看我的手机`}>
      {!what && (
        <div className="menu">
          <button onClick={onLocation} disabled={busy}><b>📍 告诉 TA 我在哪</b><span>{phone?.level === 'city' ? '只告诉 TA 在哪个城市' : '精确到区 / 街道附近，不会给门牌和坐标'}</span></button>
          <button onClick={() => setWhat('chats')} disabled={!others.length}><b>💬 给 TA 看我和别人的聊天</b><span>{others.length ? '只能看同一个世界里的人物，你来选给看哪几个' : '同一个世界里还没有别的人物'}</span></button>
        </div>
      )}
      {what === 'chats' && (
        <>
          <p className="muted small">勾选给{current.name}看哪几个人的聊天（每人最近约 30 条，只看不改；对方不会知道）。</p>
          <div className="pick-list">
            {others.map((o) => (
              <label className="check" key={o.id}>
                <input type="checkbox" checked={picked.includes(o.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))} />
                <span>{o.name}</span>
              </label>
            ))}
          </div>
          <Button busy={busy} disabled={!picked.length} onClick={() => onChats(picked)}>给 TA 看</Button>
        </>
      )}
      <p className="muted small">每次都需要你同意。看完会留下一条「查手机记录」，{current.name}也可能把看到的事记在心里。</p>
    </Sheet>
  );
}

// TA 的心声：点开才显示
function Thought({ name, text }) {
  const [open, setOpen] = useState(false);
  return open
    ? <button type="button" className="thought is-open" onClick={() => setOpen(false)}><span className="thought-label">{name}心里想：</span>{text}</button>
    : <button type="button" className="thought" onClick={() => setOpen(true)}>💭 {name}当时在想…</button>;
}

// 聊天背景：选图、变暗、模糊（跟着人物走）
function ChatBgSheet({ open, current, bg, onClose, onChange }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const save = (patch) => {
    const next = { ...(bg || { dim: 25, blur: 0 }), ...patch };
    onChange(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => post(`/api/characters/${current.id}/chatbg`, { dim: next.dim, blur: next.blur }).catch((e) => toast(e.message)), 300);
  };
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const dataUrl = await cropImage(f, { aspect: screenAspect(), size: 1080, title: '裁剪聊天背景' });
      if (!dataUrl) return;
      await post(`/api/characters/${current.id}/chatbg`, { dataUrl });
      onChange({ ...(bg || { dim: 25, blur: 0 }), image: dataUrl });
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  async function reset() {
    try { await post(`/api/characters/${current.id}/chatbg`, { dataUrl: null }); onChange({ image: null, dim: 25, blur: 0 }); toast('已恢复默认背景'); } catch (e) { toast(e.message); }
  }
  return (
    <Sheet open={open} onClose={onClose} title={`和${current.name}的聊天背景`}>
      <div className="bg-preview">
        {bg?.image && <div className="chat-bg-img" style={{ backgroundImage: `url(${bg.image})`, filter: bg.blur ? `blur(${bg.blur / 2}px)` : undefined }} />}
        {bg?.image && <div className="chat-bg-dim" style={{ opacity: bg.dim / 100 }} />}
        <span className="bubble bubble-demo-them">今天也想见你。</span>
        <span className="bubble bubble-demo-me">我也是。</span>
      </div>
      <PickButton busy={busy} onClick={() => fileRef.current?.click()}>{bg?.image ? '换一张图片' : '从相册选一张图片'}</PickButton>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      {bg?.image && (
        <>
          <label className="field"><span>变暗程度 {bg.dim}%</span><input type="range" min="0" max="85" value={bg.dim} onChange={(e) => save({ dim: Number(e.target.value) })} /></label>
          <label className="field"><span>模糊程度 {bg.blur}</span><input type="range" min="0" max="20" value={bg.blur} onChange={(e) => save({ blur: Number(e.target.value) })} /></label>
          <button type="button" className="text-btn" onClick={reset}>恢复默认背景</button>
        </>
      )}
      <p className="muted small">背景跟着人物走，和别的人物聊天不受影响。图片只存在这台设备上。</p>
    </Sheet>
  );
}

// 聊天中间的时间（像微信）：今天只写几点，昨天写“昨天”，一周内写星期几，再早写日期
// 一起听歌的邀请卡片
function MusicCard({ data, current, onListen }) {
  const m = useMusic();
  const t = m.tracks.find((x) => x.id === data.trackId);
  return (
    <div className="music-card">
      <Cover track={t || null} size={46} />
      <span className="music-card-text"><small>一起听歌吗？</small><b>{data.title}</b><em>{data.artist || '未知歌手'}</em></span>
      <button type="button" className="music-card-go" onClick={() => onListen(data.trackId)} disabled={!t || t.missing} aria-label={`和${current.name}一起听《${data.title}》`}>{!t ? '歌已删除' : t.missing ? '缺文件' : '一起听'}</button>
    </div>
  );
}

// 选一首歌发邀请
function MusicPickSheet({ open, onClose, onPick, go }) {
  const m = useMusic();
  useEffect(() => { if (open) loadLibrary().catch(() => {}); }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="邀请 TA 一起听">
      <div className="music-pick">
        {!m.tracks.length && <p className="mu-none">音乐里还没有歌。<button type="button" className="text-btn" onClick={() => { onClose(); go('music'); }}>去导入</button></p>}
        {m.tracks.filter((t) => !t.missing).map((t) => (
          <button type="button" key={t.id} className="music-pick-row" onClick={() => onPick(t)}>
            <Cover track={t} size={42} />
            <span className="mu-row-text"><b>{t.title}</b><small>{t.artist || '未知歌手'}</small></span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function chatTime(iso) {
  const d = new Date(iso); const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.toDateString() === new Date(Date.now() - 86400e3).toDateString()) return `昨天 ${hm}`;
  if (now - d < 6 * 86400e3) return `星期${'日一二三四五六'[d.getDay()]} ${hm}`;
  return `${d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + '年'}${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

export default function Chat({ me, current, refreshCharacters, go, home, runTick, refreshUnread }) {
  const branchId = current.viewBranch.id;
  const [events, setEvents] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [needsReply, setNeedsReply] = useState(false);
  const [branch, setBranch] = useState(null);
  const [names, setNames] = useState({});
  const [error, setError] = useState(null);
  const [text, setText] = useState('');
  const [image, setImage] = useState(null); // { dataUrl, width, height }
  const [sending, setSending] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const [fork, setFork] = useState(null); // { event, mode, name }
  // 长按（手机）或右键（电脑）气泡，打开这条消息的菜单：分出新世界线、纠错、复制
  const pressTimer = useRef(null);
  const pressProps = (e) => ({
    onContextMenu: (ev) => { ev.preventDefault(); setMenuFor(e); },
    onTouchStart: () => { clearTimeout(pressTimer.current); pressTimer.current = setTimeout(() => { setMenuFor(e); navigator.vibrate?.(10); }, 450); },
    onTouchEnd: () => clearTimeout(pressTimer.current),
    onTouchMove: () => clearTimeout(pressTimer.current),
  });
  const [tip, setTip] = useState(() => { try { return !localStorage.getItem('xsj:tip-fork'); } catch { return false; } });
  const closeTip = () => { setTip(false); try { localStorage.setItem('xsj:tip-fork', '1'); } catch { /* 无痕 */ } };
  const [fixing, setFixing] = useState(null); // { event, type, note }
  // TA 查手机（纯前端版）
  const [phone, setPhone] = useState(null); // { enabled, level, others, openRequest }
  const [phoneSheet, setPhoneSheet] = useState(null); // { what, requestSeq }
  const [musicPick, setMusicPick] = useState(false);
  const loadPhone = () => (IS_LOCAL ? get(`/api/characters/${current.id}/phone`).then(setPhone, () => {}) : null);
  useEffect(() => { loadPhone(); }, [current.id, branchId]);
  async function answerPhone(body) {
    setBusy(true);
    try {
      await post(`/api/branches/${branchId}/phone`, body);
      setPhoneSheet(null);
      await load(); loadPhone(); refreshCharacters?.();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  function shareLocation(requestSeq = null) {
    if (!navigator.geolocation) { toast('这个设备拿不到位置'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => answerPhone({ what: 'location', approve: true, requestSeq, lat: p.coords.latitude, lon: p.coords.longitude }),
      () => { setBusy(false); toast('没能拿到位置（可能被拒绝了）'); },
      { timeout: 15000, maximumAge: 60e3 },
    );
  }
  // 聊天背景（纯前端版）
  const [bg, setBg] = useState(null);
  const [bgOpen, setBgOpen] = useState(false);
  useEffect(() => { if (IS_LOCAL) get(`/api/characters/${current.id}/chatbg`).then(setBg, () => {}); }, [current.id]);
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const keepScroll = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  async function load() {
    setError(null);
    try {
      const [ev, br] = await Promise.all([
        get(`/api/branches/${branchId}/events?limit=50`),
        get(`/api/characters/${current.id}/branches`),
      ]);
      setEvents(ev.events);
      setHasMore(ev.hasMore);
      setNeedsReply(ev.needsReply);
      setBranch(ev.branch);
      setNames(Object.fromEntries(br.branches.map((b) => [b.id, b.name])));
    } catch (e) { setError(e); }
  }
  useEffect(() => { setEvents(null); load(); }, [branchId]);
  // 纯前端版：标记已读；离开聊天时让 TA 写日记（如果打开了）；有新私聊时刷新
  useEffect(() => {
    if (!IS_LOCAL) return undefined;
    const markRead = () => post(`/api/characters/${current.id}/read`, { area: 'chat' }).then(() => refreshUnread?.(), () => {});
    markRead();
    const onNew = () => { load(); markRead(); };
    window.addEventListener('xsj:new-events', onNew);
    return () => { window.removeEventListener('xsj:new-events', onNew); markRead(); runTick?.({ leftChatCharacterId: current.id }); };
  }, [branchId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !events) return;
    if (keepScroll.current !== null) {
      el.scrollTop = el.scrollHeight - keepScroll.current;
      keepScroll.current = null;
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [events, sending, needsReply]);

  async function loadMore() {
    try {
      const r = await get(`/api/branches/${branchId}/events?limit=50&before=${events[0].seq}`);
      keepScroll.current = listRef.current.scrollHeight - listRef.current.scrollTop;
      setEvents([...r.events, ...events]);
      setHasMore(r.hasMore);
    } catch (e) { toast(e.message); }
  }

  // 收到新的一批事件：同一编号的替换，新的接在后面
  function merge(newEvents, removeSeq = null) {
    setEvents((list) => {
      const seen = new Set(newEvents.map((e) => e.seq));
      // 去掉“发送中”的临时消息，换成服务器确认后的
      return [...list.filter((e) => e.seq > 0 && !seen.has(e.seq) && e.seq !== removeSeq), ...newEvents].sort((a, b) => a.seq - b.seq);
    });
  }

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { setImage(await compressImage(file)); } catch (err) { toast(err.message); }
  }

  async function send() {
    const t = text.trim();
    if ((!t && !image) || sending) return;
    setSending(true);
    const pic = image;
    setText('');
    setImage(null);
    // 先把自己的消息显示出来，不等角色回复
    const tempSeq = -Date.now();
    setEvents((list) => [...list, {
      seq: tempSeq, kind: 'user_message', branchId, pending: true, createdAt: new Date().toISOString(),
      data: { text: t, localImage: pic?.dataUrl },
    }]);
    try {
      let imageId;
      if (pic) imageId = (await post('/api/images', { characterId: current.id, ...pic })).image.id;
      const r = await post(`/api/branches/${branchId}/messages`, { text: t, imageId });
      merge(r.events);
      setNeedsReply(false);
    } catch (e) {
      toast(e.message);
      if (e.body?.userSeq) await load(); // 消息已保存，回复失败：刷新后显示“让 TA 回复”
      else {
        setEvents((list) => list.filter((x) => x.seq !== tempSeq));
        setText(t);
        setImage(pic);
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  // 发出一起听歌的邀请（输入框里有字就一起发）
  async function sendInvite(t) {
    setMusicPick(false);
    if (sending) return;
    const words = text.trim();
    setSending(true);
    setText('');
    const tempSeq = -Date.now();
    setEvents((list) => [...list, { seq: tempSeq, kind: 'user_message', branchId, pending: true, createdAt: new Date().toISOString(), data: { text: words, music: { trackId: t.id, title: t.title, artist: t.artist } } }]);
    try {
      const r = await post(`/api/branches/${branchId}/messages`, { text: words, musicTrackId: t.id });
      merge(r.events);
      setNeedsReply(false);
    } catch (e) {
      toast(e.message);
      if (e.body?.userSeq) await load(); else { setEvents((list) => list.filter((x) => x.seq !== tempSeq)); setText(words); }
    } finally { setSending(false); }
  }
  async function listenTogether(trackId) {
    if (!music.loaded) await loadLibrary().catch(() => {});
    await listenWith(current);
    await playTrack(trackId);
    go('music', { section: 'player' });
  }

  async function retry() {
    setMenuFor(null);
    setSending(true);
    try {
      const r = await post(`/api/branches/${branchId}/retry`);
      merge(r.events, r.replaced);
      setNeedsReply(false);
    } catch (e) {
      toast(e.message);
      await load();
    } finally { setSending(false); }
  }

  async function doFork() {
    setBusy(true);
    try {
      const r = await post(`/api/branches/${branchId}/fork`, { seq: fork.event.seq, mode: fork.mode, name: fork.name });
      setFork(null);
      if (r.prefill) setText(r.prefill);
      await refreshCharacters();
      toast(`已进入新世界线「${r.branch.name}」`);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  async function doFix() {
    setBusy(true);
    try {
      const r = await post(`/api/branches/${branchId}/corrections`, { seq: fixing.event.seq, type: fixing.type, note: fixing.note });
      setFixing(null);
      merge([r.event]);
      toast(r.removedMemories ? `已记下，并移除了 ${r.removedMemories} 条相关记忆` : '已记下，之后会避免');
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  const archived = branch?.archived;
  const messages = (events || []).filter((e) => e.kind === 'user_message' || e.kind === 'char_message');
  const lastMsg = messages[messages.length - 1];
  const canRegenerate = (e) => e && lastMsg && e.seq === lastMsg.seq && e.kind === 'char_message' && e.branchId === branchId && !archived;

  const rows = [];
  let lastMsgAt = 0; // 像微信：隔了 5 分钟以上才在中间显示一次时间
  (events || []).forEach((e, i) => {
    const prev = events[i - 1];
    if (prev && prev.branchId !== e.branchId && (e.kind === 'user_message' || e.kind === 'char_message')) {
      rows.push(<div className="fork-divider" key={'d' + e.seq}><span>从这里起是「{names[e.branchId] || '新世界线'}」</span></div>);
    }
    if (e.kind === 'settings_change') {
      if (e.data.version > 1) rows.push(<div className="sys-note" key={e.seq}>人设更新到第 {e.data.version} 版{e.data.note ? `：${e.data.note}` : ''}</div>);
      return;
    }
    if (e.kind === 'correction') {
      // 被纠正的回复已经重新生成（不再显示）时，这条提示也不显示
      if (!events.some((x) => x.seq === e.data.targetSeq)) return;
      rows.push(<div className="sys-note" key={e.seq}>你指出上面一条回复：{CORRECTION_LABEL[e.data.type]}{e.data.note ? `（${e.data.note}）` : ''}</div>);
      return;
    }
    if (e.kind === 'phone_request') {
      const answered = events.some((x) => x.kind === 'phone_check' && x.data.requestSeq === e.seq);
      if (!answered && !archived) {
        rows.push(
          <div className="phone-card is-ask" key={e.seq}>
            <span>📱 {current.name}想看你的{e.data.what === 'location' ? '位置' : '手机聊天'}</span>
            <div className="phone-card-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => (e.data.what === 'location' ? shareLocation(e.seq) : setPhoneSheet({ what: 'chats', requestSeq: e.seq }))}>给 TA 看</button>
              <button className="btn btn-ghost" disabled={busy} onClick={() => answerPhone({ what: e.data.what, approve: false, requestSeq: e.seq })}>不给</button>
            </div>
          </div>,
        );
      }
      return;
    }
    if (e.kind === 'phone_check') {
      rows.push(
        <div className={'phone-card' + (e.data.approved ? '' : ' is-refused')} key={e.seq}>
          {!e.data.approved
            ? <span>你没有给{current.name}看{e.data.what === 'location' ? '位置' : '手机'}</span>
            : (
              <>
                <b>📱 {current.name}{e.data.what === 'location' ? `查看了你的位置：${e.data.place} · ${e.data.time}` : `翻了你和${(e.data.chats || []).map((c) => c.name).join('、')}的聊天`}</b>
                {e.data.log && <p>{e.data.log}</p>}
              </>
            )}
        </div>,
      );
      return;
    }
    if (e.kind !== 'user_message' && e.kind !== 'char_message') return;
    const mine = e.kind === 'user_message';
    const tms = e.pending ? Date.now() : Date.parse(e.createdAt);
    if (!lastMsgAt || tms - lastMsgAt >= 5 * 60e3) rows.push(<div className="msg-time" key={'t' + e.seq}>{chatTime(e.pending ? new Date().toISOString() : e.createdAt)}</div>);
    lastMsgAt = tms;
    if (e.data.via === 'moment') rows.push(<div className="sys-note" key={'v' + e.seq}>{current.name}看了你的朋友圈</div>);
    if (e.data.via === 'photo') rows.push(<div className="sys-note" key={'v' + e.seq}>{current.name}看了你挂的照片</div>);
    rows.push(
      <div className={'msg ' + (mine ? 'msg-me' : 'msg-them') + (e.pending ? ' is-pending' : '')} key={e.seq}>
        {!mine && <Avatar name={current.name} color={current.avatarColor} url={current.avatarUrl} size={40} />}
        <div className="msg-body" {...(e.pending ? {} : pressProps(e))} aria-label={e.pending ? '发送中' : `${fmtTime(e.createdAt)}，长按可以分出新世界线或纠错`}>
          {(e.data.imageId || e.data.localImage) && <MsgImage id={e.data.imageId} local={e.data.localImage} alt={e.data.imageDesc} />}
          {e.data.music && <MusicCard data={e.data.music} current={current} onListen={listenTogether} />}
          {e.data.text && <div className="bubble">{e.data.text}</div>}
          {!mine && e.data.thought && <Thought name={current.name} text={e.data.thought} />}
        </div>
        {mine && (IS_LOCAL ? (
          <button type="button" className="msg-me-avatar" onClick={() => go('account', { section: 'me' })} aria-label="换我的头像">
            <Avatar name={me?.name || '我'} color="#8a8496" url={me?.avatarUrl} size={40} />
          </button>
        ) : <Avatar name={me?.email || '我'} color="#8a8496" size={40} />)}
      </div>,
    );
  });

  return (
    <div className={'page chat' + (bg?.image ? ' has-bg' : '')}>
      {bg?.image && (
        <div className="chat-bg" aria-hidden="true">
          <div className="chat-bg-img" style={{ backgroundImage: `url(${bg.image})`, filter: bg.blur ? `blur(${bg.blur}px)` : undefined }} />
          <div className="chat-bg-dim" style={{ opacity: bg.dim / 100 }} />
        </div>
      )}
      <TopBar title={current.name} onBack={IS_LOCAL ? () => go('chat') : home}
        sub={<Thread name={current.viewBranch.name} archived={archived} onClick={() => go('worldlines')} />}
        right={IS_LOCAL ? <button className="icon-btn" onClick={() => setBgOpen(true)} aria-label="聊天背景">
          <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="10" r="1.8" fill="currentColor" /><path d="M4.5 17l5-5 4 4 2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
        </button> : undefined} />
      {IS_LOCAL && <PhoneSheet state={phoneSheet} phone={phone} current={current} busy={busy} onClose={() => setPhoneSheet(null)}
        onLocation={() => shareLocation(phoneSheet?.requestSeq || null)}
        onChats={(ids) => answerPhone({ what: 'chats', approve: true, requestSeq: phoneSheet?.requestSeq || null, chatIds: ids })} />}
      {IS_LOCAL && <MusicPickSheet open={musicPick} onClose={() => setMusicPick(false)} onPick={sendInvite} go={go} />}
      {IS_LOCAL && <ChatBgSheet open={bgOpen} current={current} bg={bg} onClose={() => setBgOpen(false)} onChange={setBg} />}

      <div className="chat-list" ref={listRef}>
        {error && <ErrorBox error={error} onRetry={load} />}
        {!events && !error && <Loading />}
        {hasMore && <button className="btn btn-ghost load-more" onClick={loadMore}>加载更早的消息</button>}
        {events && messages.length === 0 && (
          <p className="chat-empty">这条世界线还没有对话。说点什么，故事就从这里开始。</p>
        )}
        {rows}
        {sending && (
          <div className="msg msg-them">
            <Avatar name={current.name} color={current.avatarColor} url={current.avatarUrl} size={40} />
            <div className="msg-body"><div className="bubble typing" aria-label="对方正在输入"><i /><i /><i /></div></div>
          </div>
        )}
        {needsReply && !sending && !archived && (
          <div className="reply-missing">
            <span>{current.name}还没有回复这条消息</span>
            <button className="btn btn-ghost" onClick={retry}>让 TA 回复</button>
          </div>
        )}
      </div>

      {archived ? (
        <div className="composer composer-off">这条世界线已归档，在「世界线」里恢复后才能继续聊天。</div>
      ) : (
        <>
          {tip && events?.filter((x) => x.kind === 'char_message').length >= 2 && (
            <div className="chat-tip">
              <span>小技巧：<b>长按</b>任意一条消息（电脑上点右键），可以<b>从这里分出新世界线</b>，或者纠正 TA 说错的话。</span>
              <button onClick={closeTip} aria-label="知道了">知道了</button>
            </div>
          )}
          {image && (
            <div className="attach-preview">
              <img src={image.dataUrl} alt="待发送的图片" />
              <button onClick={() => setImage(null)} aria-label="不发这张图片">×</button>
            </div>
          )}
          <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
            <button type="button" className="attach" onClick={() => fileRef.current?.click()} aria-label="发图片" disabled={sending}>
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="10" r="1.8" fill="currentColor" /><path d="M5 17l5-5 4 4 2-2 3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            </button>
            {IS_LOCAL && (
              <button type="button" className="attach" onClick={() => setMusicPick(true)} aria-label="邀请 TA 一起听歌" disabled={sending}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 14v-2a7 7 0 0 1 14 0v2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><rect x="3.5" y="13" width="4" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" /><rect x="16.5" y="13" width="4" height="7" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
              </button>
            )}
            {IS_LOCAL && phone?.enabled && (
              <button type="button" className="attach" onClick={() => setPhoneSheet({ what: null })} aria-label="给 TA 看看我的手机" disabled={sending || busy}>
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M10.5 18.5h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            )}
            <textarea ref={inputRef} rows={1} value={text} placeholder={image ? '说点什么（可不填）' : '发消息…'} maxLength={4000}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
            <button className="send" type="submit" disabled={(!text.trim() && !image) || sending} aria-label="发送">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z" fill="currentColor" /></svg>
            </button>
          </form>
        </>
      )}

      <Sheet open={!!menuFor} onClose={() => setMenuFor(null)} title="这条消息">
        <div className="menu">
          {canRegenerate(menuFor) && (
            <button onClick={retry}><b>重新生成</b><span>换一条回复，这条会被替换</span></button>
          )}
          {menuFor?.kind === 'char_message' && (
            <button onClick={() => { setFixing({ event: menuFor, type: 'ooc', note: '' }); setMenuFor(null); }}>
              <b>这条不对，纠正一下</b><span>崩人设、记错事实、知道了不该知道的事</span>
            </button>
          )}
          <button onClick={() => { setFork({ event: menuFor, mode: 'include', name: '' }); setMenuFor(null); }}>
            <b>从这里分出新世界线</b>
            <span>新世界线保留到这条消息为止的经历，之后的发展互不影响</span>
          </button>
          {menuFor?.kind === 'user_message' && (
            <button onClick={() => { setFork({ event: menuFor, mode: 'before', name: '' }); setMenuFor(null); }}>
              <b>改写这条，分出新世界线</b>
              <span>原来的剧情保留不变，新世界线从这条之前开始，你可以重新说</span>
            </button>
          )}
          {menuFor?.data.text && (
            <button onClick={() => { navigator.clipboard?.writeText(menuFor.data.text).then(() => toast('已复制')); setMenuFor(null); }}>
              <b>复制文字</b>
            </button>
          )}
        </div>
      </Sheet>

      <Sheet open={!!fork} onClose={() => setFork(null)} title={fork?.mode === 'before' ? '改写并分出新世界线' : '分出新世界线'}>
        <form onSubmit={(e) => { e.preventDefault(); doFork(); }}>
          <blockquote className="quote">{fork?.event.data.text || '（图片）'}</blockquote>
          <label className="field">
            <span>给新世界线起个名字</span>
            <input value={fork?.name || ''} maxLength={30} required placeholder="例如：婉拒邀请"
              onChange={(e) => setFork({ ...fork, name: e.target.value })} />
          </label>
          <p className="muted small">创建后会切换到新世界线。原来的世界线不会改变，随时可以切回去。</p>
          <Button busy={busy} type="submit" disabled={!fork?.name?.trim()}>创建并进入</Button>
        </form>
      </Sheet>

      <Sheet open={!!fixing} onClose={() => setFixing(null)} title="纠正这条回复">
        <form onSubmit={(e) => { e.preventDefault(); doFix(); }}>
          <blockquote className="quote">{fixing?.event.data.text}</blockquote>
          <fieldset className="choices">
            <legend className="muted small">哪里不对</legend>
            {CORRECTIONS.map((c) => (
              <label key={c.type} className={'choice' + (fixing?.type === c.type ? ' is-on' : '')}>
                <input type="radio" name="fix" checked={fixing?.type === c.type} onChange={() => setFixing({ ...fixing, type: c.type })} />
                <span><b>{c.label}</b>{c.hint && <small>{c.hint}</small>}</span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>补充说明（可不填）</span>
            <input value={fixing?.note || ''} maxLength={200} placeholder="例如：他不会主动说想你"
              onChange={(e) => setFixing({ ...fixing, note: e.target.value })} />
          </label>
          <p className="muted small">之后的回复不会再参考这条内容，从它整理出的记忆也会移除。想要一条新的回复，可以再点“重新生成”。</p>
          <Button busy={busy} type="submit">提交纠正</Button>
        </form>
      </Sheet>
    </div>
  );
}
