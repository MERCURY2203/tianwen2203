// 第 2 阶段测试：接入（假）DeepSeek 后的回复、看图、记忆、纠错、重新生成
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { createApp } from '../app.mjs';
import { startFakeDeepSeek } from './fake-deepseek.mjs';
import { validateCandidates } from '../lib/memory.mjs';
import { cleanReply } from '../lib/model.mjs';

let app, base, fake, config;
const ADMIN = 'admin@p2.com';

before(async () => {
  fake = await startFakeDeepSeek();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsj-p2-'));
  config = loadConfig({
    DATA_DIR: dir, ADMIN_EMAIL: ADMIN, MAIL_MODE: 'screen', DISABLE_BACKUPS: '1', DISABLE_RATE_LIMIT: '1', APP_SECRET: 's',
    MODEL_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'sk-good-1', DEEPSEEK_MEMORY_API_KEY: 'sk-mem-2', DEEPSEEK_BASE_URL: fake.url,
    MEMORY_EVERY: '4',
  });
  app = createApp(config, { info() {}, error() {} });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => { await app.close(); await fake.close(); });

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const headers = { 'content-type': 'application/json', 'x-xsj': '1' };
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), type };
  };
  return { get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}) };
}

async function login(email, invite) {
  const c = client();
  const code = (await c.post('/api/auth/request-code', { email })).body.devCode;
  const r = await c.post('/api/auth/verify', { email, code, inviteCode: invite, adultConfirmed: true, termsAccepted: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}

let admin, user, other;
const worldOf = new WeakMap();
const mk = async (c, name, settings = {}) => {
  if (!worldOf.has(c)) worldOf.set(c, (await c.post('/api/worlds', { name: '大观园', lore: '清代贵族府邸，没有现代科技' })).body.world.id);
  return (await c.post('/api/characters', { name, settings, worldId: worldOf.get(c) })).body.character;
};
async function say(c, branchId, text, extra = {}) {
  const r = await c.post(`/api/branches/${branchId}/messages`, { text, ...extra });
  return r;
}
const sysPromptOfLast = () => fake.replyCalls().at(-1).body.messages[0].content;
const allTextOfLast = () => JSON.stringify(fake.replyCalls().at(-1).body.messages);
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 30)); }
  return null;
}

test('准备账号', async () => {
  admin = await login(ADMIN);
  const inv = (await admin.post('/api/admin/invites', { count: 2 })).body.codes;
  user = await login('u@p2.com', inv[0]);
  other = await login('o@p2.com', inv[1]);
});

test('回复：系统提示包含平台规则和人设；回复去掉角色名前缀；用的是 V4 Pro 和第一个密钥', async () => {
  const c = await mk(user, '沈砚', { personality: '慢热，守约', badExamples: '宝贝我爱你！！' });
  const r = await say(user, c.viewBranch.id, '你好');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const reply = r.body.events.at(-1);
  assert.equal(reply.kind, 'char_message');
  assert.equal(reply.data.text, '回复「你好」');
  const call = fake.replyCalls().at(-1);
  assert.equal(call.body.model, 'deepseek-v4-pro');
  assert.deepEqual(call.body.thinking, { type: 'disabled' });
  assert.equal(call.body.reasoning_effort, undefined);
  assert.equal(call.auth, 'Bearer sk-good-1');
  const sys = call.body.messages[0].content;
  assert.match(sys, /中华人民共和国法律法规/);
  assert.match(sys, /慢热，守约/);
  assert.match(sys, /宝贝我爱你/);
  assert.match(sys, /不替用户说话/);
  assert.match(sys, /【世界观：大观园】\n清代贵族府邸/);
});

test('验收：角色 A 的秘密不会出现在发给模型的角色 B 的内容里；分叉前的新世界线也看不到之后的话', async () => {
  const a = await mk(user, '阿青');
  const b = await mk(user, '小白');
  const [first] = (await say(user, a.viewBranch.id, '早上好')).body.events.filter((e) => e.kind === 'user_message');
  await say(user, a.viewBranch.id, '秘密：我其实怕黑');
  await say(user, b.viewBranch.id, '你好呀');
  assert.ok(!allTextOfLast().includes('怕黑'));
  const fork = await user.post(`/api/branches/${a.viewBranch.id}/fork`, { seq: first.seq, name: '另一条' });
  await say(user, fork.body.branch.id, '在吗');
  assert.ok(!allTextOfLast().includes('怕黑'), '分叉点之后的秘密不应进入新世界线的提示');
  assert.ok(allTextOfLast().includes('早上好'));
});

