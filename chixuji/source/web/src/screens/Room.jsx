// TA 的房间（温馨日系，2.5D 斜视角）：照片墙 + 小纸条、记忆摆件、TA 此刻在做什么
import React, { useEffect, useRef, useState } from 'react';
import { get, post, useImageSrc } from '../api.js';
import { compressImage } from '../image.js';
import { Button, ErrorBox, Loading, PickButton, Sheet, Thread, toast, TopBar } from '../ui.jsx';
import { lookSrc } from '../looks.js';
import { dollUrl } from '../doll.js';
import { LookPicker } from '../parts.jsx';
import { DiaryBook } from './DiaryBook.jsx';
import { CharPhone } from './CharPhone.jsx';

// —— 斜视角坐标：地面上的 (u, v) 加高度 h → 屏幕坐标 ——
// u 沿右墙方向，v 沿左墙方向，房间地面 180×180，墙高 200
const P = (u, v, h = 0) => [200 + u - v, 250 + 0.5 * (u + v) - h];
const pts = (list) => list.map((p) => p.join(',')).join(' ');
const RIGHT_WALL = 'matrix(1,0.5,0,1,200,50)'; // 右墙平面：x 0..180，y 0..200（向下）
const LEFT_WALL = 'matrix(1,-0.5,0,1,20,140)'; // 左墙平面
const FLOOR = 'matrix(1,0.5,-1,0.5,200,250)'; // 地面平面
const ROOM_OUTLINE = '20,140 200,50 380,140 380,340 200,430 20,340';

function Box({ u, v, w, d, h, z = 0, top, left, right, stroke = 'rgba(80,50,30,.18)', onClick, label }) {
  const t = [P(u, v, z + h), P(u + w, v, z + h), P(u + w, v + d, z + h), P(u, v + d, z + h)];
  const fl = [P(u, v + d, z + h), P(u + w, v + d, z + h), P(u + w, v + d, z), P(u, v + d, z)]; // 朝左下的面
  const fr = [P(u + w, v, z + h), P(u + w, v + d, z + h), P(u + w, v + d, z), P(u + w, v, z)]; // 朝右下的面
  const props = onClick ? { onClick, role: 'button', 'aria-label': label, tabIndex: 0, className: 'room-hit', onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && onClick() } : {};
  return (
    <g {...props}>
      <polygon points={pts(fl)} fill={left} stroke={stroke} strokeWidth="0.6" />
      <polygon points={pts(fr)} fill={right} stroke={stroke} strokeWidth="0.6" />
      <polygon points={pts(t)} fill={top} stroke={stroke} strokeWidth="0.6" />
    </g>
  );
}

// —— 时间与 TA 的状态 ——
export function phaseOf(h) {
  if (h < 6 || h >= 22) return 'night';
  if (h < 10) return 'morning';
  if (h < 17) return 'day';
  return 'evening';
}
export function activityOf(now, { lastChatAt, lastDiaryAt }) {
  const t = now.getTime();
  const h = now.getHours();
  const ago = (at) => (at ? t - Date.parse(at) : Infinity);
  if (ago(lastChatAt) >= 0 && ago(lastChatAt) < 10 * 60e3) return 'phone';
  if (ago(lastDiaryAt) >= 0 && ago(lastDiaryAt) < 30 * 60e3) return 'writing';
  if (h < 6 || h >= 23) return 'sleeping';
  if (h < 10) return 'window';
  if (h < 14) return 'desk';
  return 'reading';
}
const ACTIVITY_TEXT = {
  phone: '捧着手机，在等你的消息', writing: '刚写完日记，还坐在书桌前', sleeping: '睡着了', window: '站在窗边，捧着一杯热饮',
  desk: '在书桌前忙自己的事', reading: '窝在坐垫上看书',
};

const SKY = {
  night: ['#1d2140', '#3a3560'], morning: ['#f9d9b8', '#cfe3ee'], day: ['#a9d3ea', '#e3f1f6'], evening: ['#f2a37f', '#7d6ea6'],
};
const FRAME_COLOR = { wood: '#a9774c', white: '#fbf8f2', black: '#2d2a33', gold: '#c9a24a' };
const FRAME_NAME = { wood: '原木', white: '白色', black: '黑色', gold: '金色' };
const ITEM_NAME = { cat: '猫咪摆件', shell: '贝壳', books: '一摞书', flower: '小花瓶', mug: '马克杯', stars: '星星罐', letter: '信封', gift: '小礼盒' };

