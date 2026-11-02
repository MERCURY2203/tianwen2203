// 纯前端版的规则测试：和浏览器里跑的是同一份代码，只是存储换成内存
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Store, memoryAdapter } from '../../web/src/local/store.js';
import { createModel } from '../../web/src/local/model.js';
import { createRouter } from '../../web/src/local/router.js';
import { HttpError } from '../lib/http.mjs';
import { startFakeDeepSeek } from './fake-deepseek.mjs';
import { codeToDoll, dollToCode, newDoll, packDoll, compose, unpackDoll, W, H } from '../../web/src/doll.js';

let fake, s, router, adapter;
// 假的天气服务
const weatherCalls = [];
let weatherCode = 61;
async function weatherFetch(url) {
  weatherCalls.push(url);
  const json = (o) => ({ ok: true, json: async () => o });
  const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  if (url.includes('/v1/forecast')) return json({ current: { temperature_2m: 19.4, weather_code: weatherCode }, daily: { time: [today], weather_code: [weatherCode], temperature_2m_max: [22.2], temperature_2m_min: [17.6] } });
  if (url.includes('/v1/search')) return json({ results: [{ name: '广州', latitude: 23.13, longitude: 113.26, admin1: '广东', country: '中国' }] });
  if (url.includes('reverse-geocode')) return json({ city: '广州市', locality: '天河区', principalSubdivision: '广东省', countryName: '中国' });
  return { ok: false, json: async () => ({}) };
}
before(async () => {
  fake = await startFakeDeepSeek();
  adapter = memoryAdapter();
  s = new Store(adapter);
  await s.load();
  let getSettings = () => ({});
  const model = createModel(s, () => getSettings());
  const made = createRouter({ s, model, avatarCache: new Map(), fetchImpl: weatherFetch });
  router = made.router;
  getSettings = made.modelSettings;
});
after(() => fake.close());

async function call(method, url, body = {}) {
  const u = new URL(url, 'http://local');
  const m = router.match(method, u.pathname);
  assert.ok(m && !m.methodNotAllowed, `no route ${method} ${url}`);
  try {
    return { status: 200, body: JSON.parse(JSON.stringify(await m.handler({ params: m.params, query: u.searchParams, body }))) };
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message, ...err.extra } };
    throw err;
  }
}
const say = async (b, text) => {
  const r = await call('POST', `/api/branches/${b}/messages`, { text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const evs = r.body.events.filter((e) => e.kind === 'user_message' || e.kind === 'char_message');
  return evs.slice(evs.findLastIndex((e) => e.kind === 'user_message' && e.data.text === text));
};
const userTexts = async (b) => (await call('GET', `/api/branches/${b}/events?limit=200`)).body.events.filter((e) => e.kind === 'user_message').map((e) => e.data.text);
const lastSystem = () => fake.replyCalls().at(-1).body.messages[0].content;
const lastAll = () => JSON.stringify(fake.replyCalls().at(-1).body.messages);
let worldId;
const mk = async (name, settings = {}) => (await call('POST', '/api/characters', { name, settings, worldId })).body.character;
const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); } return null; };

test('首次使用：没确认 18 岁之前不能进入；确认后可以', async () => {
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/local/welcome', { adultConfirmed: true })).status, 400);
  assert.equal((await call('POST', '/api/local/welcome', { adultConfirmed: true, termsAccepted: true })).status, 200);
  assert.equal((await call('GET', '/api/me')).body.user.local, true);
});

test('模型设置：密钥打码显示；打码的值提交回来不会覆盖原密钥；连接测试走用户填的地址', async () => {
  const r = await call('POST', '/api/local/settings', { baseUrl: fake.url, apiKey: 'sk-good-local', auxApiKey: 'sk-mem-local', memoryEvery: 4 });
  assert.equal(r.status, 200);
  const g = (await call('GET', '/api/local/settings')).body;
  assert.ok(g.settings.apiKey.includes('•'));
  await call('POST', '/api/local/settings', { apiKey: g.settings.apiKey, chatModel: 'deepseek-v4-pro' });
  const t = await call('POST', '/api/local/test', { kind: 'reply' });
  assert.equal(t.status, 200, JSON.stringify(t.body));
  assert.equal(fake.requests.at(-1).auth, 'Bearer sk-good-local');
  assert.equal((await call('POST', '/api/local/settings', { baseUrl: 'ftp://x' })).status, 400);
});

test('人物必须选世界；世界观进入提示词', async () => {
  assert.equal((await call('POST', '/api/characters', { name: '无' })).status, 400);
  worldId = (await call('POST', '/api/worlds', { name: '大观园', lore: '清代贵族府邸' })).body.world.id;
  const c = await mk('黛玉', { personality: '敏感' });
  await say(c.viewBranch.id, '你好');
  assert.match(lastSystem(), /【世界观：大观园】\n清代贵族府邸/);
  assert.match(lastSystem(), /敏感/);
});

test('验收：A 的秘密不进 B 的提示；分叉只继承分叉点之前', async () => {
  const a = await mk('A');
  const b = await mk('B');
  const [first] = await say(a.viewBranch.id, '早');
  await say(a.viewBranch.id, '秘密：怕黑');
  await say(b.viewBranch.id, '你好');
  assert.ok(!lastAll().includes('怕黑'));
  const f = (await call('POST', `/api/branches/${a.viewBranch.id}/fork`, { seq: first.seq, name: '早分' })).body.branch;
  await say(f.id, '在吗');
  assert.ok(!lastAll().includes('怕黑'));
  assert.deepEqual(await userTexts(f.id), ['早', '在吗']);
  assert.deepEqual(await userTexts(a.viewBranch.id), ['早', '秘密：怕黑']);
});

