// 记忆候选的校验规则（服务器版和纯前端版共用）
const KINDS = new Set(['fact', 'plan', 'opinion']);
const HOLDERS = new Set(['user', 'character', 'both']);

/** 检查模型给出的候选：来源必须存在于这次给它的消息里，字段必须合法 */
export function validateCandidates(raw, allowedSeqs, existingContents) {
  const ok = [];
  const rejected = [];
  const seen = new Set(existingContents.map((c) => c.trim()));
  for (const c of Array.isArray(raw) ? raw : []) {
    const content = typeof c?.content === 'string' ? c.content.trim() : '';
    const source = Array.isArray(c?.source) ? c.source.map(Number).filter(Number.isInteger) : [];
    let why = null;
    if (!KINDS.has(c?.kind)) why = 'kind';
    else if (!HOLDERS.has(c?.holder)) why = 'holder';
    else if (!content || content.length > 120) why = 'content';
    else if (!source.length || !source.every((s) => allowedSeqs.has(s))) why = 'source';
    else if (seen.has(content)) why = 'duplicate';
    if (why) { rejected.push({ why, candidate: c }); continue; }
    seen.add(content);
    ok.push({ kind: c.kind, holder: c.holder, content, source: [...new Set(source)].sort((a, b) => a - b), important: c.important === true });
  }
  return { ok, rejected };
}
