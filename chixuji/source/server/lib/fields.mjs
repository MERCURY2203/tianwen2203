// 角色卡字段与设定清理（服务器版和纯前端版共用，不依赖 Node 专属功能）
import { bad } from './http.mjs';

// 角色卡字段（前端也从 /api/meta 读取这份定义，保证两边一致）
export const SETTING_FIELDS = [
  { key: 'identity', label: '身份与背景', hint: '身份、经历、所属世界', group: '角色' },
  { key: 'relation', label: '与你的初始关系', hint: '例如：刚认识的邻居、多年的朋友', group: '角色' },
  { key: 'personality', label: '性格与价值观', hint: '怎样看待承诺、冲突、亲密、边界与责任', group: '角色' },
  { key: 'speech', label: '表达方式', hint: '措辞、句子长短、标点、表情习惯、怎么称呼你', group: '角色' },
  { key: 'behavior', label: '行为方式', hint: '怎样关心别人、怎样拒绝、什么时候主动、遇到误会怎么办', group: '角色' },
  { key: 'knowledge', label: '知识范围', hint: '知道什么、不知道什么秘密、从哪里得知信息', group: '角色' },
  { key: 'stable', label: '稳定设定', hint: '不应该被普通聊天改写的身份和事实', group: '角色' },
  { key: 'state', label: '当前状态', hint: '情绪、信任、亲密程度、当前目标', group: '角色' },
  { key: 'goodExamples', label: '符合人设的例子', hint: '写几句 TA 会说的话或会做的事', group: '例子' },
  { key: 'badExamples', label: '明显不像 TA 的反例', hint: '写几句 TA 绝对不会说的话', group: '例子' },
  { key: 'userRole', label: '你在故事里的身份', hint: '只属于这个角色的故事', group: '故事' },
];
// 世界观现在属于「世界」，旧数据里的 world 字段保留但不再显示
const LEGACY_KEYS = ['world'];
const FIELD_KEYS = new Set([...SETTING_FIELDS.map((f) => f.key), ...LEGACY_KEYS]);
const FIELD_MAX = 4000;

export function cleanSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('设定格式不对');
  const out = {};
  for (const f of SETTING_FIELDS) {
    const v = input[f.key];
    if (v === undefined || v === null) { out[f.key] = ''; continue; }
    if (typeof v !== 'string') throw bad(`「${f.label}」格式不对`);
    const s = v.replace(/\r\n/g, '\n').trim();
    if (s.length > FIELD_MAX) throw bad(`「${f.label}」不能超过 ${FIELD_MAX} 个字`);
    out[f.key] = s;
  }
  for (const k of LEGACY_KEYS) if (typeof input[k] === 'string' && input[k].trim()) out[k] = input[k].trim().slice(0, FIELD_MAX);
  for (const k of Object.keys(input)) if (!FIELD_KEYS.has(k)) throw bad(`未知的设定项：${k}`);
  return out;
}

