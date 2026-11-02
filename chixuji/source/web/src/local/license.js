// 纯前端版的卡密激活：
// 1) 第一次用：输入卡密 → 联网到卖家的服务器激活 → 拿到一张“激活凭证”（服务器私钥签名）
// 2) 以后打开：用内置的公钥在本机验证凭证，不用联网
// 3) 每隔几天联网检查一次（顺便续期）；卡密被停用就要求重新激活
/* global __XSJ_LICENSE__ */
const CFG = typeof __XSJ_LICENSE__ !== 'undefined' ? __XSJ_LICENSE__ : null;
const KEY = 'xsj-license';
const CHECK_EVERY = 3 * 86400e3;

export const LICENSE_ENABLED = !!(CFG && CFG.server && CFG.publicKey);
let state = !LICENSE_ENABLED;
export const licensed = () => state;

function readLocal() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function writeLocal(v) {
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* 隐私模式 */ }
}

export function deviceId() {
  const cur = readLocal();
  if (cur.device) return cur.device;
  const d = (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));
  writeLocal({ ...cur, device: d });
  return d;
}

const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function verifySignature(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(fromB64u(body))); } catch { return null; }
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return { payload, unverified: true }; // 非 https 网址下浏览器不给验签，只能靠联网检查
  const key = await subtle.importKey('jwk', { ...CFG.publicKey, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64u(sig), new TextEncoder().encode(body));
  return ok ? { payload } : null;
}

async function call(path, body) {
  let res;
  try {
    res = await fetch(CFG.server.replace(/\/$/, '') + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    const e = new Error('连不上激活服务器，请检查网络后再试'); e.offline = true; throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || '激活失败'); e.reason = data.reason; e.status = res.status; throw e; }
  return data;
}

// 返回 { ok: true } 或 { ok: false, message }
export async function checkLicense() {
  const r = await doCheck();
  state = !LICENSE_ENABLED || r.ok;
  return r;
}
async function doCheck() {
  if (!LICENSE_ENABLED) return { ok: true };
  const cur = readLocal();
  const dev = deviceId();
  const v = cur.token ? await verifySignature(cur.token) : null;
  const p = v?.payload;
  const valid = p && p.d === dev && p.exp * 1000 > Date.now();
  const due = !cur.checkedAt || Date.now() - cur.checkedAt > CHECK_EVERY || v?.unverified;
  if (valid && !due) return { ok: true };
  if (!cur.token) return { ok: false };
  // 该联网检查了
  try {
    const r = await call('/api/license/check', { token: cur.token });
    const again = await verifySignature(r.token);
    if (!again || again.payload.d !== dev) return { ok: false, message: '激活信息不正确，请重新输入卡密' };
    writeLocal({ ...readLocal(), token: r.token, checkedAt: Date.now() });
    return { ok: true };
  } catch (e) {
    if (e.offline || e.status >= 500 || e.status === 429) {
      // 暂时连不上：凭证还没过期就先让用
      if (valid && !v.unverified) return { ok: true };
      return { ok: false, message: e.offline ? '需要联网验证一次卡密，请连上网络后刷新' : e.message };
    }
    writeLocal({ device: dev });
    return { ok: false, message: e.message };
  }
}

export async function activate(code) {
  const dev = deviceId();
  const r = await call('/api/license/activate', { code, deviceId: dev });
  const v = await verifySignature(r.token);
  if (!v || v.payload.d !== dev) throw new Error('激活信息不正确，请联系卖家');
  writeLocal({ device: dev, token: r.token, checkedAt: Date.now(), code: String(code).trim().toUpperCase().slice(0, 8) + '…' });
  state = true;
  return true;
}

export function licenseInfo() {
  const cur = readLocal();
  if (!LICENSE_ENABLED || !cur.token) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64u(cur.token.split('.')[0])));
    return { codeHint: cur.code || '', expiresAt: new Date(p.exp * 1000).toISOString(), checkedAt: cur.checkedAt ? new Date(cur.checkedAt).toISOString() : null };
  } catch { return null; }
}
