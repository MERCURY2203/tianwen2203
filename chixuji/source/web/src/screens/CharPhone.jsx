// 房间里拿起 TA 的手机：锁屏 → 问 TA 能不能看 / 偷偷解锁 → TA 手机里的微信、日程、备忘录、相册、浏览器
// 拿起、放下的动画改的是手机自身的位置和大小（不缩放整个页面），iPhone 上不会留残影
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { get, post, useImageSrc } from '../api.js';
import { useLayerHost } from '../motion.jsx';
import { Avatar, toast } from '../ui.jsx';

const APPS = [
  { id: 'chats', name: '微信', color: '#3cb371', d: 'M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z' },
  { id: 'schedule', name: '日程', color: '#f0503c', d: 'M5 6h14v13H5z M5 10h14 M9 4v4 M15 4v4' },
  { id: 'memos', name: '备忘录', color: '#e0a32a', d: 'M6 4.5h12v15H6z M9 9h6 M9 12.5h6 M9 16h4' },
  { id: 'photos', name: '相册', color: '#8a6cc9', d: 'M4.5 6h15v12h-15z M8.5 10.5h.01 M5.5 17l5-5 3.5 3.5 2-2 3 3' },
  { id: 'searches', name: '浏览器', color: '#2f8fd8', d: 'M12 4a8 8 0 1 0 .01 0 M4 12h16 M12 4c2.5 2.5 2.5 13.5 0 16 M12 4c-2.5 2.5-2.5 13.5 0 16' },
];
const SEEN_NAME = { chats: '微信聊天', schedule: '日程', memos: '备忘录', photos: '相册', searches: '搜索记录' };
const dayLabel = (d) => {
  const t = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const k = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  if (d === k(t)) return '今天';
  if (d === k(new Date(Date.now() - 86400e3))) return '昨天';
  const [, m, dd] = d.split('-'); return `${Number(m)}月${Number(dd)}日`;
};

