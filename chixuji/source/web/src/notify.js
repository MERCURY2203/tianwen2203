// 消息提醒的小工具：免打扰判断、提示音、系统通知、提醒文字
const LAST_KEY = 'xsj:notified-seq';

export function lastNotified() {
  try { return Number(localStorage.getItem(LAST_KEY) || 0) || 0; } catch { return 0; }
}
export function setLastNotified(seq) {
  try { localStorage.setItem(LAST_KEY, String(seq)); } catch { /* 无痕模式 */ }
}

const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };
export function inDnd(dnd, d = new Date()) {
  if (!dnd?.on) return false;
  const n = d.getHours() * 60 + d.getMinutes();
  const a = toMin(dnd.start); const b = toMin(dnd.end);
  return a <= b ? n >= a && n < b : n >= a || n < b; // 跨午夜，例如 23:00–08:00
}

export function describe(n) {
  const t = (n.text || '').replace(/\s+/g, ' ');
  const short = t.length > 40 ? t.slice(0, 40) + '…' : t;
  switch (n.type) {
    case 'dm': return { title: n.name, body: short || '发来一条消息' };
    case 'like': return { title: n.name, body: '赞了你的朋友圈' };
    case 'comment': return { title: n.name, body: `评论了你的朋友圈：${short}` };
    case 'reply': return { title: n.name, body: `回复了你的评论：${short}` };
    case 'moment': return { title: n.name, body: `发了一条朋友圈：${short}` };
    case 'diary': return { title: n.name, body: '写了一篇新日记' };
    case 'note': return { title: n.name, body: `在你挂的照片旁钉了一张小纸条` };
    default: return { title: n.name, body: short };
  }
}

// “你不在的时候”汇总
export function summarize(items) {
  const by = new Map();
  for (const n of items) {
    const x = by.get(n.characterId) || { name: n.name, dm: 0, like: 0, comment: 0, moment: 0, diary: 0, note: 0 };
    const k = n.type === 'reply' ? 'comment' : n.type;
    x[k] = (x[k] || 0) + 1;
    by.set(n.characterId, x);
  }
  return [...by.values()].map((x) => {
    const parts = [];
    if (x.dm) parts.push(`给你发了 ${x.dm} 条消息`);
    if (x.comment) parts.push(`评论了 ${x.comment} 次`);
    if (x.like) parts.push(`点了 ${x.like} 个赞`);
    if (x.moment) parts.push(`发了 ${x.moment} 条朋友圈`);
    if (x.diary) parts.push(`写了 ${x.diary} 篇日记`);
    if (x.note) parts.push(`在照片旁钉了 ${x.note} 张纸条`);
    return `${x.name}${parts.join('，')}`;
  }).join('；');
}

// 提示音：用浏览器自己合成一声“叮”，不需要音频文件
let ctx = null;
export function ding() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.09]]) {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.35);
      o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.4);
    }
  } catch { /* 不支持就算了 */ }
}

// 安卓 App 里没有网页通知，改用 App 自己的系统通知（window.XSJNative）
const native = () => (typeof window !== 'undefined' ? window.XSJNative : null);
export const canSystemNotify = () => typeof window !== 'undefined' && (!!native() || 'Notification' in window);
export function notifyPermission() {
  if (native()) return native().notifyPermission();
  return typeof Notification !== 'undefined' ? Notification.permission : 'unsupported';
}
export function requestNotifyPermission() {
  if (native()) {
    return new Promise((resolve) => { window.__xsjNotifyPermission = (p) => { window.__xsjNotifyPermission = null; resolve(p); }; native().requestNotifyPermission(); });
  }
  return Notification.requestPermission();
}
// App 在后台 / 网页标签被切走
export const appHidden = () => document.visibilityState === 'hidden' || !!window.__xsjAppHidden;
export function systemNotify(title, body, onClick) {
  if (native()) { try { return native().notify(String(title), String(body)); } catch { return false; } }
  if (!canSystemNotify() || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title, { body, icon: 'icon-192.png', tag: 'xsj-' + title });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
    return true;
  } catch { return false; } // 部分手机浏览器只能通过 Service Worker 弹，失败就算了
}
