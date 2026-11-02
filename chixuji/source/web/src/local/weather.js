// 纯前端版：桌面天气小组件 + 让角色知道“用户那边今天的天气”
// 天气数据来自 Open-Meteo（免费、不用注册），城市名来自 Open-Meteo 地理编码 / BigDataCloud。
// 浏览器打不开别的软件的数据，所以没法直接读手机自带的天气 App，改成按定位或手动选的城市去查。
import { appendEvent, getBranch, newId, now, visibleEvents, visibleMemories } from './logic.js';

export const WEATHER_API = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  geocode: 'https://geocoding-api.open-meteo.com/v1/search',
  reverse: 'https://api.bigdatacloud.net/data/reverse-geocode-client',
};
const STALE_MS = 60 * 60e3; // 一小时更新一次
const KEEP_MEMORY_DAYS = 3; // 天气记忆只留最近几天，免得把记忆塞满

// WMO 天气代码 → 文字 + 图标种类
export function describeCode(code) {
  const c = Number(code);
  if (c === 0) return { text: '晴', icon: 'sun' };
  if (c === 1) return { text: '晴间多云', icon: 'partly' };
  if (c === 2) return { text: '多云', icon: 'partly' };
  if (c === 3) return { text: '阴', icon: 'cloud' };
  if (c === 45 || c === 48) return { text: '雾', icon: 'fog' };
  if (c >= 51 && c <= 57) return { text: '毛毛雨', icon: 'rain' };
  if (c === 61 || c === 80) return { text: '小雨', icon: 'rain' };
  if (c === 63 || c === 81) return { text: '中雨', icon: 'rain' };
  if (c === 65 || c === 82) return { text: '大雨', icon: 'rain' };
  if (c === 66 || c === 67) return { text: '冻雨', icon: 'rain' };
  if (c === 71 || c === 85) return { text: '小雪', icon: 'snow' };
  if (c === 73) return { text: '中雪', icon: 'snow' };
  if (c === 75 || c === 77 || c === 86) return { text: '大雪', icon: 'snow' };
  if (c >= 95) return { text: '雷阵雨', icon: 'storm' };
  return { text: '多云', icon: 'cloud' };
}

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const cn = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${m}月${d}日`; };

async function getJson(fetchImpl, url) {
  let res;
  try { res = await fetchImpl(url); } catch { throw new Error('连不上天气服务，请检查网络'); }
  if (!res.ok) throw new Error('天气服务暂时用不了，请稍后再试');
  return res.json();
}

export async function searchCity(fetchImpl, name) {
  const u = `${WEATHER_API.geocode}?name=${encodeURIComponent(name)}&count=8&language=zh&format=json`;
  const r = await getJson(fetchImpl, u);
  return (r.results || []).map((x) => ({
    name: x.name, lat: x.latitude, lon: x.longitude,
    detail: [x.admin1, x.country].filter(Boolean).join('，'),
  }));
}

export async function reverseCity(fetchImpl, lat, lon) {
  try {
    const r = await getJson(fetchImpl, `${WEATHER_API.reverse}?latitude=${lat}&longitude=${lon}&localityLanguage=zh`);
    return r.city || r.locality || r.principalSubdivision || '当前位置';
  } catch { return '当前位置'; }
}

export async function fetchForecast(fetchImpl, lat, lon) {
  const u = `${WEATHER_API.forecast}?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const r = await getJson(fetchImpl, u);
  const d = r.daily || {};
  const today = { date: d.time?.[0] || localDate(), code: d.weather_code?.[0], max: Math.round(d.temperature_2m_max?.[0]), min: Math.round(d.temperature_2m_min?.[0]) };
  const current = { temp: Math.round(r.current?.temperature_2m), code: r.current?.weather_code };
  return { today: { ...today, ...describeCode(today.code) }, current: { ...current, ...describeCode(current.code) } };
}

// 给角色看的一句话（放进提示词）
export function weatherLine(s) {
  const w = s.t.meta.find((m) => m.key === 'weather')?.value;
  if (!w?.city || !w.today || w.share === false) return '';
  if (w.today.date !== localDate()) return '';
  const cur = Number.isFinite(w.current?.temp) ? `，刚才 ${w.current.temp}℃、${w.current.text}` : '';
  return `用户所在地（${w.city}）今天的天气：${w.today.text}，${w.today.min}~${w.today.max}℃${cur}。这是用户现实中的天气，聊天时可以自然地关心（例如提醒带伞、添衣），但不要每句都提。`;
}

// 新的一天第一次拿到天气：每个人物（正在看的世界线）记一笔，并写进记忆
export function recordDailyWeather(s, w) {
  if (!w?.city || !w.today || w.share === false) return 0;
  let n = 0;
  for (const c of s.t.characters) {
    const b = getBranch(s, c.viewBranchId);
    if (!b || b.archivedAt) continue;
    const had = visibleEvents(s, b, { limit: 50, kinds: ['weather'] }).some((e) => e.data.date === w.today.date && e.data.city === w.city);
    if (had) continue;
    const seq = appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'weather', data: { date: w.today.date, city: w.city, text: w.today.text, min: w.today.min, max: w.today.max } });
    s.insert('memories', {
      id: newId(), characterId: c.id, branchId: b.id, anchorSeq: seq, kind: 'fact', holder: 'user',
      content: `${cn(w.today.date)}，用户所在的${w.city}天气${w.today.text}，${w.today.min}~${w.today.max}℃`,
      sourceSeqs: [seq], important: false, status: 'active', weather: true, createdAt: now(),
    });
    // 旧的天气记忆收起来
    const old = visibleMemories(s, b).filter((m) => s.t.memories.find((x) => x.id === m.id)?.weather && Date.now() - Date.parse(m.createdAt) > KEEP_MEMORY_DAYS * 86400e3);
    for (const m of old) appendEvent(s, { characterId: c.id, branchId: b.id, kind: 'memory_override', data: { memoryId: m.id, action: 'delete', reason: '过期的天气' } });
    n++;
  }
  return n;
}

export async function refreshWeather(s, fetchImpl, setMeta, { force = false } = {}) {
  const w = s.t.meta.find((m) => m.key === 'weather')?.value || null;
  if (!w?.city) return w;
  const fresh = w.fetchedAt && Date.now() - Date.parse(w.fetchedAt) < STALE_MS && w.today?.date === localDate();
  if (fresh && !force) return w;
  const f = await fetchForecast(fetchImpl, w.lat, w.lon);
  const next = { ...w, ...f, fetchedAt: now() };
  setMeta('weather', next);
  recordDailyWeather(s, next);
  return next;
}

export { localDate };