// 摆件图标（画在屏幕坐标 x,y 处，底部居中，大约 18px）
function ItemIcon({ item, x, y, s = 1 }) {
  const g = (children) => <g transform={`translate(${x},${y}) scale(${s})`}>{children}</g>;
  switch (item) {
    case 'cat': return g(<>
      <ellipse cx="0" cy="-5" rx="7" ry="5" fill="#9b8f99" /><circle cx="5" cy="-12" r="4.5" fill="#9b8f99" />
      <path d="M2-15 L3-20 L5.5-16 Z M6-16 L8.5-20 L9-14.5 Z" fill="#9b8f99" /><path d="M-7-5 q-5 -2 -3 -8" stroke="#9b8f99" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="4" cy="-12.5" r=".7" fill="#2d2a33" /><circle cx="7" cy="-12.5" r=".7" fill="#2d2a33" /></>);
    case 'shell': return g(<>
      <path d="M-8 -1 Q0 -20 8 -1 Z" fill="#f2c4bd" stroke="#d99a91" strokeWidth=".8" />
      {[-5, -2.5, 0, 2.5, 5].map((dx) => <path key={dx} d={`M0 -1 L${dx} -14`} stroke="#d99a91" strokeWidth=".6" />)}</>);
    case 'books': return g(<>
      <rect x="-9" y="-5" width="18" height="5" fill="#7d93b2" /><rect x="-8" y="-10" width="15" height="5" fill="#d9a066" /><rect x="-7" y="-15" width="16" height="5" fill="#a6687a" /></>);
    case 'flower': return g(<>
      <path d="M-4 0 L-5 -9 L5 -9 L4 0 Z" fill="#cfe0e8" stroke="#9fb7c4" strokeWidth=".6" />
      <path d="M0 -9 L-2 -17 M0 -9 L3 -18" stroke="#6f9a6a" strokeWidth="1" />
      <circle cx="-2" cy="-18" r="3" fill="#f4a6b8" /><circle cx="3" cy="-19" r="3" fill="#f7d26b" /></>);
    case 'mug': return g(<>
      <rect x="-6" y="-11" width="11" height="11" rx="2" fill="#f4efe6" stroke="#c9b9a6" strokeWidth=".8" />
      <path d="M5 -8 q4 0 4 3 q0 3 -4 3" fill="none" stroke="#c9b9a6" strokeWidth="1.2" />
      <path d="M-2 -14 q-2 -3 0 -5 M2 -14 q-2 -3 0 -5" stroke="#d7cfc5" strokeWidth=".9" fill="none" /></>);
    case 'stars': return g(<>
      <rect x="-6" y="-15" width="12" height="15" rx="3" fill="rgba(220,235,245,.85)" stroke="#9fb7c4" strokeWidth=".8" />
      <rect x="-4" y="-18" width="8" height="3" rx="1" fill="#c9a24a" />
      {[[-2, -4], [2, -7], [-2, -10], [2, -12], [0, -2]].map(([a, b2]) => <circle key={a + ',' + b2} cx={a} cy={b2} r="1.3" fill="#f7cf55" />)}</>);
    case 'letter': return g(<>
      <rect x="-9" y="-12" width="18" height="12" fill="#fbf6ec" stroke="#cdbb9e" strokeWidth=".8" transform="rotate(-6)" />
      <path d="M-9 -12 L0 -5 L9 -12" fill="none" stroke="#cdbb9e" strokeWidth=".8" transform="rotate(-6)" /><circle cx="0" cy="-6" r="1.8" fill="#c2313a" /></>);
    default: return g(<>
      <rect x="-7" y="-12" width="14" height="12" fill="#e9b7b0" /><rect x="-1.2" y="-12" width="2.4" height="12" fill="#c2313a" />
      <path d="M0 -12 q-6 -5 -4 -7 q3 0 4 7 q1 -7 4 -7 q2 2 -4 7" fill="#c2313a" /></>);
  }
}

// 人物（简笔小人）：颜色跟着头像色
function Person({ pose, x, y, color }) {
  const skin = '#f3d9c6'; const hair = '#3b3040';
  if (pose === 'lying') {
    return (
      <g>
        <circle cx={x} cy={y} r="7" fill={skin} /><path d={`M${x - 7} ${y - 1} a7 7 0 0 1 13 -4 l-1 5 Z`} fill={hair} />
        <path d={`M${x - 4} ${y + 4} q5 3 4 7`} stroke="none" fill="none" />
        <text x={x + 9} y={y - 10} className="room-zzz">z z</text>
      </g>
    );
  }
  const sit = pose === 'sit';
  const bodyH = sit ? 15 : 24;
  const top = y - bodyH;
  return (
    <g>
      {!sit && <><rect x={x - 4.5} y={y - 9} width="3.6" height="9" rx="1.5" fill="#5b5466" /><rect x={x + 0.9} y={y - 9} width="3.6" height="9" rx="1.5" fill="#5b5466" /></>}
      <rect x={x - 7} y={top} width="14" height={sit ? bodyH : bodyH - 7} rx="6" fill={color} />
      <circle cx={x} cy={top - 6} r="7.5" fill={skin} />
      <path d={`M${x - 7.6} ${top - 5} a7.6 7.6 0 0 1 15.2 0 q-2 -4 -7.6 -4 q-5 0 -7.6 4 Z`} fill={hair} />
      <circle cx={x - 2.4} cy={top - 5} r=".9" fill="#2d2a33" /><circle cx={x + 2.4} cy={top - 5} r=".9" fill="#2d2a33" />
    </g>
  );
}

// 预设形象（像素小人）：书桌前用侧面、窗边用背面、其他用正面；睡觉时躺在被子里
const SPRITE_H = 74;
function SpritePerson({ src, pixel, act, at }) {
  const look = pixel ? 'doll' : 'p';
  const sprite = (_l, view) => src(view);
  const ir = pixel ? { style: { imageRendering: 'pixelated' } } : {};
  const [x, y] = at;
  const w = SPRITE_H * 0.62;
  const img = (view, extra = {}) => <image href={sprite(look, view)} x={x - w / 2} y={y - SPRITE_H} width={w} height={SPRITE_H} {...ir} {...extra} />;
  if (act === 'sleeping') {
    return (
      <g transform={`translate(${x},${y}) rotate(63.4) scale(.8)`}>
        <image href={sprite(look, 'front')} x={-w / 2} y={-8} width={w} height={SPRITE_H} {...ir} />
      </g>
    );
  }
  if (act === 'desk' || act === 'writing') {
    return <g transform={`translate(${2 * x},0) scale(-1,1)`}>{img('side')}</g>;
  }
  if (act === 'window') return img('back');
  if (act === 'reading') {
    const id = `sit-${look}`;
    return (
      <g>
        <clipPath id={id}><rect x={x - w} y={y - SPRITE_H * 0.72} width={w * 2} height={SPRITE_H * 0.72} /></clipPath>
        <image href={sprite(look, 'front')} x={x - w / 2} y={y - SPRITE_H * 0.72} width={w} height={SPRITE_H} clipPath={`url(#${id})`} {...ir} />
        <ellipse cx={x} cy={y + 2} rx="20" ry="8" fill="#e7b8a8" />
        <ellipse cx={x} cy={y} rx="17" ry="6" fill="#efc9bc" />
        <path d={`M${x - 9} ${y - SPRITE_H * 0.22} l9 3 l9 -3 v-9 l-9 3 l-9 -3 Z`} fill="#f6efe2" stroke="#c9b9a6" strokeWidth=".6" />
      </g>
    );
  }
  // phone：站在床头柜旁边，手里的手机亮着
  return (
    <g>
      {img('front')}
      <rect x={x - 4} y={y - SPRITE_H * 0.47} width="7" height="10" rx="1.4" fill="#bfe3ff" stroke="#2d2a33" strokeWidth=".7" />
    </g>
  );
}

