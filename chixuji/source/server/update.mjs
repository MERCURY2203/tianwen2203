// 自动更新：启动时如果「小手机」文件夹里有「更新包.zip」，就把里面的程序文件装上。
// 不会动 data 文件夹（你的数据）和 .env（你的设置和密钥）。
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PROTECTED = (name) => name === '.env' || name.startsWith('data/') || name === 'data';

export function readZipEntries(buf) {
  // 从文件末尾找“中央目录结束”记录
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 目录损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`不支持的压缩方式：${name}`);
    entries.push({ name, data });
  }
  return entries;
}

export function applyUpdates(root, log = console) {
  const zips = fs.readdirSync(root).filter((f) => /^更新包.*\.zip$/i.test(f)).sort();
  for (const z of zips) {
    const file = path.join(root, z);
    try {
      const entries = readZipEntries(fs.readFileSync(file));
      let n = 0;
      for (const e of entries) {
        const clean = path.posix.normalize(e.name).replace(/^\/+/, '');
        if (clean.startsWith('..') || path.isAbsolute(clean) || PROTECTED(clean)) continue;
        const target = path.join(root, ...clean.split('/'));
        if (!target.startsWith(root)) continue;
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, e.data);
        n++;
      }
      fs.unlinkSync(file);
      log.log(`  ✔ 已安装更新「${z}」（${n} 个文件），你的数据和设置没有变动`);
    } catch (err) {
      log.log(`  ✘ 更新「${z}」安装失败：${err.message}。程序会用原来的版本继续运行。`);
    }
  }
}
