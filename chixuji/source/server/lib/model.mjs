// 模型接入层：DeepSeek（正式）或 mock（没填密钥时的测试回复）
import { createDeepSeek, ModelError } from './deepseek.mjs';

export { ModelError };

export function createModel(config, db) {
  if (config.modelProvider === 'deepseek') return deepseekModel(config, db);
  if (config.modelProvider === 'mock') return mockModel;
  throw new Error(`未知的模型设置：${config.modelProvider}`);
}

function deepseekModel(config, db) {
  const ds = createDeepSeek(config, db);
  const c = config.deepseek;
  return {
    name: c.chatModel,
    // 角色回复：V4 Pro
    async reply({ system, history, who, meta }) {
      const r = await ds.chat({
        model: c.chatModel, purpose: 'reply', who, reasoning: c.chatReasoning, maxTokens: 1500, temperature: 1.1,
        messages: [{ role: 'system', content: system }, ...history],
      });
      return cleanReply(r.text, meta?.characterName);
    },
    // 看图：Flash 客观描述图片，交给 Pro 以角色身份回应
    async describeImage({ dataUrl, userText, who }) {
      const r = await ds.chat({
        model: c.visionModel, purpose: 'vision', who, maxTokens: 500, temperature: 0.2,
        messages: [
          { role: 'system', content: '你负责客观描述用户发来的图片，供另一个人参考。只描述看得见的内容：主体、场景、动作、图中文字（看不清就写“看不清”）、氛围。不猜测图片以外的事，不评价。200 字以内。' },
          { role: 'user', content: [
            { type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } },
            { type: 'text', text: userText ? `请描述这张图片。用户发图时说：${userText}` : '请描述这张图片。' },
          ] },
        ],
      });
      return r.text.slice(0, 600);
    },
    // 记忆整理：Flash，JSON 输出
    async extractMemories({ system, user, who }) {
      const r = await ds.chat({
        model: c.memoryModel, purpose: 'memory', who, json: true, maxTokens: 2000, temperature: 0.1,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      });
      try {
        const parsed = JSON.parse(r.text);
        return Array.isArray(parsed?.memories) ? parsed.memories : [];
      } catch {
        throw new ModelError('记忆整理返回的格式不对', { code: 'bad_json' });
      }
    },
  };
}

// 去掉模型偶尔加上的“角色名：”前缀
export function cleanReply(text, name) {
  if (!name) return text.trim();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*${esc}\\s*[：:]\\s*`), '').trim();
}

const mockModel = {
  name: 'mock',
  async reply({ meta }) {
    const t = meta.userText || '（图片）';
    const short = t.length > 40 ? t.slice(0, 40) + '…' : t;
    const v = meta.settingsVersion ? `人设 v${meta.settingsVersion}` : '无人设';
    return `（测试回复 · ${v}）${meta.characterName}收到了：「${short}」。在 .env 里填好 DeepSeek 密钥后，这里会是真正的角色回复。`;
  },
  async describeImage() { return '（测试模式）一张图片'; },
  async extractMemories() { return []; },
};
