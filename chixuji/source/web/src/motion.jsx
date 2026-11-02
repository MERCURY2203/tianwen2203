// 页面切换动画：像真手机一样
// - 桌面 → App：从点的图标位置放大打开；App → 桌面：缩回图标位置
// - 往里走一层（比如 设置 → 画小人）：新页面从右边滑进来，旧页面往左退一点、变暗
// - 返回：反过来
// 旧页面在动画期间保留（保持原样），动画结束再移除
import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

// 弹出面板放在自己所在的页面里，页面切走时跟着一起滑走，不会留在屏幕上
const LayerContext = createContext(null);
export const useLayerHost = () => useContext(LayerContext);
function Layer({ className, style, hidden, children }) {
  const [el, setEl] = useState(null);
  return (
    <div ref={setEl} className={className} style={style} aria-hidden={hidden}>
      <LayerContext.Provider value={el}>{children}</LayerContext.Provider>
    </div>
  );
}

const DURATION = { zoom: 460, push: 420, fade: 260 };
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

// 记住最后一次点按的位置（相对手机屏幕），App 从这里放大出来
const lastTap = { x: null, y: null };
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', (e) => {
    const phone = document.querySelector('.phone');
    if (!phone) return;
    const r = phone.getBoundingClientRect();
    lastTap.x = e.clientX - r.left; lastTap.y = e.clientY - r.top;
  }, { capture: true, passive: true });
}

export function ScreenStack({ id, depth, children }) {
  const [layers, setLayers] = useState(() => [{ id, depth, el: children, anim: null }]);
  const origin = useRef({});
  const timer = useRef(null);
  const stackRef = useRef(null);
  const [exitFx, setExitFx] = useState(null);
  const top = layers[layers.length - 1];

  // 当前页面一直用最新的内容；正在退场的旧页面用它离开时的样子
  if (top.id === id) top.el = children;

  useLayoutEffect(() => {
    if (top.id === id) return;
    const prev = top;
    let kind = 'fade'; let dir = 'forward';
    if (depth !== prev.depth) {
      dir = depth > prev.depth ? 'forward' : 'back';
      kind = (dir === 'forward' ? prev.depth : depth) === 0 ? 'zoom' : 'push';
    }
    if (reduced()) kind = 'fade';
    // 退回桌面（iPhone 同款）：页面马上换成桌面，再用一张“卡片”从整屏缩回图标。
    // 卡片改的是位置和大小，不是缩放整个页面，iPhone 浏览器就不会留下旧画面的残影。
    if (kind === 'zoom' && dir === 'back') {
      clearTimeout(timer.current);
      let bg = '#f4f2f7';
      try {
        const page = stackRef.current?.lastElementChild?.firstElementChild;
        const c = page && getComputedStyle(page).backgroundColor;
        if (c && !/rgba\(.*,\s*0\)$/.test(c) && c !== 'transparent') bg = c;
      } catch { /* 用默认颜色 */ }
      setLayers([{ id, depth, el: children, anim: null }]);
      if (!reduced()) setExitFx({ key: Date.now(), o: origin.current[prev.id] || null, bg });
      window.dispatchEvent(new Event('xsj:screen'));
      return;
    }
    // 打开 App 时记下点的位置，返回桌面时缩回同一个地方
    if (kind === 'zoom' && dir === 'forward' && lastTap.x !== null) origin.current[id] = { x: lastTap.x, y: lastTap.y };
    const o = kind === 'zoom' ? origin.current[dir === 'forward' ? id : prev.id] : null;
    const anim = { kind, dir, o };
    clearTimeout(timer.current);
    setLayers([{ ...prev, anim: { ...anim, role: 'out' } }, { id, depth, el: children, anim: { ...anim, role: 'in' } }]);
    const ms = kind === 'zoom' && dir === 'back' ? 340 : DURATION[kind];
    timer.current = setTimeout(() => {
      setLayers((ls) => [{ ...ls[ls.length - 1], anim: null }]);
      window.dispatchEvent(new Event('xsj:screen'));
      // 保险：让浏览器整屏重画一次，清掉 iPhone 偶尔留下的上一帧画面
      requestAnimationFrame(() => {
        const s = stackRef.current; if (!s) return;
        s.style.opacity = '0.999';
        requestAnimationFrame(() => { s.style.opacity = ''; });
      });
    }, ms + 30);
  }, [id]);
  useLayoutEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="screen-stack" ref={stackRef}>
      {layers.map((l) => {
        const a = l.anim;
        const cls = a ? `screen-layer is-${a.kind}-${a.dir}-${a.role}` : 'screen-layer';
        const style = a?.o ? { '--ox': `${a.o.x}px`, '--oy': `${a.o.y}px` } : undefined;
        return (
          <Layer key={l.id} className={cls} style={style} hidden={a?.role === 'out' ? true : undefined}>
            {l.id === id ? children : l.el}
          </Layer>
        );
      })}
      {exitFx && <ExitCard key={exitFx.key} fx={exitFx} onDone={() => setExitFx(null)} />}
    </div>
  );
}

