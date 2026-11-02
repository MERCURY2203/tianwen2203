// 纯前端版的 api.js：和服务器版同样的用法，但所有请求都在浏览器里处理
import { useEffect, useState } from 'react';
import { HttpError } from '../../../server/lib/http.mjs';
import { Store, idbAdapter, TABLES } from './store.js';
import { createModel } from './model.js';
import { createRouter } from './router.js';
import { activate, checkLicense, LICENSE_ENABLED, licenseInfo } from './license.js';

export { LICENSE_ENABLED, licenseInfo };
let licenseOk = !LICENSE_ENABLED;
export async function ensureLicense() {
  const r = await checkLicense();
  licenseOk = r.ok;
  return r;
}
export async function activateLicense(code) {
  await activate(code);
  licenseOk = true;
  return true;
}

export const IS_LOCAL = true;

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let ready = null;
let ctx = null;

export function initLocal(adapter = idbAdapter()) {
  if (ready) return ready;
  ready = (async () => {
    const s = new Store(adapter);
    await s.load();
    // 保存失败（多半是手机存储空间不够）：提醒用户，数据还在，会自动重试
    let lastWarn = 0;
    s.onSaveError = (err) => {
      console.error('保存失败', err);
      if (Date.now() - lastWarn < 60e3 || typeof window === 'undefined') return;
      lastWarn = Date.now();
      const full = /quota|space|full/i.test(`${err?.name} ${err?.message}`);
      window.dispatchEvent(new CustomEvent('xsj:save-error', { detail: full
        ? '保存失败：手机存储空间不够了。请清理一些空间或导出备份，先别关掉迟叙机'
        : '保存失败，正在自动重试。请先别关掉迟叙机' }));
    };
    // 头像不多，启动时一次性读出来
    const avatarCache = new Map();
    for (const a of s.t.avatars) avatarCache.set(a.id, await s.getBlob(a.id));
    let getSettings = () => ({});
    const model = createModel(s, () => getSettings());
    const { router, modelSettings } = createRouter({ s, model, avatarCache });
    getSettings = modelSettings;
    // 尽量让浏览器不要自动清理这里的数据
    try { await navigator.storage?.persist?.(); } catch { /* 不支持 */ }
    // 关闭或切走页面前把还没保存的改动存好
    if (typeof window !== 'undefined') {
      const save = () => { s.flush(); };
      window.addEventListener('pagehide', save);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    }
    ctx = { s, router, model };
    return ctx;
  })();
  return ready;
}

export async function api(method, url, body) {
  if (!licenseOk) throw new ApiError(403, '请先激活卡密');
  const { s, router } = await initLocal();
  const u = new URL(url, 'http://local');
  const match = router.match(method, u.pathname);
  if (!match || match.methodNotAllowed) throw new ApiError(404, '没有这个功能');
  try {
    const result = await match.handler({ params: match.params, query: u.searchParams, body: body || {}, setHeader() {} });
    s.flush();
    // 返回一份拷贝，避免界面改到内部数据
    return JSON.parse(JSON.stringify(result ?? { ok: true }));
  } catch (err) {
    s.flush();
    if (err instanceof HttpError) throw new ApiError(err.status, err.message, { error: err.message, ...err.extra });
    console.error(err);
    throw new ApiError(500, '出错了：' + (err?.message || err));
  }
}

export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u, b = {}) => api('DELETE', u, b);

// 音乐：歌曲文件直接从本机存储读（不经过 api()，那里会把内容转成文字）
export async function getAudioBlob(trackId) {
  const { s } = await initLocal();
  return s.getBlob('music:audio:' + trackId);
}

// 聊天里的图片：从本机存储读出来
export function useImageSrc(id, local) {
  const [src, setSrc] = useState(local || null);
  useEffect(() => {
    if (local || !id) return undefined;
    let alive = true;
    initLocal().then(({ s }) => s.getBlob(id)).then((v) => { if (alive) setSrc(v || null); });
    return () => { alive = false; };
  }, [id, local]);
  return src;
}

// —— 备份：导出成一个文件 / 从文件恢复 ——
export async function exportBackup({ includeKeys = false } = {}) {
  const { s } = await initLocal();
  await s.flush();
  const tables = JSON.parse(JSON.stringify(s.t));
  if (!includeKeys) {
    const m = tables.meta.find((x) => x.key === 'modelSettings');
    if (m) m.value = { ...m.value, apiKey: '', auxApiKey: '' };
  }
  const blobs = {};
  // 歌曲文件太大，不放进备份（歌曲信息、歌词、封面会备份）；恢复后在「音乐」里重新选文件就行
  for (const id of await s.allBlobIds()) if (!String(id).startsWith('music:audio:')) blobs[id] = await s.getBlob(id);
  return { format: 'xiaoshouji-backup', version: 1, exportedAt: new Date().toISOString(), seq: s.seq, tables, blobs };
}

export async function importBackup(data, adapter = null) {
  if (!data || data.format !== 'xiaoshouji-backup' || !data.tables) throw new Error('这不是迟叙机的备份文件');
  const { s } = await initLocal();
  const keepSettings = s.t.meta.find((x) => x.key === 'modelSettings')?.value;
  // 先等正在进行的保存结束，再停止写入，免得内存里的旧数据盖掉刚导入的
  await s.flush();
  s.freeze();
  await s.saving;
  try {
    await importInto(adapter || s.adapter, data, keepSettings);
  } catch (err) {
    // 导入没成功：本机原来的数据没被动过，恢复正常保存，继续使用
    s.frozen = false;
    throw err;
  }
}

// 顺序很重要：先放新图片 → 再一次性换掉全部表格 → 最后删掉用不到的旧图片。
// 中途出错（比如空间不够）时，原来的聊天记录还完整保留。
async function importInto(target, data, keepSettings) {
  const pairs = TABLES.map((n) => [n, Array.isArray(data.tables[n]) ? data.tables[n] : []]);
  // 备份里没有密钥时，保留当前设备上已经填好的密钥
  const meta = pairs.find(([n]) => n === 'meta')[1];
  const m = meta.find((x) => x.key === 'modelSettings');
  if (keepSettings && m && !m.value.apiKey) m.value = { ...m.value, apiKey: keepSettings.apiKey, auxApiKey: keepSettings.auxApiKey };
  const blobs = data.blobs || {};
  const oldIds = await target.allBlobIds();
  for (const [id, v] of Object.entries(blobs)) await target.putBlob(id, v);
  await target.saveTables(pairs, data.seq || 0);
  // 本机的歌曲文件不在备份里，留着（恢复后同一首歌还能接着播）
  for (const id of oldIds) if (!(id in blobs) && !String(id).startsWith('music:audio:')) await target.deleteBlob(id).catch(() => {});
}

export async function resetAll() {
  const { s } = await initLocal();
  s.freeze();
  await s.saving;
  await s.adapter.clearAll();
}
