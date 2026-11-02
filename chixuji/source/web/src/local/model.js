// 纯前端版的模型接入：浏览器直接调用用户自己填的接口（DeepSeek 或兼容 OpenAI 格式的地址）
import { newId, now } from './logic.js';
import { licensed } from './license.js';

export class ModelError extends Error {
  constructor(message, { status = 502, code = 'model_error' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const DEFAULT_MODEL_SETTINGS = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: '',
  chatModel: 'deepseek-v4-pro',
  // 看图和整理记忆可以用另一个接口和密钥；不填就和上面一样
  auxBaseUrl: '',
  auxApiKey: '',
  visionModel: 'deepseek-flash',
  memoryModel: 'deepseek-flash',
  reasoning: 'none',
  memoryEvery: 8,
  historyMessages: 60,
};

// 估算花费用（美元 / 百万 token，非高峰；高峰按 2 倍）
const PRICES = {
  'deepseek-v4-pro': { hit: 0.022, miss: 0.66, out: 1.98 },
  'deepseek-flash': { hit: 0.003, miss: 0.15, out: 0.6 },
};
const isPeak = (d) => { const day = d.getUTCDay(); const h = d.getUTCHours(); return day !== 0 && day !== 6 && ((h >= 1 && h < 4) || (h >= 6 && h < 10)); };
export function estimateYuan(model, usage, at = new Date()) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens ?? 0) - hit;
  const usd = (hit * p.hit + miss * p.miss + (usage.completion_tokens ?? 0) * p.out) / 1e6;
  return usd * (isPeak(at) ? 2 : 1) * 7.2;
}

function friendly(status, body) {
  const msg = body?.error?.message || '';
  if (status === 401) return new ModelError('API 密钥不对或已失效，请到「设置 → 模型」检查', { code: 'auth' });
  if (status === 402) return new ModelError('API 账户余额不足，请充值后再试', { code: 'balance' });
  if (status === 404) return new ModelError(`找不到这个模型或接口地址不对${msg ? `：${msg}` : ''}`, { code: 'not_found' });
  if (status === 429) return new ModelError('模型服务太忙了，请稍后再试', { code: 'rate' });
  if (status === 400 || status === 422) return new ModelError('请求没被接受：' + (msg || status), { code: 'bad_request' });
  return new ModelError(`模型服务暂时出错了（${status}），请稍后重试`, { code: 'upstream' });
}

