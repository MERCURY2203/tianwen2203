// 读取项目根目录的 .env 配置文件（简单的 KEY=VALUE 格式）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function loadConfig(overrides = {}) {
  const env = { ...parseEnvFile(path.join(ROOT, '.env')), ...process.env, ...overrides };
  const dataDir = path.resolve(ROOT, env.DATA_DIR || 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  // 用于给验证码、会话加密的密钥：没有就自动生成一次并保存
  let secret = env.APP_SECRET;
  if (!secret) {
    const keyFile = path.join(dataDir, 'secret.key');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    secret = fs.readFileSync(keyFile, 'utf8').trim();
  }

  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    dataDir,
    dbFile: env.DB_FILE ? path.resolve(ROOT, env.DB_FILE) : path.join(dataDir, 'xiaoshouji.db'),
    webDir: path.resolve(ROOT, env.WEB_DIR || 'web/dist'),
    secret,
    adminEmail: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    // screen：验证码直接显示在登录页（只用于自己测试）；smtp：真正发邮件（第 3 阶段接入）
    mailMode: env.MAIL_MODE || 'screen',
    // invite：凭邀请码注册；open：任何人都能注册
    registration: env.REGISTRATION || 'invite',
    modelProvider: env.MODEL_PROVIDER || 'mock',
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY || '',
      // 可选：记忆整理单独用一个密钥，方便在 DeepSeek 后台分开看花费
      memoryApiKey: env.DEEPSEEK_MEMORY_API_KEY || env.DEEPSEEK_API_KEY || '',
      baseUrl: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
      chatModel: env.CHAT_MODEL || 'deepseek-v4-pro',
      visionModel: env.VISION_MODEL || 'deepseek-flash',
      memoryModel: env.MEMORY_MODEL || 'deepseek-flash',
      // none = 关闭“深度思考”，回复更快更省钱；可改 low / high
      chatReasoning: env.CHAT_REASONING || 'none',
      timeoutMs: Number(env.MODEL_TIMEOUT_SECONDS || 90) * 1000,
    },
    // 估算花费用的价格（美元 / 百万 token，非高峰时段；高峰时段自动按 2 倍算）
    prices: {
      'deepseek-v4-pro': { hit: 0.022, miss: 0.66, out: 1.98 },
      'deepseek-flash': { hit: 0.003, miss: 0.15, out: 0.6 },
    },
    usdToCny: Number(env.USD_TO_CNY || 7.2),
    // 每多少条新消息整理一次记忆
    memoryEvery: Number(env.MEMORY_EVERY || 8),
    // 每次回复带上最近多少条原始对话
    historyMessages: Number(env.HISTORY_MESSAGES || 60),
    backupKeepDays: Number(env.BACKUP_KEEP_DAYS || 7),
    disableBackups: env.DISABLE_BACKUPS === '1',
    disableRateLimit: env.DISABLE_RATE_LIMIT === '1',
  };
}
