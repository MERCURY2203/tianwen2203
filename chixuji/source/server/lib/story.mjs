// 故事核心规则：世界线（分支）的可见范围、设定版本、事件写入
import crypto from 'node:crypto';
import { now } from './db.mjs';

export { SETTING_FIELDS, cleanSettings } from './fields.mjs';

export const newId = () => crypto.randomUUID();

export function getBranch(db, id) {
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
}

/**
 * 一个分支能看到的范围：自己的全部事件 + 每一层祖先在分叉点之前（含）的事件。
 * 返回 [{ branchId, maxSeq }]，maxSeq 为 null 表示不限。
 */
export function lineage(db, branch) {
  const out = [{ branchId: branch.id, maxSeq: null }];
  let cur = branch;
  let limit = null;
  const seen = new Set([branch.id]);
  while (cur.parent_branch_id) {
    limit = limit === null ? cur.fork_seq : Math.min(limit, cur.fork_seq);
    const parent = getBranch(db, cur.parent_branch_id);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    out.push({ branchId: parent.id, maxSeq: limit });
    cur = parent;
  }
  return out;
}

export function visibleClause(lin, seqCol = 'seq') {
  const parts = [];
  const params = [];
  for (const l of lin) {
    if (l.maxSeq === null) {
      parts.push('(branch_id = ?)');
      params.push(l.branchId);
    } else {
      parts.push(`(branch_id = ? AND ${seqCol} <= ?)`);
      params.push(l.branchId, l.maxSeq);
    }
  }
  return { sql: '(' + parts.join(' OR ') + ')', params };
}

export const rowToEvent = (r) => ({
  seq: r.seq,
  branchId: r.branch_id,
  kind: r.kind,
  data: JSON.parse(r.data),
  createdAt: r.created_at,
});

// 读取某个分支可见的事件（时间正序），支持往前翻页
export function visibleEvents(db, branch, { beforeSeq = null, afterSeq = null, limit = 50, kinds = null } = {}) {
  const lin = lineage(db, branch);
  const v = visibleClause(lin);
  let sql = `SELECT * FROM events WHERE character_id = ? AND hidden_at IS NULL AND ${v.sql}`;
  const params = [branch.character_id, ...v.params];
  if (beforeSeq !== null) { sql += ' AND seq < ?'; params.push(beforeSeq); }
  if (afterSeq !== null) { sql += ' AND seq > ?'; params.push(afterSeq); }
  if (kinds) { sql += ` AND kind IN (${kinds.map(() => '?').join(',')})`; params.push(...kinds); }
  sql += ' ORDER BY seq DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).reverse().map(rowToEvent);
}

export function visibleEventBySeq(db, branch, seq) {
  const lin = lineage(db, branch);
  const v = visibleClause(lin);
  const r = db
    .prepare(`SELECT * FROM events WHERE character_id = ? AND seq = ? AND hidden_at IS NULL AND ${v.sql}`)
    .get(branch.character_id, seq, ...v.params);
  return r ? rowToEvent(r) : null;
}

// 某个分支当前生效的设定版本 = 可见范围内最后一次“设定变更”事件
export function effectiveSettings(db, branch) {
  const [ev] = visibleEvents(db, branch, { limit: 1, kinds: ['settings_change'] });
  if (!ev) return null;
  const v = db.prepare('SELECT * FROM setting_versions WHERE id = ?').get(ev.data.versionId);
  if (!v) return null;
  return { versionId: v.id, version: v.version, data: JSON.parse(v.data), note: v.note, createdAt: v.created_at, changedAtSeq: ev.seq };
}

export function appendEvent(db, { characterId, branchId, kind, data }) {
  const r = db
    .prepare('INSERT INTO events (character_id, branch_id, kind, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(characterId, branchId, kind, JSON.stringify(data), now());
  return Number(r.lastInsertRowid);
}

export function createSettingVersion(db, characterId, data, note) {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM setting_versions WHERE character_id = ?').get(characterId);
  const version = row.v + 1;
  const id = newId();
  db.prepare('INSERT INTO setting_versions (id, character_id, version, data, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, characterId, version, JSON.stringify(data), note || null, now());
  return { id, version };
}