export function createModel(store, getSettings) {
  async function chat({ purpose, model, messages, json = false, maxTokens = 1200, reasoning = 'none', temperature, who = {}, real = false }) {
    const cfg = getSettings();
    // “测试连接”永远真的去连，免得体验模式下也显示“连接成功”
    if (cfg.mock && !real) return mockChat({ purpose, messages, json });
    const aux = purpose !== 'reply';
    const baseUrl = ((aux && cfg.auxBaseUrl) || cfg.baseUrl || '').replace(/\/+$/, '');
    const apiKey = (aux && cfg.auxApiKey) || cfg.apiKey;
    if (!apiKey) throw new ModelError('还没有填写 API 密钥，请到「设置 → 模型」填写', { code: 'auth' });
    if (!/^https?:\/\//.test(baseUrl)) throw new ModelError('接口地址不对，请到「设置 → 模型」检查', { code: 'bad_url' });
    const body = { model, messages, max_tokens: maxTokens, stream: false };
    // DeepSeek 默认开着“思考”；关掉要明确发 thinking: disabled（reasoning_effort 没有 none 这一档）
    const think = !!reasoning && reasoning !== 'none';
    if (/deepseek\.com/i.test(baseUrl)) body.thinking = { type: think ? 'enabled' : 'disabled' };
    if (think) body.reasoning_effort = reasoning;
    if (json) body.response_format = { type: 'json_object' };
    if (temperature !== undefined && !think) body.temperature = temperature;
    const started = Date.now();
    const record = (ok, usage = null, error = null) => store.insert('modelCalls', {
      id: newId(), purpose, model, ok, error, usage, costYuan: estimateYuan(model, usage), ms: Date.now() - started,
      characterId: who.characterId ?? null, createdAt: now(),
    });
    if (!licensed()) throw new Error('请先激活卡密');
    let res;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError';
      record(false, null, timeout ? 'timeout' : 'network');
      throw new ModelError(timeout ? '模型回复超时了，请稍后重试' : '连不上模型服务：请检查网络，或接口地址是否允许网页直接访问', { code: timeout ? 'timeout' : 'network' });
    }
    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON */ }
    if (!res.ok) { record(false, null, `http_${res.status}`); throw friendly(res.status, data); }
    record(true, data?.usage);
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw new ModelError('这条内容触发了内容限制，换个说法试试', { status: 422, code: 'content_filter' });
    const text = (choice?.message?.content ?? '').trim();
    if (!text) throw new ModelError('模型返回了空内容，请重试', { code: 'empty' });
    return text;
  }

  return {
    get name() { const c = getSettings(); return c.mock ? 'mock' : c.chatModel; },
    async reply({ system, history, who, meta }) {
      const c = getSettings();
      if (c.mock) return mockReply(meta);
      const text = await chat({ purpose: 'reply', model: c.chatModel, reasoning: c.reasoning, maxTokens: 1500, temperature: 1.1, who, messages: [{ role: 'system', content: system }, ...history] });
      const esc = (meta?.characterName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return esc ? text.replace(new RegExp(`^\\s*${esc}\\s*[：:]\\s*`), '').trim() : text;
    },
    async describeImage({ dataUrl, userText, who }) {
      const c = getSettings();
      if (c.mock) return '（测试模式）一张图片';
      const text = await chat({
        purpose: 'vision', model: c.visionModel, maxTokens: 500, temperature: 0.2, who,
        messages: [
          { role: 'system', content: '你负责客观描述用户发来的图片，供另一个人参考。只描述看得见的内容：主体、场景、动作、图中文字（看不清就写“看不清”）、氛围。不猜测图片以外的事，不评价。200 字以内。' },
          { role: 'user', content: [{ type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } }, { type: 'text', text: userText ? `请描述这张图片。用户发图时说：${userText}` : '请描述这张图片。' }] },
        ],
      });
      return text.slice(0, 600);
    },
    async extractMemories({ system, user, who }) {
      const c = getSettings();
      if (c.mock) return [];
      const text = await chat({ purpose: 'memory', model: c.memoryModel, json: true, maxTokens: 2000, temperature: 0.1, who, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
      try {
        const parsed = JSON.parse(text);
        return Array.isArray(parsed?.memories) ? parsed.memories : [];
      } catch { throw new ModelError('记忆整理返回的格式不对', { code: 'bad_json' }); }
    },
    // 朋友圈、日记等：用回复模型按任务生成（json=true 时返回解析好的对象）
    async complete({ purpose, system, task, json = false, maxTokens = 800, who }) {
      const c = getSettings();
      if (c.mock) return json ? {} : '（测试模式）';
      const text = await chat({ purpose, model: c.chatModel, reasoning: c.reasoning, json, maxTokens, temperature: 1.0, who, messages: [{ role: 'system', content: system }, { role: 'user', content: task }] });
      if (!json) return text;
      try { return JSON.parse(text); } catch { throw new ModelError('模型返回的格式不对', { code: 'bad_json' }); }
    },
    // 设置页的“连接测试”：发一句很短的话，几乎不花钱
    async test(kind = 'reply') {
      const c = getSettings();
      const model = kind === 'reply' ? c.chatModel : c.memoryModel;
      const text = await chat({ purpose: kind === 'reply' ? 'reply' : 'memory', model, maxTokens: 10, real: true, messages: [{ role: 'user', content: '只回复两个字：你好' }] });
      return text;
    },
  };
}

function mockReply(meta) {
  const t = meta.userText || '（图片）';
  const short = t.length > 40 ? t.slice(0, 40) + '…' : t;
  return `（测试回复 · ${meta.settingsVersion ? `人设 v${meta.settingsVersion}` : '无人设'}）${meta.characterName}收到了：「${short}」。在「设置 → 模型」里填好 API 密钥后，这里会是真正的角色回复。`;
}
function mockChat() { return '你好'; }
