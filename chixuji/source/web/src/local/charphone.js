// 查角色的手机：按人设模拟 TA 手机里的内容（和别人的聊天、日程、备忘录、相册、搜索记录、没发出去的草稿）
// - 每天第一次打开时生成一份；之后再打开有一定概率“又多了点新东西”；只保留最近 7 天
// - 同一个世界里两个人物之间的聊天只生成一次，两边手机里看到的是同一段（方向反过来）
// - 可以先问 TA 能不能看；也可以偷看，偷看有概率被发现，TA 会发消息来
import { appendEvent, effectiveSettings, getBranch, MESSAGE_KINDS, newId, now, visibleEvents } from './logic.js';
import { persona, recentChat } from './social.js';
import { sameWorldOthers } from './phone.js';
import { roomState } from './room.js';

export const KEEP_DAYS = 7;
const EXTRA_AFTER_MS = 2 * 3600e3; // 距离上次生成至少 2 小时，才可能“又多了新内容”
const EXTRA_CHANCE = 0.3;
const PEEK_FOUND = 0.25; // 偷看被发现的概率
const PEEK_FOUND_AFTER_NO = 0.5; // 刚被拒绝又偷看
const ASK_VALID_MS = 30 * 60e3; // TA 同意后 30 分钟内看都算光明正大
const WALL_SET = 0.4; // 还是默认壁纸时，换成你发过的图的概率（每天一次）
const WALL_SWITCH = 0.2; // 已经用了你的图，换成另一张的概率

const pad = (n) => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const hm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const time = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v).padStart(5, '0') : '');

// 模型给的内容整理干净（字段缺了、太长了都处理掉）
function clean(raw, others) {
  const byName = new Map(others.map((o) => [o.name, o.id]));
  return {
    chats: arr(raw?.chats, 6).map((c) => ({
      with: str(c?.with, 20) || '朋友', relation: str(c?.relation, 20), withCharacterId: byName.get(str(c?.with, 20)) || null,
      messages: arr(c?.messages, 24).map((m) => ({ from: m?.from === 'them' ? 'them' : 'me', text: str(m?.text, 300), time: time(m?.time) })).filter((m) => m.text),
    })).filter((c) => c.messages.length),
    schedule: arr(raw?.schedule, 10).map((x) => ({ time: time(x?.time), title: str(x?.title, 40), note: str(x?.note, 120) })).filter((x) => x.title),
    memos: arr(raw?.memos, 5).map((x) => ({ title: str(x?.title, 30), text: str(x?.text, 600) })).filter((x) => x.text || x.title),
    photos: arr(raw?.photos, 6).map((x) => ({ time: time(x?.time), desc: str(x?.desc, 200), place: str(x?.place, 30) })).filter((x) => x.desc),
    searches: arr(raw?.searches, 10).map((x) => ({ time: time(x?.time), q: str(x?.q, 60) })).filter((x) => x.q),
    drafts: arr(raw?.drafts, 3).map((x) => ({ text: str(x?.text, 300) })).filter((x) => x.text),
  };
}

// 体验模式（没填密钥）用的示例内容
function sample(character, others) {
  const o = others[0]?.name;
  return {
    chats: [
      ...(o ? [{ with: o, relation: '同一个世界的人', messages: [{ from: 'them', text: '今天还好吗？', time: '10:12' }, { from: 'me', text: '还行，就是有点累。', time: '10:20' }] }] : []),
      { with: '妈妈', relation: '家人', messages: [{ from: 'them', text: '天冷了记得多穿点', time: '08:03' }, { from: 'me', text: '知道啦', time: '08:30' }] },
    ],
    schedule: [{ time: '09:30', title: '上午的事', note: '（体验模式的示例内容）' }, { time: '19:00', title: '晚上早点回家', note: '' }],
    memos: [{ title: '想记住的事', text: '（填好 API 密钥后，这里是按人设生成的真实内容）' }],
    photos: [{ time: '17:40', desc: '傍晚的天空，拍歪了一点', place: '' }],
    searches: [{ time: '22:10', q: '睡不着怎么办' }],
    drafts: [{ text: '其实今天有点想你。' }],
  };
}

