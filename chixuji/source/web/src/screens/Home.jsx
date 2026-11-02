import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cropImage } from '../crop.jsx';
import { ClockFace } from '../clock.jsx';
import { Avatar, Button, PickButton, Sheet, Thread, toast } from '../ui.jsx';
import { squareIcon } from '../image.js';
import { get, post, IS_LOCAL } from '../api.js';
import { RecordWidget, WeatherWidget } from './Widgets.jsx';

// 纯前端版：桌面数据（壁纸、唱片机、天气）
// eslint-disable-next-line no-unused-vars
let homeCache = null; // 上次的桌面数据（壁纸、图标、时间样式……），回到桌面时先直接用
const ICON_FILES = ['chat', 'moments', 'diary', 'room', 'worldlines', 'memories', 'settings', 'characters', 'account', 'more', 'music'];
const keepIcons = typeof window !== 'undefined' ? ICON_FILES.flatMap((k) => ['tiles', 'lines'].map((d) => { const im = new Image(); im.src = `icons/${d}/${k}.png`; return im; })) : [];
function useHomeData() {
  const [data, setDataRaw] = useState(homeCache);
  const setData = (d) => { homeCache = d; setDataRaw(d); };
  const load = () => (IS_LOCAL ? get('/api/local/home').then(setData, () => {}) : Promise.resolve());
  useEffect(() => {
    if (!IS_LOCAL) return undefined;
    load();
    post('/api/local/weather/refresh', {}).then(load, () => {});
    const t = setInterval(() => post('/api/local/weather/refresh', {}).then(load, () => {}), 30 * 60e3);
    return () => clearInterval(t);
  }, []);
  return [data, load];
}
const WALL_SHADE = 'linear-gradient(180deg, rgba(20,20,32,.45) 0%, rgba(20,20,32,.1) 35%, rgba(20,20,32,.15) 60%, rgba(20,20,32,.6) 100%)';
// 手机上：壁纸单独一层，比屏幕更高（往上、往下都伸出去），浏览器的状态栏、底部工具栏后面也是壁纸
function WallLayer({ url }) {
  if (!url || typeof document === 'undefined') return null;
  return createPortal(<div className="home-wall" aria-hidden="true" style={{ backgroundImage: `${WALL_SHADE}, url(${url})` }} />, document.body);
}
const wallStyle = (url) => (url ? { backgroundImage: `linear-gradient(180deg, rgba(20,20,32,.45) 0%, rgba(20,20,32,.1) 35%, rgba(20,20,32,.15) 60%, rgba(20,20,32,.6) 100%), url(${url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined);

function Clock({ style }) {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 15000);
    return () => clearInterval(i);
  }, []);
  return <ClockFace style={style} now={t} />;
}

// 有设计好的图标就用图标，没有的（比如房间）用文字
const ICONS = { 聊天: 'chat', 朋友圈: 'moments', 日记: 'diary', 世界线: 'worldlines', 记忆: 'memories', 设定: 'settings', 人物: 'characters', 房间: 'room', 设置: 'account', 账号: 'account', 管理: 'more', 音乐: 'music' };
function AppIcon({ glyph, label, onClick, soon, badge, custom, onLongPress }) {
  const icon = ICONS[label];
  const shown = custom?.name || label;
  const img = custom?.image || (icon ? `icons/${icon}.png` : null);
  const split = !custom?.image && !!icon;
  const timer = useRef(null);
  const long = useRef(false);
  const press = onLongPress ? {
    onContextMenu: (e) => { e.preventDefault(); onLongPress(); },
    onTouchStart: () => { long.current = false; clearTimeout(timer.current); timer.current = setTimeout(() => { long.current = true; navigator.vibrate?.(10); onLongPress(); }, 550); },
    onTouchEnd: () => clearTimeout(timer.current),
    onTouchMove: () => clearTimeout(timer.current),
  } : {};
  return (
    <button className={'app' + (soon ? ' is-soon' : '')} onClick={() => { if (long.current) { long.current = false; return; } onClick?.(); }} disabled={soon} {...press}
      aria-label={soon ? `${shown}（即将开放）` : badge ? `${shown}，${badge} 条未读` : shown}>
      <span className={'app-glyph' + (img ? ' has-icon' : '') + (split ? ' is-split' : '')}>
        {split ? (
          // 自带的图标分两层：底色（可以调透明）+ 线条（一直不透明）
          <><img className="app-tile" src={`icons/tiles/${icon}.png`} alt="" draggable="false" decoding="sync" loading="eager" /><img className="app-lines" src={`icons/lines/${icon}.png`} alt="" draggable="false" decoding="sync" loading="eager" /></>
        ) : img ? <img src={img} alt="" draggable="false" decoding="sync" loading="eager" /> : glyph}
        {badge > 0 && <span className="app-badge">{badge > 99 ? '99+' : badge}</span>}
      </span>
      <span className="app-label">{shown}</span>
      {soon && <span className="app-soon">即将开放</span>}
    </button>
  );
}

// 长按图标：换图、改名字、恢复默认（纯前端版）
function IconSheet({ target, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { if (target) setName(target.custom?.name || ''); }, [target?.label]);
  if (!target) return null;
  const key = ICONS[target.label];
  async function call(body, msg, close = false) {
    setBusy(true);
    try { await post(`/api/local/icons/${key}`, body); toast(msg); onSaved(close); } catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { const d = await cropImage(f, { aspect: 1, size: 256, type: 'image/png', title: '裁剪图标' }); if (d) await call({ dataUrl: d }, '图标换好了'); } catch (err) { toast(err.message); }
  }
  const img = target.custom?.image || `icons/${key}.png`;
  return (
    <Sheet open onClose={onClose} title={`「${target.custom?.name || target.label}」图标`}>
      <div className="icon-edit">
        <img src={img} alt="" />
        <PickButton busy={busy} onClick={() => fileRef.current?.click()}>从相册换一张</PickButton>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      <label className="field"><span>图标下面的名字（最多 8 个字）</span>
        <input value={name} maxLength={8} placeholder={target.label} onChange={(e) => setName(e.target.value)} />
      </label>
      <Button busy={busy} onClick={() => call({ name: name.trim() }, '名字改好了', true)}>保存名字</Button>
      <button type="button" className="text-btn" onClick={() => call({ reset: true }, '已恢复默认', true)}>恢复默认图标和名字</button>
    </Sheet>
  );
}

// 桌面分页：一屏放不下的不硬塞，自动挪到下一页；左右滑动翻页，底下的小圆点显示在第几页
let lastHomePage = 0; // 退出 App 回到桌面时，回到原来那一页
function Pager({ pages }) {
  const ref = useRef(null);
  const [page, setPage] = useState(lastHomePage);
  const [moved, setMoved] = useState(0); // 第一页末尾挪到第二页的块数
  const first = pages[0].slice(0, pages[0].length - moved);
  const spill = pages[0].slice(pages[0].length - moved);
  const all = [first, [...spill, ...pages[1]], ...pages.slice(2)];
  useEffect(() => {
    const el = ref.current?.querySelector('.home-page');
    if (!el) return undefined;
    const check = () => {
      if (el.scrollHeight > el.clientHeight + 1 && moved < pages[0].length - 1) setMoved((m) => m + 1);
    };
    check();
    return undefined;
  }, [moved]);
  // 屏幕大小变了（转屏、地址栏伸缩）就重新排一次
  useEffect(() => {
    let last = ref.current?.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = ref.current?.clientHeight;
      if (h !== last) { last = h; setMoved(0); }
    });
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && lastHomePage) el.scrollLeft = lastHomePage * el.clientWidth;
  }, [moved]);
  function onScroll() {
    const el = ref.current; if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    lastHomePage = i; setPage(i);
  }
  const goPage = (i) => ref.current?.scrollTo({ left: i * ref.current.clientWidth, behavior: 'smooth' });
  return (
    <>
      <div className="home-pager" ref={ref} onScroll={onScroll}>
        {all.map((items, i) => <div className="home-page" key={i} aria-label={`第 ${i + 1} 页`}>{items}</div>)}
      </div>
      <div className="home-dots" role="tablist" aria-label="桌面页">
        {all.map((_, i) => <button key={i} type="button" role="tab" aria-selected={page === i} aria-label={`第 ${i + 1} 页`} className={page === i ? 'is-on' : ''} onClick={() => goPage(i)} />)}
      </div>
    </>
  );
}

export default function Home({ me, current, characters, go, unread = {} }) {
  const n = (area) => (current ? unread[area]?.[current.id] || 0 : 0);
  const [homeData, reloadHome] = useHomeData();
  const alpha = (homeData?.iconAlpha ?? 100) / 100;
  const wall = { ...wallStyle(homeData?.wallpaper), '--icon-alpha': alpha };
  const linesCls = homeData?.iconLines === 'light' ? ' lines-light' : '';
  const [editIcon, setEditIcon] = useState(null);
  // 纯前端版：每个图标都能长按换图、改名字
  const ic = (label) => (IS_LOCAL ? { custom: homeData?.icons?.[ICONS[label]], onLongPress: () => setEditIcon(label) } : {});
  if (!characters.length) {
    return (
      <div className={'home' + linesCls + (homeData?.wallpaper ? ' has-wall' : '')} style={wall}>
        <WallLayer url={homeData?.wallpaper} />
        <Clock style={homeData?.clock} />
        <div className="home-empty">
          <h2>先创建一个人物</h2>
          <p>写下 TA 是谁、怎么说话、和你是什么关系。之后每一次聊天都会沿着这条世界线延续。</p>
          <button className="btn btn-light" onClick={() => go('characters', { create: true })}>创建人物</button>
        </div>
        <div className="home-apps">
          {IS_LOCAL ? <AppIcon glyph="置" label="设置" onClick={() => go('account')} /> : <AppIcon glyph="账" label="账号" onClick={() => go('account')} />}
          {me.isAdmin && <AppIcon glyph="管" label="管理" onClick={() => go('admin')} />}
        </div>
      </div>
    );
  }

  const dockApps = [
    <AppIcon key="chat" glyph="聊" label="聊天" {...ic('聊天')} onClick={() => go('chat')} badge={n('chat')} />,
    <AppIcon key="moments" glyph="圈" label="朋友圈" {...ic('朋友圈')} soon={!IS_LOCAL} onClick={() => go('moments')} badge={n('moments')} />,
    <AppIcon key="diary" glyph="记" label="日记" {...ic('日记')} soon={!IS_LOCAL} onClick={() => go('diary')} badge={n('diary')} />,
    <AppIcon key="room" glyph="房" label="房间" {...ic('房间')} soon={!IS_LOCAL} onClick={() => go('room')} badge={n('room')} />,
  ];
  const moreApps = [
    IS_LOCAL && <AppIcon key="music" glyph="乐" label="音乐" {...ic('音乐')} onClick={() => go('music')} />,
    <AppIcon key="wl" glyph="线" label="世界线" {...ic('世界线')} onClick={() => go('worldlines')} />,
    <AppIcon key="mem" glyph="忆" label="记忆" {...ic('记忆')} onClick={() => go('memories')} />,
    <AppIcon key="set" glyph="设" label="设定" {...ic('设定')} onClick={() => go('settings')} />,
    <AppIcon key="ppl" glyph="人" label="人物" {...ic('人物')} onClick={() => go('characters')} />,
    IS_LOCAL ? <AppIcon key="acc" glyph="置" label="设置" {...ic('设置')} onClick={() => go('account')} /> : <AppIcon key="acc" glyph="账" label="账号" onClick={() => go('account')} />,
    me.isAdmin && <AppIcon key="adm" glyph="管" label="管理" onClick={() => go('admin')} />,
  ].filter(Boolean);
  const widgets = IS_LOCAL && (
    <div className="widgets" key="widgets">
      <RecordWidget record={homeData?.record} onChanged={reloadHome} onOpenMusic={() => go('music', { section: 'player' })} />
      <WeatherWidget weather={homeData?.weather} characterName={current?.name} onChanged={reloadHome} />
    </div>
  );
  const who = (
    <section className="home-who" key="who">
      <button className="home-person" onClick={() => go('characters')} aria-label="切换角色">
        <Avatar name={current?.name} color={current?.avatarColor} url={current?.avatarUrl} size={52} />
        <span className="home-name">{current?.name}</span>
        {characters.length > 1 && <span className="home-switch">换角色</span>}
      </button>
      {current?.viewBranch && <Thread name={current.viewBranch.name} onClick={() => go('worldlines')} archived={current.viewBranch.archived} />}
    </section>
  );

  return (
    <div className={'home is-paged' + (IS_LOCAL ? ' has-widgets' : '') + linesCls + (homeData?.wallpaper ? ' has-wall' : '')} style={wall}>
      <WallLayer url={homeData?.wallpaper} />
      <Pager pages={[
        [<Clock key="clock" style={homeData?.clock} />, who, widgets].filter(Boolean),
        [<div className="home-apps" key="apps">{moreApps}</div>],
      ]} />
      <nav className="home-dock" aria-label="常用">{dockApps}</nav>
      {IS_LOCAL && <IconSheet target={editIcon ? { label: editIcon, custom: homeData?.icons?.[ICONS[editIcon]] } : null} onClose={() => setEditIcon(null)} onSaved={(close) => { if (close) setEditIcon(null); reloadHome(); }} />}
    </div>
  );
}
