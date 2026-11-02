// 纯前端版：TA 的房间。照片墙、小纸条、记忆摆件都记成世界线上的事件，所以按世界线隔离。
// 事件类型：
//   room_photo         { slot, imageId, caption, frame, imageDesc }  用户挂上墙的照片
//   room_note          { photoSeq, text }                           TA 钉在照片旁的小纸条
//   room_photo_move    { photoSeq, slot }
//   room_photo_remove  { photoSeq, forget }                         取下（可选让 TA 忘掉）
//   room_keepsake      { memoryId, item, slot }                     用户把一条记忆做成摆件
//   room_keepsake_off  { memoryId }                                 把摆件收起来（自动的也可以收）
import { appendEvent, invalidateMemoriesFromSources, forgottenSeqs, MESSAGE_KINDS, processBranch, visibleEvents, visibleMemories } from './logic.js';
import { persona, recentChat } from './social.js';

export const PHOTO_SLOTS = 9;
export const SHELF_SLOTS = 6;
export const FRAMES = ['wood', 'white', 'black', 'gold'];
export const ITEMS = ['cat', 'shell', 'books', 'flower', 'mug', 'stars', 'letter', 'gift'];
const ROOM_KINDS = ['room_photo', 'room_note', 'room_photo_move', 'room_photo_remove', 'room_keepsake', 'room_keepsake_off'];

// 按记忆内容猜一个合适的摆件
export function guessItem(text = '') {
  const rules = [[/猫|喵/, 'cat'], [/海|贝|沙滩|浪/, 'shell'], [/书|读|小说|诗/, 'books'], [/花|绣球|玫瑰|植物/, 'flower'],
    [/咖啡|茶|喝|饮料|奶/, 'mug'], [/星|夜|月|天空|灯/, 'stars'], [/信|约定|答应|承诺|说好/, 'letter']];
  for (const [re, item] of rules) if (re.test(text)) return item;
  return 'gift';
}

export function roomState(s, branch) {
  const evs = visibleEvents(s, branch, { limit: 1e9, kinds: ROOM_KINDS });
  // 照片
  const photos = new Map();
  for (const e of evs) {
    if (e.kind === 'room_photo') photos.set(e.seq, { seq: e.seq, slot: e.data.slot, imageId: e.data.imageId, caption: e.data.caption, frame: e.data.frame, createdAt: e.createdAt, note: null });
    else if (e.kind === 'room_note' && photos.has(e.data.photoSeq)) photos.get(e.data.photoSeq).note = { seq: e.seq, text: e.data.text, createdAt: e.createdAt };
    else if (e.kind === 'room_photo_move' && photos.has(e.data.photoSeq)) {
      const p = photos.get(e.data.photoSeq);
      const other = [...photos.values()].find((x) => x.slot === e.data.slot && x.seq !== p.seq);
      if (other) other.slot = p.slot; // 两张对调
      p.slot = e.data.slot;
    } else if (e.kind === 'room_photo_remove') photos.delete(e.data.photoSeq);
  }
  // 摆件：用户放的优先，空位再按重要记忆自动摆
  const mems = visibleMemories(s, branch);
  const memById = new Map(mems.map((m) => [m.id, m]));
  const placed = new Map(); // memoryId -> keepsake
  const off = new Set();
  for (const e of evs) {
    if (e.kind === 'room_keepsake') {
      for (const [id, k] of placed) if (k.slot === e.data.slot && id !== e.data.memoryId) placed.delete(id);
      placed.set(e.data.memoryId, { memoryId: e.data.memoryId, item: e.data.item, slot: e.data.slot, auto: false });
      off.delete(e.data.memoryId);
    } else if (e.kind === 'room_keepsake_off') { placed.delete(e.data.memoryId); off.add(e.data.memoryId); }
  }
  const keepsakes = [...placed.values()].filter((k) => memById.has(k.memoryId));
  const used = new Set(keepsakes.map((k) => k.slot));
  const candidates = mems.filter((m) => m.important && !placed.has(m.id) && !off.has(m.id)).reverse(); // 新的优先
  for (const m of candidates) {
    let slot = 0;
    while (slot < SHELF_SLOTS && used.has(slot)) slot++;
    if (slot >= SHELF_SLOTS) break;
    used.add(slot);
    keepsakes.push({ memoryId: m.id, item: guessItem(m.content), slot, auto: true });
  }
  for (const k of keepsakes) k.content = memById.get(k.memoryId)?.content || '';
  // 给“TA 在做什么”用的线索
  const lastChat = visibleEvents(s, branch, { limit: 1, kinds: MESSAGE_KINDS })[0] || null;
  const lastDiary = visibleEvents(s, branch, { limit: 1, kinds: ['diary'] })[0] || null;
  return {
    photos: [...photos.values()].sort((a, b) => a.slot - b.slot),
    keepsakes: keepsakes.sort((a, b) => a.slot - b.slot),
    lastChatAt: lastChat?.createdAt || null,
    lastDiaryAt: lastDiary?.createdAt || null,
  };
}

