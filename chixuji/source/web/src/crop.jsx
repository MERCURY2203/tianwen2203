// 上传图片前自己裁剪：拖动图片选位置，双指捏合 / 滑块缩放，裁剪框比例按用途固定（头像正方形、壁纸手机屏幕比例……）
// 用法：const dataUrl = await cropImage(file, { aspect: 1, size: 512, round: true, title: '裁剪头像' });
//       用户取消时返回 null
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

let open = null; // CropHost 注册的打开函数
export function cropImage(file, opts = {}) {
  if (!file?.type?.startsWith('image/')) return Promise.reject(new Error('请选择图片文件'));
  if (file.size > 30 * 1024 * 1024) return Promise.reject(new Error('图片太大了'));
  if (!open) return Promise.reject(new Error('裁剪工具还没准备好'));
  return new Promise((resolve, reject) => open({ file, opts, resolve, reject }));
}

export function CropHost() {
  const [job, setJob] = useState(null);
  useEffect(() => { open = (j) => setJob(j); return () => { open = null; }; }, []);
  if (!job) return null;
  return <Cropper key={job.file.name + job.file.size + job.file.lastModified} job={job} onEnd={() => setJob(null)} />;
}

function Cropper({ job, onEnd }) {
  const { aspect = 1, size = 512, round = false, title = '裁剪图片', type = 'image/jpeg', quality = 0.88 } = job.opts;
  const stageRef = useRef(null);
  const [bmp, setBmp] = useState(null);
  const [box, setBox] = useState(null); // 裁剪框在屏幕上的大小 { w, h }
  const [t, setT] = useState({ s: 1, x: 0, y: 0 }); // 图片缩放倍数和偏移（相对裁剪框中心）
  const minS = useRef(1);
  const pts = useRef(new Map());
  const g0 = useRef(null);

  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(job.file);
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      // 统一成 { width, height, el } 的样子
      setBmp({ width: img.naturalWidth, height: img.naturalHeight, el: img, url });
    };
    img.onerror = () => { URL.revokeObjectURL(url); job.reject(new Error('这张图片打不开，换一张试试（iPhone 的 HEIC 照片可以先截图再选）')); onEnd(); };
    img.src = url;
    return () => { alive = false; };
  }, []);
  useLayoutEffect(() => {
    if (!bmp || !stageRef.current) return;
    const r = stageRef.current.getBoundingClientRect();
    const maxW = r.width - 32; const maxH = r.height - 32;
    const w = Math.min(maxW, maxH * aspect); const h = w / aspect;
    setBox({ w, h });
    const s = Math.max(w / bmp.width, h / bmp.height); // 刚好铺满裁剪框
    minS.current = s;
    setT({ s, x: 0, y: 0 });
  }, [bmp]);

  // 图片不能拖出裁剪框（不留空白）
  const clamp = (n) => {
    const s = Math.max(minS.current, Math.min(minS.current * 8, n.s));
    const mx = Math.max(0, (bmp.width * s - box.w) / 2); const my = Math.max(0, (bmp.height * s - box.h) / 2);
    return { s, x: Math.max(-mx, Math.min(mx, n.x)), y: Math.max(-my, Math.min(my, n.y)) };
  };
  const mid = () => { const v = [...pts.current.values()]; return v.length > 1 ? { x: (v[0].x + v[1].x) / 2, y: (v[0].y + v[1].y) / 2, d: Math.hypot(v[0].x - v[1].x, v[0].y - v[1].y) || 1 } : { ...v[0], d: 1 }; };
  function down(e) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    g0.current = { ...mid(), t };
  }
  function move(e) {
    if (!pts.current.has(e.pointerId) || !g0.current) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = mid(); const a = g0.current;
    if (pts.current.size > 1 && a.d > 1) {
      // 捏合：以两指中间为中心缩放
      const r = stageRef.current.getBoundingClientRect();
      const cx = r.left + r.width / 2; const cy = r.top + r.height / 2;
      const k = Math.max(minS.current, Math.min(minS.current * 8, a.t.s * (m.d / a.d))) / a.t.s;
      setT(clamp({ s: a.t.s * k, x: (a.x - cx) + (a.t.x - (a.x - cx)) * k + (m.x - a.x), y: (a.y - cy) + (a.t.y - (a.y - cy)) * k + (m.y - a.y) }));
    } else setT(clamp({ s: a.t.s, x: a.t.x + (m.x - a.x), y: a.t.y + (m.y - a.y) }));
  }
  function up(e) {
    pts.current.delete(e.pointerId);
    g0.current = pts.current.size ? { ...mid(), t } : null;
  }
  function wheel(e) { e.preventDefault(); setT(clamp({ ...t, s: t.s * (e.deltaY < 0 ? 1.08 : 0.93) })); }

  // 画出来是不是一片纯白（iPhone 偶尔会画不上去）
  function looksBlank(cv) {
    try {
      const s = document.createElement('canvas'); s.width = 12; s.height = 12;
      const g = s.getContext('2d'); g.drawImage(cv, 0, 0, 12, 12);
      const d = g.getImageData(0, 0, 12, 12).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) return false;
      return true;
    } catch { return false; }
  }
  async function done() {
    // 裁剪框对应到原图上的区域
    let sw = box.w / t.s; let sh = box.h / t.s;
    let sx = bmp.width / 2 - t.x / t.s - sw / 2; let sy = bmp.height / 2 - t.y / t.s - sh / 2;
    // 截取范围必须完全在原图里面：iPhone 的浏览器只要超出一点点就什么都不画（结果是一张白图）
    sw = Math.min(sw, bmp.width); sh = Math.min(sh, bmp.height);
    sx = Math.max(0, Math.min(bmp.width - sw, sx)); sy = Math.max(0, Math.min(bmp.height - sh, sy));
    sx = Math.floor(sx); sy = Math.floor(sy); sw = Math.floor(Math.min(sw, bmp.width - sx)); sh = Math.floor(Math.min(sh, bmp.height - sy));
    const outW = Math.round(Math.min(size, sw * 2)); const outH = Math.round(outW / aspect);
    const cv = document.createElement('canvas'); cv.width = outW; cv.height = outH;
    const g = cv.getContext('2d');
    if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, outW, outH); }
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp.el, sx, sy, sw, sh, 0, 0, outW, outH);
    if (looksBlank(cv)) {
      // 换一种方式再画一次
      try {
        const b2 = await createImageBitmap(job.file);
        g.fillStyle = '#fff'; g.fillRect(0, 0, outW, outH);
        g.drawImage(b2, sx * (b2.width / bmp.width), sy * (b2.height / bmp.height), sw * (b2.width / bmp.width), sh * (b2.height / bmp.height), 0, 0, outW, outH);
      } catch { /* 用第一次的结果 */ }
    }
    const out = cv.toDataURL(type, quality); // 先导出，再释放原图
    URL.revokeObjectURL(bmp.url);
    job.resolve(out);
    onEnd();
  }
  function cancel() { if (bmp) URL.revokeObjectURL(bmp.url); job.resolve(null); onEnd(); }

  const slider = box ? (t.s - minS.current) / (minS.current * 7) : 0;
  return (
    <div className="cropper" role="dialog" aria-modal="true" aria-label={title}>
      <header className="cropper-bar">
        <button type="button" className="text-btn" onClick={cancel}>取消</button>
        <b>{title}</b>
        <button type="button" className="text-btn cropper-ok" onClick={done} disabled={!box}>完成</button>
      </header>
      <div className="cropper-stage" ref={stageRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        {bmp && box && (
          <>
            <img className="cropper-img" src={bmp.url} alt="" draggable={false} style={{ width: bmp.width * t.s, height: bmp.height * t.s, transform: `translate(calc(-50% + ${t.x}px), calc(-50% + ${t.y}px))` }} />
            <div className={'cropper-frame' + (round ? ' is-round' : '')} style={{ width: box.w, height: box.h }} />
          </>
        )}
      </div>
      <div className="cropper-zoom">
        <span aria-hidden="true">－</span>
        <input type="range" min="0" max="1" step="0.01" value={slider} aria-label="缩放"
          onChange={(e) => setT(clamp({ ...t, s: minS.current * (1 + Number(e.target.value) * 7) }))} />
        <span aria-hidden="true">＋</span>
      </div>
      <p className="cropper-tip">拖动图片选位置，双指捏合放大缩小</p>
    </div>
  );
}

// 手机屏幕的宽高比（壁纸、聊天背景按这个比例裁）
export function screenAspect() {
  const el = document.querySelector('.phone');
  const r = el?.getBoundingClientRect();
  return r && r.height ? r.width / r.height : 9 / 19.5;
}
