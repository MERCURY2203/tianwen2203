// 自己画的像素小人：在“白板小人”上一格一格涂色
// 三个面：front 正面 / back 背面 / side 侧面（朝右）。没画的面在房间里用正面代替。
// 一个面 = W×H 个格子，每格：null=白板原样，'_'=挖空（透明），'#rrggbb'=涂的颜色
// 白板小人照设计稿「AVATAR BASE」画成：大圆头、耳朵、豆豆眼、圆手、大鞋子
export const W = 40;
export const H = 74;
export const VIEWS = ['front', 'back', 'side'];
export const VIEW_NAME = { front: '正面', back: '背面', side: '侧面' };
export const CLEAR = '_';
export const DEFAULT_OUTLINE = '#3a3034';
const SOFT_OUTLINE = '#b9aea6'; // 关掉“描边”时，白板的线变成淡淡的
const BASE_FILL = '#f9f0e4';
const BASE_SHADE = '#e9dccb';
const EYE = '#2a2226';

// —— 白板小人的像素稿 ——
// '.' 空白  '#' 外轮廓  'l' 里面的线（手臂、鞋口、耳朵）  'e' 眼睛  'm' 嘴  's' 阴影（下巴下面）  ' ' 皮肤
// 正面只画左半边，右半边左右翻过来；背面 = 正面去掉五官
const FRONT_HALF = [
  "............######",
  ".........###      ",
  ".......##         ",
  "......#           ",
  ".....#            ",
  "....#             ",
  "....#             ",
  "...#              ",
  "...#              ",
  "...#              ",
  "...#              ",
  "..#               ",
  "..#               ",
  "..#               ",
  "..#               ",
  "..#               ",
  ".##               ",
  "#  l              ",
  "#  l              ",
  "#  l    ee        ",
  "#  l    ee        ",
  "#  l    ee        ",
  ".##     ee        ",
  "..#               ",
  "..#              m",
  "...#              ",
  "....#             ",
  ".....##           ",
  ".......##         ",
  ".........#####ssss",
  ".............#ss  ",
  ".........####     ",
  "........#         ",
  ".......#          ",
  ".......#          ",
  "......#           ",
  "......#           ",
  "......#           ",
  ".....#            ",
  "....#             ",
  "....#             ",
  "...#              ",
  "...#     l        ",
  "..#      l        ",
  "..#      l        ",
  ".#       l        ",
  ".#      l         ",
  "#       l         ",
  "#       l         ",
  "#       l         ",
  "#       l        l",
  ".#     ##        l",
  ".#    #.#        l",
  "..####..#        #",
  ".......#        #.",
  ".......#        #.",
  ".......#        #.",
  ".......#        #.",
  ".......#        #.",
  "......#         #.",
  "......#         #.",
  "......#         #.",
  "......#         #.",
  "......#         #.",
  "....###lllllllll#.",
  "...#            #.",
  "...#            #.",
  "...#            #.",
  "...#            #.",
  "....############..",
];
const SIDE_ART = [
  "...........##########.........",
  "........###          ###......",
  "......##                ##....",
  ".....#                    #...",
  "....#                     #...",
  "...#                       #..",
  "..#                         #.",
  "..#                         #.",
  ".#                          #.",
  ".#                           #",
  ".#                           #",
  "#                            #",
  "#                            #",
  "#                            #",
  "#                            #",
  "#                            #",
  "#                            #",
  "#          lll               #",
  "#         l   l              #",
  "#        l  s  l       ee    #",
  ".#       l  s  l       ee   #.",
  ".#       l     l       ee   #.",
  "..#       l   l        ee    #",
  "..#        lll               #",
  "..#                          #",
  "...#                         #",
  "....#                       #.",
  ".....#                     #..",
  "......###                ##...",
  ".........###ssssss########....",
  "............#ssssss#..........",
  "...........#        #.........",
  "..........#  ll      #........",
  "..........# l  l     #........",
  ".........#  l   l     #.......",
  ".........#  l    l    #.......",
  ".........#  l    l    #.......",
  ".........#  l    l     #......",
  "........#   l    l     #......",
  "........#   l    l     #......",
  "........#   l    l     #......",
  "........#   l    l      #.....",
  "........#   l    l      #.....",
  ".......#   l     l      #.....",
  ".......#   l     l      #.....",
  ".......#   l     l      #.....",
  ".......#   l     l      #.....",
  ".......#   l     l      #.....",
  "........#  l     l      #.....",
  "........#  l     l      #.....",
  ".........# l     l     #......",
  ".........# l     l     #......",
  ".........#  l   l      #......",
  ".........#   lll       #......",
  ".........#            #.......",
  ".........#            #.......",
  "........#            #........",
  "........#            #........",
  "........#            #........",
  "........#            #........",
  "........#           #.........",
  "........#           #.........",
  ".......#            #.........",
  ".......#             #........",
  ".......#llllllllllllll##......",
  "......#                 #.....",
  "......#                  #....",
  "......#                  #....",
  "......#                  #....",
  ".......##################.....",
];