function PhotoOnWall({ photo, slot, onOpen, onNote, highlightNote }) {
  const src = useImageSrc(photo?.imageId);
  const col = slot % 3; const row = Math.floor(slot / 3);
  const x = 26 + col * 44; const y = 14 + row * 34;
  const w = 36; const h = 27;
  const id = `ph${slot}`;
  if (!photo) {
    return (
      <g className="room-hit" role="button" tabIndex={0} aria-label={`照片墙第 ${slot + 1} 格，空着，点击挂照片`} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
        <rect x={x} y={y} width={w} height={h} fill="rgba(255,255,255,.18)" stroke="rgba(150,120,90,.45)" strokeDasharray="2 2" strokeWidth=".8" rx="1" />
        <text x={x + w / 2} y={y + h / 2 + 3} textAnchor="middle" className="room-plus">+</text>
      </g>
    );
  }
  const fc = FRAME_COLOR[photo.frame] || FRAME_COLOR.wood;
  return (
    <g>
      <g className="room-hit" role="button" tabIndex={0} aria-label={`照片：${photo.caption || '没有说明'}`} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
        <rect x={x - 2} y={y - 2} width={w + 4} height={h + 4} fill={fc} rx="1" />
        <clipPath id={id}><rect x={x} y={y} width={w} height={h} /></clipPath>
        <rect x={x} y={y} width={w} height={h} fill="#ddd" />
        {src && <image href={src} x={x} y={y} width={w} height={h} preserveAspectRatio="xMidYMid slice" clipPath={`url(#${id})`} />}
      </g>
      {photo.note && (
        <g className={'room-hit room-note' + (highlightNote ? ' is-new' : '')} role="button" tabIndex={0} aria-label="TA 的小纸条" onClick={onNote} onKeyDown={(e) => e.key === 'Enter' && onNote()}>
          <rect x={x + w - 6} y={y + h - 7} width="12" height="10" fill="#fffaf0" stroke="#e2d6c0" strokeWidth=".5" transform={`rotate(8 ${x + w} ${y + h})`} />
          <path d={`M${x + w - 4} ${y + h - 3} h7 M${x + w - 4} ${y + h} h6`} stroke="#b9ab95" strokeWidth=".5" transform={`rotate(8 ${x + w} ${y + h})`} />
          <circle cx={x + w} cy={y + h - 6} r="1.4" fill="#c2313a" />
        </g>
      )}
    </g>
  );
}