// 摆件对应的那段回忆：记忆来源前后的几句聊天
export function memorySnippet(s, branch, memoryId) {
  const m = visibleMemories(s, branch).find((x) => x.id === memoryId);
  if (!m) return null;
  const src = new Set(m.sourceSeqs);
  const all = visibleEvents(s, branch, { limit: 1e9, kinds: [...MESSAGE_KINDS, 'moment', 'room_photo'], order: 'earliest' });
  const idx = all.findIndex((e) => src.has(e.seq));
  const lines = idx < 0 ? [] : all.slice(Math.max(0, idx - 1), idx + 3).map((e) => ({
    seq: e.seq, who: e.kind === 'char_message' ? 'character' : 'user', source: src.has(e.seq),
    text: e.kind === 'moment' ? `（朋友圈）${e.data.text || ''}` : e.kind === 'room_photo' ? `（照片墙）${e.data.caption || '一张照片'}` : (e.data.text || '（图片）'),
    createdAt: e.createdAt,
  }));
  return { memory: { id: m.id, content: m.content, createdAt: m.createdAt }, lines };
}

// —— TA 看到新挂的照片：写一张小纸条，可能私聊 ——
export async function characterPhotoNote(s, model, character, branch, photoSeq) {
  const ev = s.eventIndex.get(photoSeq);
  if (!ev || ev.kind !== 'room_photo') return null;
  const who = { characterId: character.id, branchId: branch.id };
  let desc = ev.data.imageDesc || '';
  if (!desc) {
    const dataUrl = await s.getBlob(ev.data.imageId);
    if (dataUrl) desc = await model.describeImage({ dataUrl, userText: ev.data.caption || '', who });
    ev.data.imageDesc = desc;
    s.touch('events');
  }
  if (!roomState(s, branch).photos.some((p) => p.seq === photoSeq)) return null; // 已经取下了
  const task = [
    '【任务：照片纸条】',
    `用户在你们房间的照片墙上挂了一张照片${ev.data.caption ? `，旁边写着「${ev.data.caption}」` : ''}。`,
    desc ? `照片内容：${desc}` : '（照片没能看清）',
    `最近的聊天：\n${recentChat(s, branch, character.name, 10)}`,
    `以${character.name}的身份，写一张钉在照片旁边的小纸条：你看到这张照片想说的话。口吻按人设，像手写便条，不超过 80 字；不要编造照片里没有、聊天里也没发生过的事。`,
    '如果按你的性格还想直接发消息给用户，也可以写一条私聊（可以不写）。',
    '只输出 JSON：{"note":"纸条内容","dm":"私聊内容，不发就空字符串"}',
  ].join('\n\n');
  const r = await model.complete({ purpose: 'room', system: persona(s, character, branch), task, json: true, who });
  const text = typeof r?.note === 'string' ? r.note.trim().slice(0, 200) : '';
  if (!text) return null;
  const noteSeq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'room_note', data: { photoSeq, text } });
  const dm = typeof r?.dm === 'string' ? r.dm.trim().slice(0, 1000) : '';
  let dmSeq = null;
  if (dm && !branch.archivedAt) dmSeq = appendEvent(s, { characterId: character.id, branchId: branch.id, kind: 'char_message', data: { text: dm, model: model.name, via: 'photo', photoSeq } });
  return { noteSeq, dmSeq };
}

export function removePhoto(s, branch, photoSeq, forget) {
  if (!roomState(s, branch).photos.some((p) => p.seq === photoSeq)) return { error: 'not_found' };
  appendEvent(s, { characterId: branch.characterId, branchId: branch.id, kind: 'room_photo_remove', data: { photoSeq, forget: forget === true } });
  const forgotten = forget === true ? invalidateMemoriesFromSources(s, branch, [...forgottenSeqs(s, branch)], '用户取下了这张照片') : 0;
  return { forgotten };
}

export async function afterPhoto(s, model, settings, character, branch, photoSeq) {
  const r = await characterPhotoNote(s, model, character, branch, photoSeq);
  if (r) await processBranch({ s, model, settings, branchId: branch.id, force: true });
  return r;
}