const OX = { front: 2, back: 2, side: 5 }; // 每一面放在画布里的位置（左右居中，头顶留 3 格给头发）
const OY = 3;
const FRONT_ART = FRONT_HALF.map((r) => r + [...r].reverse().join(''));
const ART = {
  front: FRONT_ART,
  back: FRONT_ART.map((r) => r.replace(/[em]/g, ' ')),
  side: SIDE_ART,
};

// 每一格的种类：null 空白 / 'L' 线 / 'E' 五官 / 'F' 皮肤 / 'S' 阴影皮肤
function kindsOf(view) {
  const k = new Array(W * H).fill(null);
  ART[view].forEach((row, y) => [...row].forEach((ch, x) => {
    const i = (y + OY) * W + x + OX[view];
    k[i] = ch === '.' ? null : ch === '#' || ch === 'l' ? 'L' : ch === 'e' || ch === 'm' ? 'E' : ch === 's' ? 'S' : 'F';
  }));
  return k;
}
export const KINDS = Object.fromEntries(VIEWS.map((v) => [v, kindsOf(v)]));

const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// 贴着外轮廓的那一圈皮肤稍微暗一点，看起来圆润有体积（涂了颜色也保留）
function rimOf(view) {
  const k = KINDS[view]; const art = ART[view];
  const rim = new Uint8Array(W * H);
  const outer = (x, y) => { const lx = x - OX[view]; const ly = y - OY; return art[ly]?.[lx] === '#'; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (k[i] !== 'F') continue;
    if (NB.some(([dx, dy]) => outer(x + dx, y + dy))) rim[i] = 1;
  }
  return rim;
}
const RIM = Object.fromEntries(VIEWS.map((v) => [v, rimOf(v)]));

// 部位（看不见的分区）：填色桶只填一个部位，“照正面起稿”按部位取颜色
function zonesOf(view) {
  const k = KINDS[view];
  const z = new Array(W * H).fill(null);
  let arm = null;
  if (view === 'side') {
    // 侧面的手臂被线围起来：从手臂中间往外填，碰到线就停
    arm = new Uint8Array(W * H);
    const stack = [(OY + 40) * W + OX.side + 14];
    while (stack.length) {
      const i = stack.pop();
      if (arm[i] || (k[i] !== 'F' && k[i] !== 'S')) continue;
      arm[i] = 1;
      const x = i % W; const y = Math.floor(i / W);
      for (const [dx, dy] of NB) stack.push((y + dy) * W + x + dx);
    }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!k[i] || k[i] === 'L') continue;
    const ly = y - OY; const lx = x - OX[view];
    let zone;
    if (ly <= 28) zone = 'head';
    else if (ly <= 30) zone = 'neck';
    else {
      let isArm;
      if (view === 'side') isArm = arm[i];
      else { const hx = Math.min(lx, 35 - lx); isArm = ly <= 53 && ((ly <= 45 && hx <= 8) || (ly >= 46 && hx <= 7)); }
      if (isArm) zone = ly >= 47 ? 'hand' : 'arm';
      else zone = ly <= 48 ? 'torso' : ly <= 63 ? 'legs' : 'feet';
    }
    z[i] = zone;
  }
  return z;
}
export const ZONES = Object.fromEntries(VIEWS.map((v) => [v, zonesOf(v)]));

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return '#' + f(n >> 16) + f((n >> 8) & 255) + f(n & 255);
}
const shadeCache = new Map();
const shaded = (c, k) => { const key = c + k; if (!shadeCache.has(key)) shadeCache.set(key, shade(c, k)); return shadeCache.get(key); };

export function emptyLayer() { return new Array(W * H).fill(null); }
export function newDoll() { return { front: emptyLayer(), back: null, side: null, outline: DEFAULT_OUTLINE }; }
export const isBlank = (layer) => !layer || layer.every((c) => c === null);

