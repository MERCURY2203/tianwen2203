// 画小人：在白板小人上一格一格涂色（正面 / 背面 / 侧面）
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, post } from '../api.js';
import { Button, Loading, Sheet, toast, TopBar } from '../ui.jsx';
import {
  backFromFront, CLEAR, codeToDoll, colorAt, sideFromFront, compose, DEFAULT_OUTLINE, dollCanvas, dollToCode, emptyLayer, floodFill, H, isBlank, newDoll,
  packDoll, shareImage, unpackDoll, VIEW_NAME, VIEWS, W,
} from '../doll.js';

const PALETTE = [
  '#ffffff', '#d9d4dd', '#8c8590', '#3b3238', '#1f1a1e',
  '#ffe3d1', '#f6cdb2', '#e8ae8c', '#c98b67', '#8d5a3e',
  '#f7d774', '#e7b34a', '#b5793a', '#7a4a2b', '#4a2f24',
  '#ff9fb2', '#e8607a', '#c2313a', '#ffb37a', '#f28c38',
  '#bfe3a8', '#6dbb6a', '#2f7d55', '#a8dcef', '#5aa7e0',
  '#2e5fa8', '#1f3566', '#c9b2ef', '#8a6cc9', '#5b3d8f',
];
const TOOLS = [
  { id: 'pen', name: '画笔' }, { id: 'eraser', name: '橡皮' }, { id: 'fill', name: '填色' },
  { id: 'picker', name: '吸色' }, { id: 'cut', name: '挖空' },
];
const TOOL_TIP = {
  pen: '点或拖动涂色', eraser: '擦回白板的样子', fill: '把连在一起的同一种颜色整块换掉',
  picker: '点一下，取那一格的颜色', cut: '擦成透明（白板也去掉），比如腿缝、镂空', hand: '拖动画布',
};
const clone = (d) => ({ front: d.front.slice(), back: d.back ? d.back.slice() : null, side: d.side ? d.side.slice() : null, outline: d.outline });
const draftKey = (t) => `xsj:doll-draft:${t}`;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 存不了就算了 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 同上 */ } },
};

function saveImageFile(name, dataUrl) {
  const nat = window.XSJNative;
  if (nat?.saveImage) {
    const where = nat.saveImage(name, dataUrl);
    if (where) { toast(`已保存到 ${where}`); return true; }
    return false;
  }
  if (window.__XSJ_APP__) return false;
  const a = document.createElement('a');
  a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  return true;
}

