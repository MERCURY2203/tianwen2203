import React, { useState } from 'react';
import { del, post } from '../api.js';
import { Button, Sheet, toast, TopBar } from '../ui.jsx';

async function clearLocal() {
  try { localStorage.clear(); } catch { /* 忽略 */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch { /* 不支持缓存 */ }
}

export default function Account({ me, home, onLogout }) {
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [confirm, setConfirm] = useState('');

  async function logout() {
    setBusy(true);
    try { await post('/api/auth/logout'); } catch { /* 无论如何都退出 */ }
    await clearLocal();
    onLogout();
  }

  async function deleteAccount(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await del('/api/me', { confirmEmail: confirm });
      await clearLocal();
      onLogout();
    } catch (err) { toast(err.message); setBusy(false); }
  }

  return (
    <div className="page">
      <TopBar title="账号" onBack={home} />
      <div className="page-body">
        <section className="card">
          <div className="kv"><span className="muted">邮箱</span><span>{me.email}</span></div>
          {me.isAdmin && <div className="kv"><span className="muted">身份</span><span>管理员</span></div>}
          <div className="kv"><span className="muted">点数</span><span>{me.points}（第 3 阶段开放兑换）</span></div>
        </section>
        <Button kind="ghost" busy={busy} onClick={logout}>退出登录</Button>
        <button className="btn btn-danger-ghost" onClick={() => setDelOpen(true)}>删除账号</button>
      </div>

      <Sheet open={delOpen} onClose={() => setDelOpen(false)} title="删除账号">
        <form onSubmit={deleteAccount}>
          <p>会永久删除这个账号下的所有角色、世界线和聊天，无法恢复。</p>
          <label className="field">
            <span>输入你的邮箱确认</span>
            <input type="email" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <Button kind="danger" busy={busy} type="submit" disabled={confirm.trim().toLowerCase() !== me.email}>永久删除账号</Button>
        </form>
      </Sheet>
    </div>
  );
}
