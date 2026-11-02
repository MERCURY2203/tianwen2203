import React, { useState } from 'react';
import { get, post, IS_LOCAL } from '../api.js';
import { ErrorBox, Loading, Thread, toast, TopBar, useAsync } from '../ui.jsx';

const GROUPS = [
  { kind: 'fact', title: '发生过的事' },
  { kind: 'plan', title: '约定和计划' },
  { kind: 'opinion', title: 'TA 的看法和感受' },
];
const HOLDER = { user: '你', character: 'TA', both: '你们' };

export default function Memories({ current, go, home }) {
  const branchId = current.viewBranch.id;
  const q = useAsync(() => get(`/api/branches/${branchId}/memories`), [branchId]);
  const [busy, setBusy] = useState(false);

  async function act(m, action) {
    try {
      await post(`/api/branches/${branchId}/memories/${m.id}`, { action });
      toast(action === 'confirm' ? '已确认' : '已删除');
      q.reload();
    } catch (e) { toast(e.message); }
  }

  async function processNow() {
    setBusy(true);
    try {
      const r = await post(`/api/branches/${branchId}/memories/process`);
      toast(r.skipped ? '没有需要整理的新内容' : `整理完成：新增 ${r.added} 条${r.pending ? `，其中 ${r.pending} 条等你确认` : ''}`);
      q.reload();
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  const list = q.data?.memories || [];
  const pending = list.filter((m) => m.status === 'pending');
  const active = list.filter((m) => m.status === 'active');

  return (
    <div className="page">
      <TopBar title="记忆" onBack={home} sub={<Thread name={current.viewBranch.name} onClick={() => go('worldlines')} />} />
      <div className="page-body">
        {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
        {!q.data && !q.error && <Loading />}
        {q.data && (
          <>
            <p className="lead">{current.name}在这条世界线上记住的事。聊天时会参考这些内容；删掉的不会再被提起。每条世界线的记忆互不相通。</p>

            {pending.length > 0 && (
              <section className="card card-attn">
                <h2 className="card-title">等你确认</h2>
                <p className="muted small">涉及关系变化或重大约定的内容，你确认后才会生效。</p>
                {pending.map((m) => (
                  <div className="mem" key={m.id}>
                    <p>{m.content}</p>
                    <div className="mem-actions">
                      <button className="text-btn" onClick={() => act(m, 'confirm')}>确认</button>
                      <button className="text-btn muted-btn" onClick={() => act(m, 'delete')}>不对，删除</button>
                    </div>
                  </div>
                ))}
              </section>
            )}

            {GROUPS.map((g) => {
              const items = active.filter((m) => m.kind === g.kind);
              if (!items.length) return null;
              return (
                <section className="card" key={g.kind}>
                  <h2 className="card-title">{g.title}</h2>
                  {items.map((m) => (
                    <div className="mem" key={m.id}>
                      <p>{m.content}<span className="muted small">　{HOLDER[m.holder]}</span></p>
                      <div className="mem-actions">
                        {IS_LOCAL && <button className="text-btn" onClick={() => go('room', { memoryId: m.id })}>做成摆件</button>}
                        <button className="text-btn muted-btn" onClick={() => act(m, 'delete')}>删除</button>
                      </div>
                    </div>
                  ))}
                </section>
              );
            })}

            {!list.length && <p className="chat-empty">还没有记忆。多聊几句，TA 会慢慢记住重要的事。</p>}

            <button className="btn btn-ghost" disabled={busy || !q.data.unprocessed} onClick={processNow}>
              {busy ? '整理中…' : q.data.unprocessed ? `现在整理（有 ${q.data.unprocessed} 条新消息）` : '最新的消息都整理过了'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
