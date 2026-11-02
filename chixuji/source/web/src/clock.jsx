// 桌面上的时间：字体、粗细、颜色、大小、样式都可以在「设置 → 壁纸与时间样式」里换（参考 iPhone 锁屏）
import React from 'react';

export const CLOCK_FONTS = [
  { id: 'sans', name: '默认', css: '"SF Pro Display", "PingFang SC", "HarmonyOS Sans SC", "MiSans", system-ui, sans-serif' },
  { id: 'rounded', name: '圆体', css: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Varela Round", "PingFang SC", sans-serif' },
  { id: 'serif', name: '衬线', css: '"New York", "Iowan Old Style", Georgia, "Songti SC", "Noto Serif SC", serif' },
  { id: 'mono', name: '等宽', css: 'ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace' },
  { id: 'condensed', name: '窄体', css: '"Avenir Next Condensed", "Arial Narrow", "Roboto Condensed", "PingFang SC", sans-serif' },
  { id: 'hand', name: '手写', css: '"Snell Roundhand", "Segoe Script", "Bradley Hand", "Kaiti SC", "STKaiti", cursive' },
];
export const CLOCK_WEIGHTS = [{ v: 200, name: '细' }, { v: 400, name: '常规' }, { v: 600, name: '中粗' }, { v: 800, name: '粗' }];
export const CLOCK_COLORS = ['#ffffff', '#fff3d6', '#ffd1dc', '#c9f2df', '#cfe6ff', '#e3d4ff', '#ffd166', '#1d1b26'];
export const DEFAULT_CLOCK = { font: 'sans', weight: 200, color: '#ffffff', size: 64, layout: 'plain' };

export function ClockFace({ style, now }) {
  const c = { ...DEFAULT_CLOCK, ...(style || {}) };
  const font = CLOCK_FONTS.find((f) => f.id === c.font) || CLOCK_FONTS[0];
  const hh = String(now.getHours()).padStart(2, '0'); const mm = String(now.getMinutes()).padStart(2, '0');
  const st = {
    fontFamily: font.css, fontWeight: c.weight, color: c.layout === 'outline' ? 'transparent' : c.color,
    fontSize: c.layout === 'stack' ? c.size * 1.15 : c.size,
    WebkitTextStroke: c.layout === 'outline' ? `${Math.max(1, c.size / 40)}px ${c.color}` : undefined,
    textShadow: c.layout === 'glow' ? `0 0 ${c.size / 5}px ${c.color}, 0 0 ${c.size / 2}px ${c.color}88` : undefined,
  };
  return (
    <div className="home-clock">
      {c.layout === 'stack'
        ? <span className="home-time is-stack" style={st}><span>{hh}</span><span>{mm}</span></span>
        : <span className="home-time" style={st}>{hh}:{mm}</span>}
      <span className="home-date" style={{ color: c.layout === 'outline' ? c.color : c.color, fontFamily: font.css }}>
        {now.getMonth() + 1}月{now.getDate()}日 {'日一二三四五六'.split('').map((d) => '星期' + d)[now.getDay()]}
      </span>
    </div>
  );
}
