// 世界树：把所有世界线画成一棵分叉的树。从上往下是时间，每条竖线是一条世界线，
// 分叉的地方从父线弯出去。点任意一行可以切换、重命名、归档。
import React from 'react';
import { fmtTime } from '../ui.jsx';

const ROW = 58; // 每一行的高度
const LANE = 24; // 每条竖线的间距
const COLORS = ['#c2313a', '#5b7db1', '#6f9a6a', '#c98a3b', '#8a6fb5', '#3f9c9c', '#b5677d', '#7a7f3a'];

export function layoutTree(branches) {
  const byId = new Map(branches.map((b) => [b.id, b]));
  const maxSeq = branches.reduce((m, b) => Math.max(m, b.last?.seq || 0, b.forkSeq || 0), 0);
  // 每条线的起点、终点（按全局顺序号）
  const info = branches.map((b, i) => {
    const parent = b.parentId && byId.has(b.parentId) ? b.parentId : null;
    let start;
    if (b.parentId) start = b.forkSeq ?? 0;
    else if (b.isMain) start = 0;
    else start = b.first ? b.first.seq - 0.5 : maxSeq + 1 + i; // 从头开始的空白线：放在它第一条消息那里
    const end = b.last && b.last.seq > start ? b.last.seq : null;
    return { b, parent, start, end, order: i };
  });
  // 行：每条线一个“起点”行，有新消息的再加一个“最新”行
  const rows = [];
  for (const x of info) {
    rows.push({ type: 'start', seq: x.start, x });
    if (x.end !== null) rows.push({ type: 'end', seq: x.end, x });
  }
  rows.sort((a, b) => a.seq - b.seq || (a.type === b.type ? a.x.order - b.x.order : a.type === 'start' ? -1 : 1));
  rows.forEach((r, i) => { r.y = 26 + i * ROW; if (r.type === 'start') r.x.startY = r.y; else r.x.endY = r.y; });
  // 竖线的范围：从起点到最后（也要覆盖从它分出去的子线的分叉点）
  for (const x of info) { x.top = x.startY; x.bottom = x.endY ?? x.startY; }
  for (const x of info) {
    if (!x.parent) continue;
    const p = info.find((z) => z.b.id === x.parent);
    p.top = Math.min(p.top, x.startY - 22);
    p.bottom = Math.max(p.bottom, x.startY - 22);
  }
  // 分配列：按开始位置，找最左边没被占用的一列
  const cols = [];
  for (const x of [...info].sort((a, b) => a.top - b.top || a.order - b.order)) {
    const parentCol = x.parent ? info.find((z) => z.b.id === x.parent).col : -1;
    const busy = (c) => c === parentCol || (cols[c] !== undefined && cols[c] >= x.top - ROW / 2);
    // 分支尽量长在父线的右边，像树枝一样往外分
    let c = parentCol + 1;
    while (busy(c)) c++;
    x.col = c;
    cols[c] = x.bottom;
  }
  const lanes = Math.max(1, ...info.map((x) => x.col + 1));
  info.forEach((x, i) => { x.color = x.b.isMain ? '#27232f' : COLORS[i % COLORS.length]; });
  return { info, rows, lanes, height: 26 + rows.length * ROW };
}

const laneX = (col) => 14 + col * LANE;

export default function WorldTree({ branches, onSelect }) {
  if (!branches.length) return null;
  const { info, rows, lanes, height } = layoutTree(branches);
  const width = laneX(lanes - 1) + 14;
  const byId = new Map(info.map((x) => [x.b.id, x]));
  return (
    <div className="wtree" style={{ height, '--lanes': `${width}px` }}>
      <svg className="wtree-svg" width={width} height={height} aria-hidden="true">
        {info.map((x) => {
          const cx = laneX(x.col);
          const dash = x.b.archived ? '3 4' : undefined;
          const w = x.b.isView ? 3.5 : 2;
          const parts = [];
          if (x.parent) {
            const p = byId.get(x.parent);
            const px = laneX(p.col);
            const y = x.startY;
            parts.push(<path key="c" d={`M${px} ${y - 22} C ${px} ${y - 6}, ${cx} ${y - 18}, ${cx} ${y}`} fill="none" stroke={x.color} strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" />);
            parts.push(<circle key="f" cx={px} cy={y - 22} r="3" fill="#fff" stroke={p.color} strokeWidth="1.5" />);
          }
          if (x.bottom > x.top) parts.push(<line key="l" x1={cx} y1={x.top} x2={cx} y2={x.bottom} stroke={x.color} strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" />);
          parts.push(x.b.isView
            ? <g key="s"><circle cx={cx} cy={x.startY} r="8" fill={x.color} opacity=".18" /><circle cx={cx} cy={x.startY} r="5" fill={x.color} /></g>
            : <circle key="s" cx={cx} cy={x.startY} r="4.5" fill={x.color} />);
          if (x.endY !== undefined) parts.push(<circle key="e" cx={cx} cy={x.endY} r="4" fill="#fff" stroke={x.color} strokeWidth="2" />);
          return <g key={x.b.id} opacity={x.b.archived ? 0.55 : 1}>{parts}</g>;
        })}
      </svg>
      {rows.map((r) => {
        const b = r.x.b;
        return (
          <button key={r.type + b.id} type="button" className={'wtree-row' + (r.type === 'end' ? ' is-end' : '') + (b.isView ? ' is-view' : '') + (b.archived ? ' is-archived' : '')}
            style={{ top: r.y - ROW / 2, '--c': r.x.color }} onClick={() => onSelect(b)}>
            {r.type === 'start' ? (
              <>
                <span className="wtree-name">{b.name}
                  {b.isView && <span className="tag tag-red">正在查看</span>}
                  {b.isBackground && <span className="tag">后台</span>}
                  {b.archived && <span className="tag tag-grey">已归档</span>}
                </span>
                <span className="wtree-sub">
                  {b.parentId
                    ? (b.forkPreview ? `从「${b.forkPreview.text}」之后分出` : '从最开始分出')
                    : (b.isMain ? '最初的故事' : '从头开始的新故事')}
                  {r.x.end === null && (b.ownMessages ? '' : ' · 还没有新消息')}
                </span>
              </>
            ) : (
              <span className="wtree-sub">
                <b className="wtree-endname">{b.name}</b><span className="wtree-latest">最新</span>「{b.last.text}」 · {b.ownMessages} 条 · {fmtTime(b.last.at)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