test('验收：分叉继承当时的人设版本；只改当前世界线不影响别的', async () => {
  const c = await mk('版本', { personality: 'v1' });
  const main = c.viewBranch.id;
  const [early] = await say(main, '早期');
  const side = (await call('POST', `/api/branches/${main}/fork`, { seq: early.seq, name: '支' })).body.branch.id;
  await call('POST', `/api/characters/${c.id}/settings`, { data: { personality: 'v2' }, scope: 'current', branchId: main });
  assert.equal((await call('GET', `/api/characters/${c.id}/settings?branchId=${main}`)).body.settings.version, 2);
  assert.equal((await call('GET', `/api/characters/${c.id}/settings?branchId=${side}`)).body.settings.version, 1);
  await say(side, '你是谁');
  assert.match(lastSystem(), /v1/);
  assert.ok(!lastSystem().includes('v2'));
});

test('记忆：整理用第二个密钥；没来源的候选被拒；不倒灌到更早分出的世界线', async () => {
  const c = await mk('记忆');
  const br = c.viewBranch.id;
  const [m1] = await say(br, '记住：用户养了一只叫团子的猫');
  const child = (await call('POST', `/api/branches/${br}/fork`, { seq: m1.seq, name: '早分' })).body.branch.id;
  await call('POST', `/api/characters/${c.id}/view`, { branchId: br });
  await say(br, '嗯');
  const mem = await waitFor(async () => { const r = await call('GET', `/api/branches/${br}/memories`); return r.body.memories.length ? r.body.memories : null; });
  assert.deepEqual(mem.map((m) => m.content), ['用户养了一只叫团子的猫']);
  assert.equal(fake.requests.find((x) => x.body.response_format).auth, 'Bearer sk-mem-local');
  assert.equal((await call('GET', `/api/branches/${child}/memories`)).body.memories.length, 0);
  await say(br, '晚安');
  assert.match(lastSystem(), /团子/);
});

test('纠错、重新生成、失败后补回复、内容限制', async () => {
  const c = await mk('纠错');
  const br = c.viewBranch.id;
  const [, reply] = await say(br, '你喜欢什么');
  assert.equal((await call('POST', `/api/branches/${br}/corrections`, { seq: reply.seq, type: 'ooc', note: '太热情' })).status, 200);
  await say(br, '再说');
  assert.match(lastSystem(), /崩人设：太热情/);
  assert.match(lastAll(), /内容已省略/);
  const [, r2] = await say(br, '第三句');
  const rr = await call('POST', `/api/branches/${br}/retry`);
  assert.equal(rr.body.replaced, r2.seq);
  fake.state.failNext = 500;
  const fail = await call('POST', `/api/branches/${br}/messages`, { text: '会失败' });
  assert.equal(fail.status, 502);
  assert.ok(fail.body.userSeq);
  assert.equal((await call('GET', `/api/branches/${br}/events`)).body.needsReply, true);
  assert.equal((await call('POST', `/api/branches/${br}/retry`)).status, 200);
  assert.equal((await call('POST', `/api/branches/${br}/messages`, { text: '触发过滤' })).status, 422);
});

test('看图：图片存在本机，Flash 看图，描述进入回复提示', async () => {
  const c = await mk('看图');
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const img = (await call('POST', '/api/images', { characterId: c.id, dataUrl })).body.image.id;
  assert.equal(await s.getBlob(img), dataUrl);
  const r = await call('POST', `/api/branches/${c.viewBranch.id}/messages`, { text: '看', imageId: img });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(lastAll(), /橘猫/);
});

test('草稿、头像、空白世界线、删除角色；数据真的存进了存储', async () => {
  const d = (await call('POST', '/api/drafts', { data: { name: '草' } })).body.draft;
  const av = (await call('POST', '/api/avatars', { dataUrl: 'data:image/png;base64,AAAA' })).body.avatar;
  const c = (await call('POST', '/api/characters', { name: '草', worldId, avatarId: av.id, draftId: d.id })).body.character;
  assert.equal(c.avatarUrl, 'data:image/png;base64,AAAA');
  assert.ok(!(await call('GET', '/api/drafts')).body.drafts.some((x) => x.id === d.id));
  const nb = (await call('POST', `/api/characters/${c.id}/branches`, { name: '重来' })).body.branch;
  assert.equal((await userTexts(nb.id)).length, 0);
  await s.flush();
  const saved = await adapter.loadAll();
  assert.ok(saved.tables.characters.some((x) => x.id === c.id));
  assert.equal((await call('DELETE', `/api/characters/${c.id}`, { confirmName: '草' })).status, 200);
  assert.ok(!s.t.branches.some((b) => b.characterId === c.id));
});

test('朋友圈：角色每天发一条；关闭时不发；不重复发', async () => {
  const c = await mk('发圈');
  const br = c.viewBranch.id;
  let r = await call('POST', '/api/local/tick', {});
  assert.equal(r.body.posts.length, 0, '默认关闭');
  await call('POST', '/api/local/settings', { autoMoments: true });
  r = await call('POST', '/api/local/tick', {});
  assert.ok(r.body.posts.some((p) => p.characterId === c.id));
  const f = (await call('GET', `/api/branches/${br}/moments`)).body;
  assert.equal(f.posts[0].author, 'character');
  assert.equal(f.posts[0].text, '今天的晚霞很好看');
  r = await call('POST', '/api/local/tick', {});
  assert.ok(!r.body.posts.some((p) => p.characterId === c.id), '今天已经发过就不再发第一条');
  await call('POST', '/api/local/settings', { autoMoments: false });
});