// 这一面实际用哪一层：画过就用画的；没画过但正面画了，就照正面自动起稿
const derived = new Map();
function layerFor(doll, view, editing) {
  if (doll[view] && !isBlank(doll[view])) return { layer: doll[view], v: view };
  if (editing || view === 'front' || isBlank(doll.front)) return { layer: emptyLayer(), v: view };
  const key = view + doll.front.join(',');
  if (!derived.has(key)) {
    if (derived.size > 12) derived.clear();
    derived.set(key, view === 'back' ? backFromFront(doll.front) : sideFromFront(doll.front));
  }
  return { layer: derived.get(key), v: view };
}

// 这一面最后的样子：每格一个颜色或 null（透明）
export function compose(doll, view, { editing = false } = {}) {
  const { layer, v } = layerFor(doll, view, editing);
  const kind = KINDS[v]; const rim = RIM[v];
  const line = doll.outline || SOFT_OUTLINE;
  const cells = new Array(W * H).fill(null);
  for (let i = 0; i < W * H; i++) {
    const p = layer[i]; const k = kind[i];
    if (p === CLEAR) continue;
    if (p) {
      // 涂过的颜色也带上白板的明暗
      cells[i] = k === 'S' ? shaded(p, 0.9) : rim[i] ? shaded(p, 0.95) : p;
    } else if (k) {
      cells[i] = k === 'L' ? line : k === 'E' ? EYE : k === 'S' ? BASE_SHADE : rim[i] ? shaded(BASE_FILL, 0.975) : BASE_FILL;
    }
  }
  // 画到白板外面的部分（比如头发）补一圈描边
  if (doll.outline) {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (cells[i] || layer[i] === CLEAR) continue;
      if (NB.some(([dx, dy]) => {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) return false;
        const p = layer[ny * W + nx];
        return p && p !== CLEAR;
      })) cells[i] = doll.outline;
    }
  }
  return cells;
}
// 吸色：涂过的格子取原来的颜色（不带明暗），白板取皮肤色
export function colorAt(doll, view, x, y) {
  const { layer, v } = layerFor(doll, view, true);
  const i = y * W + x; const p = layer[i];
  if (p && p !== CLEAR) return p;
  const k = KINDS[v][i];
  return k === 'L' ? (doll.outline || SOFT_OUTLINE) : k === 'E' ? EYE : k ? BASE_FILL : null;
}
// 房间里实际用哪个面（没画就用正面）
export const hasView = (doll, view) => view === 'front' || !isBlank(doll?.[view]);

// —— 小人码（分享 / 保存都用这个格式）——
// XSJ1.<base64url(JSON)>，JSON = { v: 2, p: 调色盘, f/b/s: 每面一串 RLE, o: 描边色 }
// v: 1 是旧的白板（32×64），读进来时按部位搬到新白板上
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&*+-=?@^';
const MAX_COLORS = CHARS.length;
const HEX = /^#[0-9a-f]{6}$/;