export default function Doll({ current, route, refreshCharacters, go, home }) {
  const target = route.target === 'me' ? 'me' : 'character';
  const key = target === 'me' ? 'me' : current?.id;
  const title = target === 'me' ? '画我的小人' : `画${current?.name}的小人`;
  const back = () => (route.back ? (typeof route.back === 'object' ? go(route.back.name, route.back) : go(route.back)) : home());

  const [ready, setReady] = useState(false);
  const dollRef = useRef(newDoll());
  const savedRef = useRef('');
  const [ver, setVer] = useState(0); // 画完一笔加 1，用来刷新预览
  const [view, setView] = useState('front');
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#3b3238');
  const [recent, setRecent] = useState([]);
  const [mirror, setMirror] = useState(false);
  const [zoom, setZoom] = useState(1); // 画板缩放：1 = 刚好放下整个小人，最大 6 倍
  const big = zoom > 1.001;
  const [brush, setBrush] = useState(1);
  const undoRef = useRef([]); const redoRef = useRef([]);
  const [sheet, setSheet] = useState(null); // 'code' | 'import' | 'image'
  const [codeText, setCodeText] = useState('');
  const [importText, setImportText] = useState('');
  const [imgUrl, setImgUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const ctrlRef = useRef(null);

  // 读入：先看有没有没保存的草稿
  useEffect(() => {
    let alive = true;
    (async () => {
      let packed = null;
      if (target === 'me') packed = (await get('/api/local/mydoll').catch(() => ({}))).doll || null;
      else packed = current?.doll || null;
      savedRef.current = packed ? JSON.stringify(packed) : '';
      let d = packed ? unpackDoll(packed) : newDoll();
      const draft = store.get(draftKey(key));
      if (draft && draft !== savedRef.current) {
        try { d = unpackDoll(JSON.parse(draft)); toast('接着画上次没保存的'); } catch { store.del(draftKey(key)); }
      }
      if (!alive) return;
      dollRef.current = d; setReady(true); setVer((v) => v + 1);
    })();
    return () => { alive = false; };
  }, [key]);

  // 画板尺寸：base = 100% 时每一格多大。画板外框高度固定，缩放只改画布显示大小，页面不会跟着晃
  const [base, setBase] = useState(8);
  const [vpW, setVpW] = useState(320);
  useEffect(() => {
    function fit() {
      const w = wrapRef.current?.clientWidth || 320;
      const byW = (w - 4) / W;
      const top = (wrapRef.current?.getBoundingClientRect().top ?? 150) + window.scrollY;
      const ctrl = ctrlRef.current?.offsetHeight ?? 200;
      const byH = (window.innerHeight - top - ctrl - 10) / H;
      setBase(Math.max(5, Math.floor(Math.min(byW, byH))));
      setVpW(w);
    }
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [ready, view]);
  const scale = base * zoom; // 现在每格显示多大
  const cw = W * scale; const ch = H * scale;
  const vpH = H * base + 4;
  const sizerW = Math.max(cw, vpW); const sizerH = Math.max(ch, vpH);
  const offX = (sizerW - cw) / 2; const offY = (sizerH - ch) / 2;
  // 画布像素：停下来 120 毫秒后按当前大小重画一次，缩放过程中只是放大显示（又快又不闪）
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const [res, setRes] = useState(8);
  useEffect(() => {
    const id = setTimeout(() => setRes(Math.max(4, Math.min(48, Math.round(scale * dpr)))), 120);
    return () => clearTimeout(id);
  }, [scale, dpr]);

  // 缩放时让某一点（手指中间 / 画板中间）保持不动
  const zoomRef = useRef(1);
  const pending = useRef(null);
  function zoomAt(z, ax, ay) {
    z = Math.min(6, Math.max(1, z));
    const vp = wrapRef.current; if (!vp) { setZoom(z); return; }
    const r = vp.getBoundingClientRect();
    const s0 = base * zoomRef.current;
    const o0x = (Math.max(W * s0, vp.clientWidth) - W * s0) / 2; const o0y = (Math.max(H * s0, vp.clientHeight) - H * s0) / 2;
    const px = (vp.scrollLeft + (ax - r.left) - o0x) / s0; const py = (vp.scrollTop + (ay - r.top) - o0y) / s0;
    placeAt(z, px, py, ax - r.left, ay - r.top);
  }
  // 让画布上的格子 (px, py) 出现在画板里的 (vx, vy) 位置
  function placeAt(z, px, py, vx, vy) {
    zoomRef.current = z;
    pending.current = { px, py, vx, vy };
    if (Math.abs(z - zoom) < 1e-4) applyPending(); else setZoom(z);
  }
  function applyPending() {
    const vp = wrapRef.current; const pd = pending.current; if (!vp || !pd) return;
    pending.current = null;
    const s1 = base * zoomRef.current;
    const o1x = (Math.max(W * s1, vp.clientWidth) - W * s1) / 2; const o1y = (Math.max(H * s1, vp.clientHeight) - H * s1) / 2;
    vp.scrollLeft = pd.px * s1 + o1x - pd.vx; vp.scrollTop = pd.py * s1 + o1y - pd.vy;
  }
  useLayoutEffect(applyPending, [zoom]);
  const zoomCenter = (z) => {
    const vp = wrapRef.current; if (!vp) { zoomRef.current = z; setZoom(z); return; }
    const r = vp.getBoundingClientRect();
    if (zoom <= 1.001) { // 从 100% 放大：从小人中间（偏上一点，头部）开始
      placeAt(Math.min(6, Math.max(1, z)), W / 2, H * 0.4, vp.clientWidth / 2, vp.clientHeight / 2);
    } else zoomAt(z, r.left + vp.clientWidth / 2, r.top + vp.clientHeight / 2);
  };

  const layerOf = (d, v) => d[v] || emptyLayer();

  function draw() {
    const cv = canvasRef.current; if (!cv) return;
    const d = dollRef.current;
    const cells = compose(d, view, { editing: true });
    const g = cv.getContext('2d');
    const c0 = res;
    cv.width = W * c0; cv.height = H * c0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = cells[y * W + x];
      g.fillStyle = c || ((x + y) % 2 ? '#f2eef0' : '#faf8f9');
      g.fillRect(x * c0, y * c0, c0, c0);
    }
    if (c0 >= 6) {
      g.strokeStyle = 'rgba(120,100,115,.13)'; g.lineWidth = dpr;
      g.beginPath();
      for (let x = 1; x < W; x++) { g.moveTo(x * c0 + 0.5, 0); g.lineTo(x * c0 + 0.5, H * c0); }
      for (let y = 1; y < H; y++) { g.moveTo(0, y * c0 + 0.5); g.lineTo(W * c0, y * c0 + 0.5); }
      g.stroke();
    }
    if (mirror && view !== 'side') {
      g.strokeStyle = 'rgba(232,96,122,.55)'; g.lineWidth = dpr; g.setLineDash([4 * dpr, 4 * dpr]);
      g.beginPath(); g.moveTo((W / 2) * c0, 0); g.lineTo((W / 2) * c0, H * c0); g.stroke(); g.setLineDash([]);
    }
  }
  useEffect(draw, [ver, view, res, mirror, ready]);

  function remember() {
    undoRef.current.push(clone(dollRef.current));
    if (undoRef.current.length > 60) undoRef.current.shift();
    redoRef.current = [];
  }
  function changed() {
    setVer((v) => v + 1);
    try { store.set(draftKey(key), JSON.stringify(packDoll(dollRef.current))); } catch { /* 颜色太多时先不存草稿 */ }
  }
  function undo() {
    const prev = undoRef.current.pop(); if (!prev) return toast('没有可以撤销的了');
    redoRef.current.push(clone(dollRef.current)); dollRef.current = prev; changed();
  }
  function redo() {
    const nxt = redoRef.current.pop(); if (!nxt) return;
    undoRef.current.push(clone(dollRef.current)); dollRef.current = nxt; changed();
  }

  function pickColor(c) {
    setColor(c);
    if (tool !== 'pen' && tool !== 'fill') setTool('pen');
    setRecent((r) => [c, ...r.filter((x) => x !== c)].slice(0, 8));
  }

  // —— 在格子上画 ——
  const stroke = useRef(null);
  function cellAt(e) {
    const r = canvasRef.current.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) * W) / r.width), Math.floor(((e.clientY - r.top) * H) / r.height)];
  }
  function paint(x, y) {
    const d = dollRef.current;
    if (!d[view]) d[view] = emptyLayer();
    const val = tool === 'pen' ? color : tool === 'eraser' ? null : CLEAR;
    const pts = [];
    for (let dy = 0; dy < brush; dy++) for (let dx = 0; dx < brush; dx++) pts.push([x + dx, y + dy]);
    if (mirror && view !== 'side') for (const [px, py] of pts.slice()) pts.push([W - 1 - px, py]);
    for (const [px, py] of pts) if (px >= 0 && px < W && py >= 0 && py < H) d[view][py * W + px] = val;
  }
  // —— 双指：捏合缩放、一起移动来拖画布；“拖动”工具：一根手指拖画布 ——
  const pts = useRef(new Map());
  const pinch = useRef(null);
  const pan = useRef(null);
  const midDist = () => {
    const [a, b] = [...pts.current.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  function gestureDown(e) {
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvasRef.current.setPointerCapture?.(e.pointerId);
    const vp = wrapRef.current;
    if (pts.current.size === 2) {
      // 第二根手指放下：刚才那一笔不算，改成缩放
      if (stroke.current) { stroke.current = null; const prev = undoRef.current.pop(); if (prev) { dollRef.current = prev; draw(); } }
      pan.current = null;
      const m = midDist(); const r = vp.getBoundingClientRect();
      const s0 = base * zoomRef.current;
      const o0x = (Math.max(W * s0, vp.clientWidth) - W * s0) / 2; const o0y = (Math.max(H * s0, vp.clientHeight) - H * s0) / 2;
      pinch.current = { d: m.d, zoom: zoomRef.current, px: (vp.scrollLeft + (m.x - r.left) - o0x) / s0, py: (vp.scrollTop + (m.y - r.top) - o0y) / s0 };
      return true;
    }
    // 没选工具：一根手指拖动画布
    if (!tool) { pan.current = { x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop }; return true; }
    return pts.current.size > 1 || !!pinch.current;
  }
  function gestureMove(e) {
    if (!pts.current.has(e.pointerId)) return false;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const vp = wrapRef.current;
    if (pinch.current && pts.current.size >= 2) {
      const m = midDist(); const p0 = pinch.current; const r = vp.getBoundingClientRect();
      placeAt(Math.min(6, Math.max(1, p0.zoom * (m.d / p0.d))), p0.px, p0.py, m.x - r.left, m.y - r.top);
      return true;
    }
    if (pan.current) { vp.scrollLeft = pan.current.sl - (e.clientX - pan.current.x); vp.scrollTop = pan.current.st - (e.clientY - pan.current.y); return true; }
    return !!pinch.current;
  }
  function gestureUp(e) {
    pts.current.delete(e.pointerId);
    pan.current = null;
    if (pinch.current) { if (pts.current.size === 0) pinch.current = null; return true; }
    return !tool;
  }
  function onWheel(e) {
    if (!e.ctrlKey) return; // 触控板捏合 / Ctrl+滚轮
    e.preventDefault();
    zoomAt(zoomRef.current * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
  }

  function onDown(e) {
    if (!ready) return;
    e.preventDefault();
    if (gestureDown(e)) return;
    const [x, y] = cellAt(e);
    if (x < 0 || x >= W || y < 0 || y >= H) return;
    if (tool === 'picker') {
      const c = colorAt(dollRef.current, view, x, y);
      if (c) { pickColor(c); toast('取到了这个颜色'); }
      return;
    }
    remember();
    if (tool === 'fill') {
      const d = dollRef.current;
      d[view] = floodFill(d, view, x, y, color);
      if (mirror && view !== 'side') d[view] = floodFill(d, view, W - 1 - x, y, color);
      setRecent((r) => [color, ...r.filter((c) => c !== color)].slice(0, 8));
      changed();
      return;
    }
    canvasRef.current.setPointerCapture?.(e.pointerId);
    stroke.current = [x, y];
    paint(x, y); draw();
  }
  function onMove(e) {
    if (gestureMove(e)) return;
    if (!stroke.current) return;
    e.preventDefault();
    const [x1, y1] = cellAt(e); let [x0, y0] = stroke.current;
    if (x0 === x1 && y0 === y1) return;
    // 连成一条线，拖快了也不会断
    const dx = Math.abs(x1 - x0); const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1; const sy = y0 < y1 ? 1 : -1; let err = dx + dy;
    for (let n = 0; n < 200; n++) {
      paint(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    stroke.current = [x1, y1]; draw();
  }
  function onUp(e) {
    if (e && gestureUp(e)) return;
    if (!stroke.current) return;
    stroke.current = null;
    if (tool === 'pen') setRecent((r) => [color, ...r.filter((c) => c !== color)].slice(0, 8));
    changed();
  }

  // —— 整面的操作 ——
  function startFromFront() {
    remember();
    const d = dollRef.current;
    d[view] = view === 'back' ? backFromFront(d.front) : sideFromFront(d.front);
    changed();
    toast(view === 'back' ? '照正面起好稿了：左右翻过来，头部用发色盖住了，再修修细节' : '照正面的颜色起好稿了，发型和衣服细节再自己修一修');
  }
  function resetAll() {
    if (!window.confirm('把正面、背面、侧面全部擦回白板？（点「撤销」可以找回）')) return;
    remember();
    dollRef.current = newDoll();
    changed();
    toast('已经全部重置');
  }
  function setOutline(v) { remember(); dollRef.current.outline = v; changed(); }

  async function save() {
    let packed;
    try { packed = packDoll(dollRef.current); } catch (e) { return toast(e.message); }
    setSaving(true);
    try {
      if (target === 'me') await post('/api/local/mydoll', { doll: packed });
      else { await post(`/api/characters/${current.id}/doll`, { doll: packed }); await refreshCharacters(); }
      savedRef.current = JSON.stringify(packed);
      store.del(draftKey(key));
      toast(target === 'me' ? '保存好了，去 TA 的房间串门时就是这个样子' : '保存好了，房间里已经换成这个小人');
    } catch (e) { toast(e.message); } finally { setSaving(false); }
  }

  async function copyCode() {
    let code;
    try { code = dollToCode(dollRef.current); } catch (e) { return toast(e.message); }
    setCodeText(code);
    try { await navigator.clipboard.writeText(code); toast('小人码已复制，发给朋友就能导入'); } catch { setSheet('code'); }
  }
  function doImport() {
    try {
      const d = codeToDoll(importText);
      remember(); dollRef.current = d; changed();
      setSheet(null); setImportText(''); setView('front');
      toast('导入好了，满意的话点右上角保存');
    } catch (e) { toast(e.message); }
  }
  function saveImg() {
    let url;
    try { url = shareImage(dollRef.current, target === 'me' ? '' : current?.name); } catch (e) { return toast(e.message); }
    const name = `小人-${target === 'me' ? '我' : current?.name}-${Date.now().toString(36)}.png`;
    if (!saveImageFile(name, url)) { setImgUrl(url); setSheet('image'); }
  }

  if (!ready) return <div className="page"><TopBar title={title} onBack={back} /><Loading /></div>;
  const d = dollRef.current;
  const viewEmpty = view !== 'front' && isBlank(d[view]);
  const tip = tool ? TOOL_TIP[tool] : '没选工具：一根手指拖动画布，两根手指捏合缩放（不会画到）';
  const preview = (v) => { try { return dollCanvas(d, v, 2).toDataURL(); } catch { return ''; } };

  return (
    <div className="page doll-page">
      <TopBar title={title} onBack={back} right={<button className="text-btn" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</button>} />
      <div className="page-body doll-body">
        <div className="segmented doll-views" role="tablist" aria-label="画哪一面">
          {VIEWS.map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-on' : ''} onClick={() => setView(v)}>
              {VIEW_NAME[v]}{v !== 'front' && isBlank(d[v]) ? <small>（没画）</small> : null}
            </button>
          ))}
        </div>
        {viewEmpty && (
          <p className="doll-hint">
            这一面还没画，房间里{view === 'back' ? '站在窗边' : '坐在书桌前'}时会照正面自动起稿；想自己改就点下面。
            <button className="text-btn" onClick={startFromFront}>照正面起稿</button>
          </p>
        )}

        <div className="doll-stage">
          <div ref={wrapRef} className={'doll-canvas-wrap' + (big ? ' is-big' : '') + (!tool ? ' is-hand' : '')} style={{ height: vpH }}>
            <div className="doll-sizer" style={{ width: sizerW, height: sizerH }}>
              <canvas ref={canvasRef} className="doll-canvas" style={{ touchAction: 'none', width: cw, height: ch, left: offX, top: offY }} onWheel={onWheel}
                onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
                aria-label={`${VIEW_NAME[view]}画板，${W} 乘 ${H} 格`} role="img" />
            </div>
          </div>
          {view !== 'front' && (
            <figure className="doll-ref">
              <img src={preview('front')} alt="正面参考" />
              <figcaption>正面参考</figcaption>
            </figure>
          )}
        </div>
        <div ref={ctrlRef}>
        <p className="doll-tip">{tip}</p>

        <div className="doll-tools" role="toolbar" aria-label="工具">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? 'is-on' : ''} aria-pressed={tool === t.id} onClick={() => setTool(tool === t.id ? null : t.id)}>{t.name}</button>
          ))}
        </div>
        <div className="doll-tools" role="toolbar" aria-label="选项">
          <button onClick={undo}>撤销</button>
          <button onClick={resetAll}>重置</button>
          <button className={mirror ? 'is-on' : ''} aria-pressed={mirror} disabled={view === 'side'} onClick={() => setMirror(!mirror)}>左右对称</button>
          <button className={brush === 2 ? 'is-on' : ''} aria-pressed={brush === 2} onClick={() => setBrush(brush === 2 ? 1 : 2)}>粗笔</button>
        </div>
        <div className="doll-zoom" role="group" aria-label="缩放">
          <button type="button" onClick={() => zoomCenter(zoom / 1.25)} disabled={!big} aria-label="缩小">－</button>
          <input type="range" min="1" max="6" step="0.05" value={zoom} onChange={(e) => zoomCenter(Number(e.target.value))} aria-label="缩放大小" />
          <button type="button" onClick={() => zoomCenter(zoom * 1.25)} disabled={zoom >= 6} aria-label="放大">＋</button>
          <button type="button" className="doll-zoom-pct" onClick={() => zoomCenter(1)} title="恢复成整个小人">{Math.round(zoom * 100)}%</button>
        </div>

        <div className="doll-palette" role="radiogroup" aria-label="颜色">
          <label className="doll-custom" title="自己调颜色">
            <input type="color" value={color} onChange={(e) => pickColor(e.target.value)} aria-label="自己调颜色" />
            <span style={{ background: color }} />
          </label>
          {recent.map((c) => <button key={'r' + c} aria-label={'刚用过 ' + c} className={color === c ? 'is-on' : ''} style={{ background: c }} onClick={() => pickColor(c)} />)}
          {recent.length > 0 && <i className="doll-sep" aria-hidden="true" />}
          {PALETTE.map((c) => (
            <button key={c} role="radio" aria-checked={color === c} aria-label={c} className={color === c ? 'is-on' : ''} style={{ background: c }} onClick={() => pickColor(c)} />
          ))}
        </div>

        </div>

        <section className="card">
          <h2 className="card-title">描边</h2>
          <div className="row-between">
            <label className="toggle-row grow">
              <span><b>自动描边</b><small>给小人外面描一圈边，关掉就只有你画的格子</small></span>
              <span className="switch"><input type="checkbox" checked={!!d.outline} onChange={(e) => setOutline(e.target.checked ? DEFAULT_OUTLINE : null)} /><span aria-hidden="true" /></span>
            </label>
          </div>
          {d.outline && (
            <label className="doll-outline-color"><span>描边颜色</span>
              <input type="color" value={d.outline} onChange={(e) => setOutline(e.target.value)} aria-label="描边颜色" />
            </label>
          )}
        </section>

        <section className="card">
          <h2 className="card-title">三面预览</h2>
          <div className="doll-previews">
            {VIEWS.map((v) => (
              <figure key={v + ver}>
                <img src={preview(v)} alt={VIEW_NAME[v]} />
                <figcaption>{VIEW_NAME[v]}{v !== 'front' && isBlank(d[v]) ? '（用正面）' : ''}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="card-title">分享</h2>
          <p className="muted small">小人码是一串文字，发给朋友，对方在这里点「导入小人码」就能得到一模一样的小人。</p>
          <div className="doll-btns">
            <Button kind="light" onClick={copyCode}>复制小人码</Button>
            <Button kind="light" onClick={() => setSheet('import')}>导入小人码</Button>
            <Button kind="light" onClick={saveImg}>保存图片</Button>
          </div>
        </section>
      </div>

      <Sheet open={sheet === 'code'} onClose={() => setSheet(null)} title="小人码">
        <p className="muted small">没能自动复制，长按下面的文字全选复制：</p>
        <textarea className="doll-code" readOnly rows={6} value={codeText} onFocus={(e) => e.target.select()} />
      </Sheet>
      <Sheet open={sheet === 'import'} onClose={() => setSheet(null)} title="导入小人码">
        <p className="muted small">把朋友发来的小人码粘贴到这里（带着别的文字也没关系）。导入会替换现在画的，可以撤销。</p>
        <textarea className="doll-code" rows={6} value={importText} placeholder="XSJ1.…" onChange={(e) => setImportText(e.target.value)} />
        <Button onClick={doImport} disabled={!importText.trim()}>导入</Button>
      </Sheet>
      <Sheet open={sheet === 'image'} onClose={() => setSheet(null)} title="保存图片">
        <p className="muted small">长按图片保存到相册。</p>
        {imgUrl && <img className="doll-share-img" src={imgUrl} alt="小人三面图" />}
      </Sheet>
    </div>
  );
}
