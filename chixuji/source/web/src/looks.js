// 房间里可选的预设形象（图片在 web/public/sprites）
export const LOOKS = [
  { id: 'm01', name: '1' },
  { id: 'm02', name: '2' },
  { id: 'f01', name: '3' },
  { id: 'f02', name: '4' },
];
import { dollUrl } from './doll.js';
export const sprite = (look, view = 'front') => `sprites/${look}-${view}.png`;
// 人物在房间里的图：自己画的小人 or 预设
export const lookSrc = (c, view = 'front') => (c?.look === 'doll' ? dollUrl(c.doll, view) : sprite(c?.look, view));
