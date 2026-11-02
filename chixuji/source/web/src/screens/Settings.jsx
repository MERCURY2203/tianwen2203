import React, { useEffect, useState } from 'react';
import { del, get, IS_LOCAL, patch, post } from '../api.js';
import { Button, ErrorBox, fmtTime, Loading, Sheet, Thread, toast, TopBar, useAsync } from '../ui.jsx';
import { AvatarPicker, LookPicker, WorldSheet } from '../parts.jsx';

export default function Settings({ current, refreshCharacters, characters, selectCharacter, go, home }) {
  const q = useAsync(() => get(`/api/characters/${current.id}/settings`), [current.id, current.viewBranch.id]);
  const versions = useAsync(() => get(`/api/characters/${current.id}/setting-versions`), [current.id]);
  const [form, setForm] = useState(null);
  const [name, setName] = useState(current.name);
  const [saveOpen, setSaveOpen] = useState(false);
  const [scope, setScope] = useState('current');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState('');
  const worlds = useAsync(() => get('/api/worlds'), []);
  const [worldSheet, setWorldSheet] = useState(undefined);

  async function changeCharacter(body, msg) {
    try {
      await patch(`/api/characters/${current.id}`, body);
      await refreshCharacters();
      toast(msg);
    } catch (e) { toast(e.message); }
  }
  const myWorld = worlds.data?.worlds.find((w) => w.id === current.world?.id);

  useEffect(() => { if (q.data) setForm({ ...(q.data.settings?.data || {}) }); }, [q.data]);

  const fields = q.data?.fields || [];
  const groups = [...new Set(fields.map((f) => f.group))];
  const original = q.data?.settings?.data || {};
  const dirty = form && fields.some((f) => (form[f.key] || '') !== (original[f.key] || ''));

  async function saveName() {
    if (!name.trim() || name === current.name) return;
    try {
      await patch(`/api/characters/${current.id}`, { name });
      await refreshCharacters();
      toast('名字已保存');
    } catch (e) { toast(e.message); setName(current.name); }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const r = await post(`/api/characters/${current.id}/settings`, { data: form, scope, note, branchId: q.data.branchId });
      toast(`已保存为第 ${r.version} 版，应用到 ${r.appliedTo.length} 条世界线`);
      setSaveOpen(false);
      setNote('');
      await Promise.all([q.reload(), versions.reload(), refreshCharacters()]);
    } catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  async function deleteCharacter() {
    setBusy(true);
    try {
      await del(`/api/characters/${current.id}`, { confirmName: delName });
      const list = await refreshCharacters();
      selectCharacter(list[0]?.id || null);
      toast('角色已删除');
      home();
    } catch (e) { toast(e.message); setBusy(false); }
  }

  return (
    <div className="page">
      <TopBar title="设定" onBack={home}
        right={<button className="text-btn" disabled={!dirty} onClick={() => setSaveOpen(true)}>保存</button>} />
      <div className="page-body">
        {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
        {!form && !q.error && <Loading />}
        {form && (
          <>
            <section className="card">
              <div className="create-head">
                <AvatarPicker name={current.name} color={current.avatarColor} url={current.avatarUrl}
                  onChange={(a) => changeCharacter({ avatarId: a?.id || null }, a ? '头像已更换' : '已改回默认头像')} />
                <label className="field grow">
                  <span>角色名</span>
                  <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} onBlur={saveName} />
                </label>
              </div>
              <label className="field">
                <span>生活在哪个世界</span>
                <select value={current.world?.id || ''} onChange={(e) => (e.target.value === '__new' ? setWorldSheet(null) : changeCharacter({ worldId: e.target.value || null }, '已更换世界'))}>
                  {!current.world && <option value="">还没选（请选一个）</option>}
                  {worlds.data?.worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  <option value="__new">＋ 新建一个世界</option>
                </select>
              </label>
              {myWorld && (
                <div className="world-peek-row">
                  <p className="world-peek">{myWorld.lore}</p>
                  <button className="text-btn" onClick={() => setWorldSheet(myWorld)}>修改世界观</button>
                </div>
              )}
              <div className="row-between small">
                <span className="muted">当前世界线用的是第 {q.data.settings?.version ?? '-'} 版人设</span>
                <Thread name={q.data.branchName} onClick={() => go('worldlines')} />
              </div>
            </section>

            {IS_LOCAL && (
              <section className="card">
                <h2 className="card-title">房间里的形象</h2>
                <LookPicker current={current} refreshCharacters={refreshCharacters} go={go} back="settings" />
              </section>
            )}

            <p className="lead">写得越具体，TA 越像 TA。在聊天里说“忘掉你的人设”不会改动这里，只有在这页保存才算数。</p>

            {groups.map((g) => (
              <section className="card" key={g}>
                <h2 className="card-title">{g === '角色' ? '关于 TA' : g === '例子' ? '像与不像' : '故事'}</h2>
                {fields.filter((f) => f.group === g).map((f) => (
                  <label className="field" key={f.key}>
                    <span>{f.label}</span>
                    <textarea rows={3} maxLength={4000} value={form[f.key] || ''} placeholder={f.hint}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                  </label>
                ))}
              </section>
            ))}

            {dirty && <Button onClick={() => setSaveOpen(true)}>保存设定</Button>}

            <section className="card">
              <h2 className="card-title">历史版本</h2>
              {versions.data?.versions.map((v) => (
                <div className="version-row" key={v.id}>
                  <span>第 {v.version} 版</span>
                  <span className="muted">{v.note || '无说明'}</span>
                  <time className="muted small">{fmtTime(v.createdAt)}</time>
                </div>
              ))}
            </section>

            <button className="btn btn-danger-ghost" onClick={() => setDelOpen(true)}>删除这个角色</button>
          </>
        )}
      </div>

      <Sheet open={saveOpen} onClose={() => setSaveOpen(false)} title="保存为新版本">
        <form onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
          <fieldset className="choices">
            <legend className="muted small">这次修改应用到</legend>
            <label className={'choice' + (scope === 'current' ? ' is-on' : '')}>
              <input type="radio" name="scope" checked={scope === 'current'} onChange={() => setScope('current')} />
              <span><b>只有「{q.data?.branchName}」</b><small>其他世界线保持原来的人设</small></span>
            </label>
            <label className={'choice' + (scope === 'all' ? ' is-on' : '')}>
              <input type="radio" name="scope" checked={scope === 'all'} onChange={() => setScope('all')} />
              <span><b>所有未归档的世界线</b><small>每条线从现在起都用新人设，过去的对话不变</small></span>
            </label>
          </fieldset>
          <label className="field">
            <span>修改说明（可不填）</span>
            <input value={note} maxLength={100} placeholder="例如：改得更慢热" onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button busy={busy} type="submit">保存</Button>
        </form>
      </Sheet>

      <WorldSheet open={worldSheet !== undefined} world={worldSheet || null} onClose={() => setWorldSheet(undefined)}
        onSaved={async (w) => {
          await worlds.reload();
          if (!worldSheet) await changeCharacter({ worldId: w.id }, `已搬到「${w.name}」`);
          else await refreshCharacters();
          setWorldSheet(undefined);
        }} />

      <Sheet open={delOpen} onClose={() => setDelOpen(false)} title="删除角色">
        <form onSubmit={(e) => { e.preventDefault(); deleteCharacter(); }}>
          <p>会永久删除「{current.name}」的设定、所有世界线和聊天，无法恢复。</p>
          <label className="field">
            <span>输入角色名「{current.name}」确认</span>
            <input value={delName} onChange={(e) => setDelName(e.target.value)} />
          </label>
          <Button kind="danger" busy={busy} type="submit" disabled={delName !== current.name}>永久删除</Button>
        </form>
      </Sheet>
    </div>
  );
}
