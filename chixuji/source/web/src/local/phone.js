// 纯前端版：TA 查你的手机（位置 / 你和同一个世界里其他人物的聊天）
// 规则：每次都要用户同意；只看不改；看完留一张“查手机记录”，TA 按人设反应，可进记忆。
// 事件：
//   phone_request { what: 'location'|'chats', askSeq }       TA 开口要看（等用户回答）
//   phone_check   { what, approved, place?, time?, chats?, log, requestSeq? }  查看结果
import { appendEvent, getBranch, MESSAGE_KINDS, newId, now, visibleEvents } from './logic.js';
import { persona, recentChat } from './social.js';

const REVERSE = 'https://api.bigdatacloud.net/data/reverse-geocode-client';
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// 坐标 → 「广州市·天河区」这样的文字；只把文字交给模型，不交经纬度
export async function placeText(fetchImpl, lat, lon, level = 'street') {
  let r = {};
  try {
    const res = await fetchImpl(`${REVERSE}?latitude=${lat}&longitude=${lon}&localityLanguage=zh`);
    if (res.ok) r = await res.json();
  } catch { /* 用下面的兜底 */ }
  const city = r.city || r.principalSubdivision || '';
  if (level === 'city') return city || '某个城市';
  const admin = (r.localityInfo?.administrative || []).map((x) => x.name).filter(Boolean);
  // 区/街道：取比城市更小的那一级
  const smaller = [r.locality, ...admin.slice().reverse()].find((n) => n && n !== city && !(r.principalSubdivision && n === r.principalSubdivision) && n !== r.countryName);
  return [city, smaller].filter(Boolean).join('·') || '一个说不清的地方';
}

// 同一个世界里的其他人物（可以给 TA 看聊天的人）
export function sameWorldOthers(s, character) {
  if (!character.worldId) return [];
  return s.t.characters.filter((c) => c.id !== character.id && c.worldId === character.worldId);
}

function chatExcerpt(s, other, limit = 30) {
  const b = getBranch(s, other.viewBranchId);
  if (!b) return { lines: [], count: 0 };
  const evs = visibleEvents(s, b, { limit, kinds: MESSAGE_KINDS });
  const lines = evs.map((e) => `[${e.createdAt.slice(5, 16).replace('T', ' ')}] ${e.kind === 'user_message' ? '用户' : other.name}：${(e.data.text || '（图片）').slice(0, 200)}`);
  return { lines, count: evs.length, lastAt: evs.length ? evs[evs.length - 1].createdAt : null };
}

// TA 开口要看手机（定时检查里偶尔触发）
export async function characterAsk(s, model, character, branch, random = Math.random) {
  const pendingReq = visibleEvents(s, branch, { limit: 20, kinds: ['phone_request', 'phone_check'] });
  const lastReq = [...pendingReq].reverse().find((e) => e.kind === 'phone_request');
  if (lastReq && Date.now() - Date.parse(lastReq.createdAt) < 24 * 3600e3) return null; // 一天最多问一次
  const others = sameWorldOthers(s, character);
  const what = others.length && random() < 0.5 ? 'chats' : 'location';
  const task = [
    '【任务：要看手机】',
    what === 'location'
      ? `按${character.name}的性格，开口问用户现在在哪、想看看用户的位置。`
      : `按${character.name}的性格，开口要用户的手机，想看看用户最近都在和谁聊天（${others.map((o) => o.name).join('、')}是你也知道的人）。`,
    `最近的聊天：\n${recentChat(s, branch, character.name, 10)}`,
    '如果按人设和现在的气氛完全不会这么做，可以不问。写成一条直接发给用户的消息，口语、简短。',
    '只输出 JSON：{"ask":"消息内容","skip":false}，不问就 {"ask":"","skip":true}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'phone', system: persona(s, character, branch), task, json: true, who: { characterId: character.id, branchId: branch.id } });
  const ask = typeof r?.ask === 'string' ? r.ask.trim().slice(0, 300) : '';
  if (r?.skip || !ask) return null;
  const askSeq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data: { text: ask, model: model.name, via: 'phone_ask' } });
  const reqSeq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'phone_request', data: { what, askSeq } });
  return { askSeq, reqSeq, what };
}

