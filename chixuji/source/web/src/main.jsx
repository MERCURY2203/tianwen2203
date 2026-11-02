import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);

// 添加到桌面（PWA）：只缓存界面文件，聊天内容不缓存在手机上
/* global __XSJ_APP__ */
const IN_APP = typeof __XSJ_APP__ !== 'undefined' && __XSJ_APP__;
if (!IN_APP && 'serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// 安卓 App：先取系统栏高度；每次换页后看看页面顶部/底部是浅色还是深色，系统栏图标跟着换颜色
const nat = typeof window !== 'undefined' ? window.XSJNative : null;
if (nat?.insets) {
  try {
    const [t, r, b, l] = JSON.parse(nat.insets());
    const s = document.documentElement.style;
    s.setProperty('--safe-t', `${t}px`); s.setProperty('--safe-r', `${r}px`); s.setProperty('--safe-b', `${b}px`); s.setProperty('--safe-l', `${l}px`);
  } catch { /* 旧版 App */ }
}
// —— iPhone 主屏幕模式的高度修正 ——
// 从主屏幕图标打开时，iOS 报给网页的高度（innerHeight、100%、100dvh、100lvh）比屏幕少了顶部状态栏那一截，
// 页面从屏幕最顶上开始画，结果底下空出一条（就是看到的「白边」）。这里直接用屏幕本身的高度。
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function fitHeight() {
  const s = document.documentElement.style;
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  // 状态栏现在是实心的（index.html 里 status-bar-style = default，为了去掉 iOS 26 顶部的雾化），
  // 页面从状态栏下面开始，iOS 报的高度就是对的；只有改回透明状态栏时才需要修正
  const translucent = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content === 'black-translucent';
  if (!IOS || !standalone || !translucent) { s.removeProperty('--app-h'); return; }
  const portrait = window.innerHeight >= window.innerWidth;
  const full = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  s.setProperty('--app-h', `${Math.max(full, window.innerHeight)}px`);
}
fitHeight();
window.addEventListener('resize', fitHeight);
window.addEventListener('orientationchange', () => setTimeout(fitHeight, 300));

// —— 全屏自适应 ——
// 手机浏览器（iPhone Safari、安卓 Chrome）顶部状态栏和底部工具栏那一条，颜色取自网页最外层的背景。
// 每次换页后，看看页面最顶上、最底下实际是什么颜色，把最外层背景和 theme-color 都换成同样的颜色，
// 这样状态栏、底部横条和页面连成一片，看起来就是全屏的，不会露出白边。
// 图片背景：按图片在页面上实际显示的样子（铺满裁切、上面盖的渐变）取最顶上 / 最底下那一条，
// 取「占得最多的颜色」而不是平均色（红字 + 灰底平均出来是一片土褐色，和壁纸对不上）
const imgCache = new Map(); // src -> HTMLImageElement（加载好）| null（加载中 / 失败）
function loadImg(src) {
  if (imgCache.has(src)) return imgCache.get(src);
  imgCache.set(src, null);
  const img = new Image();
  img.onload = () => { imgCache.set(src, img); syncEdges(); };
  img.src = src;
  return null;
}
function dominant(d) {
  const bins = new Map();
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    opaque++;
    const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    const b = bins.get(k) || [0, 0, 0, 0];
    b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++;
    bins.set(k, b);
  }
  if (opaque < d.length / 4 * 0.6) return null; // 大半透明（比如装饰线条）不算数
  let best = null;
  for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
  return [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
}
// 背景里盖在图片上面的渐变：取它在顶边 / 底边的颜色，叠上去
function overlayAt(bi, side) {
  const before = bi.split(/url\(/)[0];
  const stops = before.match(/rgba?\([^)]+\)/g);
  if (!stops) return null;
  const m = (side === 'top' ? stops[0] : stops[stops.length - 1]).match(/rgba?\(([^)]+)\)/);
  const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return { c: v.slice(0, 3), a: v.length > 3 ? v[3] : 1 };
}
function imageEdge(el, src, side, bi = '', vy = null) {
  const img = loadImg(src);
  if (!img) return undefined; // 还在加载，等加载好会再算一次
  try {
    const r = el.getBoundingClientRect();
    const W = Math.max(8, Math.round(r.width / 4)), H = Math.max(8, Math.round(r.height / 4));
    const cs = el.tagName === 'IMG' ? null : getComputedStyle(el);
    const contain = cs && /contain/.test(cs.backgroundSize);
    const stretch = cs && /100% 100%/.test(cs.backgroundSize);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (stretch) g.drawImage(img, 0, 0, W, H);
    else {
      const sc = (contain ? Math.min : Math.max)(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
      g.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); // 居中裁切，和 background: center / cover 一样
    }
    const rows = Math.max(1, Math.round(H * 0.03));
    // vy：按屏幕上的位置取（元素比屏幕大时，取屏幕顶边 / 底边那一条）
    let y0 = side === 'top' ? 0 : H - rows;
    if (vy !== null) y0 = Math.max(0, Math.min(H - rows, Math.round((vy - r.top) / 4) - (side === 'top' ? 0 : rows)));
    let col = dominant(g.getImageData(0, y0, W, rows).data);
    if (!col) return null;
    const ov = cs ? overlayAt(bi, side) : null;
    if (ov) col = col.map((v, i) => v * (1 - ov.a) + ov.c[i] * ov.a);
    return col.map(Math.round);
  } catch { return null; }
}
function parseRgb(str) {
  const m = str && str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  if (v.length > 3 && v[3] < 0.5) return null;
  return v.slice(0, 3).map(Math.round);
}
function colorAt(y, edge) {
  let el = document.elementFromPoint(window.innerWidth / 2, y);
  // 桌面的壁纸在单独一层（比屏幕高）：按屏幕顶边 / 底边那一条取色
  const wall = el?.closest?.('.home.has-wall') ? document.querySelector('.home-wall') : null;
  if (wall && getComputedStyle(wall).display !== 'none') {
    const bi = getComputedStyle(wall).backgroundImage;
    const url = bi.match(/url\("?([^")]+)"?\)/);
    if (url) { const a = imageEdge(wall, url[1], edge, bi, edge === 'top' ? 0 : window.innerHeight); if (a) return a; if (a === undefined) return null; }
  }
  while (el && el !== document.documentElement) {
    if (el.tagName === 'IMG' && el.complete && el.src) { const a = imageEdge(el, el.src, edge); if (a) return a; if (a === undefined) return null; }
    if (el.tagName === 'VIDEO') return [0, 0, 0];
    const cs = getComputedStyle(el);
    const bi = cs.backgroundImage;
    if (bi && bi !== 'none') {
      const url = bi.match(/url\("?([^")]+)"?\)/);
      if (url) { const a = imageEdge(el, url[1], edge, bi); if (a) return a; if (a === undefined) return null; }
      const own = parseRgb(cs.backgroundColor); // 渐变底下写明的底色优先（那是我们特意标的顶边颜色）
      if (own && edge === 'top') return own;
      const stops = bi.match(/rgba?\([^)]+\)/g);
      if (stops?.length) { const c = parseRgb(edge === 'top' ? stops[0] : stops[stops.length - 1]); if (c) return c; }
    }
    const c = parseRgb(cs.backgroundColor);
    if (c) return c;
    el = el.parentElement;
  }
  return null;
}
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const isLight = (c) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 > 0.6;
let themeMeta = document.querySelector('meta[name="theme-color"]');
const edges = {};
function edge(side) {
  if (!edges[side]) {
    const d = document.createElement('div');
    d.className = `edge-ext edge-${side}`;
    d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
    edges[side] = d;
  }
  return edges[side];
}
function syncEdges() {
  try {
    const top = colorAt(2, 'top'), bottom = colorAt(window.innerHeight - 2, 'bottom');
    if (!top || !bottom) return;
    const de = document.documentElement;
    // 顶部、底部颜色延长：页面四周只要露出一点空（浏览器栏、主屏幕模式下的状态栏/底部横条、回弹），
    // 露出来的都是页面顶边 / 底边的颜色，绝不会是白色。
    // 1) 最外层背景：上半截顶边色、下半截底边色（底色用顶边色，浏览器顶栏取的就是它）
    // 浏览器里：顶栏取的是底色，所以底色 = 顶边色；
    // 主屏幕模式：顶部状态栏下面就是页面本身，底色改成底边色，屏幕最底下那一截露出来也是同一个颜色
    de.style.backgroundColor = hex(document.documentElement.style.getPropertyValue('--app-h') ? bottom : top);
    de.style.backgroundImage = `linear-gradient(${hex(top)} 0 50%, ${hex(bottom)} 50% 100%)`;
    de.style.backgroundRepeat = 'no-repeat'; // 渐变不要重复：之前底下多出来的一截又从顶边色开始，就是那条色差
    // 2) 页面后面垫两块延长色，各往屏幕外再伸出一截
    edge('top').style.background = hex(top);
    edge('bottom').style.background = hex(bottom);
    if (!themeMeta) { themeMeta = document.createElement('meta'); themeMeta.name = 'theme-color'; document.head.appendChild(themeMeta); }
    themeMeta.content = hex(top);
    if (nat?.setBarStyle) nat.setBarStyle(isLight(top), isLight(bottom));
  } catch { /* 忽略 */ }
}
window.addEventListener('xsj:screen', () => { setTimeout(syncEdges, 60); setTimeout(syncEdges, 450); });
window.addEventListener('xsj:resume', syncEdges);
window.addEventListener('resize', () => setTimeout(syncEdges, 100));
setTimeout(syncEdges, 300);
setTimeout(syncEdges, 1200);

