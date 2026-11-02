// 数据库：使用 Node.js 自带的 SQLite，整个数据库就是一个文件
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from './config.mjs';

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = path.join(ROOT, 'server', 'migrations');
  const done = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const name of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(name)) continue;
    tx(db, () => {
      db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(name, now());
    });
  }
}

// 事务：中途出错就全部撤销
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => new Date().toISOString();

// 每天自动备份一次，保留最近 N 天
export function startBackups(db, config, log = console) {
  if (config.disableBackups) return () => {};
  const dir = path.join(config.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const run = () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const file = path.join(dir, `xiaoshouji-${stamp}.db`);
      if (!fs.existsSync(file)) {
        db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
        log.info?.(`已备份数据库：${file}`);
      }
      const files = fs.readdirSync(dir).filter((f) => /^xiaoshouji-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
      for (const old of files.slice(0, Math.max(0, files.length - config.backupKeepDays))) fs.unlinkSync(path.join(dir, old));
    } catch (err) {
      log.error?.('备份失败：' + err.message);
    }
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000); // 每小时检查一次，当天已备份就跳过
  timer.unref();
  return () => clearInterval(timer);
}
