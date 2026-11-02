// 房间里点日记本：本子从书桌上“拿起来”到眼前，翻开就是日记（和日记软件里的一样）；关上时“放回”书桌
// 动画改的是本子的位置和大小（不缩放整个页面），iPhone 上不会留残影
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { get, post } from '../api.js';
import { useLayerHost } from '../motion.jsx';
import { createPortal } from 'react-dom';
import { dateTitle } from './Diary.jsx';

export function DiaryBook({ from, current, onClose, onOpenApp }) {
  const host = useLayerHost();
  const bookRef = useRef(null); const dimRef = useRef(null);
  const [entries, setEntries] = useState(null);
  const [shown, setShown] = useState(false); // 动画结束后才显示里面的字
  const closing = useRef(false);
  useEffect(() => {
    get(`/api/branches/${current.viewBranch.id}/diary`).then((r) => setEntries(r.entries), () => setEntries([]));
    post(`/api/characters/${current.id}/read`, { area: 'diary' }).catch(() => {});
  }, []);

  // 书桌上日记本的位置 → 屏幕中间的大本子
  const geo = () => {
    const box = host?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const start = { x: from.left - box.left, y: from.top - box.top, w: Math.max(18, from.width), h: Math.max(14, from.height) };
    const w = Math.min(box.width - 32, 420); const h = Math.min(box.height - 120, 620);
    const end = { x: (box.width - w) / 2, y: (box.height - h) / 2 + 10, w, h };
    return { start, end };
  };
  const frame = (r, rot, radius) => ({ left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, transform: `rotate(${rot}deg)`, borderRadius: `${radius}px` });
  useLayoutEffect(() => {
    const el = bookRef.current; if (!el) return;
    const { start, end } = geo();
    Object.assign(el.style, frame(end, 0, 10));
    const a = el.animate([frame(start, -14, 3), frame(end, 0, 10)], { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)' });
    dimRef.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, fill: 'both' });
    a.onfinish = () => setShown(true);
  }, []);

  function close() {
    if (closing.current) return; closing.current = true;
    setShown(false);
    const el = bookRef.current; const { start, end } = geo();
    const a = el.animate([frame(end, 0, 10), frame(start, -14, 3)], { duration: 340, easing: 'cubic-bezier(.4, 0, .6, 1)', fill: 'forwards' });
    dimRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' });
    a.onfinish = () => {
      // 放回桌上：最后一下轻轻淡掉，和桌上的本子重合
      const f = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 80, fill: 'forwards' });
      f.onfinish = onClose;
    };
    setTimeout(onClose, 700); // 万一动画事件没来
  }
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    window.__xsjBookClose = close; // 安卓返回键
    return () => { window.removeEventListener('keydown', onKey); if (window.__xsjBookClose === close) window.__xsjBookClose = null; };
  }, []);

  const node = (
    <div className="diarybook-wrap" role="dialog" aria-modal="true" aria-label={`${current.name}的日记本`}>
      <div className="diarybook-dim" ref={dimRef} onClick={close} />
      <div className="diarybook" ref={bookRef}>
        <div className={'diarybook-inner' + (shown ? ' is-shown' : '')}>
          <header className="diarybook-head">
            <b>{current.name}的日记</b>
            <button type="button" className="diarybook-close" onClick={close} aria-label="放回去">×</button>
          </header>
          <div className="diarybook-pages">
            {!entries && <p className="diarybook-empty">翻开中…</p>}
            {entries && !entries.length && <p className="diarybook-empty">日记本还是空的。</p>}
            {entries?.map((e) => (
              <article className="diary-page" key={e.seq}>
                <h2>{dateTitle(e.createdAt)}</h2>
                <p>{e.text}</p>
              </article>
            ))}
          </div>
          <button type="button" className="diarybook-more" onClick={() => { closing.current = true; onClose(); onOpenApp(); }}>在日记软件里看</button>
        </div>
      </div>
    </div>
  );
  return createPortal(node, host || document.querySelector('.phone') || document.body);
}
