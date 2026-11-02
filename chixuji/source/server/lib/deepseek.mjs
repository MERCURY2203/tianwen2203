// DeepSeek 接口（和 OpenAI 格式一样）。每次调用都记账到 model_calls 表。
import { now } from './db.mjs';
import { newId } from './story.mjs';

export class ModelError extends Error {
  constructor(message, { status = 502, code = 'model_error', retryable = true } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

// DeepSeek 高峰时段：北京时间工作日 9–12 点、14–18 点（价格翻倍）
export function isPeak(d = new Date()) {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const h = d.getUTCHours();
  return (h >= 1 && h < 4) || (h >= 6 && h < 10);
}

export function estimateCostMicroYuan(config, model, usage, at = new Date()) {
  const p = config.prices[model];
  if (!p || !usage) return null;
  const hit = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens ?? 0) - hit;
  const out = usage.completion_tokens ?? 0;
  const usd = (hit * p.hit + miss * p.miss + out * p.out) / 1e6;
  return Math.round(usd * (isPeak(at) ? 2 : 1) * config.usdToCny * 1e6);
}

function friendly(status, body) {
  if (status === 401) return new ModelError('DeepSeek 密钥不对或已失效，请检查 .env 里的 DEEPSEEK_API_KEY', { code: 'auth', retryable: false });
  if (status === 402) return new ModelError('DeepSeek 账户余额不足，请充值后再试', { code: 'balance', retryable: false });
  if (status === 429) return new ModelError('DeepSeek 太忙了，请稍后再试', { code: 'rate', retryable: true });
  if (status === 400 || status === 422) return new ModelError('请求内容不被 DeepSeek 接受：' + (body?.error?.message || status), { code: 'bad_request', retryable: false });
  return new ModelError(`DeepSeek 暂时出错了（${status}），请稍后重试`, { code: 'upstream', retryable: true });
}

export function createDeepSeek(config, db) {
  const ds = config.deepseek;

  /**
   * @param {object} o
   * @param {string} o.model
   * @param {Array} o.messages
   * @param {string} o.purpose  reply / vision / memory
   * @param {object} o.who      { userId, characterId, branchId }
   */
  async function chat({ model, messages, purpose, who = {}, json = false, maxTokens = 1200, reasoning = 'none', temperature }) {
    const apiKey = purpose === 'memory' ? ds.memoryApiKey : ds.apiKey;
    if (!apiKey) throw new ModelError('还没有填写 DeepSeek 密钥（.env 里的 DEEPSEEK_API_KEY）', { code: 'auth', retryable: false });
    const started = Date.now();
    const body = { model, messages, max_tokens: maxTokens, stream: false };
    // DeepSeek 默认开着“思考”；关掉要明确发 thinking: disabled（reasoning_effort 没有 none 这一档）
    const think = !!reasoning && reasoning !== 'none';
    body.thinking = { type: think ? 'enabled' : 'disabled' };
    if (think) body.reasoning_effort = reasoning;
    if (json) body.response_format = { type: 'json_object' };
    if (temperature !== undefined && !think) body.temperature = temperature;

    const record = (ok, { usage = null, error = null } = {}) => {
      db.prepare(
        `INSERT INTO model_calls (id, user_id, character_id, branch_id, purpose, model, ok, error,
          prompt_hit_tokens, prompt_miss_tokens, completion_tokens, cost_micro_yuan, ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(), who.userId ?? null, who.characterId ?? null, who.branchId ?? null, purpose, model, ok ? 1 : 0, error,
        usage?.prompt_cache_hit_tokens ?? null,
        usage ? (usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens ?? 0) - (usage.prompt_cache_hit_tokens ?? 0)) : null,
        usage?.completion_tokens ?? null, estimateCostMicroYuan(config, model, usage), Date.now() - started, now(),
      );
    };

    let res;
    try {
      res = await fetch(`${ds.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ds.timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError';
      record(false, { error: timeout ? 'timeout' : 'network' });
      // 超时时上游可能已经处理并计费，所以不自动重试
      throw new ModelError(timeout ? 'DeepSeek 回复超时了，请稍后重试' : '连不上 DeepSeek，请检查网络', { code: timeout ? 'timeout' : 'network', retryable: !timeout });
    }

    let data = null;
    try { data = await res.json(); } catch { /* 非 JSON */ }
    if (!res.ok) {
      record(false, { error: `http_${res.status}` });
      throw friendly(res.status, data);
    }
    const choice = data?.choices?.[0];
    record(true, { usage: data?.usage });
    if (choice?.finish_reason === 'content_filter') {
      throw new ModelError('这条内容触发了内容限制，换个说法试试', { status: 422, code: 'content_filter', retryable: false });
    }
    const text = (choice?.message?.content ?? '').trim();
    if (!text) throw new ModelError('DeepSeek 返回了空内容，请重试', { code: 'empty' });
    return { text, finishReason: choice.finish_reason, usage: data.usage };
  }

  return { chat };
}