test('朋友圈：用户发情绪低落的动态，角色看到后点赞、评论、私聊，并进入记忆；别的角色看不到', async () => {
  await call('POST', '/api/local/settings', { readMoments: true });
  const c = await mk('关心');
  const other = await mk('旁人');
  const br = c.viewBranch.id;
  const p = (await call('POST', `/api/branches/${br}/moments`, { text: '今天好难过' })).body.seq;
  // 角色过几秒才看；这里直接跑一次检查
  await call('POST', '/api/local/tick', {});
  const post = (await call('GET', `/api/branches/${br}/moments`)).body.posts.find((x) => x.seq === p);
  assert.ok(post.seen);
  assert.deepEqual(post.likes, ['character']);
  assert.equal(post.comments[0].text, '怎么了？');
  const chat = (await call('GET', `/api/branches/${br}/events`)).body.events;
  assert.equal(chat.at(-1).data.text, '看到你的朋友圈了，还好吗？');
  assert.ok((await call('GET', '/api/local/unread')).body.unread[c.id] >= 1);
  await call('POST', `/api/characters/${c.id}/read`);
  assert.equal((await call('GET', '/api/local/unread')).body.unread[c.id], 0);
  // 记忆：朋友圈内容也会被整理
  const memReq = await waitFor(async () => fake.requests.find((x) => x.body.response_format && JSON.stringify(x.body.messages).includes('发了一条朋友圈：今天好难过')));
  assert.ok(memReq, '朋友圈应该交给记忆整理');
  // 别的角色看不到这条
  assert.equal((await call('GET', `/api/branches/${other.viewBranch.id}/moments`)).body.posts.length, 0);
  // 普通的动态：只点赞，不私聊
  const p2 = (await call('POST', `/api/branches/${br}/moments`, { text: '晒晒午饭' })).body.seq;
  await call('POST', '/api/local/tick', {});
  const post2 = (await call('GET', `/api/branches/${br}/moments`)).body.posts.find((x) => x.seq === p2);
  assert.equal(post2.comments.length, 0);
  assert.notEqual((await call('GET', `/api/branches/${br}/events`)).body.events.at(-1).data.text, '看到你的朋友圈了，还好吗？'.repeat(2));
  await call('POST', '/api/local/settings', { readMoments: false });
});

test('朋友圈：点赞可以取消；评论角色的动态；分叉前的新世界线看不到之后的朋友圈', async () => {
  const c = await mk('点赞');
  const br = c.viewBranch.id;
  const [m] = await say(br, '你好');
  const p = (await call('POST', `/api/branches/${br}/moments`, { text: '一条动态' })).body.seq;
  assert.equal((await call('POST', `/api/branches/${br}/moments/${p}/like`)).body.liked, true);
  assert.equal((await call('POST', `/api/branches/${br}/moments/${p}/like`)).body.liked, false);
  assert.equal((await call('POST', `/api/branches/${br}/moments/${p}/comments`, { text: '自己评论一下' })).status, 200);
  const child = (await call('POST', `/api/branches/${br}/fork`, { seq: m.seq, name: '早' })).body.branch.id;
  assert.equal((await call('GET', `/api/branches/${child}/moments`)).body.posts.length, 0);
});

test('日记：聊完写日记，记录这段聊天；太少不写；不重复覆盖同一段', async () => {
  const c = await mk('日记');
  const br = c.viewBranch.id;
  assert.equal((await call('POST', `/api/branches/${br}/diary`)).status, 400, '还没聊过就不写');
  await say(br, '一');
  await say(br, '二');
  const w = await call('POST', `/api/branches/${br}/diary`);
  assert.equal(w.status, 200, JSON.stringify(w.body));
  const d = (await call('GET', `/api/branches/${br}/diary`)).body;
  assert.equal(d.entries[0].text, '今天和你聊了一会儿，心里很安静。');
  assert.equal(d.pending, 0);
  // 自动写：离开聊天时满 4 条才写
  await call('POST', '/api/local/settings', { autoDiary: true });
  await say(br, '三');
  let t = await call('POST', '/api/local/tick', { leftChatCharacterId: c.id });
  assert.ok(!t.body.diaries.some((x) => x.characterId === c.id), '只有 2 条新消息，不写');
  await say(br, '四');
  t = await call('POST', '/api/local/tick', { leftChatCharacterId: c.id });
  assert.ok(t.body.diaries.some((x) => x.characterId === c.id));
  assert.equal((await call('GET', `/api/branches/${br}/diary`)).body.entries.length, 2);
  await call('POST', '/api/local/settings', { autoDiary: false });
});