// —— 排查用：屏幕最上面一条连点 5 下，显示/隐藏尺寸数字（给用户截图用，平时看不见）——
let taps = [];
function showDims() {
  let box = document.getElementById('xsj-dims');
  if (box) { box.remove(); return; }
  box = document.createElement('div'); box.id = 'xsj-dims';
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:45%;z-index:99999;background:rgba(0,0,0,.82);color:#0f0;font:12px/1.5 monospace;padding:10px;border-radius:8px;white-space:pre-wrap;pointer-events:none';
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;top:env(safe-area-inset-top);bottom:env(safe-area-inset-bottom);height:100lvh;width:100dvh';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe), r = document.getElementById('root').getBoundingClientRect();
  box.textContent = [
    `standalone: ${navigator.standalone} / ${matchMedia('(display-mode: standalone)').matches}`,
    `screen: ${screen.width} x ${screen.height}`,
    `inner: ${innerWidth} x ${innerHeight}`,
    `visualViewport: ${window.visualViewport?.height} offTop ${window.visualViewport?.offsetTop}`,
    `html: ${document.documentElement.clientHeight}`,
    `100lvh: ${cs.height}  100dvh: ${cs.width}`,
    `safe top/bottom: ${cs.top} / ${cs.bottom}`,
    `--app-h: ${document.documentElement.style.getPropertyValue('--app-h') || '(无)'}`,
    `#root: top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} h ${Math.round(r.height)}`,
  ].join('\n');
  probe.remove();
  document.body.appendChild(box);
}
window.addEventListener('touchend', (e) => {
  const t = e.changedTouches[0]; if (!t || t.clientY > 60) return;
  const now = Date.now(); taps = taps.filter((x) => now - x < 2000); taps.push(now);
  if (taps.length >= 5) { taps = []; showDims(); }
}, { passive: true });