function RoomScene({ data, current, me, now, unreadChat, unreadNote, onSlot, onPhoto, onNote, onKeepsake, onDiary, onPhone, onCharacter }) {
  const phase = phaseOf(now.getHours());
  const act = activityOf(now, data);
  const [sky1, sky2] = SKY[phase];
  const dark = phase === 'night';
  const curtainsClosed = act === 'sleeping';
  const color = current.avatarColor || '#e7a3b4';
  const bySlot = new Map(data.photos.map((p) => [p.slot, p]));
  const shelf = new Map(data.keepsakes.map((k) => [k.slot, k]));
  const person = {
    phone: { pose: 'sit', at: P(150, 150, 26) }, writing: { pose: 'sit', at: P(46, 100, 18) }, desk: { pose: 'sit', at: P(46, 100, 18) },
    sleeping: { pose: 'lying', at: P(145, 119, 30) }, window: { pose: 'stand', at: P(52, 40, 0) }, reading: { pose: 'sit', at: P(80, 92, 7) },
  }[act];
  const look = current.look;
  const spriteAt = {
    phone: P(102, 96, 0), writing: P(62, 100, 0), desk: P(62, 100, 0), sleeping: P(145, 120, 27), window: P(26, 44, 0), reading: P(82, 88, 0),
  }[act];
  const personNode = look ? (
    <g className="room-hit" role="button" tabIndex={0} aria-label={`${current.name}：${ACTIVITY_TEXT[act]}，点击聊天`} onClick={onCharacter} onKeyDown={(e) => e.key === 'Enter' && onCharacter()}>
      <SpritePerson src={(v) => lookSrc(current, v)} pixel={look === 'doll'} act={act} at={spriteAt} />
      {act === 'sleeping' && <text x={spriteAt[0] + 8} y={spriteAt[1] - 14} className="room-zzz">z z</text>}
    </g>
  ) : (
    <g className="room-hit" role="button" tabIndex={0} aria-label={`${current.name}：${ACTIVITY_TEXT[act]}，点击聊天`} onClick={onCharacter} onKeyDown={(e) => e.key === 'Enter' && onCharacter()}>
      <Person pose={person.pose} x={person.at[0]} y={person.at[1]} color={color} />
      {act === 'reading' && <rect x={person.at[0] - 6} y={person.at[1] - 13} width="12" height="8" fill="#f6efe2" stroke="#c9b9a6" strokeWidth=".6" />}
      {act === 'window' && <ItemIcon item="mug" x={person.at[0] + 9} y={person.at[1] - 10} s={0.5} />}
      {act === 'phone' && <rect x={person.at[0] - 3} y={person.at[1] - 14} width="6" height="9" rx="1.2" fill="#2d2a33" stroke="#9ad" strokeWidth=".5" />}
    </g>
  );
  // 画的先后：睡觉时夹在枕头和被子之间；简笔小人捧手机时坐在床边（画在床后面才能挡住）
  const slot = act === 'sleeping' ? 'inBed' : (!look && act === 'phone') ? 'afterBed' : 'beforeBed';

  return (
    <svg className="room-svg" viewBox="14 46 372 390" role="img" aria-label={`${current.name}的房间`}>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={sky1} /><stop offset="1" stopColor={sky2} /></linearGradient>
        <radialGradient id="lamp"><stop offset="0" stopColor="#ffd98a" stopOpacity=".75" /><stop offset="1" stopColor="#ffd98a" stopOpacity="0" /></radialGradient>
        <linearGradient id="phoneScreen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9fd0ff" /><stop offset="1" stopColor="#c9a6f0" /></linearGradient>
        <pattern id="planks" width="180" height="15" patternUnits="userSpaceOnUse"><rect width="180" height="15" fill="#d2a679" /><path d="M0 14.5 H180" stroke="#bf9268" strokeWidth="1" /><path d="M60 0 V15 M150 0 V15" stroke="#c49a70" strokeWidth=".6" /></pattern>
      </defs>

      {/* 墙和地板 */}
      <polygon points={pts([[20, 340], [200, 250], [200, 50], [20, 140]])} fill="#f5ece0" />
      <polygon points={pts([[200, 250], [380, 340], [380, 140], [200, 50]])} fill="#ecdfcd" />
      <g transform={FLOOR}><rect width="180" height="180" fill="url(#planks)" /></g>
      <polyline points={pts([[20, 340], [200, 250], [380, 340]])} fill="none" stroke="#cdb497" strokeWidth="2" />
      <polyline points={pts([[200, 250], [200, 50]])} fill="none" stroke="#dccbb6" strokeWidth="1" />

      {/* 左墙：窗户 */}
      <g transform={LEFT_WALL}>
        <rect x="52" y="34" width="76" height="70" fill="url(#sky)" />
        {dark ? <>
          <circle cx="110" cy="52" r="7" fill="#f5f0d8" /><circle cx="113" cy="50" r="6" fill={sky1} />
          {[[64, 48], [80, 60], [96, 44], [70, 80], [118, 76]].map(([a, b]) => <circle key={a} cx={a} cy={b} r=".9" fill="#fff" />)}
        </> : <circle cx={phase === 'evening' ? 70 : 108} cy={phase === 'evening' ? 88 : 54} r="7" fill={phase === 'evening' ? '#ffcf8a' : '#fff5cf'} />}
        <path d="M90 34 V104 M52 69 H128" stroke="#f8f3ea" strokeWidth="3" />
        <rect x="52" y="34" width="76" height="70" fill="none" stroke="#f8f3ea" strokeWidth="4" />
        <rect x="46" y="104" width="88" height="5" fill="#e8dccb" />
        {/* 窗帘 */}
        <path d={curtainsClosed ? 'M48 30 H92 V108 H48 Z' : 'M44 30 H60 Q56 70 62 108 H44 Z'} fill="#e7b8a8" opacity=".95" />
        <path d={curtainsClosed ? 'M88 30 H132 V108 H88 Z' : 'M120 30 H136 V108 H118 Q124 70 120 30 Z'} fill="#e7b8a8" opacity=".95" />
        <rect x="40" y="27" width="100" height="3" rx="1.5" fill="#a9774c" />
        {/* 小挂历 */}
        <rect x="150" y="60" width="18" height="22" fill="#fbf8f2" stroke="#d8c9b4" strokeWidth=".6" />
        <rect x="150" y="60" width="18" height="6" fill="#c2313a" />
        <text x="159" y="78" textAnchor="middle" className="room-cal">{now.getDate()}</text>
      </g>

      {/* 右墙：照片墙 */}
      <g transform={RIGHT_WALL}>
        <path d="M28 10 H158" stroke="#cdb497" strokeWidth=".6" strokeDasharray="1 3" />
        {Array.from({ length: data.photoSlots }, (_, i) => (
          <PhotoOnWall key={i} slot={i} photo={bySlot.get(i)} highlightNote={unreadNote}
            onOpen={() => (bySlot.get(i) ? onPhoto(bySlot.get(i)) : onSlot(i))} onNote={() => onNote(bySlot.get(i))} />
        ))}
      </g>

      {/* 地毯 */}
      <g transform={FLOOR}>
        <rect x="52" y="52" width="62" height="62" rx="8" fill="#efe1cf" />
        <rect x="58" y="58" width="50" height="50" rx="6" fill="none" stroke="#dcc3a8" strokeWidth="1.5" strokeDasharray="4 3" />
      </g>

      {/* 摆件架（照片墙下面） */}
      <Box u={26} v={0} w={136} d={18} h={30} top="#c99567" left="#b07b50" right="#a06c43" />
      {Array.from({ length: data.shelfSlots }, (_, i) => {
        const k = shelf.get(i);
        const [x, y] = P(26 + 136 * (i + 0.5) / data.shelfSlots, 9, 30);
        return k ? (
          <g key={i} className="room-hit" role="button" tabIndex={0} aria-label={`摆件：${ITEM_NAME[k.item]}，${k.content}`} onClick={() => onKeepsake(k)} onKeyDown={(e) => e.key === 'Enter' && onKeepsake(k)}>
            <ellipse cx={x} cy={y} rx="9" ry="3" fill="rgba(0,0,0,.08)" />
            <ItemIcon item={k.item} x={x} y={y} s={0.95} />
          </g>
        ) : null;
      })}

      {/* 绿植 */}
      <Box u={4} v={4} w={14} d={14} h={14} top="#d9c2a5" left="#b48c66" right="#a37b56" />
      {[[-6, -26, 9], [4, -32, 8], [9, -22, 8], [-2, -38, 6], [-10, -18, 6]].map(([dx, dy, r], i) => {
        const [x, y] = P(11, 11, 14);
        return <circle key={i} cx={x + dx} cy={y + dy + 8} r={r} fill={i % 2 ? '#86a97d' : '#6f9a6a'} />;
      })}

      {/* 书桌、台灯、日记本、椅子 */}
      <Box u={0} v={62} w={34} d={78} h={36} top="#c48f61" left="#a87449" right="#9a6941" />
      <g className="room-hit" role="button" tabIndex={0} aria-label={`${current.name}的日记本，点击查看`} onClick={(e) => onDiary(e.currentTarget.getBoundingClientRect())} onKeyDown={(e) => e.key === 'Enter' && onDiary(e.currentTarget.getBoundingClientRect())}>
        {(() => { const [x, y] = P(16, 102, 38); return <circle cx={x} cy={y} r="20" fill="transparent" />; })()}
        <Box u={6} v={90} w={20} d={24} h={4} z={36} top="#8a5a6e" left="#6f4658" right="#6f4658" />
        <Box u={7} v={91} w={18} d={22} h={0.6} z={40} top="#f6efe2" left="#f6efe2" right="#f6efe2" stroke="none" />
        {(() => { const [x, y] = P(16, 113, 38); return <path d={`M${x} ${y} l1.5 7 l1.5 -3 l1.5 3 l0 -7 Z`} fill="#c2313a" />; })()}
      </g>
      {(() => { const [x, y] = P(10, 128, 36); return <>
        {(dark || phase === 'evening') && <circle cx={x} cy={y - 20} r="46" fill="url(#lamp)" />}
        <rect x={x - 1} y={y - 18} width="2" height="18" fill="#7a6a5c" /><path d={`M${x - 8} ${y - 18} L${x + 8} ${y - 18} L${x + 4} ${y - 28} L${x - 4} ${y - 28} Z`} fill={dark || phase === 'evening' ? '#ffe2a3' : '#f2e6d0'} />
        <ellipse cx={x} cy={y} rx="5" ry="2" fill="#7a6a5c" /></>; })()}
      <Box u={38} v={92} w={16} d={16} h={18} top="#d8b48c" left="#b48c66" right="#a37b56" />
      <Box u={52} v={92} w={3} d={16} h={36} top="#c9a27a" left="#b48c66" right="#a37b56" />

      {slot === 'beforeBed' && personNode}

      {/* 床头柜 */}
      <Box u={150} v={82} w={26} d={24} h={26} top="#d8b48c" left="#b48c66" right="#a37b56" />

      {/* 床：床头靠里（v 小的一侧），枕头在床头，被子盖到胸口 */}
      <Box u={112} v={104} w={66} d={6} h={40} top="#b48660" left="#9d7049" right="#8d6340" />
      <Box u={112} v={110} w={66} d={68} h={14} top="#c79b72" left="#ad8058" right="#9d7049" />
      <Box u={113} v={111} w={64} d={66} h={8} z={14} top="#f8f3ea" left="#ece3d5" right="#e4d9c9" />
      <Box u={120} v={113} w={50} d={14} h={6} z={22} top="#fffdf8" left="#efe6d8" right="#e8dece" />
      {slot === 'inBed' && personNode}
      <Box u={113} v={129} w={64} d={48} h={4} z={22} top="#e9bfb1" left="#d9a898" right="#cf9c8c" />

      {/* TA 的手机：亮着屏幕，丢在被子上（点它拿起来看） */}
      {(() => {
        const z = 26; const u0 = 150; const u1 = 153.5; const v0 = 150; const v1 = 157; const th = 0.5; // 现实比例（床约 1.5×2 米）
        const top = [P(u0, v0, z + th), P(u1, v0, z + th), P(u1, v1, z + th), P(u0, v1, z + th)];
        const sideR = [P(u1, v0, z), P(u1, v1, z), P(u1, v1, z + th), P(u1, v0, z + th)];
        const sideF = [P(u0, v1, z), P(u1, v1, z), P(u1, v1, z + th), P(u0, v1, z + th)];
        const scr = [P(u0 + 0.35, v0 + 0.5, z + th), P(u1 - 0.35, v0 + 0.5, z + th), P(u1 - 0.35, v1 - 0.5, z + th), P(u0 + 0.35, v1 - 0.5, z + th)];
        const [cx, cy] = P((u0 + u1) / 2, (v0 + v1) / 2, z + th);
        const badge = P(u1 - 0.3, v0 + 0.3, z + th + 1);
        return (
          <g className="room-hit room-phone" role="button" tabIndex={0} aria-label={`${current.name}的手机`} onClick={(e) => onPhone(e.currentTarget.getBoundingClientRect())} onKeyDown={(e) => e.key === 'Enter' && onPhone(e.currentTarget.getBoundingClientRect())}>
            {/* 手机本身很小，点的范围放大，保证点得到 */}
            <circle cx={cx} cy={cy} r="22" fill="transparent" />
            <ellipse cx={cx} cy={cy} rx="7" ry="4" fill="#bfe3ff" opacity=".5" className="room-glow" />
            <polygon points={pts(sideR)} fill="#1d1b26" />
            <polygon points={pts(sideF)} fill="#2d2a33" />
            <polygon points={pts(top)} fill="#26232e" stroke="#15131b" strokeWidth=".3" />
            <polygon points={pts(scr)} fill="url(#phoneScreen)" />
            {unreadChat > 0 && <circle cx={badge[0]} cy={badge[1]} r="1.6" fill="#e8607a" stroke="#fff" strokeWidth=".4" />}
          </g>
        );
      })()}

      {slot === 'afterBed' && personNode}

      {/* 串门：玩家自己画的小人站在房间前面 */}
      {me && (() => { const [x, y] = P(96, 162, 0); const w = SPRITE_H * 0.5; return (
        <g aria-label="我（来串门）" role="img">
          <ellipse cx={x} cy={y - 1} rx="11" ry="3.5" fill="rgba(80,50,30,.18)" />
          <image href={dollUrl(me, 'front')} x={x - w / 2} y={y - SPRITE_H} width={w} height={SPRITE_H} style={{ imageRendering: 'pixelated' }} />
        </g>); })()}

      {/* 夜里整个房间暗一点，台灯那边亮 */}
      {dark && <polygon points={ROOM_OUTLINE} fill="#1a1c3a" opacity=".32" pointerEvents="none" />}
      {phase === 'evening' && <polygon points={ROOM_OUTLINE} fill="#f2a37f" opacity=".08" pointerEvents="none" />}
      {(phase === 'morning' || phase === 'day') && (
        <polygon points={pts([P(10, 70, 0), P(10, 140, 0), P(90, 150, 0), P(90, 90, 0)])} fill="#fff8de" opacity=".28" pointerEvents="none" />
      )}
    </svg>
  );
}