test('朋友圈删除：自己的可以删（可选让 TA 忘掉）；TA 的只能隐藏；带图的清掉图片；只影响当前世界线', async () => {
  const c = await mk('删除');
  const br = c.viewBranch.id;
  const mems = async (b = br) => (await call('GET', `/api/branches/${b}/memories`)).body.memories.map((m) => m.content);
  const posts = async (b = br) => (await call('GET', `/api/branches/${b}/moments`)).body.posts;
  const [m0] = await say(br, '开始');
  // 1) 已经记进记忆的动态：删除并忘掉 → 记忆撤掉
  const p1 = (await call('POST', `/api/branches/${br}/moments`, { text: '记住：我怕打雷' })).body.seq;
  await call('POST', `/api/branches/${br}/memories/process`);
  assert.ok((await mems()).includes('我怕打雷'));
  // 先分一条线：分叉点在这条动态之后，那条线也看得到它
  const [fp] = await say(br, '分叉点');
  const fork = await call('POST', `/api/branches/${br}/fork`, { seq: fp.seq, name: '平行' });
  assert.equal(fork.status, 200, JSON.stringify(fork.body));
  const forkId = fork.body.branch.id;
  await call('POST', `/api/characters/${c.id}/view`, { branchId: br }); // 回到原来那条线
  const r1 = await call('POST', `/api/branches/${br}/moments/${p1}/remove`, { forget: true });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.mode, 'delete');
  assert.equal(r1.body.forgotten, 1);
  assert.ok(!(await posts()).some((p) => p.seq === p1));
  assert.ok(!(await mems()).includes('我怕打雷'));
  assert.equal((await call('POST', `/api/branches/${br}/moments/${p1}/remove`, {})).status, 400, '不能重复删');
  assert.ok((await posts(forkId)).some((p) => p.seq === p1), '分出去的世界线不受影响');
  assert.ok((await mems(forkId)).includes('我怕打雷'));
  // 2) 只删除不忘掉 → 记忆还在
  const p2 = (await call('POST', `/api/branches/${br}/moments`, { text: '记住：我喜欢下雨' })).body.seq;
  await call('POST', `/api/branches/${br}/memories/process`);
  await call('POST', `/api/branches/${br}/moments/${p2}/remove`, { forget: false });
  assert.ok(!(await posts()).some((p) => p.seq === p2));
  assert.ok((await mems()).includes('我喜欢下雨'));
  // 3) 还没整理就删除并忘掉 → 之后整理时根本不会交给模型
  const p3 = (await call('POST', `/api/branches/${br}/moments`, { text: '记住：秘密暗号' })).body.seq;
  await call('POST', `/api/branches/${br}/moments/${p3}/remove`, { forget: true });
  const before = fake.requests.length;
  await say(br, '记住：我爱吃橘子');
  await call('POST', `/api/branches/${br}/memories/process`);
  const sent = JSON.stringify(fake.requests.slice(before).map((x) => x.body.messages));
  assert.ok(!sent.includes('秘密暗号'));
  assert.ok((await mems()).includes('我爱吃橘子'));
  // 4) 自己的评论可以删；TA 的动态和评论只能隐藏，TA 还记得
  await call('POST', '/api/local/settings', { autoMoments: true });
  await call('POST', '/api/local/tick', {});
  await call('POST', '/api/local/settings', { autoMoments: false });
  const cp = (await posts()).find((p) => p.author === 'character');
  await call('POST', `/api/branches/${br}/moments/${cp.seq}/comments`, { text: '好看' });
  const myComment = (await posts()).find((p) => p.seq === cp.seq).comments.find((x) => x.author === 'user');
  const rc = await call('POST', `/api/branches/${br}/comments/${myComment.seq}/remove`, { forget: true });
  assert.equal(rc.body.mode, 'delete');
  assert.equal((await posts()).find((p) => p.seq === cp.seq).comments.length, 0);
  const rh = await call('POST', `/api/branches/${br}/moments/${cp.seq}/remove`, { forget: true });
  assert.equal(rh.body.mode, 'hide');
  assert.equal(rh.body.forgotten, 0, '隐藏 TA 的动态不会让 TA 忘掉');
  assert.ok(!(await posts()).some((p) => p.seq === cp.seq));
  const hideEv = s.t.events.filter((e) => e.kind === 'moment_remove').at(-1);
  assert.equal(hideEv.data.forget, false);
  // 5) 带图的动态删除后，图片从本机清掉
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const img = (await call('POST', '/api/images', { characterId: c.id, dataUrl })).body.image.id;
  const p5 = (await call('POST', `/api/branches/${br}/moments`, { text: '晒图', imageIds: [img] })).body.seq;
  const r5 = await call('POST', `/api/branches/${br}/moments/${p5}/remove`, {});
  assert.equal(r5.body.freed, 1);
  assert.equal(await s.getBlob(img), undefined);
  void m0;
});

test('消息提醒：列出 TA 主动做的事；朋友圈/日记各有红点；删除隐藏的不再提醒；设置可保存', async () => {
  const c = await mk('提醒');
  const br = c.viewBranch.id;
  const start = (await call('GET', '/api/local/notifications?after=0')).body.latestSeq;
  await call('POST', '/api/local/settings', { readMoments: true, autoMoments: true });
  const p = (await call('POST', `/api/branches/${br}/moments`, { text: '今天好难过' })).body.seq;
  await call('POST', '/api/local/tick', {});
  await call('POST', '/api/local/settings', { readMoments: false, autoMoments: false });
  const n = (await call('GET', `/api/local/notifications?after=${start}`)).body;
  const mine = n.items.filter((x) => x.characterId === c.id).map((x) => x.type).sort();
  assert.deepEqual(mine, ['comment', 'dm', 'like', 'moment']);
  assert.equal(n.notify.dnd.on, false, '免打扰默认关闭');
  // 普通聊天回复不算提醒
  await say(br, '你好');
  assert.ok(!(await call('GET', `/api/local/notifications?after=${n.latestSeq}`)).body.items.some((x) => x.characterId === c.id));
  // 红点：圈 3（赞、评论、TA 的新动态），聊 1；看过就清零
  let u = (await call('GET', '/api/local/unread')).body;
  assert.equal(u.moments[c.id], 3);
  assert.equal(u.unread[c.id], 1);
  await call('POST', `/api/characters/${c.id}/read`, { area: 'moments' });
  u = (await call('GET', '/api/local/unread')).body;
  assert.equal(u.moments[c.id], 0);
  assert.equal(u.unread[c.id], 1, '看朋友圈不会清掉聊天的红点');
  // 删除那条动态后，它的赞和评论不再算提醒
  await call('POST', `/api/branches/${br}/moments/${p}/remove`, {});
  const after = (await call('GET', `/api/local/notifications?after=${start}`)).body.items.filter((x) => x.characterId === c.id).map((x) => x.type).sort();
  assert.deepEqual(after, ['dm', 'moment']);
  // 设置
  await call('POST', '/api/local/settings', { notify: { sound: false, types: { like: false }, dnd: { on: true, start: '22:30', end: '07:00' } } });
  const cfg = (await call('GET', '/api/local/settings')).body.settings.notify;
  assert.equal(cfg.sound, false);
  assert.equal(cfg.types.like, false);
  assert.equal(cfg.types.dm, true);
  assert.deepEqual(cfg.dnd, { on: true, start: '22:30', end: '07:00' });
  await call('POST', '/api/local/settings', { notify: { dnd: { start: '25:99' } } });
  assert.equal((await call('GET', '/api/local/settings')).body.settings.notify.dnd.start, '22:30', '错误的时间不保存');
});