function rle(s) {
  let out = ''; let i = 0;
  while (i < s.length) {
    let j = i; while (j < s.length && s[j] === s[i]) j++;
    const n = j - i; out += (n > 1 ? n : '') + s[i]; i = j;
  }
  return out;
}
function unrle(s, len) {
  let out = ''; let num = '';
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') { num += ch; continue; }
    const n = num ? Number(num) : 1; num = '';
    if (n > len) throw new Error('小人码坏了');
    out += ch.repeat(n);
    if (out.length > len) throw new Error('小人码坏了');
  }
  if (out.length !== len) throw new Error('小人码坏了');
  return out;
}
const b64e = (str) => {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64d = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export function colorsUsed(doll) {
  const set = new Set();
  for (const v of VIEWS) for (const c of doll[v] || []) if (c && c !== CLEAR) set.add(c);
  return [...set];
}

export function packDoll(doll) {
  const pal = colorsUsed(doll);
  if (pal.length > MAX_COLORS) throw new Error(`颜色太多了（最多 ${MAX_COLORS} 种），换几种相近的颜色合并一下`);
  const idx = new Map(pal.map((c, i) => [c, CHARS[i]]));
  const enc = (layer) => rle(layer.map((c) => (c === null ? '.' : c === CLEAR ? '_' : idx.get(c))).join(''));
  const j = { v: 2, p: pal.map((c) => c.slice(1)), f: enc(doll.front), o: doll.outline ? doll.outline.slice(1) : '' };
  if (!isBlank(doll.back)) j.b = enc(doll.back);
  if (!isBlank(doll.side)) j.s = enc(doll.side);
  return j;
}
export function unpackDoll(j) {
  if (!j || typeof j !== 'object' || (j.v !== 1 && j.v !== 2) || !Array.isArray(j.p) || typeof j.f !== 'string') throw new Error('小人码不对');
  if (j.p.length > MAX_COLORS) throw new Error('小人码不对');
  const pal = j.p.map((c) => '#' + String(c).toLowerCase());
  if (!pal.every((c) => HEX.test(c))) throw new Error('小人码不对');
  const [w, h] = j.v === 1 ? [LW, LH] : [W, H];
  const dec = (s) => {
    if (typeof s !== 'string' || s.length > w * h * 2) throw new Error('小人码不对');
    return [...unrle(s, w * h)].map((ch) => {
      if (ch === '.') return null;
      if (ch === '_') return CLEAR;
      const k = CHARS.indexOf(ch);
      if (k < 0 || k >= pal.length) throw new Error('小人码不对');
      return pal[k];
    });
  };
  const o = typeof j.o === 'string' && /^[0-9a-fA-F]{6}$/.test(j.o) ? '#' + j.o.toLowerCase() : null;
  const d = { front: dec(j.f), back: j.b ? dec(j.b) : null, side: j.s ? dec(j.s) : null, outline: o };
  return j.v === 1 ? fromLegacy(d) : d;
}
export const dollToCode = (doll) => 'XSJ1.' + b64e(JSON.stringify(packDoll(doll)));
export function codeToDoll(code) {
  const m = /XSJ1\.([A-Za-z0-9_-]+)/.exec(String(code || '').replace(/\s+/g, ''));
  if (!m) throw new Error('没认出小人码，要以 XSJ1. 开头');
  let j;
  try { j = JSON.parse(b64d(m[1])); } catch { throw new Error('小人码不完整，复制的时候可能少了一截'); }
  return unpackDoll(j);
}

// —— 旧白板（32×64）画的小人：按部位搬到新白板上 ——
const LW = 32; const LH = 64;
function legacyZones(view) {
  const zone = new Array(LW * LH).fill(null);
  const set = (x, y, z) => { if (x >= 0 && x < LW && y >= 0 && y < LH) zone[y * LW + x] = z; };
  const span = (y, a, b, z) => { for (let x = a; x <= b; x++) set(x, y, z); };
  const sym = (y, hw, z) => span(y, 16 - hw, 15 + hw, z);
  if (view === 'side') {
    const head = [[13, 19], [11, 21], [10, 22]];
    for (let y = 4; y <= 19; y++) { const r = y < 7 ? head[y - 4] : y <= 17 ? [9, 23] : y === 18 ? [10, 22] : [12, 20]; span(y, r[0], r[1], 'head'); }
    for (let y = 20; y <= 21; y++) span(y, 15, 17, 'neck');
    for (let y = 22; y <= 37; y++) span(y, 12, 20, 'torso');
    for (let y = 23; y <= 34; y++) span(y, 14, 17, 'arm');
    for (let y = 35; y <= 37; y++) span(y, 15, 17, 'hand');
    for (let y = 38; y <= 57; y++) span(y, 13, 18, 'legs');
    for (let y = 58; y <= 61; y++) span(y, 13, 21, 'feet');
  } else {
    [4, 6, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 7, 6, 4].forEach((hw, i) => sym(4 + i, hw, 'head'));
    sym(20, 2, 'neck'); sym(21, 2, 'neck');
    for (let y = 22; y <= 37; y++) sym(y, 6, 'torso');
    for (let y = 22; y <= 34; y++) { span(y, 7, 9, 'arm'); span(y, 22, 24, 'arm'); }
    for (let y = 35; y <= 37; y++) { span(y, 7, 9, 'hand'); span(y, 22, 24, 'hand'); }
    for (let y = 38; y <= 57; y++) { span(y, 10, 14, 'legs'); span(y, 17, 21, 'legs'); }
    for (let y = 58; y <= 61; y++) { span(y, 9, 14, 'feet'); span(y, 17, 22, 'feet'); }
  }
  return zone;
}
function boxes(zone, w, h) {
  const b = {};
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const z = zone[y * w + x]; if (!z) continue;
    const r = (b[z] ||= { x0: x, x1: x, y0: y, y1: y });
    r.x0 = Math.min(r.x0, x); r.x1 = Math.max(r.x1, x); r.y0 = Math.min(r.y0, y); r.y1 = Math.max(r.y1, y);
  }
  return b;
}
function fromLegacy(d) {
  const conv = (old, view) => {
    if (!old) return null;
    const oz = legacyZones(view); const ob = boxes(oz, LW, LH);
    const nz = ZONES[view]; const nb = boxes(nz, W, H);
    const all = (b) => Object.values(b).reduce((a, r) => ({ x0: Math.min(a.x0, r.x0), x1: Math.max(a.x1, r.x1), y0: Math.min(a.y0, r.y0), y1: Math.max(a.y1, r.y1) }));
    const oa = all(ob); const na = all(nb);
    const map = (v, a0, a1, b0, b1) => Math.round(b0 + ((v - a0) / Math.max(1, a1 - a0)) * (b1 - b0));
    const out = emptyLayer();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const z = nz[y * W + x];
      const [s, t] = z && ob[z] ? [ob[z], nb[z]] : [oa, na];
      const ox = map(x, t.x0, t.x1, s.x0, s.x1); const oy = map(y, t.y0, t.y1, s.y0, s.y1);
      if (ox < 0 || ox >= LW || oy < 0 || oy >= LH) continue;
      const p = old[oy * LW + ox];
      // 白板外面画的（头发等）只搬到新白板外面，免得盖住轮廓
      if (!z && oz[oy * LW + ox]) continue;
      if (p && KINDS[view][y * W + x] !== 'L') out[y * W + x] = p;
    }
    return out;
  };
  return { front: conv(d.front, 'front'), back: conv(d.back, 'back'), side: conv(d.side, 'side'), outline: d.outline ? DEFAULT_OUTLINE : null };
}

