// 记忆：由 DeepSeek Flash 从聊天里整理“候选”，程序核验来源后才入库。
// 记忆的可见范围和聊天消息一样按世界线隔离：
//   - 每次整理都在当前世界线写一条 memory_commit 事件，记忆挂在这条事件上；
//   - 在整理之前就分出去的世界线看不到它（后来整理的内容不会倒灌）；
//   - 删除 / 确认 / 纠错作废也写成当前世界线的事件，不影响别的世界线。
import { now, tx } from './db.mjs';
import { ModelError } from './deepseek.mjs';
import { memorySystemPrompt, memoryUserPrompt } from './prompt.mjs';
import { appendEvent, lineage, newId, rowToEvent, visibleClause, visibleEvents } from './story.mjs';

const MESSAGE_KINDS = ['user_message', 'char_message'];

// 当前世界线可见的“纠错”和“记忆覆盖”事件
export function visibleControlEvents(db, branch) {
  const lin = lineage(db, branch);
  const v = visibleClause(lin);
  return db
    .prepare(`SELECT * FROM events WHERE character_id = ? AND hidden_at IS NULL AND kind IN ('correction','memory_override','memory_commit') AND ${v.sql} ORDER BY seq`)
    .all(branch.character_id, ...v.params)
    .map(rowToEvent);
}

export function correctionsMap(controls) {
  const map = new Map();
  for (const e of controls) if (e.kind === 'correction') map.set(e.data.targetSeq, e.data);
  return map;
}

// 已整理到哪一条消息
export function processedUpTo(controls) {
  let upto = 0;
  for (const e of controls) if (e.kind === 'memory_commit') upto = Math.max(upto, e.data.uptoSeq);
  return upto;
}

/** 当前世界线能看到的记忆（已套用删除 / 确认 / 作废）。statuses 默认只要生效的 */
export function visibleMemories(db, branch, { statuses = ['active'], controls = null } = {}) {
  const lin = lineage(db, branch);
  const v = visibleClause(lin, 'anchor_seq');
  const rows = db
    .prepare(`SELECT * FROM memories WHERE character_id = ? AND ${v.sql} ORDER BY anchor_seq, created_at`)
    .all(branch.character_id, ...v.params);
  const ctl = controls || visibleControlEvents(db, branch);
  const override = new Map();
  for (const e of ctl) if (e.kind === 'memory_override') override.set(e.data.memoryId, e.data);
  return rows
    .map((m) => {
      const o = override.get(m.id);
      let status = m.status;
      if (o?.action === 'delete') status = 'invalid';
      else if (o?.action === 'confirm' && status === 'pending') status = 'active';
      return {
        id: m.id, branchId: m.branch_id, kind: m.kind, holder: m.holder, content: m.content,
        sourceSeqs: JSON.parse(m.source_seqs), important: !!m.important, status,
        invalidReason: o?.action === 'delete' ? o.reason : null, createdAt: m.created_at,
      };
    })
    .filter((m) => statuses.includes(m.status));
}

// 让某些来源消息产生的记忆在当前世界线作废（纠错、重新生成时用）
export function invalidateMemoriesFromSources(db, branch, seqs, reason) {
  const set = new Set(seqs);
  const hit = visibleMemories(db, branch, { statuses: ['active', 'pending'] }).filter((m) => m.sourceSeqs.some((s) => set.has(s)));
  for (const m of hit) {
    appendEvent(db, { characterId: branch.character_id, branchId: branch.id, kind: 'memory_override', data: { memoryId: m.id, action: 'delete', reason } });
  }
  return hit.length;
}

function pendingMessages(db, branch, afterSeq, limit) {
  const lin = lineage(db, branch);
  const v = visibleClause(lin);
  return db
    .prepare(`SELECT * FROM events WHERE character_id = ? AND hidden_at IS NULL AND seq > ? AND kind IN ('user_message','char_message') AND ${v.sql} ORDER BY seq ASC LIMIT ?`)
    .all(branch.character_id, afterSeq, ...v.params, limit)
    .map(rowToEvent);
}

export { validateCandidates } from './memrules.mjs';
import { validateCandidates } from './memrules.mjs';

const running = new Set();

/**
 * 整理一条世界线的新消息。返回 { added, pending, skipped }
 * force=false 时，新消息不够 config.memoryEvery 条就跳过。
 */
export async function processBranch({ db, model, config, branchId, force = false, log = console }) {
  if (running.has(branchId)) return { skipped: 'running' };
  running.add(branchId);
  try {
    const branch = db.prepare('SELECT * FROM branches WHERE id = ?').get(branchId);
    if (!branch) return { skipped: 'gone' };
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(branch.character_id);
    const controls = visibleControlEvents(db, branch);
    const upto = processedUpTo(controls);
    const msgs = pendingMessages(db, branch, upto, 60);
    if (!msgs.length || (!force && msgs.length < config.memoryEvery)) return { skipped: 'not_enough', unprocessed: msgs.length };

    const corrected = correctionsMap(controls);
    const usable = msgs.filter((m) => !(m.kind === 'char_message' && corrected.has(m.seq)));
    const existing = visibleMemories(db, branch, { statuses: ['active', 'pending'], controls });
    const raw = await model.extractMemories({
      system: memorySystemPrompt(character.name),
      user: memoryUserPrompt(character.name, existing.slice(-80), usable),
      who: { userId: character.user_id, characterId: character.id, branchId: branch.id },
    });

    // 提交前重新核对：来源消息仍然存在、没被隐藏、没被纠错
    const stillThere = new Set(
      visibleEvents(db, branch, { afterSeq: upto, limit: 1000, kinds: MESSAGE_KINDS })
        .filter((e) => !corrected.has(e.seq) && !correctionsMap(visibleControlEvents(db, branch)).has(e.seq))
        .map((e) => e.seq),
    );
    const allowed = new Set(usable.map((m) => m.seq).filter((s) => stillThere.has(s)));
    const { ok, rejected } = validateCandidates(raw, allowed, existing.map((m) => m.content));
    if (rejected.length) log.info?.(`记忆候选被拒绝 ${rejected.length} 条：${rejected.map((r) => r.why).join(',')}`);

    const lastSeq = msgs[msgs.length - 1].seq;
    return tx(db, () => {
      const commitSeq = appendEvent(db, {
        characterId: branch.character_id, branchId: branch.id, kind: 'memory_commit',
        data: { uptoSeq: lastSeq, added: ok.length, rejected: rejected.length },
      });
      const ins = db.prepare(
        `INSERT INTO memories (id, character_id, branch_id, anchor_seq, kind, holder, content, source_seqs, important, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      let pending = 0;
      for (const m of ok) {
        // 身份、关系阶段、重大约定：先放“待确认”，你确认后才生效
        const status = m.important ? 'pending' : 'active';
        if (status === 'pending') pending++;
        ins.run(newId(), branch.character_id, branch.id, commitSeq, m.kind, m.holder, m.content, JSON.stringify(m.source), m.important ? 1 : 0, status, now(), now());
      }
      return { added: ok.length, pending, rejected: rejected.length };
    });
  } catch (err) {
    if (!(err instanceof ModelError)) log.error?.(err);
    return { skipped: 'error', error: err.message };
  } finally {
    running.delete(branchId);
  }
}