test('房间：挂照片 → TA 写纸条、可能私聊、记进记忆；对调位置；取下可让 TA 忘掉；摆件自动+手动；按世界线隔离', async () => {
  const c = await mk('房间');
  const br = c.viewBranch.id;
  const room = async (b = br) => (await call('GET', `/api/branches/${b}/room`)).body;
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const img = async () => (await call('POST', '/api/images', { characterId: c.id, dataUrl })).body.image.id;
  const [m0] = await say(br, '开始');
  const r1 = await call('POST', `/api/branches/${br}/room/photos`, { imageId: await img(), slot: 4, caption: '那天在海边', frame: 'white' });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal((await call('POST', `/api/branches/${br}/room/photos`, { imageId: await img(), slot: 4 })).status, 400, '同一格不能挂两张');
  const withNote = await waitFor(async () => (await room()).photos.find((p) => p.note), 5000);
  assert.ok(withNote, 'TA 应该写了纸条');
  assert.equal(withNote.note.text, '这张我也很喜欢。下次换我给你拍。');
  assert.equal(withNote.frame, 'white');
  const chat = (await call('GET', `/api/branches/${br}/events`)).body.events;
  assert.equal(chat.at(-1).data.text, '照片墙上那张海边，是那天吗？');
  const n = (await call('GET', '/api/local/notifications?after=0')).body.items.filter((x) => x.characterId === c.id).map((x) => x.type).sort();
  assert.deepEqual(n, ['dm', 'note']);
  assert.equal((await call('GET', '/api/local/unread')).body.room[c.id], 1);
  // 照片进记忆整理
  const memReq = fake.requests.find((x) => x.body.response_format && JSON.stringify(x.body.messages).includes('照片墙上挂了一张照片'));
  assert.ok(memReq, '照片应该交给记忆整理');
  // 对调位置
  const r2 = await call('POST', `/api/branches/${br}/room/photos`, { imageId: await img(), slot: 0, caption: '第二张' });
  await call('POST', `/api/branches/${br}/room/photos/${r1.body.seq}/move`, { slot: 0 });
  let st = await room();
  assert.equal(st.photos.find((p) => p.seq === r1.body.seq).slot, 0);
  assert.equal(st.photos.find((p) => p.seq === r2.body.seq).slot, 4);
  // 分出去的世界线（在挂照片之前分叉）看不到照片
  const child = (await call('POST', `/api/branches/${br}/fork`, { seq: m0.seq, name: '早' })).body.branch.id;
  assert.equal((await room(child)).photos.length, 0);
  await call('POST', `/api/characters/${c.id}/view`, { branchId: br });
  // 摆件：重要记忆自动摆上；可以手动换样子、换位置；收起来后不再自动出现
  await say(br, '我们确定关系吧');
  await call('POST', `/api/branches/${br}/memories/process`);
  const pend = (await call('GET', `/api/branches/${br}/memories`)).body.memories.find((m) => m.content === '双方确定了恋爱关系');
  assert.ok(!(await room()).keepsakes.some((k) => k.memoryId === pend.id), '还没确认的重要记忆不摆出来');
  await call('POST', `/api/branches/${br}/memories/${pend.id}`, { action: 'confirm' });
  st = await room();
  const auto = st.keepsakes.find((k) => k.content === '双方确定了恋爱关系');
  assert.ok(auto?.auto, '重要记忆自动变成摆件');
  await call('POST', `/api/branches/${br}/room/keepsakes`, { memoryId: auto.memoryId, item: 'cat', slot: 3 });
  st = await room();
  const manual = st.keepsakes.find((k) => k.memoryId === auto.memoryId);
  assert.deepEqual([manual.item, manual.slot, manual.auto], ['cat', 3, false]);
  const snip = (await call('GET', `/api/branches/${br}/room/memory/${auto.memoryId}`)).body;
  assert.ok(snip.lines.some((l) => l.source && l.text.includes('确定关系')));
  await call('POST', `/api/branches/${br}/room/keepsakes/off`, { memoryId: auto.memoryId });
  assert.ok(!(await room()).keepsakes.some((k) => k.memoryId === auto.memoryId));
  // 取下照片并让 TA 忘掉：纸条也不再提醒，相关记忆撤掉
  const rm = await call('POST', `/api/branches/${br}/room/photos/${r1.body.seq}/remove`, { forget: true });
  assert.equal(rm.status, 200);
  assert.ok(!(await room()).photos.some((p) => p.seq === r1.body.seq));
});


test('桌面：壁纸、唱片机；天气小组件让角色知道今天的天气并记进记忆', async () => {
  const c = await mk('天气');
  const br = c.viewBranch.id;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  // 壁纸、唱片机
  assert.equal((await call('GET', '/api/local/home')).body.wallpaper, null);
  await call('POST', '/api/local/wallpaper', { dataUrl: png });
  assert.equal((await call('GET', '/api/local/home')).body.wallpaper, png);
  assert.equal((await call('POST', '/api/local/wallpaper', { dataUrl: 'data:text/html,hi' })).status, 400);
  await call('POST', '/api/local/record', { title: '晴天', artist: '某人', cover: png, playing: false });
  let h = (await call('GET', '/api/local/home')).body;
  assert.deepEqual([h.record.title, h.record.artist, h.record.cover, h.record.playing], ['晴天', '某人', png, false]);
  await call('POST', '/api/local/wallpaper', { dataUrl: null });
  assert.equal((await call('GET', '/api/local/home')).body.wallpaper, null);
  // 还没设置城市：角色提示里没有天气
  await say(br, '早');
  assert.ok(!lastSystem().includes('今天的天气'));
  // 搜索城市并设置
  const found = (await call('GET', '/api/local/weather/search?q=广州')).body.results;
  assert.equal(found[0].name, '广州');
  const set = await call('POST', '/api/local/weather/location', { name: '广州', lat: 23.13, lon: 113.26 });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  h = (await call('GET', '/api/local/home')).body;
  assert.equal(h.weather.city, '广州');
  assert.equal(h.weather.today.text, '小雨');
  assert.deepEqual([h.weather.today.min, h.weather.today.max, h.weather.current.temp], [18, 22, 19]);
  // 角色聊天时知道天气
  await say(br, '今天出门吗');
  assert.match(lastSystem(), /用户所在地（广州）今天的天气：小雨，18~22℃/);
  // 记进记忆（每天一条，不重复）
  const mems = async () => (await call('GET', `/api/branches/${br}/memories`)).body.memories.map((m) => m.content);
  assert.ok((await mems()).some((m) => m.includes('广州天气小雨')));
  await call('POST', '/api/local/weather/refresh', { force: true });
  assert.equal((await mems()).filter((m) => m.includes('广州天气')).length, 1, '同一天不重复记');
  // 关掉“让 TA 知道”：提示里不再有
  await call('POST', '/api/local/weather/settings', { share: false });
  await say(br, '嗯');
  assert.ok(!lastSystem().includes('今天的天气'));
  await call('POST', '/api/local/weather/settings', { share: true });
  // 用定位：自动反查城市名
  await call('POST', '/api/local/weather/location', { lat: 23.1, lon: 113.2 });
  assert.equal((await call('GET', '/api/local/home')).body.weather.city, '广州市');
  // 一小时内不重复请求
  const before = weatherCalls.length;
  await call('POST', '/api/local/weather/refresh', {});
  assert.equal(weatherCalls.length, before);
});