function rowsOf(s, characterId) {
  return s.t.phones.filter((r) => r.characterId === characterId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function phoneDays(s, characterId) {
  return [...new Set(rowsOf(s, characterId).map((r) => r.day))].sort().reverse();
}
function prune(s) {
  const cut = localDay(new Date(Date.now() - (KEEP_DAYS - 1) * 86400e3));
  s.remove('phones', (r) => r.day < cut);
}

async function generate(s, model, character, branch, kind) {
  const others = sameWorldOthers(s, character);
  const today = localDay();
  const nowText = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
  // 同一个世界的人和 TA 今天已经聊过的（在别人手机里生成过）：不要重复生成
  const done = [];
  for (const r of s.t.phones) {
    if (r.day !== today || r.characterId === character.id) continue;
    for (const c of r.content.chats) if (c.withCharacterId === character.id) done.push(s.t.characters.find((x) => x.id === r.characterId)?.name);
  }
  const mine = rowsOf(s, character.id);
  const recent = mine.filter((r) => r.day >= localDay(new Date(Date.now() - 2 * 86400e3)));
  const before = recent.map((r) => `${r.day}：日程「${r.content.schedule.map((x) => x.title).join('、') || '无'}」；聊过的人「${r.content.chats.map((c) => c.with).join('、') || '无'}」`).join('\n');
  const otherLines = others.map((o) => {
    const ob = getBranch(s, o.viewBranchId);
    const d = ob ? effectiveSettings(s, ob)?.data || {} : {};
    return `- ${o.name}：${(d.identity || d.relation || '（没写设定）').slice(0, 120)}`;
  }).join('\n');
  const extra = kind === 'extra';
  const task = [
    '【任务：模拟你自己手机里的内容】',
    `现在是 ${nowText}。请以${character.name}的身份，写出你手机里${extra ? '在上次之后新增的一点点内容（很少，像几个小时里自然多出来的）' : '今天的内容'}。`,
    '要求：',
    '1. 全部符合你的设定、世界观和性格；和用户之间的事只能来自聊天里真的发生过的，不要编造共同经历。',
    '2. 和别人的聊天：对象可以是同一个世界里的其他人物（用下面给的名字），也可以是你生活里合理存在的人（家人、朋友、同事等，自己起名）。不要生成和用户的聊天。',
    `3. 时间都用 24 小时制“HH:MM”；聊天、照片、搜索记录只能发生在现在之前（${hm()} 以前）；日程可以有今天晚些时候的安排。`,
    '4. 相册里的照片用一句话描述画面（你不会画图）。草稿是你想发给用户、打了又没发出去的话（可以没有）。',
    '5. 不写色情、血腥暴力、违法内容；内容自然、生活化，有你的个性。',
    extra
      ? '数量：chats 0-2 段（每段 2-6 条），schedule 0-1，memos 0-1，photos 0-2，searches 0-3，drafts 0-1。'
      : '数量：chats 2-4 段（每段 3-10 条），schedule 3-6，memos 1-3，photos 1-4，searches 3-6，drafts 0-2。',
    `同一个世界里的其他人物：\n${otherLines || '（没有）'}`,
    done.length ? `下面这些人今天已经和你聊过（在 TA 们的手机里），不要再生成和他们的聊天：${done.filter(Boolean).join('、')}` : '',
    before ? `你手机里前两天的情况（保持连贯，别重复）：\n${before}` : '',
    `最近和用户的聊天：\n${recentChat(s, branch, character.name, 16)}`,
    '只输出 JSON：{"chats":[{"with":"对方名字","relation":"关系","messages":[{"from":"me或them","text":"内容","time":"HH:MM"}]}],"schedule":[{"time":"HH:MM","title":"事情","note":"备注"}],"memos":[{"title":"标题","text":"内容"}],"photos":[{"time":"HH:MM","desc":"画面描述","place":"地点"}],"searches":[{"time":"HH:MM","q":"搜索的内容"}],"drafts":[{"text":"没发出去的话"}]}',
  ].filter(Boolean).join('\n\n');
  let raw = null;
  if (model.name !== 'mock') {
    raw = await model.complete({ purpose: 'charphone', system: persona(s, character, branch), task, json: true, maxTokens: extra ? 1200 : 3200, who: { characterId: character.id, branchId: branch.id } });
  }
  const content = clean(raw && typeof raw === 'object' && Object.keys(raw).length ? raw : (model.name === 'mock' ? sample(character, others) : {}), others);
  const row = { id: newId(), characterId: character.id, branchId: branch.id, day: today, kind, content, createdAt: now() };
  s.insert('phones', row);
  prune(s);
  return row;
}

// 你挂在 TA 房间照片墙上的照片（现在还挂着的，按挂上去的先后）
function receivedImages(s, branch) {
  return roomState(s, branch).photos.slice().sort((a, b) => a.seq - b.seq)
    .map((p) => p.imageId).filter((id) => id && s.t.images.some((i) => i.id === id));
}
// TA 的手机壁纸：有时会换成你发过的图片（每天最多变一次，换了就一直用着）
function maybeChangeWallpaper(s, character, branch, random) {
  const pics = receivedImages(s, branch);
  const cur = character.phoneWallpaper || null;
  if (cur && !pics.includes(cur)) { character.phoneWallpaper = null; s.touch('characters'); }
  if (!pics.length) return;
  const roll = random();
  if (!character.phoneWallpaper && roll < WALL_SET) {
    // 越近发的越可能被拿来当壁纸
    const recent = pics.slice(-8);
    character.phoneWallpaper = recent[Math.floor(random() * recent.length)];
    s.touch('characters');
  } else if (character.phoneWallpaper && roll < WALL_SWITCH && pics.length > 1) {
    const others = pics.filter((p) => p !== character.phoneWallpaper);
    character.phoneWallpaper = others[Math.floor(random() * others.length)];
    s.touch('characters');
  }
}

// 拿起手机时：今天还没有就生成；有了就按概率多一点新内容
export async function openPhone(s, model, character, branch, { random = Math.random } = {}) {
  const today = localDay();
  const mine = rowsOf(s, character.id).filter((r) => r.day === today);
  if (!mine.length) { maybeChangeWallpaper(s, character, branch, random); await generate(s, model, character, branch, 'daily'); }
  else {
    const last = mine[mine.length - 1];
    if (Date.now() - Date.parse(last.createdAt) > EXTRA_AFTER_MS && random() < EXTRA_CHANCE) {
      try { await generate(s, model, character, branch, 'extra'); } catch { /* 多出来的内容生成失败就算了 */ }
    }
  }
}

// 某一天手机里的样子：自己的几份合在一起 + 别人手机里和 TA 的聊天 + 和用户的真实聊天
export function phoneView(s, character, branch, day = localDay()) {
  const rows = rowsOf(s, character.id).filter((r) => r.day === day);
  const v = { chats: [], schedule: [], memos: [], photos: [], searches: [], drafts: [] };
  for (const r of rows) for (const k of Object.keys(v)) v[k].push(...r.content[k]);
  // 同一段聊天在多份里出现：合到一起
  const merged = new Map();
  for (const c of v.chats) {
    const key = c.withCharacterId || c.with;
    if (merged.has(key)) merged.get(key).messages.push(...c.messages); else merged.set(key, { ...c, messages: [...c.messages] });
  }
  // 别的人物手机里生成过的、和 TA 的聊天（反过来看）
  for (const r of s.t.phones) {
    if (r.day !== day || r.characterId === character.id) continue;
    const other = s.t.characters.find((x) => x.id === r.characterId);
    if (!other) continue;
    for (const c of r.content.chats) {
      if (c.withCharacterId !== character.id) continue;
      const flipped = c.messages.map((m) => ({ ...m, from: m.from === 'me' ? 'them' : 'me' }));
      if (merged.has(other.id)) merged.get(other.id).messages.push(...flipped);
      else merged.set(other.id, { with: other.name, relation: '', withCharacterId: other.id, messages: flipped });
    }
  }
  const chats = [...merged.values()].map((c) => ({ ...c, messages: c.messages.sort((a, b) => (a.time || '').localeCompare(b.time || '')) }));
  // 和用户的聊天：用真实的聊天记录（当天的）
  const userChat = visibleEvents(s, branch, { limit: 400, kinds: MESSAGE_KINDS })
    .filter((e) => localDay(new Date(e.createdAt)) === day)
    .map((e) => ({ from: e.kind === 'char_message' ? 'me' : 'them', text: e.data.text || '[图片]', time: hm(new Date(e.createdAt)) }));
  const byTime = (a, b) => (a.time || '').localeCompare(b.time || '');
  return {
    day,
    userChat: userChat.slice(-60),
    chats: chats.sort((a, b) => (b.messages.at(-1)?.time || '').localeCompare(a.messages.at(-1)?.time || '')),
    schedule: v.schedule.sort(byTime), memos: v.memos, photos: v.photos.sort(byTime).reverse(), searches: v.searches.sort(byTime).reverse(), drafts: v.drafts,
    generatedAt: rows.at(-1)?.createdAt || null,
    wallpaperImageId: character.phoneWallpaper || null,
  };
}

// —— 问 TA 能不能看 ——
export async function askToSee(s, model, character, branch, setMeta, meta) {
  appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'user_message', data: { text: '能让我看看你的手机吗？' } });
  let allow = false; let reply = '';
  if (model.name === 'mock') { allow = true; reply = '（测试回复）嗯……给你看吧。'; }
  else {
    const r = await model.complete({
      purpose: 'charphone', system: persona(s, character, branch), json: true, maxTokens: 400, who: { characterId: character.id, branchId: branch.id },
      task: ['用户刚刚问你：“能让我看看你的手机吗？”', `按${character.name}的性格、你们现在的关系和最近的聊天，决定给不给看，并回一条消息。`, `最近的聊天：\n${recentChat(s, branch, character.name, 12)}`, '只输出 JSON：{"allow":true或false,"reply":"你回的消息"}'].join('\n\n'),
    });
    allow = r?.allow === true; reply = str(r?.reply, 500) || (allow ? '……好吧，给你看。' : '不要。');
  }
  appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data: { text: reply, model: model.name } });
  const asks = { ...meta('charPhoneAsk', {}) }; asks[character.id] = { allow, at: Date.now() };
  setMeta('charPhoneAsk', asks);
  return { allow, reply };
}
export function askState(meta, characterId) {
  const a = meta('charPhoneAsk', {})[characterId];
  return a && Date.now() - a.at < ASK_VALID_MS ? a : null;
}

