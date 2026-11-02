// 和服务器通信的小工具
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-xsj': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, '连不上服务器，请检查网络');
  }
  let data = {};
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (!res.ok) throw new ApiError(res.status, data.error || `出错了（${res.status}）`, data);
  return data;
}

export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u, b = {}) => api('DELETE', u, b);

// 服务器版：图片直接用网址
export const IS_LOCAL = false;
export function useImageSrc(id, local) {
  return local || (id ? `/api/images/${id}` : null);
}
// 备份功能只在纯前端版里有
export async function getAudioBlob() { return null; }
export async function exportBackup() { throw new Error('服务器版不支持'); }
export async function importBackup() { throw new Error('服务器版不支持'); }
export async function resetAll() { throw new Error('服务器版不支持'); }

// 卡密只在纯前端版里用
export const LICENSE_ENABLED = false;
export async function ensureLicense() { return { ok: true }; }
export async function activateLicense() { return true; }
export function licenseInfo() { return null; }