// —— 弹窗们 ——
function HangSheet({ open, slot, current, onClose, onDone }) {
  const [pic, setPic] = useState(null);
  const [caption, setCaption] = useState('');
  const [frame, setFrame] = useState('wood');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { if (open) { setPic(null); setCaption(''); setFrame('wood'); } }, [open]);
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { setPic(await compressImage(f)); } catch (err) { toast(err.message); }
  }
  async function hang() {
    setBusy(true);
    try {
      const img = (await post('/api/images', { characterId: current.id, ...pic })).image.id;
      await post(`/api/branches/${current.viewBranch.id}/room/photos`, { imageId: img, slot, caption, frame });
      toast(`挂好了，${current.name}过一会儿会看到`);
      onDone();
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="挂一张照片">
      <button type="button" className="room-pick" onClick={() => fileRef.current?.click()} style={{ borderColor: FRAME_COLOR[frame] }}>
        {pic ? <img src={pic.dataUrl} alt="选好的照片" /> : <span>点这里选一张照片</span>}
      </button>
      <PickButton onClick={() => fileRef.current?.click()}>{pic ? '换一张照片' : '从相册选一张照片'}</PickButton>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      <label className="field"><span>写一句话（可以不写）</span><input value={caption} maxLength={40} placeholder="例如：第一次一起看海" onChange={(e) => setCaption(e.target.value)} /></label>
      <div className="room-frames" role="radiogroup" aria-label="相框">
        {Object.keys(FRAME_COLOR).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={frame === f} className={frame === f ? 'is-on' : ''} onClick={() => setFrame(f)}>
            <i style={{ background: FRAME_COLOR[f] }} />{FRAME_NAME[f]}
          </button>
        ))}
      </div>
      <Button busy={busy} disabled={!pic} onClick={hang}>挂上去</Button>
      <p className="muted small">{current.name}会看到这张照片，在旁边钉一张小纸条，也会把它记在心里。</p>
    </Sheet>
  );
}

