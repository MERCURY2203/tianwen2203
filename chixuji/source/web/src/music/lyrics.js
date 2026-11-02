// 歌词：读文件（自动认 UTF-8 / GBK / UTF-16）、认格式（LRC / SRT / VTT / 纯文字）、解析成统一的样子
// 统一格式：{ timed: true|false, lines: [{ t: 秒（纯文字为 null）, text }] }

// 文字文件的编码：中文歌词很多是 GBK，按顺序试
export function decodeText(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); } catch { /* 不是 UTF-8 */ }
  for (const enc of ['gb18030', 'gbk', 'big5']) {
    try { return new TextDecoder(enc, { fatal: true }).decode(u8); } catch { /* 下一个 */ }
  }
  return new TextDecoder('utf-8').decode(u8);
}

const clean = (s) => s.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();

export function detectFormat(text, filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (/^\s*WEBVTT/.test(text)) return 'vtt';
  if (/\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text)) return ext === 'vtt' ? 'vtt' : 'srt';
  if (/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(text)) return 'lrc';
  if (ext === 'lrc') return 'lrc';
  return 'txt';
}

// LRC：[mm:ss.xx] 一行可以有多个时间；[offset:+/-毫秒]；逐字时间 <mm:ss.xx> 去掉
function parseLrc(text) {
  let offset = 0;
  const out = [];
  const info = {};
  for (const raw of text.split(/\r?\n/)) {
    const tag = raw.match(/^\s*\[(ti|ar|al|by|offset|au|length|re|ve):(.*)\]\s*$/i);
    if (tag) {
      const k = tag[1].toLowerCase();
      if (k === 'offset') offset = (Number(tag[2]) || 0) / 1000;
      else info[k] = tag[2].trim();
      continue;
    }
    const times = [];
    let rest = raw;
    let m;
    while ((m = rest.match(/^\s*\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/))) {
      const sec = Number(m[2].replace(':', '.'));
      times.push(Number(m[1]) * 60 + sec);
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue;
    const line = clean(rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, ''));
    for (const t of times) out.push({ t: Math.max(0, t - offset), text: line }); // offset 为正：歌词提前出现
  }
  out.sort((a, b) => a.t - b.t);
  // 同一时间的两行（常见的「原文 + 翻译」）合成一行
  const merged = [];
  for (const l of out) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.t - l.t) < 0.01 && l.text) last.text = last.text ? `${last.text}\n${l.text}` : l.text;
    else merged.push({ ...l });
  }
  return { lines: merged, info };
}

const ts = (h, m, s, ms) => Number(h || 0) * 3600 + Number(m) * 60 + Number(s) + Number((ms || '0').padEnd(3, '0')) / 1000;
// SRT / VTT：时间 --> 时间，下面是一到多行文字
function parseCues(text) {
  const out = [];
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  for (const b of blocks) {
    const rows = b.split('\n');
    const i = rows.findIndex((r) => r.includes('-->'));
    if (i < 0) continue;
    const m = rows[i].match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/);
    if (!m) continue;
    const line = clean(rows.slice(i + 1).join('\n').replace(/\n/g, '\u0000')).replace(/\u0000/g, '\n');
    if (line) out.push({ t: ts(m[1], m[2], m[3], m[4]), text: line });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function parseLyrics(text, filename = '') {
  const fmt = detectFormat(text, filename);
  let lines = [];
  if (fmt === 'lrc') lines = parseLrc(text).lines;
  else if (fmt === 'srt' || fmt === 'vtt') lines = parseCues(text);
  else lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ t: null, text: l }));
  lines = lines.filter((l) => l.text || l.t !== null).slice(0, 600).map((l) => ({ t: l.t === null ? null : Math.round(l.t * 100) / 100, text: l.text.slice(0, 200) }));
  const timed = fmt !== 'txt' && lines.some((l) => l.t !== null);
  return { format: fmt, timed, lines };
}

export const FORMAT_NAMES = { lrc: 'LRC 滚动歌词', srt: 'SRT 字幕', vtt: 'VTT 字幕', txt: '纯文字歌词', id3: '歌曲文件自带的歌词' };

// 当前播到第几行（带时间的歌词）
export function lineAt(lines, t) {
  let i = -1;
  for (let k = 0; k < lines.length; k++) { if (lines[k].t !== null && lines[k].t <= t + 0.15) i = k; else if (lines[k].t > t) break; }
  return i;
}

// 给 AI 看的歌词：带时间就写上时间
export function lyricsForPrompt(lyrics, max = 1600) {
  if (!lyrics?.lines?.length) return '';
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const text = lyrics.lines.filter((l) => l.text).map((l) => (l.t !== null ? `[${fmt(l.t)}] ` : '') + l.text.replace(/\n/g, ' / ')).join('\n');
  return text.length > max ? text.slice(0, max) + '\n…' : text;
}
