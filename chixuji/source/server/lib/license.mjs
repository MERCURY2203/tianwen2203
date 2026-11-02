// 卡密签名：服务器用私钥签发“激活凭证”，纯前端版用公钥验证。
// 私钥只放在服务器电脑的 data/license-private.pem，永远不要发给别人。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TOKEN_DAYS = 30; // 凭证有效期；联网时会自动续期

const b64u = (buf) => Buffer.from(buf).toString('base64url');

export function loadLicenseKey(dataDir, rootDir) {
  const file = path.join(dataDir, 'license-private.pem');
  if (!fs.existsSync(file)) {
    // 更新包里可以带一把预先生成的私钥（放在根目录），第一次启动时搬进 data/
    const shipped = rootDir && path.join(rootDir, 'license-private.pem');
    if (shipped && fs.existsSync(shipped)) {
      fs.copyFileSync(shipped, file);
      fs.rmSync(shipped, { force: true });
    } else {
      const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      fs.writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
  }
  const privateKey = crypto.createPrivateKey(fs.readFileSync(file));
  const publicKey = crypto.createPublicKey(privateKey);
  const jwk = publicKey.export({ format: 'jwk' });
  return { privateKey, publicKey, publicJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

export function signToken(key, payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(body), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${body}.${b64u(sig)}`;
}

export function verifyToken(key, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const ok = crypto.verify('sha256', Buffer.from(body), { key: key.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  if (!ok) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}

// 卡密格式：XSJ-XXXX-XXXX-XXXX（去掉容易看混的字符）
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newLicenseCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[crypto.randomInt(0, ALPHABET.length)]).join('');
  return `XSJ-${part()}-${part()}-${part()}`;
}
export function normalizeCode(s) {
  const raw = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const core = raw.startsWith('XSJ') ? raw.slice(3) : raw;
  if (core.length !== 12) return null;
  return `XSJ-${core.slice(0, 4)}-${core.slice(4, 8)}-${core.slice(8, 12)}`;
}