export function CharPhone({ from, current, me, onClose }) {
  const host = useLayerHost();
  const phoneRef = useRef(null); const dimRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('lock'); // lock | home | 应用 id | thread
  const [thread, setThread] = useState(null);
  const [day, setDay] = useState(null);
  const [asking, setAsking] = useState(false);
  const seen = useRef(new Set());
  const closing = useRef(false);
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setClock(new Date()), 20000); return () => clearInterval(t); }, []);

  // 拿起手机：今天没有就生成（要等一会儿）
  useEffect(() => {
    let alive = true;
    post(`/api/characters/${current.id}/charphone/open`).then((r) => { if (alive) { setData(r); setDay(r.view.day); } }, (e) => { if (alive) toast(e.message); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);
  async function pickDay(d) {
    setDay(d);
    try { setData(await get(`/api/characters/${current.id}/charphone?day=${d}`)); } catch (e) { toast(e.message); }
  }

  const geo = () => {
    const box = host?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const start = { x: from.left - box.left, y: from.top - box.top, w: Math.max(16, from.width), h: Math.max(10, from.height) };
    const h = Math.min(box.height - 70, 680); const w = Math.min(box.width - 36, h * 0.49);
    return { start, end: { x: (box.width - w) / 2, y: (box.height - h) / 2, w, h } };
  };
  const frame = (r, rot, rad) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, transform: `rotate(${rot}deg)`, borderRadius: `${rad}px` });
  useLayoutEffect(() => {
    const el = phoneRef.current; if (!el) return;
    const { start, end } = geo();
    Object.assign(el.style, frame(end, 0, 40));
    el.animate([frame(start, 24, 4), frame(end, 0, 40)], { duration: 440, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    dimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, fill: 'both' });
  }, []);
  function close() {
    if (closing.current) return; closing.current = true;
    const el = phoneRef.current; const { start, end } = geo();
    el.classList.add('is-closing');
    const a = el.animate([frame(end, 0, 40), frame(start, 24, 4)], { duration: 360, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' });
    dimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    const done = () => {
      onClose();
      // 偷看的话，放下以后 TA 可能会发现
      if (screen !== 'lock' || seen.current.size) post(`/api/characters/${current.id}/charphone/close`, { seen: [...seen.current].map((k) => SEEN_NAME[k]) }).catch(() => {});
    };
    a.onfinish = () => { const f = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' }); f.onfinish = done; };
  }
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.__xsjBookClose = close;
    return () => { window.removeEventListener('keydown', onKey); if (window.__xsjBookClose === close) window.__xsjBookClose = null; };
  });

  async function ask() {
    setAsking(true);
    try {
      const r = await post(`/api/characters/${current.id}/charphone/ask`);
      setData((d) => ({ ...d, ask: r.ask }));
      toast(`${current.name}：${r.reply}`);
    } catch (e) { toast(e.message); } finally { setAsking(false); }
  }
  function openApp(id) { seen.current.add(id); setScreen(id); }

  const v = data?.view;
  const allowed = data?.ask?.allow;
  const refused = data?.ask && !data.ask.allow;
  const meName = me?.name && me.name !== '我' ? me.name : '你';
  const hhmm = `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`;
  // 壁纸：TA 有时会用你发给 TA 的图片
  const wallSrc = useImageSrc(v?.wallpaperImageId || null);
  const wall = wallSrc
    ? { background: `linear-gradient(180deg, rgba(0,0,0,.28), rgba(0,0,0,.08) 40%, rgba(0,0,0,.38)), center / cover no-repeat url(${wallSrc})` }
    : { background: `linear-gradient(160deg, ${current.avatarColor || '#9db4e8'} 0%, #2a2740 75%)` };

  let body;
  if (screen === 'lock') {
    const notes = (v?.chats || []).map((c) => ({ who: c.with, m: [...c.messages].reverse().find((x) => x.from === 'them') })).filter((x) => x.m).slice(0, 3);
    body = (
      <div className="cp-lock" style={wall}>
        <div className="cp-lock-time">{hhmm}</div>
        <div className="cp-lock-date">{clock.getMonth() + 1}月{clock.getDate()}日 星期{'日一二三四五六'[clock.getDay()]}</div>
        <div className="cp-notes">
          {loading && <div className="cp-note is-loading">手机开机中…</div>}
          {notes.map((n, i) => <div className="cp-note" key={i}><b>{n.who}</b><span>{n.m.text}</span></div>)}
        </div>
        <div className="cp-lock-actions">
          {allowed ? (
            <button type="button" className="cp-btn is-main" disabled={loading} onClick={() => setScreen('home')}>{current.name}同意了，打开看看</button>
          ) : (
            <>
              <button type="button" className="cp-btn is-main" disabled={loading || asking} onClick={ask}>{asking ? '等 TA 回复…' : `问${current.name}能不能看`}</button>
              <button type="button" className="cp-btn" disabled={loading} onClick={() => setScreen('home')}>{refused ? 'TA 不让看……偷偷解锁' : '偷偷解锁'}</button>
            </>
          )}
        </div>
      </div>
    );
  } else if (screen === 'home') {
    body = (
      <div className="cp-home" style={wall}>
        <div className="cp-apps">
          {APPS.map((a) => (
            <button key={a.id} type="button" onClick={() => openApp(a.id)}>
              <span className="cp-app-ico" style={{ background: a.color }}><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d={a.d} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              <span>{a.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  } else {
    const title = screen === 'thread' ? thread?.with : APPS.find((a) => a.id === screen)?.name;
    let inner = null;
    if (screen === 'chats') {
      const rows = [{ key: 'user', with: meName, user: true, last: v.userChat.at(-1) }, ...v.chats.map((c, i) => ({ key: i, with: c.with, relation: c.relation, c, last: c.messages.at(-1) }))];
      inner = (
        <ul className="cp-list">
          {rows.map((r) => (
            <li key={r.key}><button type="button" onClick={() => { setThread(r.user ? { with: meName, user: true, messages: v.userChat, drafts: v.drafts } : r.c); setScreen('thread'); }}>
              {r.user ? <Avatar name={meName} color="#8a8496" url={me?.avatarUrl} size={40} /> : <span className="cp-ava">{r.with.slice(0, 1)}</span>}
              <span className="cp-row-main"><span className="cp-row-top"><b>{r.with}{r.user ? '（置顶）' : ''}</b><time>{r.last?.time || ''}</time></span>
                <span className="cp-row-sub">{r.user && v.drafts.length ? <><em>[草稿]</em> {v.drafts.at(-1).text}</> : (r.last?.text || '没有消息')}</span></span>
            </button></li>
          ))}
        </ul>
      );
    } else if (screen === 'thread') {
      inner = (
        <div className="cp-thread">
          {!thread.messages.length && <p className="cp-empty">这一天没有消息</p>}
          {thread.messages.map((m, i) => (
            <div key={i} className={'cp-msg ' + (m.from === 'me' ? 'is-me' : 'is-them')}>
              <span className="cp-bubble">{m.text}</span>{m.time && <time>{m.time}</time>}
            </div>
          ))}
          {thread.user && thread.drafts?.length > 0 && (
            <div className="cp-draft"><em>输入框里没发出去的话</em>{thread.drafts.map((d, i) => <p key={i}>{d.text}</p>)}</div>
          )}
        </div>
      );
    } else if (screen === 'schedule') {
      inner = v.schedule.length ? <ul className="cp-sched">{v.schedule.map((x, i) => <li key={i}><time>{x.time || '全天'}</time><span><b>{x.title}</b>{x.note && <small>{x.note}</small>}</span></li>)}</ul> : <p className="cp-empty">这一天没有日程</p>;
    } else if (screen === 'memos') {
      inner = v.memos.length ? <ul className="cp-memos">{v.memos.map((x, i) => <li key={i}><b>{x.title || '无标题'}</b><p>{x.text}</p></li>)}</ul> : <p className="cp-empty">没有备忘录</p>;
    } else if (screen === 'photos') {
      inner = v.photos.length ? <ul className="cp-photos">{v.photos.map((x, i) => <li key={i} style={{ background: `linear-gradient(${140 + i * 37}deg, hsl(${(i * 67 + 20) % 360} 45% 72%), hsl(${(i * 67 + 80) % 360} 40% 52%))` }}><p>{x.desc}</p><small>{[x.time, x.place].filter(Boolean).join(' · ')}</small></li>)}</ul> : <p className="cp-empty">相册是空的</p>;
    } else if (screen === 'searches') {
      inner = v.searches.length ? <ul className="cp-search">{v.searches.map((x, i) => <li key={i}><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M10.5 5a5.5 5.5 0 1 0 .01 0 M15 15l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg><span>{x.q}</span><time>{x.time}</time></li>)}</ul> : <p className="cp-empty">没有搜索记录</p>;
    }
    body = (
      <div className="cp-app">
        <header className="cp-bar">
          <button type="button" onClick={() => setScreen(screen === 'thread' ? 'chats' : 'home')} aria-label="返回">‹</button>
          <b>{title}</b><span />
        </header>
        {screen !== 'thread' && (data?.days || []).length > 1 && (
          <div className="cp-days">
            {data.days.map((d) => <button key={d} type="button" className={d === day ? 'is-on' : ''} onClick={() => pickDay(d)}>{dayLabel(d)}</button>)}
          </div>
        )}
        <div className="cp-scroll">{inner}</div>
      </div>
    );
  }

  const node = (
    <div className="cp-wrap" role="dialog" aria-modal="true" aria-label={`${current.name}的手机`}>
      <div className="cp-dim" ref={dimRef} onClick={close} />
      <div className="cp-phone" ref={phoneRef}>
        <div className="cp-screen">
          <div className="cp-status"><span>{hhmm}</span><span className="cp-island" /><svg viewBox="0 0 22 12" width="22" height="12" aria-hidden="true"><path d="M1 11h3V8H1z M6 11h3V6H6z M11 11h3V3.5h-3z M16 11h3V1h-3z" fill="currentColor" /></svg></div>
          {body}
        </div>
      </div>
      <button type="button" className="cp-put" onClick={close}>放下手机</button>
    </div>
  );
  return createPortal(node, host || document.querySelector('.phone') || document.body);
}