// —— 看完放下手机：偷看的话，有概率被发现 ——
export async function closePhone(s, model, character, branch, meta, { seen = [], random = Math.random } = {}) {
  const ask = askState(meta, character.id);
  if (ask?.allow) return { discovered: false };
  const chance = ask && !ask.allow ? PEEK_FOUND_AFTER_NO : PEEK_FOUND;
  if (random() >= chance) return { discovered: false };
  const what = seen.length ? seen.join('、') : '手机';
  let text = '';
  if (model.name === 'mock') text = '（测试回复）你刚才是不是动过我手机？';
  else {
    const r = await model.complete({
      purpose: 'charphone', system: persona(s, character, branch), maxTokens: 400, who: { characterId: character.id, branchId: branch.id },
      task: [`你刚刚发现用户${ask && !ask.allow ? '在你拒绝之后，还是' : ''}偷偷看了你的手机（看了：${what}）。`, `按${character.name}的性格和你们的关系，主动给用户发一条消息。可以生气、害羞、调侃或者假装不在意，看你的性格。`, `最近的聊天：\n${recentChat(s, branch, character.name, 10)}`, '只输出你发的消息内容。'].join('\n\n'),
    });
    text = str(r, 500);
  }
  if (!text || branch.archivedAt) return { discovered: false };
  appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data: { text, model: model.name, via: 'peek' } });
  return { discovered: true };
}