function SlotPicker({ count, cols, taken, current, onPick }) {
  return (
    <div className="room-slots" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: count }, (_, i) => (
        <button key={i} type="button" className={(i === current ? 'is-here ' : '') + (taken.has(i) ? 'is-taken' : '')} onClick={() => onPick(i)} aria-label={`第 ${i + 1} 格${i === current ? '（现在的位置）' : taken.has(i) ? '（有东西，会对调）' : ''}`}>
          {i === current ? '这里' : taken.has(i) ? '·' : ''}
        </button>
      ))}
    </div>
  );
}

function PhotoSheet({ photo, current, data, startWithNote, onClose, onChanged }) {
  const src = useImageSrc(photo?.imageId);
  const [noteOpen, setNoteOpen] = useState(false);
  const [mode, setMode] = useState('view');
  const [busy, setBusy] = useState('');
  useEffect(() => { setNoteOpen(!!startWithNote); setMode('view'); }, [photo?.seq, startWithNote]);
  if (!photo) return null;
  const base = `/api/branches/${current.viewBranch.id}/room/photos/${photo.seq}`;
  async function move(slot) {
    try { await post(`${base}/move`, { slot }); toast('换好了'); onChanged(); } catch (e) { toast(e.message); }
  }
  async function remove(forget) {
    setBusy(forget ? 'f' : 'k');
    try { await post(`${base}/remove`, { forget }); toast(forget ? `取下了，${current.name}也不记得了` : '取下了'); onChanged(); }
    catch (e) { toast(e.message); } finally { setBusy(''); }
  }
  return (
    <Sheet open onClose={onClose} title={photo.caption || '照片'}>
      {mode === 'view' && (
        <>
          <div className="room-photo-big" style={{ borderColor: FRAME_COLOR[photo.frame] }}>{src ? <img src={src} alt={photo.caption || '照片'} /> : <Loading />}</div>
          {photo.note ? (
            noteOpen ? (
              <div className="room-note-open" role="note">
                <i className="pin" aria-hidden="true" />
                <p>{photo.note.text}</p>
                <span>—— {current.name}</span>
              </div>
            ) : (
              <button type="button" className="room-note-folded" onClick={() => setNoteOpen(true)}>
                <i className="pin" aria-hidden="true" />{current.name}在旁边钉了一张小纸条 · 点开看看
              </button>
            )
          ) : <p className="muted small">{current.name}还没看到这张照片……过一会儿再来看看。</p>}
          <div className="room-actions">
            <button type="button" className="text-btn" onClick={() => setMode('move')}>换位置</button>
            <button type="button" className="text-btn danger" onClick={() => setMode('remove')}>取下</button>
          </div>
        </>
      )}
      {mode === 'move' && (
        <>
          <p className="muted small">选一个新位置。那里有照片的话，两张会对调。</p>
          <SlotPicker count={data.photoSlots} cols={3} taken={new Set(data.photos.map((p) => p.slot))} current={photo.slot} onPick={(i) => (i === photo.slot ? setMode('view') : move(i))} />
          <button type="button" className="text-btn" onClick={() => setMode('view')}>返回</button>
        </>
      )}
      {mode === 'remove' && (
        <>
          <p className="muted small">取下后，这条世界线的照片墙上就没有它了（分出去的其他世界线不受影响）。{current.name}要不要也忘掉它？</p>
          <Button kind="danger" busy={busy === 'f'} disabled={!!busy} onClick={() => remove(true)}>取下，并让{current.name}也忘掉</Button>
          <Button kind="ghost" busy={busy === 'k'} disabled={!!busy} onClick={() => remove(false)}>只取下，{current.name}还记得</Button>
          <button type="button" className="text-btn" onClick={() => setMode('view')}>返回</button>
        </>
      )}
    </Sheet>
  );
}