// 退出 App 时缩回图标的卡片：从整屏变成图标的大小和位置，图标慢慢显出来，最后和桌面上的图标重合
function ExitCard({ fx, onDone }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current; const stack = el?.parentElement;
    if (!el || !stack) { onDone(); return undefined; }
    const s = stack.getBoundingClientRect();
    const W = s.width; const H = s.height;
    // 找到桌面上离当初点的位置最近的图标
    let target = null; let best = Infinity;
    stack.querySelectorAll('.home-dock img, .home-apps img').forEach((im) => {
      const r = im.getBoundingClientRect();
      if (!r.width || r.right < s.left || r.left > s.right) return; // 不在当前这一页
      const cx = r.left - s.left + r.width / 2; const cy = r.top - s.top + r.height / 2;
      const d = fx.o ? Math.hypot(cx - fx.o.x, cy - fx.o.y) : Infinity;
      if (d < best) { best = d; target = { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height, src: im.currentSrc || im.src }; }
    });
    if (!target || best > 90) {
      const cx = fx.o?.x ?? W / 2; const cy = fx.o?.y ?? H / 2;
      target = { x: cx - 30, y: cy - 30, w: 60, h: 60, src: null };
    }
    const img = el.querySelector('img');
    if (target.src) img.src = target.src; else img.remove();
    const D = 280; const easing = 'cubic-bezier(.3, .8, .25, 1)';
    const radius = `${Math.round(target.w * 0.23)}px`;
    const box = el.animate([
      { left: '0px', top: '0px', width: `${W}px`, height: `${H}px`, borderRadius: '0px', backgroundColor: fx.bg },
      { backgroundColor: fx.bg, offset: 0.45 },
      { left: `${target.x}px`, top: `${target.y}px`, width: `${target.w}px`, height: `${target.h}px`, borderRadius: radius, backgroundColor: target.src ? 'rgba(0,0,0,0)' : fx.bg },
    ], { duration: D, easing, fill: 'forwards' });
    if (target.src) img.animate([{ opacity: 0 }, { opacity: 0, offset: 0.3 }, { opacity: 1 }], { duration: D, easing: 'ease-out', fill: 'forwards' });
    let gone = false;
    const finish = () => { if (!gone) { gone = true; onDone(); } };
    box.onfinish = () => {
      // 和桌面上的图标重合了，轻轻淡掉就看不出来
      const f = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: target.src ? 60 : 100, fill: 'forwards' });
      f.onfinish = finish;
    };
    const safety = setTimeout(finish, D + 400); // 万一动画事件没来，也一定移除
    return () => clearTimeout(safety);
  }, []);
  return <div className="exit-card" ref={ref} aria-hidden="true"><img alt="" /></div>;
}
