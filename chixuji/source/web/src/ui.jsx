// 共用的小部件
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLayerHost } from './motion.jsx';

export function TopBar({ title, onBack, right, sub }) {
  return (
    <header className="topbar">
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="返回">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      ) : <span className="icon-btn-spacer" />}
      <div className="topbar-title">
        <h1>{title}</h1>
        {sub}
      </div>
      <div className="topbar-right">{right || <span className="icon-btn-spacer" />}</div>
    </header>
  );
}

// 红线：显示当前世界线
export function Thread({ name, onClick, archived }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag className={'thread' + (archived ? ' is-archived' : '')} onClick={onClick}>
      <svg viewBox="0 0 28 10" width="28" height="10" aria-hidden="true"><path d="M1 5c5-5 8 5 13 0s8-5 13 0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      <span>{name}{archived ? '（已归档）' : ''}</span>
    </Tag>
  );
}

export function Avatar({ name, color, url, size = 40 }) {
  if (url) return <img className="avatar avatar-img" src={url} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="avatar" style={{ background: color, width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {(name || '?').slice(0, 1)}
    </span>
  );
}

// 打开着的弹窗（安卓返回键用来关最上面那个）
const openSheets = [];
export function closeTopSheet() {
  const top = openSheets[openSheets.length - 1];
  if (!top) return false;
  top.current();
  return true;
}
export function Sheet({ open, onClose, title, children }) {
  const ref = useRef(null);
  const layerHost = useLayerHost();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    openSheets.push(closeRef);
    return () => { const i = openSheets.indexOf(closeRef); if (i >= 0) openSheets.splice(i, 1); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
    if (coarse) ref.current?.focus({ preventScroll: true });
    else ref.current?.querySelector('input, textarea, button')?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // 关闭时先播放收起动画，再真正移除；动画期间显示关闭前的内容
  const [closing, setClosing] = useState(false);
  const last = useRef(null);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      setClosing(true);
      const t = setTimeout(() => setClosing(false), 260);
      wasOpen.current = open;
      return () => clearTimeout(t);
    }
    wasOpen.current = open;
    if (open) setClosing(false);
    return undefined;
  }, [open]);
  if (open) last.current = { title, children };
  const justClosed = wasOpen.current && !open; // 刚关上的这一帧，效果还没跑到
  if (!open && !closing && !justClosed) return null;
  const shown = open ? { title, children } : last.current || { title, children };
  // 弹窗渲染到手机外框的最外层，避免被包在别的表单里
  const host = layerHost || document.querySelector('.phone') || document.body;
  return createPortal(
    <div className={`sheet-backdrop${open ? '' : ' is-closing'}`} onClick={open ? onClose : undefined}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={shown.title} ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        {shown.title && <h2 className="sheet-title">{shown.title}</h2>}
        {shown.children}
      </div>
    </div>,
    host,
  );
}

// 按钮：busy 时显示处理中并禁用，防止重复点击
// 选图片的按钮：实心、带一个图片小图标
export function PickButton({ children, busy, ...rest }) {
  return (
    <button type="button" className="btn btn-primary btn-pick" disabled={busy || rest.disabled} {...rest}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="9" cy="10" r="1.7" fill="currentColor" /><path d="M4.5 17l5-5 4 4 2.5-2.5 3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
      <span>{busy ? '处理中…' : children}</span>
    </button>
  );
}

export function Button({ busy, children, kind = 'primary', ...rest }) {
  return (
    <button className={`btn btn-${kind}`} disabled={busy || rest.disabled} {...rest}>
      {busy ? '处理中…' : children}
    </button>
  );
}

let toastSetter = null;
export function toast(msg) { toastSetter?.(msg); }
export function ToastHost() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    toastSetter = (m) => setMsg({ m, k: Date.now() });
    return () => (toastSetter = null);
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast" role="status" key={msg.k}>{msg.m}</div> : null;
}

export function useAsync(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ loading: false, data: await fn(), error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  };
  useEffect(() => { reload(); }, deps);
  return { ...state, reload };
}

export function Loading({ text = '加载中…' }) {
  return <div className="loading">{text}</div>;
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="error-box">
      <p>{error?.message || '出错了'}</p>
      {onRetry && <button className="btn btn-ghost" onClick={onRetry}>重试</button>}
    </div>
  );
}

export function fmtTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === today.toDateString()) return hm;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}