function ItemPicker({ value, onPick }) {
  return (
    <div className="room-items" role="radiogroup" aria-label="摆件样子">
      {Object.keys(ITEM_NAME).map((it) => (
        <button key={it} type="button" role="radio" aria-checked={value === it} className={value === it ? 'is-on' : ''} onClick={() => onPick(it)}>
          <svg viewBox="-14 -24 28 28" width="34" height="34" aria-hidden="true"><ItemIcon item={it} x={0} y={0} /></svg>
          <span>{ITEM_NAME[it]}</span>
        </button>
      ))}
    </div>
  );
}

function KeepsakeSheet({ k, current, onClose, onChanged }) {
  const [snip, setSnip] = useState(null);
  const [mode, setMode] = useState('view');
  useEffect(() => {
    if (!k) return;
    setSnip(null); setMode('view');
    get(`/api/branches/${current.viewBranch.id}/room/memory/${k.memoryId}`).then(setSnip, (e) => setSnip({ error: e.message }));
  }, [k?.memoryId]);
  if (!k) return null;
  async function restyle(item) {
    try { await post(`/api/branches/${current.viewBranch.id}/room/keepsakes`, { memoryId: k.memoryId, item, slot: k.slot }); toast('换好了'); onChanged(); } catch (e) { toast(e.message); }
  }
  async function putAway() {
    try { await post(`/api/branches/${current.viewBranch.id}/room/keepsakes/off`, { memoryId: k.memoryId }); toast('收起来了'); onChanged(); } catch (e) { toast(e.message); }
  }
  return (
    <Sheet open onClose={onClose} title={ITEM_NAME[k.item]}>
      {mode === 'view' ? (
        <>
          <div className="room-keepsake-head">
            <svg viewBox="-14 -24 28 28" width="56" height="56" aria-hidden="true"><ItemIcon item={k.item} x={0} y={0} /></svg>
            <p className="serif">{k.content}</p>
          </div>
          {!snip && <Loading />}
          {snip?.lines?.length > 0 && (
            <div className="room-snippet">
              <h3 className="card-sub">那时候</h3>
              {snip.lines.map((l) => (
                <p key={l.seq} className={(l.who === 'user' ? 'me' : 'ta') + (l.source ? ' is-source' : '')}>
                  <b>{l.who === 'user' ? '我' : current.name}</b>{l.text}
                </p>
              ))}
            </div>
          )}
          <p className="muted small">{k.auto ? '这是一段重要的回忆，自动摆上了架子。' : '这是你亲手摆上的。'}</p>
          <div className="room-actions">
            <button type="button" className="text-btn" onClick={() => setMode('style')}>换个样子</button>
            <button type="button" className="text-btn danger" onClick={putAway}>收起来</button>
          </div>
        </>
      ) : (
        <>
          <ItemPicker value={k.item} onPick={restyle} />
          <button type="button" className="text-btn" onClick={() => setMode('view')}>返回</button>
        </>
      )}
    </Sheet>
  );
}

