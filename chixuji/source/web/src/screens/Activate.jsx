// 纯前端版：输入卡密激活
import React, { useState } from 'react';
import { activateLicense } from '../api.js';
import { Button } from '../ui.jsx';

export default function Activate({ message, onDone }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(message || '');

  async function go(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await activateLicense(code); onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-mark">
        <svg viewBox="0 0 120 40" width="120" height="40" aria-hidden="true">
          <path d="M4 20c14-18 24 18 38 0s24-18 38 0 24 18 36 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <h1>迟叙机</h1>
        <p>输入卡密，激活这台设备</p>
      </div>
      <form className="login-form" onSubmit={go}>
        <label className="field">
          <span>卡密</span>
          <input value={code} autoFocus autoCapitalize="characters" autoComplete="off" spellCheck={false}
            placeholder="XSJ-XXXX-XXXX-XXXX" maxLength={40} onChange={(e) => setCode(e.target.value)} />
        </label>
        <Button busy={busy} type="submit" disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 12}>激活</Button>
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="muted small">激活时只会把卡密和一个随机的设备编号发给发卡方的服务器，用来确认卡密有效；你的人物和聊天内容不会上传。激活后平时可以离线使用，每隔几天联网确认一次。</p>
      </form>
    </div>
  );
}
