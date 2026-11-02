import React, { useState } from 'react';
import { get, post } from '../api.js';
import { Button, ErrorBox, fmtTime, Loading, toast, TopBar, useAsync } from '../ui.jsx';

export default function Admin({ home }) {
  const [tab, setTab] = useState('invites');
  const invites = useAsync(() => get('/api/admin/invites'), []);
  const users = useAsync(() => get('/api/admin/users'), []);
  const usage = useAsync(() => get('/api/admin/usage'), [tab]);
  const [form, setForm] = useState({ count: 5, maxUses: 1, expiresDays: 30, note: '' });
  const [fresh, setFresh] = useState([]);
  const [busy, setBusy] = useState(false);

  async function generate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post('/api/admin/invites', { ...form, count: Number(form.count), maxUses: Number(form.maxUses), expiresDays: Number(form.expiresDays) });
      setFresh(r.codes);
      invites.reload();
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }

  async function disable(id) {
    try { await post(`/api/admin/invites/${id}/disable`); invites.reload(); toast('已停用'); } catch (e) { toast(e.message); }
  }

  const copy = (t) => navigator.clipboard?.writeText(t).then(() => toast('已复制'), () => toast('复制失败，请手动选择'));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="page">
      <TopBar title="管理" onBack={home} />
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'invites'} onClick={() => setTab('invites')}>邀请码</button>
        <button role="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>用户</button>
        <button role="tab" aria-selected={tab === 'usage'} onClick={() => setTab('usage')}>花费</button>
        <button role="tab" aria-selected={tab === 'licenses'} onClick={() => setTab('licenses')}>卡密</button>
      </div>
      <div className="page-body">
        {tab === 'invites' && (
          <>
            <form className="card" onSubmit={generate}>
              <h2 className="card-title">生成邀请码</h2>
              <div className="grid-3">
                <label className="field"><span>数量</span><input type="number" min="1" max="50" value={form.count} onChange={set('count')} /></label>
                <label className="field"><span>每个可用几次</span><input type="number" min="1" max="100" value={form.maxUses} onChange={set('maxUses')} /></label>
                <label className="field"><span>有效天数</span><input type="number" min="0" max="365" value={form.expiresDays} onChange={set('expiresDays')} /></label>
              </div>
              <p className="muted small">有效天数填 0 表示不过期。</p>
              <label className="field"><span>备注（只有你能看到）</span><input value={form.note} maxLength={100} onChange={set('note')} placeholder="例如：第一批内测朋友" /></label>
              <Button busy={busy} type="submit">生成</Button>
              {fresh.length > 0 && (
                <div className="fresh">
                  <pre>{fresh.join('\n')}</pre>
                  <button type="button" className="btn btn-ghost" onClick={() => copy(fresh.join('\n'))}>复制全部</button>
                </div>
              )}
            </form>

            {invites.error && <ErrorBox error={invites.error} onRetry={invites.reload} />}
            {!invites.data && !invites.error && <Loading />}
            <ul className="admin-list">
              {invites.data?.invites.map((i) => {
                const expired = i.expiresAt && new Date(i.expiresAt) < new Date();
                const state = i.disabled ? '已停用' : expired ? '已过期' : i.usedCount >= i.maxUses ? '已用完' : '可用';
                return (
                  <li key={i.id}>
                    <button className="code" onClick={() => copy(i.code)} aria-label={`复制 ${i.code}`}>{i.code}</button>
                    <span className="muted small">{i.usedCount}/{i.maxUses} 次，{state}{i.note ? `，${i.note}` : ''}</span>
                    {state === '可用' && <button className="text-btn danger" onClick={() => disable(i.id)}>停用</button>}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {tab === 'licenses' && <Licenses copy={copy} />}

        {tab === 'usage' && (
          <>
            {usage.error && <ErrorBox error={usage.error} onRetry={usage.reload} />}
            {!usage.data && !usage.error && <Loading />}
            {usage.data && (() => {
              const total = (rows) => rows.reduce((a, x) => a + x.costYuan, 0);
              const calls = (rows) => rows.reduce((a, x) => a + x.calls, 0);
              const label = { reply: '角色回复', vision: '看图', memory: '记忆整理' };
              return (
                <>
                  <div className="stat-grid">
                    <div className="stat"><b>¥{total(usage.data.today).toFixed(2)}</b><span>今天（{calls(usage.data.today)} 次调用）</span></div>
                    <div className="stat"><b>¥{total(usage.data.week).toFixed(2)}</b><span>最近 7 天（{calls(usage.data.week)} 次）</span></div>
                  </div>
                  <p className="muted small">按 DeepSeek 公布的价格估算，实际以 DeepSeek 后台账单为准。</p>
                  <section className="card">
                    <h2 className="card-title">今天按用途</h2>
                    {usage.data.today.length === 0 && <p className="muted small">今天还没有调用。</p>}
                    {usage.data.today.map((x) => (
                      <div className="kv" key={x.purpose}><span>{label[x.purpose] || x.purpose}</span><span>{x.calls} 次{x.failed ? `（失败 ${x.failed}）` : ''}，¥{x.costYuan.toFixed(3)}</span></div>
                    ))}
                  </section>
                  <section className="card">
                    <h2 className="card-title">今天各用户</h2>
                    {usage.data.topUsersToday.map((x) => (
                      <div className="kv" key={x.email}><span>{x.email}</span><span>¥{x.costYuan.toFixed(3)}</span></div>
                    ))}
                  </section>
                </>
              );
            })()}
          </>
        )}

        {tab === 'users' && (
          <>
            {users.error && <ErrorBox error={users.error} onRetry={users.reload} />}
            {!users.data && !users.error && <Loading />}
            {users.data && <p className="muted small">共 {users.data.users.length} 个用户。这里不显示任何聊天内容。</p>}
            <ul className="admin-list">
              {users.data?.users.map((u) => (
                <li key={u.id}>
                  <b>{u.email}{u.isAdmin ? '（管理员）' : ''}</b>
                  <span className="muted small">
                    {u.characters} 个角色，{u.points} 点，注册于 {fmtTime(u.createdAt)}
                    {u.lastSeenAt ? `，最近登录 ${fmtTime(u.lastSeenAt)}` : ''}
                    {u.inviteCode ? `，邀请码 ${u.inviteCode}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

// 卡密（纯前端版用）：生成、看激活了哪些设备、停用、重置设备
function Licenses({ copy }) {
  const list = useAsync(() => get('/api/admin/licenses'), []);
  const [form, setForm] = useState({ count: 10, maxDevices: 2, note: '' });
  const [fresh, setFresh] = useState([]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function generate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await post('/api/admin/licenses', { ...form, count: Number(form.count), maxDevices: Number(form.maxDevices) });
      setFresh(r.codes); list.reload();
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  async function act(path, body, msg) {
    try { await post(path, body); list.reload(); toast(msg); } catch (e) { toast(e.message); }
  }
  const rows = (list.data?.licenses || []).filter((l) => !q || l.code.includes(q.toUpperCase()) || l.note.includes(q));

  return (
    <>
      <form className="card" onSubmit={generate}>
        <h2 className="card-title">生成卡密</h2>
        <div className="grid-3">
          <label className="field"><span>数量</span><input type="number" min="1" max="200" value={form.count} onChange={set('count')} /></label>
          <label className="field"><span>可激活设备数</span><input type="number" min="1" max="20" value={form.maxDevices} onChange={set('maxDevices')} /></label>
        </div>
        <label className="field"><span>备注（只有你能看到）</span><input value={form.note} maxLength={100} onChange={set('note')} placeholder="例如：闲鱼 10 月第一批" /></label>
        <Button busy={busy} type="submit">生成</Button>
        {fresh.length > 0 && (
          <div className="fresh">
            <pre>{fresh.join('\n')}</pre>
            <button type="button" className="btn btn-ghost" onClick={() => copy(fresh.join('\n'))}>复制全部</button>
          </div>
        )}
        <p className="muted small">买家在纯前端版第一次打开时输入卡密激活。清理浏览器数据或换手机算新设备；设备数用满了，在下面点「重置设备」。</p>
      </form>

      {list.error && <ErrorBox error={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}
      {list.data && (
        <>
          <label className="field"><span>搜索（卡密或备注）</span><input value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <p className="muted small">共 {list.data.licenses.length} 个，已激活 {list.data.licenses.filter((l) => l.devices.length).length} 个</p>
          <ul className="admin-list">
            {rows.map((l) => (
              <li key={l.id}>
                <button className="code" onClick={() => copy(l.code)} aria-label={`复制 ${l.code}`}>{l.code}</button>
                <span className="muted small">
                  {l.revoked ? '已停用' : l.devices.length ? `已激活 ${l.devices.length}/${l.maxDevices} 台` : '未使用'}
                  {l.note ? `，${l.note}` : ''}
                  {l.devices.length > 0 && `，最近 ${fmtTime(l.devices.reduce((a, d) => (d.lastAt > a ? d.lastAt : a), ''))}`}
                </span>
                <span>
                  {l.devices.length > 0 && <button className="text-btn" onClick={() => act(`/api/admin/licenses/${l.id}/reset-devices`, {}, '已重置，买家可以重新激活')}>重置设备</button>}
                  {l.revoked
                    ? <button className="text-btn" onClick={() => act(`/api/admin/licenses/${l.id}/revoke`, { revoked: false }, '已恢复')}>恢复</button>
                    : <button className="text-btn danger" onClick={() => act(`/api/admin/licenses/${l.id}/revoke`, { revoked: true }, '已停用')}>停用</button>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
