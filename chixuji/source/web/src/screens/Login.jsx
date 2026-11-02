import React, { useEffect, useState } from 'react';
import { post } from '../api.js';
import { Button, Sheet } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [step, setStep] = useState('email'); // email → code → signup
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [invite, setInvite] = useState('');
  const [needInvite, setNeedInvite] = useState(true);
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [showTerms, setShowTerms] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function run(fn) {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const requestCode = (e) => {
    e?.preventDefault();
    run(async () => {
      const r = await post('/api/auth/request-code', { email });
      setDevCode(r.devCode || null);
      setStep('code');
      setCooldown(60);
    });
  };

  const verify = (e) => {
    e?.preventDefault();
    run(async () => {
      const body = { email, code };
      if (step === 'signup') Object.assign(body, { inviteCode: invite, adultConfirmed: adult, termsAccepted: terms });
      const r = await post('/api/auth/verify', body);
      if (r.needSignup) { setNeedInvite(r.needInvite); setStep('signup'); return; }
      onLogin(r.user);
    });
  };

  return (
    <div className="login">
      <div className="login-mark">
        <svg viewBox="0 0 120 40" width="120" height="40" aria-hidden="true">
          <path d="M4 20c14-18 24 18 38 0s24-18 38 0 24 18 36 0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <h1>迟叙机</h1>
        <p>和 TA 共用的一部手机</p>
      </div>

      {step === 'email' && (
        <form className="login-form" onSubmit={requestCode}>
          <label className="field">
            <span>邮箱</span>
            <input type="email" inputMode="email" autoComplete="email" required value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <Button busy={busy} type="submit" disabled={!email}>获取验证码</Button>
        </form>
      )}

      {step !== 'email' && (
        <form className="login-form" onSubmit={verify}>
          <p className="muted">验证码已发送到 {email}
            <button type="button" className="link" onClick={() => { setStep('email'); setCode(''); }}>换一个邮箱</button>
          </p>
          {devCode && <p className="dev-note">测试模式：验证码是 <b>{devCode}</b>（正式上线后会改为发邮件）</p>}
          <label className="field">
            <span>6 位验证码</span>
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </label>

          {step === 'signup' && (
            <div className="signup-box">
              <p>这个邮箱还没注册，补充以下信息就能开始。</p>
              {needInvite && (
                <label className="field">
                  <span>邀请码</span>
                  <input value={invite} required autoCapitalize="characters" onChange={(e) => setInvite(e.target.value)} placeholder="内测期间凭邀请码注册" />
                </label>
              )}
              <label className="check">
                <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
                <span>我已年满 18 周岁</span>
              </label>
              <label className="check">
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>我已阅读并同意<button type="button" className="link" onClick={() => setShowTerms(true)}>《用户协议与隐私说明》</button></span>
              </label>
            </div>
          )}

          <Button busy={busy} type="submit" disabled={code.length !== 6 || (step === 'signup' && (!adult || !terms || (needInvite && !invite)))}>
            {step === 'signup' ? '注册并进入' : '登录'}
          </Button>
          <button type="button" className="btn btn-ghost" disabled={cooldown > 0 || busy} onClick={requestCode}>
            {cooldown > 0 ? `${cooldown} 秒后可重新获取` : '重新获取验证码'}
          </button>
        </form>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <Sheet open={showTerms} onClose={() => setShowTerms(false)} title="用户协议与隐私说明（内测版）">
        <div className="terms">
          <p>迟叙机是一款与虚拟角色互动的内测产品，仅限年满 18 周岁的用户使用。</p>
          <p>角色由人工智能生成回复，内容可能出错，不代表真实的人，也不构成任何专业建议。</p>
          <p>你的聊天、角色设定和世界线只属于你的账号，其他用户看不到。为了生成回复，相关内容会发送给平台使用的模型服务（DeepSeek）。</p>
          <p>运营者只在排查故障等必要时查看运行信息，不会把你的私聊当作日常监控内容。</p>
          <p>你可以随时在「账号」里删除账号，所有角色、世界线和聊天会被一并删除，无法恢复。</p>
          <p>正式版协议会在公开上线前补充完整。</p>
        </div>
        <Button kind="primary" onClick={() => { setTerms(true); setShowTerms(false); }}>我已了解</Button>
      </Sheet>
    </div>
  );
}
