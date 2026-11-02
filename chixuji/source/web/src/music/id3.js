// 读 mp3 文件里自带的信息（ID3v2.2 / 2.3 / 2.4）：歌名、歌手、专辑、作词、作曲、封面、歌词
// 只读文件开头一段，不需要整首歌

const syncsafe = (b, i) => ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
const be32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const be24 = (b, i) => (b[i] << 16) + (b[i + 1] << 8) + b[i + 2];

function decodeStr(bytes, enc) {
  try {
    if (enc === 0) {
      // 规定是 Latin-1，但中文 mp3 常常直接塞 GBK
      try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* */ }
      if (bytes.some((x) => x > 0x7f)) { try { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); } catch { /* */ } }
      return new TextDecoder('latin1').decode(bytes);
    }
    if (enc === 1) return new TextDecoder('utf-16').decode(bytes);
    if (enc === 2) return new TextDecoder('utf-16be').decode(bytes);
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return ''; }
}
const strip = (s) => s.replace(/\u0000+$/g, '').replace(/^﻿/, '').trim();
// 找字符串结尾（单字节编码一个 0，双字节编码两个 0 并且对齐）
function termEnd(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  const i = b.indexOf(0, start);
  return i < 0 ? b.length : i;
}
const termLen = (enc) => (enc === 1 || enc === 2 ? 2 : 1);

function unsync(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) { out.push(b[i]); if (b[i] === 0xff && b[i + 1] === 0x00) i++; }
  return new Uint8Array(out);
}

export async function readTags(file) {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null; // 不是 ID3
  const ver = head[3];
  const flags = head[5];
  const size = syncsafe(head, 6);
  let b = new Uint8Array(await file.slice(10, 10 + Math.min(size, 20 * 1024 * 1024)).arrayBuffer());
  if (flags & 0x80 && ver < 4) b = unsync(b);
  let p = 0;
  if (flags & 0x40) p = ver === 4 ? syncsafe(b, 0) : be32(b, 0) + 4; // 扩展头
  const out = {};
  const v22 = ver === 2;
  const idLen = v22 ? 3 : 4;
  const hdrLen = v22 ? 6 : 10;
  while (p + hdrLen <= b.length) {
    const id = String.fromCharCode(...b.subarray(p, p + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // 到了填充区
    const fsize = v22 ? be24(b, p + 3) : ver === 4 ? syncsafe(b, p + 4) : be32(b, p + 4);
    const fflags = v22 ? 0 : b[p + 9];
    let data = b.subarray(p + hdrLen, p + hdrLen + fsize);
    p += hdrLen + fsize;
    if (!fsize || fsize > b.length) continue;
    if (ver === 4 && fflags & 0x02) data = unsync(data);
    if (ver === 4 && fflags & 0x01) data = data.subarray(4); // 带长度标记
    if (fflags & 0x0c) continue; // 压缩 / 加密的不管
    try { frame(id, data, out); } catch { /* 一帧坏了不影响别的 */ }
  }
  return out;
}

const TEXT = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TCOM: 'composer', TCM: 'composer', TEXT: 'lyricist', TXT: 'lyricist', TPE3: 'arranger', TP3: 'arranger', TLEN: 'length', TLE: 'length' };

function frame(id, d, out) {
  if (TEXT[id]) {
    const v = strip(decodeStr(d.subarray(1), d[0])).split('\u0000')[0].trim();
    if (v && !out[TEXT[id]]) out[TEXT[id]] = v;
    return;
  }
  if (id === 'TIPL' || id === 'IPLS') { // 参与人员：找「制作人」
    const parts = strip(decodeStr(d.subarray(1), d[0])).split('\u0000');
    for (let i = 0; i + 1 < parts.length; i += 2) if (/produc/i.test(parts[i]) && parts[i + 1] && !out.producer) out.producer = parts[i + 1].trim();
    return;
  }
  if (id === 'APIC' || id === 'PIC') {
    if (out.cover) return;
    const enc = d[0];
    let i = 1;
    let mime;
    if (id === 'PIC') { const f = String.fromCharCode(...d.subarray(1, 4)).toLowerCase(); mime = f === 'png' ? 'image/png' : 'image/jpeg'; i = 4; }
    else { const e = d.indexOf(0, 1); mime = String.fromCharCode(...d.subarray(1, e)) || 'image/jpeg'; i = e + 1; }
    i += 1; // 图片类型
    i = termEnd(d, i, enc) + termLen(enc); // 描述
    if (!/^image\//.test(mime)) mime = 'image/' + (mime.replace(/[^a-z]/gi, '') || 'jpeg').toLowerCase();
    out.cover = new Blob([d.slice(i)], { type: mime === 'image/jpg' ? 'image/jpeg' : mime });
    return;
  }
  if (id === 'USLT' || id === 'ULT') {
    if (out.lyricsText) return;
    const enc = d[0];
    const i = termEnd(d, 4, enc) + termLen(enc); // 语言 3 字节 + 描述
    const v = strip(decodeStr(d.subarray(i), enc));
    if (v) out.lyricsText = v;
    return;
  }
  if (id === 'SYLT' || id === 'SLT') {
    if (out.syncedLyrics) return;
    const enc = d[0];
    const unit = d[4]; // 1 = 帧数，2 = 毫秒
    if (unit !== 2) return;
    let i = termEnd(d, 6, enc) + termLen(enc); // 描述
    const lines = [];
    while (i < d.length) {
      const e = termEnd(d, i, enc);
      const text = strip(decodeStr(d.subarray(i, e), enc));
      i = e + termLen(enc);
      if (i + 4 > d.length) break;
      const ms = be32(d, i); i += 4;
      lines.push({ t: ms / 1000, text: text.replace(/^[\r\n]+/, '') });
    }
    if (lines.length) out.syncedLyrics = lines;
  }
}