// —— 画成图片（浏览器里）——
const urlCache = new Map();
export function dollCanvas(doll, view, scale = 4, opts = {}) {
  const cells = compose(doll, view, opts);
  const cv = document.createElement('canvas');
  cv.width = W * scale; cv.height = H * scale;
  const g = cv.getContext('2d');
  for (let i = 0; i < W * H; i++) {
    if (!cells[i]) continue;
    g.fillStyle = cells[i];
    g.fillRect((i % W) * scale, Math.floor(i / W) * scale, scale, scale);
  }
  return cv;
}
// 存起来的小人（packDoll 的 JSON）→ 图片地址，带缓存
export function dollUrl(packed, view = 'front') {
  if (!packed) return null;
  const key = JSON.stringify(packed) + view;
  if (!urlCache.has(key)) {
    if (urlCache.size > 60) urlCache.clear();
    try { urlCache.set(key, dollCanvas(unpackDoll(packed), view).toDataURL('image/png')); } catch { urlCache.set(key, null); }
  }
  return urlCache.get(key);
}
// 三个面并排的分享图（左下角写小人码提示）
export function shareImage(doll, name = '') {
  const s = 8; const pad = 24;
  const cv = document.createElement('canvas');
  cv.width = pad + 3 * (W * s + pad); cv.height = H * s + pad * 2 + 30;
  const g = cv.getContext('2d');
  g.fillStyle = '#fbf7f2'; g.fillRect(0, 0, cv.width, cv.height);
  VIEWS.forEach((v, i) => g.drawImage(dollCanvas(doll, v, s), pad + i * (W * s + pad), pad));
  g.fillStyle = '#7d6f78'; g.font = '16px sans-serif';
  g.fillText(`${name ? name + ' · ' : ''}迟叙机像素小人`, pad, cv.height - 16);
  return cv.toDataURL('image/png');
}

// 填色桶：把相连的同一块换成新颜色（白板按部位分块，线和五官挡住）
const keyOf = (layer, kinds, zones, i) => {
  const p = layer[i];
  if (p) return p;
  const k = kinds[i];
  return !k ? 'empty' : k === 'L' ? 'line' : k === 'E' ? 'eye' : `skin:${zones[i]}:${k === 'S' ? 's' : ''}`;
};
export function floodFill(doll, view, x, y, color) {
  const layer = doll[view] ? doll[view].slice() : emptyLayer();
  const kinds = KINDS[view]; const zones = ZONES[view];
  const start = y * W + x;
  const target = keyOf(layer, kinds, zones, start);
  if (target === color) return layer;
  const seen = new Uint8Array(W * H); const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue; seen[i] = 1;
    if (keyOf(layer, kinds, zones, i) !== target) continue;
    layer[i] = color;
    const cx = i % W; const cy = Math.floor(i / W);
    for (const [dx, dy] of NB) {
      const nx = cx + dx; const ny = cy + dy;
      if (nx >= 0 && nx < W && ny >= 0 && ny < H) stack.push(ny * W + nx);
    }
  }
  return layer;
}

