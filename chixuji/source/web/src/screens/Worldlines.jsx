import React, { useState } from 'react';
import { get, patch, post } from '../api.js';
import { Button, ErrorBox, Loading, Sheet, toast, TopBar, useAsync } from '../ui.jsx';
import WorldTree from './WorldTree.jsx';

function buildTree(branches, showArchived) {
  const visible = branches.filter((b) => showArchived || !b.archived || b.isView);
  const ids = new Set(visible.map((b) => b.id));
  const kids = new Map();
  for (const b of visible) {
    const p = b.parentId && ids.has(b.parentId) ? b.parentId : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(b);
  }
  const out = [];
  const walk = (parent, depth) => (kids.get(parent) || []).forEach((b) => { out.push({ ...b, depth }); walk(b.id, depth + 1); });
  walk(null, 0);
  return out;
}

export default function Worldlines({ current, refreshCharacters, go, home }) {
  const q = useAsync(() => get(`/api/characters/${current.id}/branches`), [current.id, current.viewBranch.id]);
  const [showArchived, setShowArchived] = useState(false);
  const [sel, setSel] = useState(null);
  const [rename, setRename] = useState(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState(null);
  const [view, setView] = useState(() => { try { return localStorage.getItem('xsj:wl-view') || 'tree'; } catch { return 'tree'; } });
  const pickView = (v) => { setView(v); try { localStorage.setItem('xsj:wl-view', v); } catch { /* 无痕 */ } };

  async function act(fn, msg) {
    setBusy(true);
    try {
      await fn();
      await refreshCharacters();
      await q.reload();
      if (msg) toast(msg);
      setSel(null);
      setRename(null);
      return true;
    } catch (e) { toast(e.message); return false; } finally { setBusy(false); }
  }

  const data = q.data;
  const bg = data?.background;
  const rows = data ? buildTree(data.branches, showArchived) : [];
  const archivedCount = data ? data.branches.filter((b) => b.archived).length : 0;

  return (
    <div className="page">
      <TopBar title="世界线" onBack={home} right={<button className="text-btn" onClick={() => setNewName('')}>新建</button>} />
      <div className="page-body">
        {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
        {!data && !q.error && <Loading />}
        {data && (
          <>
            <p className="lead">每条世界线都是一段独立的故事。从某条消息分出来的新线，只记得分叉之前的事。</p>
            <div className="segmented" role="tablist">
              <button role="tab" aria-selected={view === 'tree'} onClick={() => pickView('tree')}>世界树</button>
              <button role="tab" aria-selected={view === 'list'} onClick={() => pickView('list')}>列表</button>
            </div>

            {view === 'tree' && (
              <>
                <div className="wtree-wrap"><WorldTree branches={data.branches.filter((b) => showArchived || !b.archived || b.isView)} onSelect={setSel} /></div>
                <p className="muted small">从上往下是时间。每条竖线是一条世界线，<b>弯出去的地方</b>就是从那条消息分出来的；实心圆点是这条线的起点，空心圆点是它最新的消息。点任意一行可以切换过去。</p>
              </>
            )}

            {view === 'list' && <ol className="threads" aria-label="世界线列表">
              {rows.map((b) => (
                <li key={b.id} className={'thread-row' + (b.isView ? ' is-view' : '') + (b.archived ? ' is-archived' : '')}
                  style={{ '--depth': b.depth }}>
                  <button className="thread-node" onClick={() => setSel(b)}>
                    <span className="thread-name">{b.name}</span>
                    <span className="thread-tags">
                      {b.isView && <span className="tag tag-red">正在查看</span>}
                      {b.isBackground && <span className="tag">后台活动线</span>}
                      {b.archived && <span className="tag tag-grey">已归档</span>}
                    </span>
                    <span className="thread-info">
                      {b.parentId
                        ? (b.forkPreview ? `从「${b.forkPreview.text}」之后分出` : '从最开始分出')
                        : (b.isMain ? '最初的故事' : '从头开始的新故事')}
                      {`，这条线上有 ${b.ownMessages} 条新消息`}
                    </span>
                  </button>
                </li>
              ))}
            </ol>}
            {archivedCount > 0 && (
              <button className="btn btn-ghost" onClick={() => setShowArchived(!showArchived)}>
                {showArchived ? '隐藏已归档的世界线' : `显示已归档的世界线（${archivedCount}）`}
              </button>
            )}

            <section className="card">
              <div className="row-between">
                <div>
                  <h2 className="card-title">离开后活动</h2>
                  <p className="muted small">
                    {bg.branchId ? `后台活动线：「${bg.branchName}」` : '还没有指定后台活动线'}
                  </p>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={bg.enabled} disabled={busy || !bg.branchId}
                    onChange={(e) => act(() => post(`/api/characters/${current.id}/background`, { enabled: e.target.checked }),
                      e.target.checked ? '已开启离开后活动' : '已关闭离开后活动')} />
                  <span aria-hidden="true" />
                  <span className="sr-only">允许离开后活动</span>
                </label>
              </div>
              <p className="muted small">开启后，你不在时角色可以在这条线上主动发消息、发朋友圈、补写日记（第 5 阶段起生效，会消耗点数）。只查看别的世界线不会改动这个设置。</p>
            </section>
          </>
        )}
      </div>

      <Sheet open={!!sel && !rename} onClose={() => setSel(null)} title={sel ? `「${sel.name}」` : ''}>
        {sel && (
          <div className="menu">
            {!sel.isView && (
              <button disabled={busy} onClick={() => act(() => post(`/api/characters/${current.id}/view`, { branchId: sel.id }), `已切换到「${sel.name}」`).then((ok) => ok && go('chat', { thread: current.id }))}>
                <b>切换到这条世界线</b><span>聊天、设定都会切换到这条线</span>
              </button>
            )}
            {sel.isView && (
              <button onClick={() => go('chat', { thread: current.id })}><b>去聊天</b></button>
            )}
            <button onClick={() => setRename({ id: sel.id, name: sel.name })}><b>重命名</b></button>
            {!sel.archived && !sel.isBackground && (
              <button disabled={busy} onClick={() => act(() => post(`/api/characters/${current.id}/background`, { branchId: sel.id }), `后台活动线已改为「${sel.name}」`)}>
                <b>设为后台活动线</b><span>每个角色只能有一条后台活动线</span>
              </button>
            )}
            {!sel.isMain && !sel.archived && (
              <button className="danger" disabled={busy} onClick={() => act(() => patch(`/api/branches/${sel.id}`, { archived: true }), '已归档')}>
                <b>归档</b><span>收起来不再显示，内容保留，可以随时恢复</span>
              </button>
            )}
            {sel.archived && (
              <button disabled={busy} onClick={() => act(() => patch(`/api/branches/${sel.id}`, { archived: false }), '已恢复')}>
                <b>恢复</b>
              </button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={newName !== null} onClose={() => setNewName(null)} title="新建世界线">
        <form onSubmit={(e) => {
          e.preventDefault();
          act(() => post(`/api/characters/${current.id}/branches`, { name: newName }), `已进入新世界线「${newName}」`).then((ok) => { if (ok) { setNewName(null); go('chat', { thread: current.id }); } });
        }}>
          <p className="muted small">从头开始一段新故事：没有任何聊天记录，人设沿用现在的版本，和其他世界线互不影响。想保留一部分经历的话，请在聊天里对某条消息选“从这里分出新世界线”。</p>
          <label className="field">
            <span>名称</span>
            <input value={newName || ''} maxLength={30} required placeholder="例如：重新认识" onChange={(e) => setNewName(e.target.value)} />
          </label>
          <Button busy={busy} type="submit" disabled={!newName?.trim()}>创建并进入</Button>
        </form>
      </Sheet>

      <Sheet open={!!rename} onClose={() => { setRename(null); setSel(null); }} title="重命名世界线">
        {rename && (
          <form onSubmit={(e) => { e.preventDefault(); act(() => patch(`/api/branches/${rename.id}`, { name: rename.name }), '已重命名'); }}>
            <label className="field">
              <span>名称</span>
              <input value={rename.name} maxLength={30} required onChange={(e) => setRename({ ...rename, name: e.target.value })} />
            </label>
            <Button busy={busy} type="submit" disabled={!rename.name.trim()}>保存名称</Button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
