// 桌面小组件（纯前端版）：唱片机 + 天气
import React, { useEffect, useRef, useState } from 'react';
import { cropImage } from '../crop.jsx';
import { get, post } from '../api.js';
import { compressImage } from '../image.js';
import { Button, PickButton, Sheet, toast } from '../ui.jsx';
import { toggle as toggleMusic, useMusic } from '../music/player.js';

// —— 唱片机 ——
export function RecordWidget({ record, onChanged, onOpenMusic }) {
  const [open, setOpen] = useState(false);
  // 音乐里有歌（正在放或上次放的）：唱片机显示那首歌的封面和歌手，点唱片就是播放 / 暂停
  const m = useMusic();
  const live = !!m.track;
  if (live) record = { title: m.track.title, artist: m.companion ? `${m.track.artist || '未知歌手'} · 和${m.companion.name}一起听` : m.track.artist || '未知歌手', cover: m.cover, playing: m.playing };
  const playing = live ? m.playing : record?.playing !== false;
  async function toggle() {
    if (live) { toggleMusic(); return; }
    try { await post('/api/local/record', { playing: !playing }); onChanged(); } catch (e) { toast(e.message); }
  }
  return (
    <>
      <div className="widget widget-record">
        <button type="button" className="record-deck" onClick={toggle} aria-label={playing ? '暂停唱片' : '播放唱片'}>
          <span className={'vinyl' + (playing ? ' is-playing' : '')}>
            <span className="vinyl-label" style={record?.cover ? { backgroundImage: `url(${record.cover})` } : undefined} />
          </span>
          <svg className={'tonearm' + (playing ? ' is-on' : '')} viewBox="0 0 40 80" aria-hidden="true">
            <circle cx="30" cy="8" r="6" fill="#d9d4cc" stroke="#8f887d" strokeWidth="1.5" />
            <path d="M30 8 L30 52 L18 66" fill="none" stroke="#cfc8bd" strokeWidth="3.5" strokeLinecap="round" />
            <rect x="11" y="63" width="10" height="7" rx="1.5" fill="#6f685e" transform="rotate(40 16 66)" />
          </svg>
        </button>
        <button type="button" className="widget-caption" onClick={() => (live ? onOpenMusic?.() : setOpen(true))} aria-label={live ? '打开音乐' : '换唱片封面和歌名'}>
          <b>{record?.title || '我们的歌'}</b>
          <span>{record?.artist || '点这里换封面'}</span>
        </button>
      </div>
      <RecordSheet open={open} record={record} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChanged(); }} />
    </>
  );
}

function RecordSheet({ open, record, onClose, onSaved }) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [cover, setCover] = useState(undefined); // undefined = 不改
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  useEffect(() => { if (open) { setTitle(record?.title || ''); setArtist(record?.artist || ''); setCover(undefined); } }, [open]);
  async function pick(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try { const d = await cropImage(f, { aspect: 1, size: 800, title: '裁剪唱片封面' }); if (d) setCover(d); } catch (err) { toast(err.message); }
  }
  async function save() {
    setBusy(true);
    try { await post('/api/local/record', { title, artist, ...(cover !== undefined ? { cover } : {}) }); toast('唱片换好了'); onSaved(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }
  const shown = cover === undefined ? record?.cover : cover;
  return (
    <Sheet open={open} onClose={onClose} title="唱片机">
      <button type="button" className="record-pick" onClick={() => fileRef.current?.click()}>
        <span className="vinyl"><span className="vinyl-label" style={shown ? { backgroundImage: `url(${shown})` } : undefined} /></span>
        <span>{shown ? '换一张封面' : '选一张图片当唱片封面'}</span>
      </button>
      <PickButton onClick={() => fileRef.current?.click()}>{shown ? '换一张封面' : '选一张图片当封面'}</PickButton>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pick} />
      {shown && <button type="button" className="text-btn" onClick={() => setCover(null)}>去掉封面</button>}
      <label className="field"><span>歌名</span><input value={title} maxLength={40} placeholder="我们的歌" onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="field"><span>歌手（可以不写）</span><input value={artist} maxLength={40} onChange={(e) => setArtist(e.target.value)} /></label>
      <Button busy={busy} onClick={save}>保存</Button>
      <p className="muted small">点唱片可以让它转起来或停下。这里只是装饰，不会播放声音。</p>
    </Sheet>
  );
}

// —— 天气 ——
function WeatherIcon({ icon, size = 40 }) {
  const s = { width: size, height: size };
  const sun = <><circle cx="20" cy="20" r="7" fill="#ffd36b" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <path key={a} d="M20 6 V9.5" stroke="#ffd36b" strokeWidth="2.4" strokeLinecap="round" transform={`rotate(${a} 20 20)`} />)}</>;
  const cloud = (y = 0, fill = '#fff') => <path d={`M11 ${30 + y} h18 a6 6 0 0 0 0 -12 a8 8 0 0 0 -15 -2 a5.5 5.5 0 0 0 -3 14 Z`} fill={fill} />;
  return (
    <svg viewBox="0 0 40 40" style={s} aria-hidden="true">
      {icon === 'sun' && sun}
      {icon === 'partly' && <><g transform="translate(-5 -5) scale(.85)">{sun}</g>{cloud(2)}</>}
      {icon === 'cloud' && cloud(0, '#eef1f6')}
      {icon === 'fog' && <>{cloud(-4, '#eef1f6')}<path d="M9 31 H31 M12 35 H28" stroke="#eef1f6" strokeWidth="2.2" strokeLinecap="round" /></>}
      {icon === 'rain' && <>{cloud(-4, '#eef1f6')}{[13, 20, 27].map((x) => <path key={x} d={`M${x} 30 l-2 6`} stroke="#9fd0ff" strokeWidth="2.2" strokeLinecap="round" />)}</>}
      {icon === 'snow' && <>{cloud(-4, '#eef1f6')}{[13, 20, 27].map((x) => <circle key={x} cx={x} cy="33" r="1.8" fill="#fff" />)}</>}
      {icon === 'storm' && <>{cloud(-4, '#dfe3ea')}<path d="M21 27 l-4 7 h4 l-2 6 l7 -9 h-4 l2 -4 Z" fill="#ffd36b" /></>}
    </svg>
  );
}

