// 简单的频率限制（存在内存里，重启后清零）
import { HttpError } from './http.mjs';

export class RateLimiter {
  constructor(disabled = false) {
    this.disabled = disabled;
    this.hits = new Map();
    setInterval(() => this.cleanup(), 10 * 60 * 1000).unref();
  }
  // 在 windowMs 时间内最多 limit 次
  check(key, limit, windowMs, message = '操作太频繁，请稍后再试') {
    if (this.disabled) return;
    const t = Date.now();
    const list = (this.hits.get(key) || []).filter((x) => t - x < windowMs);
    if (list.length >= limit) {
      const wait = Math.ceil((windowMs - (t - list[0])) / 1000);
      throw new HttpError(429, message, { retryAfterSeconds: wait });
    }
    list.push(t);
    this.hits.set(key, list);
  }
  cleanup() {
    const t = Date.now();
    for (const [k, list] of this.hits) if (!list.some((x) => t - x < 24 * 3600 * 1000)) this.hits.delete(k);
  }
}
