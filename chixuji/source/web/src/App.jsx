import React, { useEffect, useRef, useState } from 'react';
import { get, post, IS_LOCAL, ensureLicense } from './api.js';
import { Loading, ToastHost, toast } from './ui.jsx';
import { ScreenStack } from './motion.jsx';
import { CropHost } from './crop.jsx';
import Login from './screens/Login.jsx';
import Home from './screens/Home.jsx';
import Chat from './screens/Chat.jsx';
import ChatList from './screens/ChatList.jsx';
import Worldlines from './screens/Worldlines.jsx';
import Settings from './screens/Settings.jsx';
import Characters from './screens/Characters.jsx';
import Account from './screens/Account.jsx';
import Admin from './screens/Admin.jsx';
import Memories from './screens/Memories.jsx';
import Welcome from './screens/Welcome.jsx';
import LocalSettings from './screens/LocalSettings.jsx';
import Moments from './screens/Moments.jsx';
import Diary from './screens/Diary.jsx';
import Activate from './screens/Activate.jsx';
import Room from './screens/Room.jsx';
import Doll from './screens/Doll.jsx';
import Music from './screens/Music.jsx';
import { loadLibrary } from './music/player.js';
import { appHidden, describe, ding, inDnd, lastNotified, setLastNotified, summarize, systemNotify } from './notify.js';
import { closeTopSheet } from './ui.jsx';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 无痕模式等 */ } },
};

