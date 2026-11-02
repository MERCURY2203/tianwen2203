// 纯前端版的「设置」：像 iPhone 的设置一样，首页只列出每一项，点进去再改
import React, { useEffect, useRef, useState } from 'react';
import { cropImage, screenAspect } from '../crop.jsx';
import * as API from '../api.js';
import { Avatar, Button, ErrorBox, Loading, PickButton, Sheet, toast, TopBar, useAsync } from '../ui.jsx';
import { notifyPermission, requestNotifyPermission } from '../notify.js';
import { dollUrl } from '../doll.js';
import { AvatarPicker } from '../parts.jsx';
import { ClockFace, CLOCK_FONTS, CLOCK_WEIGHTS, CLOCK_COLORS, DEFAULT_CLOCK } from '../clock.jsx';

const { get, post } = API;

function download(name, text) {
  // 安卓 App：直接存到手机的“下载/迟叙机”文件夹
  if (window.XSJNative?.saveText) {
    const where = window.XSJNative.saveText(name, text);
    toast(where ? `已保存到：${where}` : '保存失败，请检查存储空间');
    return;
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 5000);
}

// 设置首页每一行的小图标：简单的白色线条（像 iPhone 设置）
const ICON_PATHS = {
  model: 'M8 8h8v8H8z M10 4v4 M14 4v4 M10 16v4 M14 16v4 M4 10h4 M4 14h4 M16 10h4 M16 14h4',
  auto: 'M5 6.5h14a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3H5A1.5 1.5 0 0 1 3.5 15V8A1.5 1.5 0 0 1 5 6.5z M8.5 11.5h.01 M12 11.5h.01 M15.5 11.5h.01',
  phone: 'M8 3.5h8a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 19V5A1.5 1.5 0 0 1 8 3.5z M11 17.5h2',
  look: 'M4.5 5h15v14h-15z M12 9v3.5l2.3 1.5 M12 7.5a4.5 4.5 0 1 0 .01 0',
  appbg: 'M12 4l8 4-8 4-8-4z M4 12l8 4 8-4 M4 16l8 4 8-4',
  doll: 'M9 4h6v5H9z M10 9v2h4V9 M7 11h10v6H7z M9 17v3 M15 17v3',
  notify: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z M10 20h4',
  cost: 'M12 3.5a8.5 8.5 0 1 0 .01 0 M9 8l3 4 3-4 M12 12v5 M9.5 13.5h5 M9.5 16h5',
  backup: 'M4.5 7.5h15v12h-15z M3.5 4.5h17v3h-17z M10 11.5h4',
  shortcut: 'M5 5h14v14H5z M12 8.5v7 M8.5 12h7',
  license: 'M8.5 15.5a4 4 0 1 1 3.6-2.3L19 20h-3v-2h-2v-2h-2.3 M7.5 11.5h.01',
  music: 'M5 14v-2a7 7 0 0 1 14 0v2 M4 13.5h3.5v6H4z M16.5 13.5H20v6h-3.5z',
};
function LineIcon({ id }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d={ICON_PATHS[id]} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 设置首页的每一行：图标底色、名字
const SECTIONS = {
  me: { title: '我的头像' },
  model: { title: '模型', color: '#5b6cf0' },
  auto: { title: 'TA 的自主行为', color: '#e8607a' },
  phone: { title: 'TA 查你的手机', color: '#3aa76d' },
  look: { title: '壁纸与时间样式', color: '#2f8fd8' },
  appbg: { title: '软件背景', color: '#16a2a6' },
  music: { title: '音乐', color: '#ff5a6e' },
  doll: { title: '像素形象', color: '#8a6cc9' },
  notify: { title: '消息提醒', color: '#f0503c' },
  cost: { title: '花费', color: '#e0a32a' },
  backup: { title: '备份', color: '#7b8794' },
  shortcut: { title: '手机桌面图标', color: '#4a4e69' },
  license: { title: '卡密', color: '#a0743a' },
};

export default function LocalSettings({ home, go, route, me, refreshMe }) {
  const section = route?.section && SECTIONS[route.section] ? route.section : null;
  const back = () => (section ? go('account') : home());
  const q = useAsync(() => get('/api/local/settings'), []);
  const usage = useAsync(() => get('/api/local/usage'), []);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState('');
  const [showAux, setShowAux] = useState(false);
  const [withKeys, setWithKeys] = useState(false);
  const [importData, setImportData] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetText, setResetText] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!q.data) return;
    setForm(q.data.settings);
    setShowAux(!!(q.data.settings.auxBaseUrl || q.data.hasAuxKey));
  }, [q.data]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  async function save(e) {
    e?.preventDefault();
    setBusy('save');
    try {
      await post('/api/local/settings', { ...form, memoryEvery: Number(form.memoryEvery) });
      toast('已保存');
      await q.reload();
      return true;
    } catch (err) { toast(err.message); return false; } finally { setBusy(''); }
  }

  async function test(kind) {
    if (!(await save())) return;
    setBusy('test-' + kind);
    try {
      const r = await post('/api/local/test', { kind });
      toast(`连接成功，模型回复：${r.reply}`);
    } catch (err) { toast(err.message); } finally { setBusy(''); usage.reload(); }
  }

  async function doExport() {
    setBusy('export');
    try {
      const data = await API.exportBackup({ includeKeys: withKeys });
      const d = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
      download(`迟叙机备份-${stamp}.json`, JSON.stringify(data));
      toast('备份文件已下载');
    } catch (err) { toast(err.message); } finally { setBusy(''); }
  }

  async function pickImport(e) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data?.format !== 'xiaoshouji-backup') throw new Error('这不是迟叙机的备份文件');
      setImportData({ data, name: f.name, people: data.tables?.characters?.length || 0, at: data.exportedAt });
    } catch (err) { toast(err.message || '文件读不出来'); }
  }

  async function doImport() {
    setBusy('import');
    try {
      await API.importBackup(importData.data);
      toast('已恢复，正在重新打开…');
      setTimeout(() => location.reload(), 600);
    } catch (err) { toast(err.message); setBusy(''); }
  }

  async function doReset() {
    setBusy('reset');
    await API.resetAll();
    location.reload();
  }

  async function quickSet(k, v, msg) {
    setForm({ ...form, [k]: v });
    try { await post('/api/local/settings', { [k]: v }); if (msg) toast(msg); } catch (err) { toast(err.message); }
  }

  const total = (rows) => rows.reduce((a, x) => a + (x.costYuan || 0), 0);
  const calls = (rows) => rows.reduce((a, x) => a + x.calls, 0);
  const native = typeof window !== 'undefined' ? window.XSJNative : null;

  // —— 首页：列表 ——
  if (!section) {
    const autoOn = form ? ['autoMoments', 'readMoments', 'autoDiary', 'innerVoice'].filter((k) => form[k]).length : 0;
    const groups = [
      ['model', 'auto', 'phone'],
      ['look', 'appbg', 'music', 'doll', 'notify'],
      ['cost', 'backup', ...(native?.pinShortcut ? ['shortcut'] : []), ...(API.licenseInfo?.() ? ['license'] : [])],
    ];
    const value = {
      model: form ? (form.apiKey ? form.chatModel : '未填密钥') : '',
      auto: form ? (autoOn ? `开了 ${autoOn} 项` : '关') : '',
      phone: form ? (form.phoneCheck ? '允许' : '关') : '',
      notify: form?.notify ? (form.notify.enabled ? '开' : '关') : '',
      cost: usage.data ? `今天 ¥${total(usage.data.today).toFixed(2)}` : '',
    };
    return (
      <div className="page">
        <TopBar title="设置" onBack={home} />
        <div className="page-body settings-home">
          {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
          <button type="button" className="settings-me" onClick={() => go('account', { section: 'me' })}>
            <Avatar name={me?.name || '我'} color="#8a8496" url={me?.avatarUrl} size={58} />
            <span className="settings-me-text"><b>{me?.name || '我'}</b><small>头像、名字</small></span>
            <i className="chev" aria-hidden="true" />
          </button>
          {groups.map((g, gi) => (
            <ul className="settings-list" key={gi}>
              {g.map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => go('account', { section: id })}>
                    <span className="settings-ico" style={{ background: SECTIONS[id].color }} aria-hidden="true"><LineIcon id={id} /></span>
                    <span className="settings-name">{SECTIONS[id].title}</span>
                    {value[id] && <span className="settings-val">{value[id]}</span>}
                    <i className="chev" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    );
  }

  // —— 各个子页面 ——
  let body = null;
  if (section === 'me') body = <MeCard me={me} refreshMe={refreshMe} />;
  else if (section === 'look') body = (<><WallpaperCard /><IconAlphaCard /><ClockCard /></>);
  else if (section === 'doll') body = <MyDollCard go={go} />;
  else if (section === 'appbg') body = <AppBgCard />;
  else if (section === 'music') body = <MusicLookCard />;
  else if (section === 'shortcut') body = <ShortcutCard />;
  else if (section === 'license') body = API.licenseInfo?.() ? (
    <section className="card"><p className="muted small">已激活（{API.licenseInfo().codeHint}）。本次确认有效到 {((d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`)(new Date(API.licenseInfo().expiresAt))}，联网时会自动续期。</p></section>
  ) : null;
  else if (section === 'cost') body = (
    <section className="card">
      {usage.data ? (
        <div className="stat-grid">
          <div className="stat"><b>¥{total(usage.data.today).toFixed(2)}</b><span>今天（{calls(usage.data.today)} 次调用）</span></div>
          <div className="stat"><b>¥{total(usage.data.week).toFixed(2)}</b><span>最近 7 天（{calls(usage.data.week)} 次）</span></div>
        </div>
      ) : <Loading />}
      <p className="muted small">按 DeepSeek 公布的价格估算，只统计这台设备。实际以你的 API 账户账单为准。</p>
    </section>
  );
  else if (section === 'backup') body = (
    <>
      <section className="card">
        <p className="muted small">所有内容只存在这台设备的浏览器里。换手机、清理浏览器之前，先导出一份备份。</p>
        <label className="check">
          <input type="checkbox" checked={withKeys} onChange={(e) => setWithKeys(e.target.checked)} />
          <span>备份里包含 API 密钥（不要把这样的备份发给别人）</span>
        </label>
        <Button kind="primary" busy={busy === 'export'} onClick={doExport}>导出备份</Button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={pickImport} />
        <button className="btn btn-outline" onClick={() => fileRef.current?.click()}>从备份文件恢复</button>
      </section>
      <button className="btn btn-danger-ghost" onClick={() => setResetOpen(true)}>清空这台设备上的所有数据</button>
    </>
  );
  else if (!form) body = q.error ? <ErrorBox error={q.error} onRetry={q.reload} /> : <Loading />;
  else if (section === 'model') body = (
    <form className="card" onSubmit={save}>
      <p className="muted small">角色的回复由你自己的 API 生成。默认使用 DeepSeek 官方接口，也可以填其他兼容 OpenAI 格式的地址。</p>
      <label className="field"><span>接口地址</span><input value={form.baseUrl} onChange={set('baseUrl')} placeholder="https://api.deepseek.com" inputMode="url" /></label>
      <label className="field"><span>API 密钥</span><input type="password" value={form.apiKey} onChange={set('apiKey')} placeholder="sk-…" autoComplete="off" /></label>
      <label className="field"><span>回复用的模型</span><input value={form.chatModel} onChange={set('chatModel')} /></label>
      <label className="field"><span>深度思考</span>
        <select value={form.reasoning} onChange={set('reasoning')}>
          <option value="none">关闭（更快、更省钱）</option>
          <option value="low">少量</option>
          <option value="high">充分（更慢、更贵）</option>
        </select>
      </label>
      <button type="button" className="text-btn" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setShowAux(!showAux)}>
        {showAux ? '收起看图和记忆的设置' : '看图和记忆的设置'}
      </button>
      {showAux && (
        <>
          <p className="muted small">看图和整理记忆用便宜一些的模型。接口地址和密钥不填，就和上面用同一个。</p>
          <label className="field"><span>接口地址（可不填）</span><input value={form.auxBaseUrl} onChange={set('auxBaseUrl')} placeholder="和上面一样" inputMode="url" /></label>
          <label className="field"><span>API 密钥（可不填）</span><input type="password" value={form.auxApiKey} onChange={set('auxApiKey')} placeholder="和上面一样" autoComplete="off" /></label>
          <label className="field"><span>看图的模型</span><input value={form.visionModel} onChange={set('visionModel')} /></label>
          <label className="field"><span>整理记忆的模型</span><input value={form.memoryModel} onChange={set('memoryModel')} /></label>
          <label className="field"><span>每多少条新消息整理一次记忆</span><input type="number" min="2" max="100" value={form.memoryEvery} onChange={set('memoryEvery')} /></label>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={!!form.mock} onChange={set('mock')} />
        <span>体验模式：还没填密钥时用测试回复（不花钱）。填了密钥就自动用真模型</span>
      </label>
      <Button busy={busy === 'save'} type="submit">保存</Button>
      <div className="row-2">
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => test('reply')}>{busy === 'test-reply' ? '测试中…' : '测试回复模型'}</button>
        <button type="button" className="btn btn-ghost" disabled={!!busy} onClick={() => test('aux')}>{busy === 'test-aux' ? '测试中…' : '测试记忆模型'}</button>
      </div>
      <p className="muted small">密钥只保存在这台设备上。不要在别人的设备或公用电脑上保存密钥。</p>
    </form>
  );
  else if (section === 'auto') body = (
    <>
      <section className="card">
        <p className="muted small">打开后，你打开迟叙机时（以及开着的时候每隔几分钟），人物会按自己的性格做这些事。每一次都会调用模型、花费你的 API 额度。</p>
        {[
          ['autoMoments', 'TA 会自己发朋友圈', '每天 1 条，偶尔多发，最多 3 条'],
          ['readMoments', 'TA 会看你的朋友圈', '可能点赞、评论；你心情不好时可能私聊你。看过的内容会记进记忆'],
          ['autoDiary', '聊完天自动写日记', '离开聊天，或 15 分钟没有新消息，就写一篇'],
          ['innerVoice', 'TA 的心声', '每条回复下面多一个「TA 当时在想…」，点开能看到 TA 没说出口的心里话（每条回复多花一点点额度）'],
        ].map(([k, label, hint]) => (
          <Toggle key={k} label={label} hint={hint} checked={form[k]} onChange={(v) => quickSet(k, v, v ? '已打开' : '已关闭')} />
        ))}
      </section>
      {form.notify && <NotifyTypes notify={form.notify} onChange={(notify) => setForm({ ...form, notify })} />}
    </>
  );
  else if (section === 'phone') body = (
    <section className="card">
      <p className="muted small">TA 偶尔会开口要看你的位置或聊天，你也可以在聊天里主动给 TA 看。每次都要你同意；只看不改。每查一次大约花写一篇日记的额度。</p>
      <Toggle label="允许 TA 查手机" hint="关掉后 TA 不会再问，聊天里也不会出现这个按钮" checked={form.phoneCheck} onChange={(v) => quickSet('phoneCheck', v)} />
      <Toggle label="位置记进记忆" hint="打开后 TA 会记住你常去的地方" checked={form.locationMemory} onChange={(v) => quickSet('locationMemory', v)} />
      <label className="field"><span>位置精确到</span>
        <select value={form.locationLevel || 'street'} onChange={(e) => quickSet('locationLevel', e.target.value)}>
          <option value="street">区 / 街道附近</option>
          <option value="city">只给城市</option>
        </select>
      </label>
    </section>
  );
  else if (section === 'notify') body = form.notify ? <NotifyCard notify={form.notify} onChange={(notify) => setForm({ ...form, notify })} /> : null;

  return (
    <div className="page">
      <TopBar title={SECTIONS[section].title} onBack={back} />
      <div className="page-body">{body}</div>

      <Sheet open={!!importData} onClose={() => setImportData(null)} title="从备份恢复">
        <p>备份「{importData?.name}」里有 {importData?.people} 个人物，导出于 {importData?.at ? new Date(importData.at).toLocaleString('zh-CN') : '未知时间'}。</p>
        <p className="muted small">恢复会<b>替换</b>这台设备上现在的全部内容。如果现在的内容还需要，先导出一份备份。</p>
        <Button kind="danger" busy={busy === 'import'} onClick={doImport}>替换并恢复</Button>
      </Sheet>

      <Sheet open={resetOpen} onClose={() => setResetOpen(false)} title="清空所有数据">
        <p>会删除这台设备上的所有人物、世界、聊天、记忆和设置，无法恢复。</p>
        <label className="field"><span>输入「清空」确认</span><input value={resetText} onChange={(e) => setResetText(e.target.value)} /></label>
        <Button kind="danger" busy={busy === 'reset'} disabled={resetText !== '清空'} onClick={doReset}>永久清空</Button>
      </Sheet>
    </div>
  );
}

// 每个软件的背景：选图片、调浅色遮罩、恢复默认
const APP_NAMES = {
  chat: ['聊天', '人物在聊天页单独设过背景的，用人物自己的'], moments: ['朋友圈'], diary: ['日记'], room: ['房间'], worldlines: ['世界线'],
  memories: ['记忆'], settings: ['设定'], characters: ['人物'], account: ['设置'], doll: ['画小人'],
};
function AppBgCard() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef(null);
  const target = useRef(null);
  const load = () => get('/api/local/app-bg').then(setData, () => setData({ bgs: {}, apps: Object.keys(APP_NAMES) }));
  useEffect(() => { load(); }, []);
  const changed = () => { load(); window.dispatchEvent(new Event('xsj:appbg')); };
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    const app = target.current;
    if (!f || !app) return;
    setBusy(app);
    try {
      const d = await cropImage(f, { aspect: screenAspect(), size: 1080, title: `裁剪「${APP_NAMES[app][0]}」的背景` });
      if (!d) return;
      await post('/api/local/app-bg', { app, dataUrl: d });
      changed(); toast('背景换好了');
    } catch (err) { toast(err.message); } finally { setBusy(''); }
  }
  async function setDim(app, dim) {
    setData((x) => ({ ...x, bgs: { ...x.bgs, [app]: { ...x.bgs[app], dim } } }));
    try { await post('/api/local/app-bg', { app, dim }); window.dispatchEvent(new Event('xsj:appbg')); } catch (err) { toast(err.message); }
  }
  async function reset(app) {
    try { await post('/api/local/app-bg', { app, dataUrl: null }); changed(); toast('已恢复默认'); } catch (err) { toast(err.message); }
  }
  if (!data) return <Loading />;
  return (
    <>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      {data.apps.map((app) => {
        const bg = data.bgs[app];
        return (
          <section className="card appbg-card" key={app}>
            <div className="appbg-row">
              <span className="appbg-thumb" style={bg?.image ? { backgroundImage: `url(${bg.image})` } : undefined}>
                {bg?.image && <i style={{ opacity: bg.dim / 100 }} />}
              </span>
              <div className="grow">
                <b>{APP_NAMES[app][0]}</b>
                {APP_NAMES[app][1] && <p className="muted small">{APP_NAMES[app][1]}</p>}
                <PickButton busy={busy === app} onClick={() => { target.current = app; fileRef.current?.click(); }}>{bg?.image ? '换一张' : '选一张图片'}</PickButton>
              </div>
            </div>
            {bg?.image && (
              <>
                <label className="field"><span>盖一层浅色，让字更清楚：{bg.dim}%</span>
                  <input type="range" min="0" max="90" value={bg.dim} onChange={(e) => setDim(app, Number(e.target.value))} />
                </label>
                <button type="button" className="text-btn" onClick={() => reset(app)}>恢复默认背景</button>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}

// 音乐：播放页背景、一起听时 TA 会不会主动说话
const MUSIC_COLORS = ['#2a2840', '#1e3a5f', '#2f4f3f', '#5a2a3a', '#3d3d3d', '#6b4f2a', '#123c4a', '#4a2d6b'];
function MusicLookCard() {
  const [look, setLook] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const load = () => get('/api/local/music/look').then((r) => setLook(r.look), () => setLook({ mode: 'cover', color: '#2a2840', dim: 35, blur: 0, image: null, autoTalk: true }));
  useEffect(() => { load(); }, []);
  async function save(patch, msg) {
    setLook((x) => ({ ...x, ...patch, ...(patch.image !== undefined ? { image: patch.image || null } : {}) }));
    try { await post('/api/local/music/look', patch); window.dispatchEvent(new Event('xsj:musiclook')); if (msg) toast(msg); }
    catch (err) { toast(err.message); load(); }
  }
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try {
      const d = await cropImage(f, { aspect: screenAspect(), size: 1080, title: '裁剪播放页背景' });
      if (d) await save({ image: d, mode: 'image' }, '背景换好了');
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  if (!look) return <Loading />;
  const modes = [['cover', '跟着封面颜色', '每首歌自动换成封面的主色'], ['color', '固定一种颜色', ''], ['image', '自己的图片', '']];
  const previewStyle = look.mode === 'image' && look.image
    ? { backgroundImage: `url(${look.image})` }
    : { background: look.mode === 'color' ? look.color : 'linear-gradient(160deg, #3a6fd8, #1d2f6b)' };
  return (
    <>
      <section className="card">
        <h3 className="card-title">播放页背景</h3>
        <div className="mlook">
          <div className="mlook-preview" style={previewStyle}>
            {look.mode === 'image' && look.image && <i style={{ opacity: look.dim / 100, backdropFilter: look.blur ? `blur(${Math.round(look.blur / 3)}px)` : undefined, WebkitBackdropFilter: look.blur ? `blur(${Math.round(look.blur / 3)}px)` : undefined }} />}
            <span className="mlook-disc" />
          </div>
          <div className="mlook-modes" role="radiogroup" aria-label="背景">
            {modes.map(([k, label, hint]) => (
              <button type="button" key={k} role="radio" aria-checked={look.mode === k} className={'mlook-mode' + (look.mode === k ? ' is-on' : '')}
                onClick={() => (k === 'image' && !look.image ? fileRef.current?.click() : save({ mode: k }))}>
                <b>{label}</b>{hint && <small>{hint}</small>}
              </button>
            ))}
          </div>
        </div>
        {look.mode === 'color' && (
          <div className="mlook-colors">
            {MUSIC_COLORS.map((c) => <button type="button" key={c} className={look.color === c ? 'is-on' : ''} style={{ background: c }} aria-label={c} onClick={() => save({ color: c })} />)}
            <label className="mlook-custom" aria-label="自己选颜色"><input type="color" value={look.color} onChange={(e) => save({ color: e.target.value })} /><span>自选</span></label>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
        {look.mode === 'image' && look.image && (
          <>
            <PickButton busy={busy} onClick={() => fileRef.current?.click()}>换一张图片</PickButton>
            <label className="field"><span>盖一层暗色，让字更清楚：{look.dim}%</span>
              <input type="range" min="0" max="90" value={look.dim} onChange={(e) => setLook({ ...look, dim: Number(e.target.value) })} onPointerUp={(e) => save({ dim: Number(e.currentTarget.value) })} onTouchEnd={(e) => save({ dim: Number(e.currentTarget.value) })} onKeyUp={(e) => save({ dim: Number(e.currentTarget.value) })} />
            </label>
            <label className="field"><span>模糊：{look.blur ? `${look.blur}` : '不模糊'}</span>
              <input type="range" min="0" max="30" value={look.blur} onChange={(e) => setLook({ ...look, blur: Number(e.target.value) })} onPointerUp={(e) => save({ blur: Number(e.currentTarget.value) })} onTouchEnd={(e) => save({ blur: Number(e.currentTarget.value) })} onKeyUp={(e) => save({ blur: Number(e.currentTarget.value) })} />
            </label>
            <button type="button" className="text-btn" onClick={() => save({ image: null }, '已删除背景图，改回跟着封面颜色')}>删除这张图片</button>
          </>
        )}
        {look.mode !== 'image' && look.image && <button type="button" className="text-btn" onClick={() => save({ mode: 'image' })}>用回之前那张图片</button>}
      </section>
      <section className="card">
        <h3 className="card-title">一起听</h3>
        <label className="check">
          <input type="checkbox" checked={look.autoTalk !== false} onChange={(e) => save({ autoTalk: e.target.checked })} />
          <span>TA 会跟着歌词主动说话<small className="muted small" style={{ display: 'block' }}>每首歌多花一次 AI 费用；关掉后，TA 只在你说话时回</small></span>
        </label>
      </section>
    </>
  );
}

// 我的头像和名字
function MeCard({ me, refreshMe }) {
  const [name, setName] = useState(me?.name || '我');
  async function saveProfile(body, msg) {
    try { await post('/api/local/profile', body); await refreshMe?.(); toast(msg); } catch (e) { toast(e.message); }
  }
  return (
    <section className="card me-card">
      <AvatarPicker name={name} color="#8a8496" url={me?.avatarUrl} size={88}
        onChange={(a) => saveProfile({ avatarId: a?.id || null }, a ? '头像换好了' : '已改回默认头像')} />
      <label className="field"><span>我的名字（朋友圈里显示）</span>
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name.trim() !== me?.name && saveProfile({ name: name.trim() }, '名字改好了')} />
      </label>
    </section>
  );
}

// 时间样式：字体、粗细、颜色、大小、排列
function ClockCard() {
  const [c, setC] = useState(null);
  useEffect(() => { get('/api/local/home').then((r) => setC({ ...DEFAULT_CLOCK, ...(r.clock || {}) }), () => setC({ ...DEFAULT_CLOCK })); }, []);
  if (!c) return <Loading />;
  async function change(patch) {
    const next = { ...c, ...patch };
    setC(next);
    try { await post('/api/local/clock', next); } catch (e) { toast(e.message); }
  }
  return (
    <section className="card clock-card">
      <h2 className="card-title">时间样式</h2>
      <div className="clock-preview"><ClockFace style={c} now={new Date()} /></div>
      <h3 className="card-sub">字体</h3>
      <div className="chip-row">
        {CLOCK_FONTS.map((f) => (
          <button key={f.id} type="button" className={'clock-font' + (c.font === f.id ? ' is-on' : '')} style={{ fontFamily: f.css }} onClick={() => change({ font: f.id })}>
            <span>12</span><small>{f.name}</small>
          </button>
        ))}
      </div>
      <h3 className="card-sub">粗细</h3>
      <div className="seg">
        {CLOCK_WEIGHTS.map((w) => <button key={w.v} type="button" className={c.weight === w.v ? 'is-on' : ''} onClick={() => change({ weight: w.v })}>{w.name}</button>)}
      </div>
      <h3 className="card-sub">颜色</h3>
      <div className="chip-row">
        {CLOCK_COLORS.map((col) => (
          <button key={col} type="button" className={'clock-color' + (c.color === col ? ' is-on' : '')} style={{ background: col }} aria-label={col} onClick={() => change({ color: col })} />
        ))}
        <label className="clock-color is-custom" title="自己调颜色">
          <input type="color" value={c.color} onChange={(e) => change({ color: e.target.value })} aria-label="自己调颜色" />
        </label>
      </div>
      <h3 className="card-sub">大小</h3>
      <input type="range" min="40" max="104" value={c.size} onChange={(e) => change({ size: Number(e.target.value) })} aria-label="时间大小" className="wide-range" />
      <h3 className="card-sub">样式</h3>
      <div className="seg">
        {[['plain', '普通'], ['stack', '上下叠'], ['outline', '空心'], ['glow', '发光']].map(([v, n]) => (
          <button key={v} type="button" className={c.layout === v ? 'is-on' : ''} onClick={() => change({ layout: v })}>{n}</button>
        ))}
      </div>
      <button type="button" className="text-btn" onClick={() => change({ ...DEFAULT_CLOCK })}>恢复默认</button>
    </section>
  );
}

function Toggle({ label, hint, checked, onChange, disabled }) {
  return (
    <label className={'toggle-row' + (disabled ? ' is-off' : '')}>
      <span><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <span className="switch">
        <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

const TYPE_LABELS = [['dm', 'TA 主动私聊你'], ['comment', 'TA 评论你的朋友圈'], ['reply', 'TA 回复你的评论'], ['like', 'TA 给你点赞'], ['moment', 'TA 发了朋友圈'], ['diary', 'TA 写了新日记'], ['note', 'TA 在照片旁钉了纸条']];

// TA 做了哪些事要提醒你（放在「TA 的自主行为」里）
function NotifyTypes({ notify, onChange }) {
  async function save(types) {
    const next = { ...notify, types: { ...notify.types, ...types } };
    onChange(next);
    try { await post('/api/local/settings', { notify: next }); } catch (e) { toast(e.message); }
  }
  return (
    <section className="card">
      <h2 className="card-title">TA 做这些事时提醒我</h2>
      {!notify.enabled && <p className="muted small">消息提醒现在是关着的，要先在「消息提醒」里打开。</p>}
      {TYPE_LABELS.map(([k, label]) => (
        <Toggle key={k} label={label} checked={notify.types?.[k] !== false} disabled={!notify.enabled} onChange={(v) => save({ [k]: v })} />
      ))}
    </section>
  );
}

// 消息提醒：横幅、系统通知、提示音、免打扰
function NotifyCard({ notify, onChange }) {
  const [permission, setPermission] = useState(() => notifyPermission());
  async function save(patch) {
    const next = { ...notify, ...patch, types: { ...notify.types, ...(patch.types || {}) }, dnd: { ...notify.dnd, ...(patch.dnd || {}) } };
    onChange(next);
    try { await post('/api/local/settings', { notify: next }); } catch (e) { toast(e.message); }
  }
  async function askPermission() {
    try { setPermission(await requestNotifyPermission()); } catch { setPermission('denied'); }
  }
  const off = !notify.enabled;
  return (
    <section className="card">
      <p className="muted small">TA 主动找你时提醒你。具体提醒哪些事，在「TA 的自主行为」里选。迟叙机要开着（在后台也行）才能提醒；完全关掉的话，下次打开会告诉你“你不在的时候”发生了什么。</p>
      <Toggle label="打开消息提醒" hint="在迟叙机里时，屏幕顶部弹出横幅" checked={notify.enabled} onChange={(v) => save({ enabled: v })} />
      <Toggle label="系统通知" hint="切到别的软件或网页时，用手机/电脑的通知提醒" checked={notify.system} disabled={off} onChange={(v) => { save({ system: v }); if (v && permission === 'default') askPermission(); }} />
      {notify.system && !off && permission !== 'granted' && (
        permission === 'unsupported'
          ? <p className="muted small">这个浏览器不支持系统通知。iPhone 需要先「添加到主屏幕」再从主屏幕打开。</p>
          : permission === 'denied'
            ? <p className="muted small">你之前拒绝了通知权限，需要在浏览器的网站设置里重新允许。</p>
            : <Button kind="ghost" onClick={askPermission}>允许系统通知</Button>
      )}
      <Toggle label="提示音" checked={notify.sound} disabled={off} onChange={(v) => save({ sound: v })} />
      <h3 className="card-sub">免打扰</h3>
      <Toggle label="免打扰时段" hint="这段时间不弹、不响，只显示红点" checked={notify.dnd?.on} disabled={off} onChange={(v) => save({ dnd: { on: v } })} />
      {notify.dnd?.on && !off && (
        <div className="grid-2">
          <label className="field"><span>从</span><input type="time" value={notify.dnd.start} onChange={(e) => save({ dnd: { start: e.target.value } })} /></label>
          <label className="field"><span>到</span><input type="time" value={notify.dnd.end} onChange={(e) => save({ dnd: { end: e.target.value } })} /></label>
        </div>
      )}
    </section>
  );
}

// 桌面壁纸：换成自己喜欢的图片
// 桌面图标：底色的透明度（线条一直不透明）、线条颜色
function IconAlphaCard() {
  const [v, setV] = useState(null);
  const [lines, setLines] = useState('dark');
  const [wall, setWall] = useState(null);
  useEffect(() => { get('/api/local/home').then((r) => { setV(r.iconAlpha ?? 100); setLines(r.iconLines || 'dark'); setWall(r.wallpaper); }, () => setV(100)); }, []);
  async function save(body) {
    try { await post('/api/local/icon-alpha', body); } catch (e) { toast(e.message); }
  }
  if (v === null) return null;
  const icons = ['chat', 'moments', 'diary', 'room'];
  return (
    <section className="card">
      <h3 className="card-title">桌面图标</h3>
      <div className={'ialpha-preview' + (lines === 'light' ? ' lines-light' : '')} style={wall ? { backgroundImage: `url(${wall})` } : undefined} aria-hidden="true">
        {icons.map((k) => <span key={k}><img className="t" src={`icons/tiles/${k}.png`} alt="" style={{ opacity: v / 100 }} /><img className="l" src={`icons/lines/${k}.png`} alt="" /></span>)}
      </div>
      <label className="field"><span>图标底色透明度：{v >= 100 ? '不透明' : v <= 0 ? '完全透明' : `${100 - v}%`}</span>
        <input type="range" min="0" max="100" step="5" value={v} onChange={(e) => setV(Number(e.target.value))}
          onPointerUp={(e) => save({ value: Number(e.currentTarget.value) })} onTouchEnd={(e) => save({ value: Number(e.currentTarget.value) })} onKeyUp={(e) => save({ value: Number(e.currentTarget.value) })}
          aria-label="图标底色的不透明程度" />
      </label>
      <div className="field"><span>线条颜色</span>
        <div className="ialpha-lines" role="radiogroup" aria-label="线条颜色">
          {[['dark', '深色'], ['light', '白色']].map(([k, label]) => (
            <button type="button" key={k} role="radio" aria-checked={lines === k} className={lines === k ? 'is-on' : ''} onClick={() => { setLines(k); save({ lines: k }); }}>{label}</button>
          ))}
        </div>
      </div>
      <p className="muted small">只有图标的底色会变透明，线条一直清楚；壁纸偏暗时，线条换成白色更好看。自己换过图的图标不受影响。</p>
    </section>
  );
}

function WallpaperCard() {
  const [url, setUrl] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const load = () => get('/api/local/home').then((r) => setUrl(r.wallpaper), () => setUrl(null));
  useEffect(() => { load(); }, []);
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { const d = await cropImage(f, { aspect: screenAspect(), size: 1290, title: '裁剪壁纸' }); if (!d) return; await post('/api/local/wallpaper', { dataUrl: d }); await load(); toast('壁纸换好了'); }
    catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  async function reset() {
    try { await post('/api/local/wallpaper', { dataUrl: null }); await load(); toast('已恢复默认壁纸'); } catch (e) { toast(e.message); }
  }
  return (
    <section className="card">
      <div className="wall-row">
        <span className="wall-preview" style={url ? { backgroundImage: `url(${url})` } : undefined} aria-hidden="true" />
        <div>
          <PickButton busy={busy} onClick={() => fileRef.current?.click()}>{url ? '换一张壁纸' : '选一张图片当壁纸'}</PickButton>
          {url && <button type="button" className="text-btn" onClick={reset}>恢复默认</button>}
          <p className="muted small">竖着的图片效果最好。图片只存在这台设备上。</p>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
    </section>
  );
}

// 安卓 App：用自己的图片和名字在手机桌面建一个图标（快捷方式）
function ShortcutCard() {
  const nat = typeof window !== 'undefined' ? window.XSJNative : null;
  const [img, setImg] = useState(null);
  const [name, setName] = useState('');
  const fileRef = useRef(null);
  if (!nat?.pinShortcut) return null;
  const supported = nat.canPinShortcut ? nat.canPinShortcut() : true;
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { const d = await cropImage(f, { aspect: 1, size: 256, type: 'image/png', title: '裁剪图标' }); if (d) setImg(d); } catch (err) { toast(err.message); }
  }
  function create() {
    const ok = nat.pinShortcut(name.trim() || '迟叙机', img);
    toast(ok ? '手机会弹出确认，点「添加」就好' : '这台手机不支持添加，可以在桌面设置里允许“添加快捷方式”后再试');
  }
  return (
    <section className="card">
      {!supported ? <p className="muted small">这台手机的桌面不支持应用添加图标。</p> : (
        <>
          <div className="icon-edit">
            {img ? <img src={img} alt="" /> : <span className="icon-empty" aria-hidden="true">＋</span>}
            <PickButton onClick={() => fileRef.current?.click()}>{img ? '换一张' : '选一张图片'}</PickButton>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
          <label className="field"><span>图标名字</span><input value={name} maxLength={10} placeholder="例如：备忘录" onChange={(e) => setName(e.target.value)} /></label>
          <Button disabled={!img} onClick={create}>添加到手机桌面</Button>
          <p className="muted small">会在手机桌面多出一个用你的图片和名字的图标，点它直接打开迟叙机。部分手机会在图标角上加一个小标记；原来的「迟叙机」图标还在，可以收进文件夹。</p>
        </>
      )}
    </section>
  );
}

// 我的小人：去 TA 房间串门时用
function MyDollCard({ go }) {
  const [doll, setDoll] = useState(undefined);
  useEffect(() => { API.get('/api/local/mydoll').then((r) => setDoll(r.doll || null), () => setDoll(null)); }, []);
  if (doll === undefined) return null;
  return (
    <section className="card">
      <div className="mydoll-row">
        {doll ? <img className="mydoll-img" src={dollUrl(doll)} alt="我的小人" /> : <span className="look-plain" aria-hidden="true" style={{ background: '#d9d4dd' }} />}
        <div className="grow">
          <p className="muted small">在白板小人上一格一格涂出你自己。画好后可以去 TA 的房间串门，也能生成小人码分享给朋友。</p>
          <Button kind="light" onClick={() => go('doll', { target: 'me', back: { name: 'account', section: 'doll' } })}>{doll ? '修改我的小人' : '画我的小人'}</Button>
        </div>
      </div>
    </section>
  );
}