test('记忆：Flash 整理，用第二个密钥；没有来源的候选被拒绝；生效的记忆进入下一次回复的提示', async () => {
  const c = await mk(user, '记忆');
  const br = c.viewBranch.id;
  await say(user, br, '记住：用户养了一只叫团子的猫');
  await say(user, br, '今天好累');
  const mem = await waitFor(async () => {
    const r = await user.get(`/api/branches/${br}/memories`);
    return r.body.memories.length ? r.body.memories : null;
  });
  assert.ok(mem, '应该整理出记忆');
  assert.deepEqual(mem.map((m) => m.content), ['用户养了一只叫团子的猫']);
  assert.ok(!mem.some((m) => m.content.includes('书店')), '没有真实来源的候选必须被拒绝');
  const memCall = fake.requests.find((r) => r.body.response_format?.type === 'json_object');
  assert.equal(memCall.auth, 'Bearer sk-mem-2');
  assert.equal(memCall.body.model, 'deepseek-flash');

  await say(user, br, '晚安');
  assert.match(sysPromptOfLast(), /团子/);
});

test('验收：后来整理出的记忆不会倒灌到更早分出的世界线', async () => {
  const c = await mk(user, '倒灌');
  const br = c.viewBranch.id;
  const [m1] = (await say(user, br, '记住：用户的生日是三月')).body.events.filter((e) => e.kind === 'user_message');
  // 在记忆整理之前就分出去
  const child = (await user.post(`/api/branches/${br}/fork`, { seq: m1.seq, name: '早分' })).body.branch.id;
  await user.post(`/api/characters/${c.id}/view`, { branchId: br });
  await say(user, br, '嗯');
  const parentMem = await waitFor(async () => (await user.get(`/api/branches/${br}/memories`)).body.memories.length || null);
  assert.ok(parentMem);
  const childMem = (await user.get(`/api/branches/${child}/memories`)).body.memories;
  assert.equal(childMem.length, 0, '子世界线不应得到父世界线后来整理的记忆');
  await say(user, child, '你好');
  assert.ok(!/你知道的事[\s\S]*三月/.test(sysPromptOfLast()));
});

test('重要记忆（确定关系）先待确认，不进提示；确认后才生效', async () => {
  const c = await mk(user, '关系');
  const br = c.viewBranch.id;
  await say(user, br, '我们今天确定关系了吧');
  await say(user, br, '嗯嗯');
  const pending = await waitFor(async () => (await user.get(`/api/branches/${br}/memories`)).body.memories.find((m) => m.status === 'pending'));
  assert.ok(pending);
  await say(user, br, '早');
  assert.ok(!sysPromptOfLast().includes('确定了恋爱关系'));
  await user.post(`/api/branches/${br}/memories/${pending.id}`, { action: 'confirm' });
  await say(user, br, '中午好');
  assert.match(sysPromptOfLast(), /确定了恋爱关系/);
});

test('纠错：被指出的回复在提示里被省略，问题写进“之后要避免”，相关记忆作废', async () => {
  const c = await mk(user, '纠错');
  const br = c.viewBranch.id;
  const reply = (await say(user, br, '你喜欢什么')).body.events.at(-1);
  const r = await user.post(`/api/branches/${br}/corrections`, { seq: reply.seq, type: 'ooc', note: '他不会这么热情' });
  assert.equal(r.status, 200);
  await say(user, br, '再说一次');
  const sys = sysPromptOfLast();
  assert.match(sys, /崩人设：他不会这么热情/);
  assert.ok(!allTextOfLast().includes('回复「你喜欢什么」'));
  assert.match(allTextOfLast(), /内容已省略/);
  // 只能对角色回复纠错
  const userMsg = (await user.get(`/api/branches/${br}/events`)).body.events.find((e) => e.kind === 'user_message');
  assert.equal((await user.post(`/api/branches/${br}/corrections`, { seq: userMsg.seq, type: 'ooc' })).status, 400);
});