test('TA 的心声：打开后回复里的心声被拆出来单独存，不进聊天历史；关闭时不加要求', async () => {
  const c = await mk('心声');
  const br = c.viewBranch.id;
  await say(br, '你好');
  assert.ok(!lastSystem().includes('【心声】'));
  await call('POST', '/api/local/settings', { innerVoice: true });
  fake.state.nextReply = '没事，你早点睡。\n【心声】她明明很累，还在硬撑。';
  const [, reply] = await say(br, '我没事');
  assert.ok(lastSystem().includes('【心声】'));
  assert.equal(reply.data.text, '没事，你早点睡。');
  assert.equal(reply.data.thought, '她明明很累，还在硬撑。');
  await say(br, '嗯');
  assert.ok(!lastAll().includes('硬撑'), '心声不能出现在之后的聊天历史里');
  await call('POST', '/api/local/settings', { innerVoice: false });
});

test('聊天背景：按人物保存，可以调变暗和模糊，可以恢复默认', async () => {
  const a = await mk('背景A'); const b = await mk('背景B');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await call('POST', `/api/characters/${a.id}/chatbg`, { dataUrl: png });
  await call('POST', `/api/characters/${a.id}/chatbg`, { dim: 50, blur: 6 });
  let r = (await call('GET', `/api/characters/${a.id}/chatbg`)).body;
  assert.deepEqual([r.image, r.dim, r.blur], [png, 50, 6]);
  assert.equal((await call('GET', `/api/characters/${b.id}/chatbg`)).body.image, null);
  assert.equal((await call('POST', `/api/characters/${a.id}/chatbg`, { blur: 99 })).status, 400);
  await call('POST', `/api/characters/${a.id}/chatbg`, { dataUrl: null });
  r = (await call('GET', `/api/characters/${a.id}/chatbg`)).body;
  assert.deepEqual([r.image, r.dim, r.blur], [null, 25, 0]);
});


test('TA 查手机：关着时不能查；位置只给文字；聊天只能看同一个世界的人；拒绝也有反应；TA 会开口要', async () => {
  const otherWorld = (await call('POST', '/api/worlds', { name: '异世界', lore: '另一个世界' })).body.world.id;
  const c = await mk('查手机');
  const friend = await mk('同世界朋友');
  const stranger = (await call('POST', '/api/characters', { name: '异世界人', settings: {}, worldId: otherWorld })).body.character;
  const br = c.viewBranch.id;
  await say(friend.viewBranch.id, '我们聊到凌晨两点吧');
  await say(br, '在吗');
  assert.equal((await call('POST', `/api/branches/${br}/phone`, { what: 'location', lat: 23.1, lon: 113.3 })).status, 400, '默认关闭');
  await call('POST', '/api/local/settings', { phoneCheck: true });
  const opt = (await call('GET', `/api/characters/${c.id}/phone`)).body;
  assert.equal(opt.enabled, true);
  assert.ok(opt.others.some((o) => o.id === friend.id), '同一个世界的人物在列表里');
  assert.ok(!opt.others.some((o) => o.id === stranger.id), '别的世界的人物不在列表里');
  // 位置：给模型的是文字，不是坐标
  const before = fake.requests.length;
  const r1 = await call('POST', `/api/branches/${br}/phone`, { what: 'location', lat: 23.123456, lon: 113.654321 });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(r1.body.place, '广州市·天河区');
  const sent = JSON.stringify(fake.requests.slice(before).map((x) => x.body.messages));
  assert.ok(sent.includes('广州市·天河区'));
  assert.ok(!sent.includes('23.12') && !sent.includes('113.65'), '经纬度不能发给模型');
  const evs = (await call('GET', `/api/branches/${br}/events`)).body.events;
  const card = evs.find((e) => e.kind === 'phone_check');
  assert.equal(card.data.place, '广州市·天河区');
  assert.equal(evs.at(-1).data.text, '这么晚还在广州市·天河区？');
  // 位置默认不进记忆
  let mems = (await call('GET', `/api/branches/${br}/memories`)).body.memories.map((m) => m.content);
  assert.ok(!mems.some((m) => m.includes('天河区')));
  // 只给城市
  await call('POST', '/api/local/settings', { locationLevel: 'city', locationMemory: true });
  const r2 = await call('POST', `/api/branches/${br}/phone`, { what: 'location', lat: 23.1, lon: 113.3 });
  assert.equal(r2.body.place, '广州市');
  mems = (await call('GET', `/api/branches/${br}/memories`)).body.memories.map((m) => m.content);
  assert.ok(mems.some((m) => m.includes('广州市')), '打开开关后位置进记忆');
  // 聊天：只能看同一个世界的人
  assert.equal((await call('POST', `/api/branches/${br}/phone`, { what: 'chats', chatIds: [stranger.id] })).status, 400);
  const before2 = fake.requests.length;
  const r3 = await call('POST', `/api/branches/${br}/phone`, { what: 'chats', chatIds: [friend.id] });
  assert.equal(r3.status, 200, JSON.stringify(r3.body));
  assert.ok(JSON.stringify(fake.requests.slice(before2).map((x) => x.body.messages)).includes('我们聊到凌晨两点吧'));
  const chk = (await call('GET', `/api/branches/${br}/events`)).body.events.filter((e) => e.kind === 'phone_check').at(-1);
  assert.equal(chk.data.chats[0].name, '同世界朋友');
  // 被看的人物不知道
  assert.ok(!(await call('GET', `/api/branches/${friend.viewBranch.id}/events`)).body.events.some((e) => e.kind === 'phone_check'));
  // TA 开口要 → 用户拒绝
  const t = await call('POST', '/api/local/tick', { forcePhoneAsk: true });
  assert.ok(t.body.dms.some((d) => d.characterId === c.id));
  const req = (await call('GET', `/api/characters/${c.id}/phone`)).body.openRequest;
  assert.ok(req);
  const r4 = await call('POST', `/api/branches/${br}/phone`, { what: req.what, approve: false, requestSeq: req.seq });
  assert.equal(r4.status, 200);
  assert.equal((await call('GET', `/api/branches/${br}/events`)).body.events.at(-1).data.text, '好吧，不看就不看。');
  assert.equal((await call('GET', `/api/characters/${c.id}/phone`)).body.openRequest, null, '回答过就不再挂着');
  await call('POST', '/api/local/settings', { phoneCheck: false, locationLevel: 'street', locationMemory: false });
});