export function WeatherWidget({ weather, characterName, onChanged }) {
  const [open, setOpen] = useState(false);
  const t = weather?.today;
  const theme = t?.icon === 'sun' || t?.icon === 'partly' ? 'is-sunny' : t?.icon === 'rain' || t?.icon === 'storm' ? 'is-rainy' : t?.icon === 'snow' ? 'is-snowy' : 'is-cloudy';
  return (
    <>
      <button type="button" className={'widget widget-weather ' + (t ? theme : 'is-empty')} onClick={() => setOpen(true)}
        aria-label={t ? `${weather.city}，${t.text}，现在 ${weather.current?.temp} 度，点开设置` : '设置天气'}>
        {t ? (
          <>
            <span className="wx-city">{weather.city}</span>
            <span className="wx-now">{weather.current?.temp ?? '--'}°</span>
            <WeatherIcon icon={weather.current?.icon || t.icon} size={34} />
            <span className="wx-text">{t.text}</span>
            <span className="wx-range">最高 {t.max}° 最低 {t.min}°</span>
          </>
        ) : (
          <>
            <WeatherIcon icon="partly" size={40} />
            <span className="wx-text">点这里设置天气</span>
            <span className="wx-range">{characterName ? `${characterName}也能知道今天的天气` : ''}</span>
          </>
        )}
      </button>
      <WeatherSheet open={open} weather={weather} characterName={characterName} onClose={() => setOpen(false)} onChanged={onChanged} />
    </>
  );
}

function WeatherSheet({ open, weather, characterName, onClose, onChanged }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { if (open) { setQ(''); setResults(null); } }, [open]);
  async function search(e) {
    e.preventDefault();
    setBusy('search');
    try { setResults((await get(`/api/local/weather/search?q=${encodeURIComponent(q)}`)).results); } catch (err) { toast(err.message); } finally { setBusy(''); }
  }
  async function setLoc(body, msg) {
    setBusy('set');
    try { const r = await post('/api/local/weather/location', body); toast(msg || `已切换到${r.city}`); onChanged(); onClose(); }
    catch (err) { toast(err.message); } finally { setBusy(''); }
  }
  function useHere() {
    if (!navigator.geolocation) { toast('这个浏览器不支持定位，请搜索城市'); return; }
    setBusy('geo');
    navigator.geolocation.getCurrentPosition(
      (p) => setLoc({ lat: p.coords.latitude, lon: p.coords.longitude }, '已按当前位置更新天气'),
      () => { setBusy(''); toast('没能拿到位置（可能被拒绝了），请搜索城市'); },
      { timeout: 10000, maximumAge: 3600e3 },
    );
  }
  async function share(v) {
    try { await post('/api/local/weather/settings', { share: v }); onChanged(); toast(v ? `${characterName || 'TA'}会知道今天的天气` : '已关闭'); } catch (e) { toast(e.message); }
  }
  async function refresh() {
    setBusy('refresh');
    try { await post('/api/local/weather/refresh', { force: true }); onChanged(); toast('已更新'); } catch (e) { toast(e.message); } finally { setBusy(''); }
  }
  return (
    <Sheet open={open} onClose={onClose} title="天气">
      <p className="muted small">网页没法读取手机自带天气 App 的数据，这里会按你的定位或你选的城市，从公开的天气服务查当天天气，每小时自动更新。</p>
      <Button kind="ghost" busy={busy === 'geo' || busy === 'set'} disabled={!!busy} onClick={useHere}>用我现在的位置</Button>
      <form className="wx-search" onSubmit={search}>
        <input value={q} maxLength={40} placeholder="或者搜索城市，例如：广州" onChange={(e) => setQ(e.target.value)} />
        <Button busy={busy === 'search'} type="submit" disabled={!q.trim() || !!busy}>搜索</Button>
      </form>
      {results && (results.length ? (
        <ul className="wx-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}><button type="button" onClick={() => setLoc({ name: r.name, lat: r.lat, lon: r.lon })}><b>{r.name}</b><span>{r.detail}</span></button></li>
          ))}
        </ul>
      ) : <p className="muted small">没找到这个城市，换个写法试试。</p>)}
      {weather?.city && (
        <>
          <label className="toggle-row">
            <span><b>让{characterName || 'TA'}知道今天的天气</b><small>聊天时会自然地关心你（比如提醒带伞），每天的天气也会记进记忆。城市名和天气会随聊天发给你填的模型服务。</small></span>
            <span className="switch"><input type="checkbox" checked={weather.share} onChange={(e) => share(e.target.checked)} /><span aria-hidden="true" /></span>
          </label>
          <div className="room-actions">
            <button type="button" className="text-btn" disabled={!!busy} onClick={refresh}>现在更新</button>
          </div>
        </>
      )}
      <p className="muted small">天气数据：Open-Meteo</p>
    </Sheet>
  );
}