test('重新生成：旧回复被替换且不再显示；回复失败时消息保留，可以补上回复', async () => {
  const c = await mk(user, '重试');
  const br = c.viewBranch.id;
  const old = (await say(user, br, '第一句')).body.events.at(-1);
  const rr = await user.post(`/api/branches/${br}/retry`);
  assert.equal(rr.status, 200);
  assert.equal(rr.body.replaced, old.seq);
  const list = (await user.get(`/api/branches/${br}/events`)).body.events;
  assert.ok(!list.some((e) => e.seq === old.seq));
  assert.equal(list.filter((e) => e.kind === 'char_message').length, 1);

  fake.state.failNext = 500;
  const fail = await say(user, br, '第二句');
  assert.equal(fail.status, 502);
  assert.ok(fail.body.userSeq);
  const after = await user.get(`/api/branches/${br}/events`);
  assert.equal(after.body.needsReply, true);
  assert.equal(after.body.events.at(-1).data.text, '第二句');
  const fix = await user.post(`/api/branches/${br}/retry`);
  assert.equal(fix.status, 200);
  assert.equal(fix.body.events.at(-1).kind, 'char_message');
  assert.equal((await user.get(`/api/branches/${br}/events`)).body.needsReply, false);
});

test('内容限制：触发过滤时给出提示，不保存假回复', async () => {
  const c = await mk(user, '过滤');
  const r = await say(user, c.viewBranch.id, '触发过滤');
  assert.equal(r.status, 422);
  assert.match(r.body.error, /内容限制/);
});

test('图片：Flash 看图，描述交给 V4 Pro；别人拿不到这张图', async () => {
  const c = await mk(user, '看图');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await user.post('/api/images', { characterId: c.id, dataUrl: 'data:image/png;base64,' + png.toString('base64') });
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const imageId = up.body.image.id;
  const r = await say(user, c.viewBranch.id, '看我家猫', { imageId });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const vision = fake.requests.filter((x) => x.body.model === 'deepseek-flash' && !x.body.response_format).at(-1);
  assert.ok(vision.body.messages[1].content.some((p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,')));
  assert.match(allTextOfLast(), /橘猫/);
  assert.equal(fake.replyCalls().at(-1).body.model, 'deepseek-v4-pro');

  const mine = await user.get(`/api/images/${imageId}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.type, 'image/png');
  assert.equal((await other.get(`/api/images/${imageId}`)).status, 404);
  // 不是图片的文件被拒绝
  const bad = await user.post('/api/images', { characterId: c.id, dataUrl: 'data:image/png;base64,' + Buffer.from('hello world, not an image').toString('base64') });
  assert.equal(bad.status, 400);
  // 不能拿别人的角色上传
  assert.equal((await other.post('/api/images', { characterId: c.id, dataUrl: 'data:image/png;base64,' + png.toString('base64') })).status, 404);
});

test('每次调用都记账；管理员能看到花费估算', async () => {
  const n = app.db.prepare('SELECT COUNT(*) AS n FROM model_calls WHERE ok = 1 AND cost_micro_yuan > 0').get().n;
  assert.ok(n > 5);
  const u = await admin.get('/api/admin/usage');
  assert.equal(u.status, 200);
  assert.ok(u.body.today.find((x) => x.purpose === 'reply').costYuan > 0);
  assert.equal((await user.get('/api/admin/usage')).status, 403);
});

test('密钥错误时给出清楚的提示', async () => {
  const saved = config.deepseek.apiKey;
  config.deepseek.apiKey = 'sk-wrong';
  const c = await mk(user, '错钥');
  const r = await say(user, c.viewBranch.id, '你好');
  config.deepseek.apiKey = saved;
  assert.equal(r.status, 502);
  assert.match(r.body.error, /密钥/);
});

test('单元：记忆候选校验、去掉角色名前缀', () => {
  const { ok, rejected } = validateCandidates([
    { kind: 'fact', holder: 'user', content: '用户喜欢下雨天', source: [5] },
    { kind: 'guess', holder: 'user', content: 'x', source: [5] },
    { kind: 'fact', holder: 'user', content: '用户喜欢下雨天', source: [5] },
    { kind: 'plan', holder: 'both', content: '周六去书店', source: [7] },
  ], new Set([5]), []);
  assert.equal(ok.length, 1);
  assert.deepEqual(rejected.map((r) => r.why), ['kind', 'duplicate', 'source']);
  assert.equal(cleanReply('沈砚：好呀：周六见', '沈砚'), '好呀：周六见');
  assert.equal(cleanReply('好呀：周六见', '沈砚'), '好呀：周六见');
});