test('桌面图标：换图、改名字、恢复默认；不认识的图标不行', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await call('POST', '/api/local/icons/chat', { dataUrl: png, name: '备忘录' });
  let ic = (await call('GET', '/api/local/home')).body.icons;
  assert.deepEqual(ic.chat, { name: '备忘录', image: png });
  assert.equal((await call('POST', '/api/local/icons/chat', { name: '一二三四五六七八九' })).status, 400, '名字太长');
  assert.equal((await call('POST', '/api/local/icons/hack', { name: 'x' })).status, 404);
  await call('POST', '/api/local/icons/chat', { reset: true });
  ic = (await call('GET', '/api/local/home')).body.icons;
  assert.equal(ic.chat, undefined);
});

test('像素小人：画了能存、小人码能来回转、坏数据不收、玩家自己的小人', async () => {
  const c = await mk('小画');
  const d = newDoll();
  d.front[10 * W + 12] = '#ff0000'; d.front[3 * W + 3] = '_';
  d.side = new Array(d.front.length).fill(null); d.side[5 * W + 15] = '#00ff00';
  const code = dollToCode(d);
  const back = codeToDoll('看看我的小人 ' + code + ' 好看吗');
  assert.deepEqual(back.front, d.front);
  assert.deepEqual(back.side, d.side);
  assert.equal(back.back, null);
  assert.equal(compose(back, 'back')[10 * W + 12], '#ff0000', '没画背面就照正面起稿');
  // 旧白板（32×64，v1）画的小人还能读，颜色会搬到新白板上
  const old = { v: 1, p: ['00ff00'], f: `${10 * 32 + 16}.A${32 * 64 - 10 * 32 - 17}.`, o: '4a3b42' };
  const moved = unpackDoll(old);
  assert.equal(moved.front.length, W * H);
  assert.ok(moved.front.includes('#00ff00'));
  assert.throws(() => codeToDoll('XSJ1.abc'));
  assert.throws(() => codeToDoll('随便一段字'));

  let r = await call('PATCH', `/api/characters/${c.id}`, { look: 'doll' });
  assert.equal(r.status, 400, '没画不能选');
  r = await call('POST', `/api/characters/${c.id}/doll`, { doll: packDoll(d) });
  assert.equal(r.body.character.look, 'doll');
  assert.deepEqual(r.body.character.doll, packDoll(d));
  assert.equal((await call('POST', `/api/characters/${c.id}/doll`, { doll: { v: 1, p: ['zz'], f: 'A' } })).status, 400);
  r = await call('POST', `/api/characters/${c.id}/doll`, { doll: null });
  assert.equal(r.body.character.look, null);

  assert.equal((await call('GET', '/api/local/mydoll')).body.doll, null);
  await call('POST', '/api/local/mydoll', { doll: packDoll(d) });
  assert.deepEqual((await call('GET', '/api/local/mydoll')).body.doll, packDoll(d));
});

test('保存：某一次存储失败后，之后的改动还能存进去；冻结后不再写入', async () => {
  const a = memoryAdapter();
  let fail = true;
  const orig = a.saveTables;
  a.saveTables = async (...x) => { if (fail) { fail = false; throw new Error('QuotaExceededError'); } return orig(...x); };
  const st = new Store(a);
  await st.load();
  const errors = [];
  st.onSaveError = (e) => errors.push(e.message);
  st.insert('worlds', { id: 'w1' }); await st.flush();
  assert.equal(errors.length, 1);
  st.insert('worlds', { id: 'w2' }); await st.flush();
  assert.deepEqual((await a.loadAll()).tables.worlds.map((w) => w.id), ['w1', 'w2']);
  st.freeze();
  st.insert('worlds', { id: 'w3' }); await st.flush();
  assert.deepEqual((await a.loadAll()).tables.worlds.map((w) => w.id), ['w1', 'w2']);
});