// —— 照正面起稿 ——
function topColor(list) {
  const n = new Map(); for (const c of list) if (c && c !== CLEAR) n.set(c, (n.get(c) || 0) + 1);
  let best = null; let k = 0; for (const [c, m] of n) if (m > k) { best = c; k = m; }
  return best;
}
const at = (layer, view, lx, ly) => layer[(ly + OY) * W + lx + OX[view]];
// 正面头顶几行最多的颜色当作发色；头发在脸两边垂到哪一行
function hairOf(front) {
  const top = [];
  for (let y = 0; y < OY + 9; y++) for (let x = 0; x < W; x++) top.push(front[y * W + x]);
  const hair = topColor(top);
  let bottom = -1;
  if (hair) for (let ly = 0; ly < H - OY; ly++) for (const lx of [-2, -1, 0, 1, 2, 3, 4, 5, 30, 31, 32, 33, 34, 35, 36, 37]) if (at(front, 'front', lx, ly) === hair) bottom = Math.max(bottom, ly);
  return { hair, bottom };
}
const isEar = (view, lx, ly) => (view === 'side' ? lx >= 9 && lx <= 15 && ly >= 17 && ly <= 23 : (lx <= 2 || lx >= 33) && ly >= 16 && ly <= 22);
// 背面：正面左右翻过来，头部用头发颜色盖住（背面看不到脸）
export function backFromFront(front) {
  const l = emptyLayer();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) l[y * W + x] = front[y * W + (W - 1 - x)];
  const { hair, bottom } = hairOf(front);
  if (hair) {
    const z = ZONES.back;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ly = y - OY; const lx = x - OX.back;
      if (z[y * W + x] === 'head' && ly <= Math.max(bottom, 24) && !isEar('back', lx, ly)) l[y * W + x] = hair;
    }
  }
  return l;
}
// 侧面：按部位取正面最多的颜色，再补上头发、眼睛
export function sideFromFront(front) {
  const fz = ZONES.front; const sz = ZONES.side;
  const byZone = {};
  for (const zn of ['head', 'neck', 'torso', 'arm', 'hand', 'legs', 'feet']) {
    const list = [];
    for (let i = 0; i < W * H; i++) if (fz[i] === zn && !(zn === 'head' && Math.floor(i / W) < OY + 12)) list.push(front[i]);
    byZone[zn] = topColor(list);
  }
  const l = emptyLayer();
  for (let i = 0; i < W * H; i++) if (sz[i] && byZone[sz[i]]) l[i] = byZone[sz[i]];
  const { hair, bottom } = hairOf(front);
  if (hair) {
    const end = Math.max(bottom, 22);
    let onTop = 0; for (let lx = 12; lx <= 23; lx++) if (at(front, 'front', lx, 0) === hair) onTop++;
    const overLine = onTop >= 6;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; const ly = y - OY; const lx = x - OX.side;
      const inHair = ly <= 10 || (ly <= 16 && lx <= 19 - (ly - 10)) || (ly <= end && lx <= 8);
      if (!inHair || isEar('side', lx, ly)) continue;
      // 头顶、刘海，耳朵上方斜着收到后脑勺；正面头发盖过了轮廓线，侧面也盖过去
      if (sz[i] === 'head' || (overLine && KINDS.side[i] === 'L' && ly <= end)) l[i] = hair;
    }
    // 画在白板外面的头发（蓬起来的部分）：正面头宽 3–32，侧面头宽 0–29，左右平移过来
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (KINDS.front[i] || front[i] !== hair) continue;
      const ly = y - OY; const lx = x - OX.front - 3;
      if (ly > 12) continue;
      if (ly < 0 && (lx < 7 || lx > 24)) continue; // 侧面头顶窄一些
      const sx = lx + OX.side;
      if (sx >= 0 && sx < W && !KINDS.side[y * W + sx]) l[y * W + sx] = hair;
    }
  }
  // 眼睛（正面左眼 → 侧面的眼睛）
  for (let ly = 19; ly <= 22; ly++) for (const [sx, fx] of [[23, 10], [24, 11]]) {
    const c = at(front, 'front', fx, ly);
    if (c && c !== CLEAR) l[(ly + OY) * W + sx + OX.side] = c;
  }
  return l;
}
