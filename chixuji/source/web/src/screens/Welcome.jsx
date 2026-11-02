// 纯前端版：第一次打开时的说明和 18 岁确认
import React, { useState } from 'react';
import { post } from '../api.js';
import { Button } from '../ui.jsx';

export default function Welcome({ onDone }) {
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go(e) {
    e.preventDefault();
    setBusy(true);
    try { onDone((await post('/api/local/welcome', { adultConfirmed: adult, termsAccepted: terms })).user); }
    catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="login">
      <div className="login-mark">
        <svg viewBox="0 0 120 40" width="120" height="40" aria-hidden="true">
          <path d="M4 20c14-18 24 18 38 0s24-18 38 0 24 18 36 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <h1>迟叙机</h1>
        <p>和 TA 共用的一部手机</p>
      </div>
      <form className="login-form" onSubmit={go}>
        <div className="signup-box terms">
          <p>迟叙机完全在你自己的设备上运行：人物、聊天、记忆都只保存在这台设备的浏览器里，没有云端账号，开发者也看不到。</p>
          <p>角色的回复由你自己填写的 API（例如 DeepSeek）生成，费用由你的 API 账户支付。聊天内容只会发送给你填写的那个模型服务。</p>
          <p>清理浏览器数据会删掉这里的内容，记得定期在「设置」里导出备份。</p>
          <p>角色由人工智能扮演，内容可能出错，不代表真实的人。</p>
        </div>
        <label className="check">
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          <span>我已年满 18 周岁</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>我已了解以上说明</span>
        </label>
        <Button busy={busy} type="submit" disabled={!adult || !terms}>开始使用</Button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </div>
  );
}