function PlaceSheet({ open, current, data, presetMemoryId, onClose, onDone }) {
  const [mems, setMems] = useState(null);
  const [memId, setMemId] = useState(null);
  const [picked, setPicked] = useState(null); // 点一下先选中（右边红点），再点一下进入选样式
  const [item, setItem] = useState('gift');
  const [slot, setSlot] = useState(null);
  useEffect(() => {
    if (!open) return;
    setMemId(presetMemoryId || null); setPicked(null); setSlot(null);
    get(`/api/branches/${current.viewBranch.id}/memories`).then((r) => {
      const list = r.memories.filter((m) => m.status === 'active');
      setMems(list);
      const pre = list.find((m) => m.id === presetMemoryId);
      if (pre) setItem(guess(pre.content));
    }, () => setMems([]));
  }, [open]);
  const guess = (t) => (/猫/.test(t) ? 'cat' : /海|贝/.test(t) ? 'shell' : /书|读/.test(t) ? 'books' : /花/.test(t) ? 'flower' : /咖啡|茶|喝/.test(t) ? 'mug' : /星|夜|月/.test(t) ? 'stars' : /信|约定|答应|承诺/.test(t) ? 'letter' : 'gift');
  const taken = new Set(data.keepsakes.map((k) => k.slot));
  const firstFree = [...Array(data.shelfSlots).keys()].find((i) => !taken.has(i));
  async function place() {
    try {
      await post(`/api/branches/${current.viewBranch.id}/room/keepsakes`, { memoryId: memId, item, slot: slot ?? firstFree ?? 0 });
      toast('摆上了'); onDone();
    } catch (e) { toast(e.message); }
  }
  const chosen = mems?.find((m) => m.id === memId);
  return (
    <Sheet open={open} onClose={onClose} title="把一段回忆做成摆件">
      {!mems && <Loading />}
      {mems && !chosen && (
        mems.length ? (
          <ul className="room-memlist">
            {mems.slice().reverse().map((m) => (
              <li key={m.id}>
                <button type="button" className={picked === m.id ? 'is-picked' : ''} aria-pressed={picked === m.id}
                  onClick={() => { if (picked === m.id) { setMemId(m.id); setItem(guess(m.content)); } else setPicked(m.id); }}>
                  <span className="room-mem-text">{m.content}</span>
                  <span className="room-mem-dot" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="muted small">还没有记忆。多聊聊，{current.name}记住的事会出现在这里。</p>
      )}
      {chosen && (
        <>
          <p className="sheet-quote">「{chosen.content}」</p>
          <h3 className="card-sub">选个样子</h3>
          <ItemPicker value={item} onPick={setItem} />
          <h3 className="card-sub">放在架子上哪一格</h3>
          <SlotPicker count={data.shelfSlots} cols={6} taken={taken} current={slot ?? firstFree} onPick={setSlot} />
          {taken.has(slot ?? -1) && <p className="muted small">那一格原来的摆件会被收起来。</p>}
          <Button onClick={place}>摆上去</Button>
          <button type="button" className="text-btn" onClick={() => { setMemId(null); setPicked(null); }}>换一段回忆</button>
        </>
      )}
    </Sheet>
  );
}

export default function Room({ me, current, home, go, unread = {}, refreshUnread, refreshCharacters, route }) {
  const branchId = current.viewBranch.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => new Date());
  const [hangSlot, setHangSlot] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [noteFirst, setNoteFirst] = useState(false);
  const [keep, setKeep] = useState(null);
  const [placing, setPlacing] = useState(!!route?.memoryId);
  const [myDoll, setMyDoll] = useState(null);
  const [lookOpen, setLookOpen] = useState(false);
  const [diaryFrom, setDiaryFrom] = useState(null);
  const [phoneFrom, setPhoneFrom] = useState(null); // 点了床头的手机：拿起 TA 的手机 // 点了日记本：从日记本的位置“拿起来”
  const visitKey = `xsj:visit:${current.id}`;
  const [visit, setVisit] = useState(() => { try { return localStorage.getItem(visitKey) === '1'; } catch { return false; } });
  useEffect(() => { get('/api/local/mydoll').then((r) => setMyDoll(r.doll || null), () => {}); }, []);
  function toggleVisit() {
    const v = !visit; setVisit(v);
    try { localStorage.setItem(visitKey, v ? '1' : '0'); } catch { /* 无痕模式 */ }
    toast(v ? `你来${current.name}的房间串门了` : '你离开了房间');
  }

  async function load() {
    try { setData(await get(`/api/branches/${branchId}/room`)); setError(null); } catch (e) { setError(e); }
  }
  const markRead = () => post(`/api/characters/${current.id}/read`, { area: 'room' }).then(() => refreshUnread?.(), () => {});
  useEffect(() => {
    load();
    const t = setInterval(() => { setNow(new Date()); load(); }, 6000);
    const onNew = () => load();
    window.addEventListener('xsj:new-events', onNew);
    return () => { clearInterval(t); window.removeEventListener('xsj:new-events', onNew); markRead(); };
  }, [branchId]);
  // 打开的照片跟着数据刷新（例如纸条刚写好）
  const livePhoto = photo && data?.photos.find((p) => p.seq === photo.seq);

  const unreadNote = (unread.room?.[current.id] || 0) > 0;
  const act = data ? activityOf(now, data) : null;

  return (
    <div className="page room">
      <TopBar title={`${current.name}的房间`} onBack={home} sub={<Thread name={current.viewBranch.name} onClick={() => go('worldlines')} />}
        right={<button className="text-btn" onClick={() => setPlacing(true)}>摆件</button>} />
      <div className="page-body room-body">
        {error && <ErrorBox error={error} onRetry={load} />}
        {!data && !error && <Loading />}
        {data && (
          <>
            <RoomScene data={data} current={current} me={visit ? myDoll : null} now={now} unreadChat={unread.chat?.[current.id] || 0} unreadNote={unreadNote}
              onSlot={(i) => setHangSlot(i)}
              onPhoto={(p) => { setPhoto(p); setNoteFirst(false); if (p.note) markRead(); }}
              onNote={(p) => { setPhoto(p); setNoteFirst(true); markRead(); }}
              onKeepsake={setKeep}
              onDiary={(rect) => setDiaryFrom(rect || null)} onPhone={(rect) => setPhoneFrom(rect || null)} onCharacter={() => go('chat', { thread: current.id })} />
            <p className="room-status"><span className="dot" style={{ background: current.avatarColor }} />{current.name}{ACTIVITY_TEXT[act]}</p>
            <div className="room-visit">
              <button className="text-btn" onClick={() => setLookOpen(true)}>{current.doll ? `换${current.name}的形象` : `给${current.name}画个小人`}</button>
              <span className="room-visit-sep" aria-hidden="true">·</span>
              {myDoll
                ? <button className="text-btn is-quiet" onClick={toggleVisit}>{visit ? '离开房间' : '我去串门'}</button>
                : <button className="text-btn is-quiet" onClick={() => go('doll', { target: 'me', back: 'room' })}>画我自己（串门用）</button>}
            </div>
            <p className="muted small room-tip">点空相框挂照片 · 点照片旁的小纸条看 TA 写的话 · 点架子上的摆件回忆那段时光 · 点书桌上的日记本、床头 TA 的手机</p>
            {phoneFrom && <CharPhone from={phoneFrom} current={current} me={me} onClose={() => setPhoneFrom(null)} />}
            {diaryFrom && <DiaryBook from={diaryFrom} current={current} onClose={() => setDiaryFrom(null)} onOpenApp={() => go('diary')} />}
          </>
        )}
      </div>
      {data && (
        <>
          <HangSheet open={hangSlot !== null} slot={hangSlot} current={current} onClose={() => setHangSlot(null)} onDone={() => { setHangSlot(null); load(); }} />
          {livePhoto && <PhotoSheet photo={livePhoto} data={data} current={current} startWithNote={noteFirst} onClose={() => setPhoto(null)} onChanged={() => { setPhoto(null); load(); }} />}
          {keep && <KeepsakeSheet k={keep} current={current} onClose={() => setKeep(null)} onChanged={() => { setKeep(null); load(); }} />}
          <Sheet open={lookOpen} onClose={() => setLookOpen(false)} title={`${current.name}的形象`}>
            <p className="muted small">可以用预设的小人，也可以在白板小人上一格一格给 TA 画。</p>
            <LookPicker current={current} refreshCharacters={refreshCharacters} go={go} back="room" />
          </Sheet>
          <PlaceSheet open={placing} current={current} data={data} presetMemoryId={route?.memoryId} onClose={() => setPlacing(false)} onDone={() => { setPlacing(false); load(); }} />
        </>
      )}
    </div>
  );
}