export function openRequest(s, branch) {
  const evs = visibleEvents(s, branch, { limit: 40, kinds: ['phone_request', 'phone_check'] });
  const answered = new Set(evs.filter((e) => e.kind === 'phone_check' && e.data.requestSeq).map((e) => e.data.requestSeq));
  return [...evs].reverse().find((e) => e.kind === 'phone_request' && !answered.has(e.seq)) || null;
}

// 用户的回答 / 主动给看
export async function doPhoneCheck(s, model, cfg, character, branch, { what, approve, requestSeq = null, place = null, chatIds = [] }) {
  const who = { characterId: character.id, branchId: branch.id };
  const base = { what, approved: !!approve, requestSeq };
  const time = hhmm();
  if (!approve) {
    const task = [
      '【任务：查手机被拒绝】',
      `你刚才想看用户的${what === 'location' ? '位置' : '手机聊天'}，用户没有给你看。`,
      `最近的聊天：\n${recentChat(s, branch, character.name, 8)}`,
      `按${character.name}的性格自然地回应（可以失落、调侃、尊重、追问，但不要强迫）。只输出 JSON：{"reply":"发给用户的话"}`,
    ].join('\n\n');
    const r = await model.complete({ purpose: 'phone', system: persona(s, character, branch), task, json: true, who });
    const checkSeq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'phone_check', data: { ...base, log: '' } });
    const reply = typeof r?.reply === 'string' ? r.reply.trim().slice(0, 600) : '';
    const replySeq = reply ? appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data: { text: reply, model: model.name, via: 'phone' } }) : null;
    return { checkSeq, replySeq };
  }

  let seen = '';
  let chats = [];
  if (what === 'location') {
    seen = `用户给你看了TA现在的位置：${place}（当地时间 ${time}）。这是用户现实中的位置，只精确到这一级。`;
  } else {
    const allowed = new Map(sameWorldOthers(s, character).map((c) => [c.id, c]));
    const picked = chatIds.map((id) => allowed.get(id)).filter(Boolean);
    if (!picked.length) throw new Error('请至少选一个人');
    const parts = [];
    for (const o of picked) {
      const ex = chatExcerpt(s, o);
      chats.push({ characterId: o.id, name: o.name, count: ex.count });
      parts.push(`—— 用户和「${o.name}」最近的聊天（${ex.count} 条）——\n${ex.lines.join('\n') || '（还没聊过）'}`);
    }
    seen = `用户把手机给你看了，你翻到了TA和下面这些人的聊天（只看不改）：\n\n${parts.join('\n\n')}`;
  }
  const task = [
    '【任务：查手机】',
    seen,
    `最近你们的聊天：\n${recentChat(s, branch, character.name, 8)}`,
    `以${character.name}的身份：`,
    '1. log：用第三人称写一段「查手机记录」（60~120 字），像小说旁白：你翻了什么、在哪里停住、表情或动作。只写看到的内容里真实存在的东西，不要编造。',
    '2. reply：看完后你直接对用户说的话（按人设，可以关心、调侃、吃醋、追问）。',
    '3. memory：一句值得记住的事实（例如“她今晚十点还在公司附近”“她最近常和某某聊到很晚”），没有就空字符串。',
    '只输出 JSON：{"log":"...","reply":"...","memory":"..."}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'phone', system: persona(s, character, branch), task, json: true, maxTokens: 800, who });
  const log = typeof r?.log === 'string' ? r.log.trim().slice(0, 600) : '';
  const checkSeq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'phone_check', data: { ...base, place: what === 'location' ? place : undefined, time, chats: what === 'chats' ? chats : undefined, log } });
  const reply = typeof r?.reply === 'string' ? r.reply.trim().slice(0, 1000) : '';
  const replySeq = reply ? appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data: { text: reply, model: model.name, via: 'phone' } }) : null;
  const mem = typeof r?.memory === 'string' ? r.memory.trim().slice(0, 200) : '';
  const remember = mem && (what !== 'location' || cfg.locationMemory === true);
  if (remember) {
    s.insert('memories', { id: newId(), characterId: character.id, branchId: branch.id, anchorSeq: checkSeq, kind: 'fact', holder: 'user', content: mem, sourceSeqs: [checkSeq], important: false, status: 'active', createdAt: now() });
  }
  return { checkSeq, replySeq, remembered: !!remember };
}
