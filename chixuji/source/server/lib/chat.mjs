// 一次聊天回复的完整流程（对应方案第十三节的处理顺序）
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './http.mjs';
import { ModelError } from './deepseek.mjs';
import { buildHistory, buildSystemPrompt } from './prompt.mjs';
import { appendEvent, effectiveSettings, visibleEvents } from './story.mjs';
import { correctionsMap, processBranch, visibleControlEvents, visibleMemories } from './memory.mjs';

const MESSAGE_KINDS = ['user_message', 'char_message'];
const busy = new Set();

// —— 图片 ——
const MAGIC = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { mime: 'image/gif', ext: 'gif', test: (b) => b.slice(0, 4).toString() === 'GIF8' },
];
export const sniffImage = (buf) => MAGIC.find((m) => buf.length > 12 && m.test(buf)) || null;
export const imageDir = (config) => path.join(config.dataDir, 'images');
export function imagePath(config, img) {
  const ext = MAGIC.find((m) => m.mime === img.mime)?.ext || 'bin';
  return path.join(imageDir(config), `${img.id}.${ext}`);
}
function imageDataUrl(config, img) {
  return `data:${img.mime};base64,${fs.readFileSync(imagePath(config, img)).toString('base64')}`;
}

/**
 * 根据当前世界线的历史生成一条角色回复。
 * 要求：可见历史的最后一条是用户消息（新发的，或上次回复失败留下的）。
 */
export async function generateReply({ db, model, config, branch, character, log = console }) {
  if (busy.has(branch.id)) throw new HttpError(409, '上一条还在回复中，请稍等');
  busy.add(branch.id);
  try {
    const who = { userId: character.user_id, characterId: character.id, branchId: branch.id };
    let events = visibleEvents(db, branch, { limit: config.historyMessages, kinds: MESSAGE_KINDS });
    const last = events[events.length - 1];
    if (!last || last.kind !== 'user_message') throw new HttpError(400, '没有需要回复的消息');

    // 用户发了图片但还没识别：先让 Flash 看图
    if (last.data.imageId && !last.data.imageDesc) {
      const img = db.prepare('SELECT * FROM images WHERE id = ? AND character_id = ?').get(last.data.imageId, character.id);
      if (!img) throw new HttpError(400, '图片找不到了');
      const desc = await model.describeImage({ dataUrl: imageDataUrl(config, img), userText: last.data.text, who });
      last.data.imageDesc = desc;
      db.prepare('UPDATE events SET data = ? WHERE seq = ?').run(JSON.stringify(last.data), last.seq);
    }

    const controls = visibleControlEvents(db, branch);
    const corrected = correctionsMap(controls);
    const settings = effectiveSettings(db, branch);
    const memories = visibleMemories(db, branch, { controls }).slice(-150);
    const corrections = controls.filter((e) => e.kind === 'correction').slice(-10).map((e) => e.data);

    const text = await model.reply({
      system: buildSystemPrompt({
        name: character.name, settings, memories, corrections,
        world: character.world_id ? db.prepare('SELECT name, lore FROM worlds WHERE id = ?').get(character.world_id) : null,
      }),
      history: buildHistory(events, corrected),
      who,
      meta: { characterName: character.name, settingsVersion: settings?.version ?? null, userText: last.data.text },
    });

    const seq = appendEvent(db, {
      characterId: character.id, branchId: branch.id, kind: 'char_message',
      data: { text, model: model.name, settingsVersion: settings?.version ?? null },
    });

    // 记忆整理放到后台慢慢做，不耽误回复
    setImmediate(() => processBranch({ db, model, config, branchId: branch.id, log }).catch(() => {}));
    return { userSeq: last.seq, replySeq: seq };
  } catch (err) {
    if (err instanceof ModelError) throw new HttpError(err.status === 422 ? 422 : 502, err.message, { modelError: err.code });
    throw err;
  } finally {
    busy.delete(branch.id);
  }
}

// 删除角色或账号时，把对应的图片文件也删掉
export function deleteImageFiles(db, config, { userId = null, characterId = null }) {
  const rows = characterId
    ? db.prepare('SELECT * FROM images WHERE character_id = ?').all(characterId)
    : db.prepare('SELECT * FROM images WHERE user_id = ?').all(userId);
  for (const img of rows) {
    try { fs.unlinkSync(imagePath(config, img)); } catch { /* 已经不在了 */ }
  }
  if (userId) {
    for (const a of db.prepare('SELECT * FROM avatars WHERE user_id = ?').all(userId)) {
      const ext = a.mime.split('/')[1] === 'jpeg' ? 'jpg' : a.mime.split('/')[1];
      try { fs.unlinkSync(path.join(config.dataDir, 'avatars', `${a.id}.${ext}`)); } catch { /* 已经不在了 */ }
    }
  }
}