export default function App() {
  const [lic, setLic] = useState(undefined); // 纯前端版：卡密是否有效
  const [me, setMe] = useState(undefined); // undefined=检查中，null=未登录
  const [characters, setCharacters] = useState(null);
  const [currentId, setCurrentId] = useState(null);
  const [route, setRoute] = useState({ name: 'home' });
  const swipe = useRef({ y: 0, dy: 0, moved: false }); // 消息横幅：往上滑就收起

  // 纯前端版：数据保存失败时提醒（多半是手机存储空间不够）
  useEffect(() => {
    const onErr = (e) => toast(e.detail);
    window.addEventListener('xsj:save-error', onErr);
    return () => window.removeEventListener('xsj:save-error', onErr);
  }, []);
  useEffect(() => {
    ensureLicense().then(setLic).catch((e) => setLic({ ok: false, message: e.message }));
  }, []);
  // 音乐：播放出错、TA 没跟上之类的提示
  useEffect(() => {
    const onErr = (e) => toast(e.detail);
    window.addEventListener('xsj:music-error', onErr);
    return () => window.removeEventListener('xsj:music-error', onErr);
  }, []);
  useEffect(() => {
    if (!lic?.ok) return;
    get('/api/me').then((r) => setMe(r.user)).catch(() => setMe(null));
  }, [lic?.ok]);

  // 每个软件自己的背景
  const [appBgs, setAppBgs] = useState({});
  const loadAppBgs = () => { if (IS_LOCAL) get('/api/local/app-bg').then((r) => setAppBgs(r.bgs || {}), () => {}); };
  useEffect(() => {
    if (!me) return undefined;
    loadAppBgs();
    window.addEventListener('xsj:appbg', loadAppBgs);
    return () => window.removeEventListener('xsj:appbg', loadAppBgs);
  }, [me?.id]);

  async function refreshMe() {
    try { const r = await get('/api/me'); setMe(r.user); } catch { /* 忽略 */ }
  }

  async function refreshCharacters() {
    const r = await get('/api/characters');
    setCharacters(r.characters);
    return r.characters;
  }

  useEffect(() => {
    if (!me) return;
    if (IS_LOCAL) loadLibrary().catch(() => {}); // 桌面唱片机要显示上次听的歌
    refreshCharacters().then((list) => {
      const saved = store.get(`xsj:current:${me.id}`);
      setCurrentId(list.find((c) => c.id === saved)?.id || list[0]?.id || null);
    }).catch(() => setCharacters([]));
  }, [me?.id]);

  // 纯前端版：打开时、以及开着的时候每 5 分钟，让角色做自己的事（发朋友圈、看朋友圈、写日记）
  const [unread, setUnread] = useState({ chat: {}, moments: {}, diary: {}, room: {} });
  const [banner, setBanner] = useState(null);
  const routeRef = useRef(route); routeRef.current = route;
  const currentRef = useRef(currentId); currentRef.current = currentId;
  const firstPoll = useRef(true);

  async function refreshUnread() {
    try { const r = await get('/api/local/unread'); setUnread({ chat: r.unread, moments: r.moments || {}, diary: r.diary || {}, room: r.room || {} }); } catch { /* 静默 */ }
  }
  // 看看有没有新的提醒（TA 主动私聊、点赞评论、发圈、写日记）
  async function pollNotifications() {
    if (!IS_LOCAL || !me) return;
    let r;
    try { r = await get(`/api/local/notifications?after=${lastNotified()}`); } catch { return; }
    const catchUp = firstPoll.current;
    firstPoll.current = false;
    if (!lastNotified()) { setLastNotified(r.latestSeq); return; } // 第一次用：以前的事不提醒
    setLastNotified(r.latestSeq);
    const cfg = r.notify || {};
    const items = (r.items || []).filter((n) => cfg.types?.[n.type] !== false && !isLooking(n));
    if (!items.length) return;
    window.dispatchEvent(new Event('xsj:new-events'));
    if (!cfg.enabled || inDnd(cfg.dnd)) return; // 免打扰：只记红点
    const hidden = appHidden();
    if (catchUp && items.length > 1) {
      const text = summarize(items);
      if (hidden && cfg.system) systemNotify('你不在的时候', text);
      else setBanner({ title: '你不在的时候', body: text, item: items[items.length - 1], key: Date.now() });
    } else {
      const last = items[items.length - 1];
      const d = describe(last);
      const more = items.length > 1 ? `（还有 ${items.length - 1} 条）` : '';
      if (hidden && cfg.system) systemNotify(d.title, d.body + more, () => openItem(last));
      else setBanner({ ...d, body: d.body + more, item: last, key: Date.now() });
    }
    if (cfg.sound && !hidden) ding();
  }
  // 正在看的页面就不用再弹了
  function isLooking(n) {
    if (appHidden() || n.characterId !== currentRef.current) return false;
    const r = routeRef.current.name;
    return (n.type === 'dm' && r === 'chat') || (['like', 'comment', 'reply', 'moment'].includes(n.type) && r === 'moments') || (n.type === 'diary' && r === 'diary') || (n.type === 'note' && r === 'room');
  }
  function openItem(n) {
    setBanner(null);
    if (n.characterId !== currentRef.current) selectCharacter(n.characterId);
    setRoute(n.type === 'dm' ? { name: 'chat', thread: n.characterId } : { name: n.type === 'diary' ? 'diary' : n.type === 'note' ? 'room' : 'moments' });
  }
  async function runTick(extra = {}) {
    if (!IS_LOCAL || !me) return;
    try { await post('/api/local/tick', extra); } catch { /* 静默 */ }
    await pollNotifications();
    await refreshUnread();
  }
  useEffect(() => {
    if (!IS_LOCAL || !me || !characters) return undefined;
    runTick();
    const t = setInterval(runTick, 5 * 60e3);
    const u = setInterval(() => { pollNotifications().then(refreshUnread); }, 8e3);
    const vis = () => { if (document.visibilityState === 'visible') runTick(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('xsj:resume', vis);
    return () => { clearInterval(t); clearInterval(u); document.removeEventListener('visibilitychange', vis); window.removeEventListener('xsj:resume', vis); };
  }, [me?.id, !!characters]);
  // 安卓 App 的返回键：先关弹窗，再回桌面；已经在桌面就交给系统
  useEffect(() => {
    window.__xsjBack = () => {
      if (window.__xsjBookClose) { window.__xsjBookClose(); return true; }
      if (closeTopSheet()) return true;
      const r = routeRef.current;
      // 子页面先回上一层（设置的某一项 → 设置；某人的相册 → 朋友圈；画小人 → 从哪来回哪去）
      if (r.section) { setRoute({ name: r.name }); return true; }
      if (r.person || r.thread) { setRoute({ name: r.name }); return true; }
      if (r.name === 'doll' && r.back) { setRoute(typeof r.back === 'object' ? { ...r.back } : { name: r.back }); return true; }
      if (r.name !== 'home') { setRoute({ name: 'home' }); return true; }
      return false;
    };
    return () => { window.__xsjBack = null; };
  }, []);
  // 标签页标题显示未读数
  useEffect(() => {
    if (!IS_LOCAL) return;
    const n = ['chat', 'moments', 'diary', 'room'].reduce((a, k) => a + Object.values(unread[k] || {}).reduce((x, y) => x + y, 0), 0);
    document.title = n ? `(${n > 99 ? '99+' : n}) 迟叙机` : '迟叙机';
  }, [unread]);
  useEffect(() => {
    if (!banner) return undefined;
    const t = setTimeout(() => setBanner(null), 5000);
    return () => clearTimeout(t);
  }, [banner?.key]);

  function selectCharacter(id) {
    setCurrentId(id);
    if (me) store.set(`xsj:current:${me.id}`, id);
  }

  function logout() {
    setMe(null);
    setCharacters(null);
    setCurrentId(null);
    setRoute({ name: 'home' });
  }

  const go = (name, params = {}) => setRoute({ name, ...params });
  const home = () => setRoute({ name: 'home' });

  let screen;
  let screenId = route.name; // 用来判断是不是换了页面（换了才播放切换动画）
  let depth = route.name === 'home' ? 0 : route.name === 'doll' ? 3 : route.section || route.person || route.thread ? 2 : 1;
  if (lic === undefined) screen = <Loading text="正在打开迟叙机…" />;
  else if (!lic.ok) screen = <Activate message={lic.message} onDone={() => setLic({ ok: true })} />;
  else if (me === undefined) screen = <Loading text="正在打开迟叙机…" />;
  else if (!me) screen = IS_LOCAL ? <Welcome onDone={(u) => setMe(u)} /> : <Login onLogin={(u) => setMe(u)} />;
  else if (!characters) screen = <Loading />;
  else {
    const current = characters.find((c) => c.id === currentId) || null;
    const common = { me, current, characters, refreshCharacters, refreshMe, go, home, selectCharacter, unread, runTick, refreshUnread, route };
    switch (route.name) {
      case 'chat': screen = !current ? null : IS_LOCAL && !route.thread ? <ChatList {...common} /> : <Chat key={current.id} {...common} />; break;
      case 'worldlines': screen = current ? <Worldlines key={current.id} {...common} /> : null; break;
      case 'moments': screen = current && IS_LOCAL ? <Moments key={current.id} {...common} /> : null; break;
      case 'room': screen = current && IS_LOCAL ? <Room key={current.id + (route.memoryId || '')} {...common} route={route} /> : null; break;
      case 'doll': screen = IS_LOCAL && (route.target === 'me' || current) ? <Doll key={(route.target || '') + (current?.id || '')} {...common} route={route} /> : null; break;
      case 'music': screen = IS_LOCAL ? <Music {...common} route={route} /> : null; break;
      case 'diary': screen = current && IS_LOCAL ? <Diary key={current.id} {...common} /> : null; break;
      case 'memories': screen = current ? <Memories key={current.id} {...common} /> : null; break;
      case 'settings': screen = current ? <Settings key={current.id} {...common} /> : null; break;
      case 'characters': screen = <Characters {...common} startCreating={route.create} />; break;
      case 'account': screen = IS_LOCAL ? <LocalSettings {...common} /> : <Account {...common} onLogout={logout} />; break;
      case 'admin': screen = me.isAdmin ? <Admin {...common} /> : null; break;
      default: screen = null;
    }
    const abg = route.name !== 'home' ? appBgs[route.name] : null;
    if (screen && abg?.image) {
      screen = (
        <>
          <div className="app-bg" aria-hidden="true" style={{ backgroundImage: `url(${abg.image})` }}><i style={{ opacity: abg.dim / 100 }} /></div>
          <div className="app-bg-page">{screen}</div>
        </>
      );
    }
    if (!screen) { screen = <Home {...common} />; screenId = 'home'; depth = 0; }
    else screenId = `${route.name}:${current?.id || ''}:${route.memoryId || ''}:${route.target || ''}:${route.section || ''}:${route.person || ''}:${route.thread ? 't' : ''}`;
  }
  if (!me || !characters || !lic?.ok) { screenId = `boot:${lic === undefined ? 'l' : !lic.ok ? 'a' : me === undefined ? 'l' : !me ? 'w' : 'l'}`; depth = 0; }

  return (
    <div className="stage">
      <div className="phone">
        <div className="screen"><ScreenStack id={screenId} depth={depth}>{screen}</ScreenStack></div>
        {banner && (
          <button className="notice" key={banner.key} onClick={() => { if (!swipe.current.moved) openItem(banner.item); }}
            onTouchStart={(e) => { swipe.current = { y: e.touches[0].clientY, dy: 0, moved: false }; }}
            onTouchMove={(e) => {
              const dy = Math.min(0, e.touches[0].clientY - swipe.current.y);
              swipe.current.dy = dy; if (dy < -6) swipe.current.moved = true;
              e.currentTarget.style.transition = 'none'; e.currentTarget.style.transform = `translateY(${dy}px)`;
            }}
            onTouchEnd={(e) => {
              const el = e.currentTarget; el.style.transition = 'transform .25s ease, opacity .25s ease';
              if (swipe.current.dy < -24) { el.style.transform = 'translateY(-130%)'; el.style.opacity = '0'; setTimeout(() => setBanner(null), 220); }
              else el.style.transform = '';
            }}>
            <span className="notice-app">迟叙机 · 现在</span>
            <b>{banner.title}</b>
            <span className="notice-body">{banner.body}</span>
          </button>
        )}
        <CropHost />
        <ToastHost />
      </div>
    </div>
  );
}