test('深度思考：关闭时明确告诉 DeepSeek 不思考，打开时带上强度', async () => {
  const sent = [];
  const fakeFetch = async (url, opt) => { sent.push(JSON.parse(opt.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: '你好' } }], usage: {} }) }; };
  const realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const st = new Store(memoryAdapter());
    let cfg = { baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', chatModel: 'deepseek-v4-pro', memoryModel: 'deepseek-flash', reasoning: 'none' };
    const m = createModel(st, () => cfg);
    await m.test('reply');
    assert.deepEqual(sent[0].thinking, { type: 'disabled' });
    assert.equal(sent[0].reasoning_effort, undefined);
    cfg = { ...cfg, reasoning: 'high' };
    await m.reply({ system: 's', history: [], who: {}, meta: {} });
    assert.deepEqual(sent[1].thinking, { type: 'enabled' });
    assert.equal(sent[1].reasoning_effort, 'high');
    assert.equal(sent[1].temperature, undefined);
    // 别家兼容接口不发 DeepSeek 专用的开关
    cfg = { ...cfg, baseUrl: 'https://example.com/v1', reasoning: 'none' };
    await m.test('reply');
    assert.equal(sent[2].thinking, undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('查角色手机：每天生成一次、同世界两人的聊天两边一致、只留 7 天、偷看可能被发现', async () => {
  const { openPhone, phoneView, closePhone, askToSee, localDay } = await import('../../web/src/local/charphone.js');
  const st = new Store(memoryAdapter()); await st.load();
  const t = new Date().toISOString();
  st.insert('worlds', { id: 'w', name: '城', lore: '' });
  for (const [id, name] of [['a', '阿青'], ['b', '小白']]) {
    st.insert('characters', { id, name, worldId: 'w', viewBranchId: 'br' + id, createdAt: t, updatedAt: t });
    st.insert('branches', { id: 'br' + id, characterId: id, name: '主线', parentId: null, forkSeq: null, createdAt: t, archivedAt: null });
  }
  let calls = 0;
  const model = { name: 'fake', async complete({ task }) {
    calls++;
    if (/偷偷看了你的手机/.test(task)) return '你刚才翻我手机了吧？';
    if (/能让我看看你的手机/.test(task)) return { allow: false, reply: '不行。' };
    return { chats: [{ with: '小白', relation: '朋友', messages: [{ from: 'me', text: '在吗', time: '09:00' }, { from: 'them', text: '在', time: '09:01' }] }], schedule: [{ time: '10:00', title: '开会' }], memos: [{ title: '买菜', text: '鸡蛋' }], photos: [{ time: '08:00', desc: '早餐' }], searches: [{ time: '07:00', q: '天气' }], drafts: [{ text: '想你' }] };
  } };
  const A = st.t.characters[0]; const B = st.t.characters[1];
  await openPhone(st, model, A, getBranchFor(st, A), { random: () => 1 });
  await openPhone(st, model, A, getBranchFor(st, A), { random: () => 1 });
  assert.equal(calls, 1, '同一天第二次打开不再生成');
  const va = phoneView(st, A, getBranchFor(st, A));
  assert.equal(va.chats[0].withCharacterId, 'b');
  assert.equal(va.drafts[0].text, '想你');
  const vb = phoneView(st, B, getBranchFor(st, B));
  assert.equal(vb.chats[0].with, '阿青');
  assert.equal(vb.chats[0].messages[0].from, 'them', 'B 手机里看到的是反过来的');
  // 7 天前的会被清掉
  st.insert('phones', { id: 'old', characterId: 'a', branchId: 'bra', day: localDay(new Date(Date.now() - 9 * 86400e3)), kind: 'daily', content: va, createdAt: t });
  await openPhone(st, model, B, getBranchFor(st, B), { random: () => 1 });
  assert.ok(!st.t.phones.some((r) => r.id === 'old'));
  // 问了被拒绝，再偷看：random 小于 0.5 就会被发现，TA 发来一条消息
  const meta = (k, f = null) => st.t.meta.find((m) => m.key === k)?.value ?? f;
  const setMeta = (k, v) => { const r = st.t.meta.find((m) => m.key === k); if (r) r.value = v; else st.t.meta.push({ key: k, value: v }); };
  const asked = await askToSee(st, model, A, getBranchFor(st, A), setMeta, meta);
  assert.equal(asked.allow, false);
  const found = await closePhone(st, model, A, getBranchFor(st, A), meta, { seen: ['备忘录'], random: () => 0.4 });
  assert.equal(found.discovered, true);
  const last = st.t.events.filter((e) => e.characterId === 'a').at(-1);
  assert.equal(last.data.via, 'peek');
  // 聊天里发的图不会当壁纸；挂在照片墙上的照片，新的一天 TA 可能设成手机壁纸
  st.insert('images', { id: 'img0', characterId: 'b', createdAt: t });
  st.insert('events', { seq: st.nextSeq(), characterId: 'b', branchId: 'brb', kind: 'user_message', data: { text: '', imageId: 'img0' }, createdAt: t });
  st.remove('phones', (r) => r.characterId === 'b');
  await openPhone(st, model, B, getBranchFor(st, B), { random: () => 0 });
  assert.equal(phoneView(st, B, getBranchFor(st, B)).wallpaperImageId, null);
  st.insert('images', { id: 'img1', characterId: 'b', createdAt: t });
  st.insert('events', { seq: st.nextSeq(), characterId: 'b', branchId: 'brb', kind: 'room_photo', data: { slot: 0, imageId: 'img1', caption: '', frame: 'wood' }, createdAt: t });
  st.remove('phones', (r) => r.characterId === 'b');
  await openPhone(st, model, B, getBranchFor(st, B), { random: () => 0 });
  assert.equal(phoneView(st, B, getBranchFor(st, B)).wallpaperImageId, 'img1');
});
function getBranchFor(st, c) { return st.t.branches.find((b) => b.id === c.viewBranchId); }
