// 自动测试：账号、数据隔离、世界线分叉规则、设定版本
// 运行：npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { createApp } from '../app.mjs';

let app, base;
const ADMIN = 'admin@test.com';

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xsj-test-'));
  const config = loadConfig({
    DATA_DIR: dir, ADMIN_EMAIL: ADMIN, MAIL_MODE: 'screen', REGISTRATION: 'invite',
    DISABLE_BACKUPS: '1', DISABLE_RATE_LIMIT: '1', APP_SECRET: 'test-secret',
  });
  app = createApp(config, { info() {}, error() {} });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(() => app.close());

// 一个带 cookie 的“浏览器”
function client() {
  let cookie = '';
  const call = async (method, url, body, { csrf = true } = {}) => {
    const headers = { 'content-type': 'application/json' };
    if (csrf) headers['x-xsj'] = '1';
    if (cookie) headers.cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  return {
    get: (u) => call('GET', u),
    post: (u, b, o) => call('POST', u, b || {}, o),
    patch: (u, b) => call('PATCH', u, b),
    del: (u, b) => call('DELETE', u, b),
    getCookie: () => cookie,
    setCookie: (v) => (cookie = v),
  };
}

async function signup(email, invite) {
  const c = client();
  const r1 = await c.post('/api/auth/request-code', { email });
  assert.equal(r1.status, 200);
  const r2 = await c.post('/api/auth/verify', {
    email, code: r1.body.devCode, inviteCode: invite, adultConfirmed: true, termsAccepted: true,
  });
  return { c, res: r2 };
}

async function newInvite(admin, maxUses = 1) {
  const r = await admin.post('/api/admin/invites', { count: 1, maxUses });
  assert.equal(r.status, 200);
  return r.body.codes[0];
}

const texts = (events) => events.filter((e) => e.kind !== 'settings_change').map((e) => e.data.text);
const userTexts = (events) => events.filter((e) => e.kind === 'user_message').map((e) => e.data.text);

async function say(c, branchId, text) {
  const r = await c.post(`/api/branches/${branchId}/messages`, { text });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // 返回 [这条用户消息, 角色回复]（服务器可能还会带上前面没被回复的消息）
  const evs = r.body.events.filter((e) => e.kind === 'user_message' || e.kind === 'char_message');
  return evs.slice(evs.findLastIndex((e) => e.kind === 'user_message' && e.data.text === text));
}

async function events(c, branchId) {
  const r = await c.get(`/api/branches/${branchId}/events?limit=200`);
  assert.equal(r.status, 200);
  return r.body.events;
}

const worldOf = new WeakMap();
async function makeCharacter(c, name, settings = {}) {
  if (!worldOf.has(c)) worldOf.set(c, (await c.post('/api/worlds', { name: '测试世界', lore: '现代都市' })).body.world.id);
  const r = await c.post('/api/characters', { name, settings, worldId: worldOf.get(c) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.character;
}

let admin, userA, userB;

test('注册：管理员邮箱不需要邀请码，新用户必须确认 18 岁并同意协议', async () => {
  const c = client();
  const code = (await c.post('/api/auth/request-code', { email: ADMIN })).body.devCode;
  const first = await c.post('/api/auth/verify', { email: ADMIN, code });
  assert.deepEqual(first.body, { needSignup: true, needInvite: false });
  const ok = await c.post('/api/auth/verify', { email: ADMIN, code, adultConfirmed: true, termsAccepted: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.isAdmin, true);
  admin = c;
  assert.equal((await admin.get('/api/me')).body.user.email, ADMIN);
});

test('注册：普通用户没有邀请码不能注册；邀请码用完后失效', async () => {
  const c = client();
  const code = (await c.post('/api/auth/request-code', { email: 'a@test.com' })).body.devCode;
  const need = await c.post('/api/auth/verify', { email: 'a@test.com', code });
  assert.deepEqual(need.body, { needSignup: true, needInvite: true });
  const bad = await c.post('/api/auth/verify', { email: 'a@test.com', code, inviteCode: 'WRONG123', adultConfirmed: true, termsAccepted: true });
  assert.equal(bad.status, 400);

  const inv = await newInvite(admin, 1);
  const ok = await c.post('/api/auth/verify', { email: 'a@test.com', code, inviteCode: inv.toLowerCase(), adultConfirmed: true, termsAccepted: true });
  assert.equal(ok.status, 200);
  userA = c;

  const again = await signup('x@test.com', inv);
  assert.equal(again.res.status, 400, '同一个单次邀请码不能用第二次');

  const b = await signup('b@test.com', await newInvite(admin));
  assert.equal(b.res.status, 200);
  userB = b.c;
});

test('验证码：输错 5 次后作废；老用户再次登录不需要邀请码', async () => {
  const c = client();
  const code = (await c.post('/api/auth/request-code', { email: 'a@test.com' })).body.devCode;
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await c.post('/api/auth/verify', { email: 'a@test.com', code: wrong })).status, 400);
  const locked = await c.post('/api/auth/verify', { email: 'a@test.com', code });
  assert.equal(locked.status, 400);
  assert.match(locked.body.error, /太多/);

  const code2 = (await c.post('/api/auth/request-code', { email: 'a@test.com' })).body.devCode;
  const ok = await c.post('/api/auth/verify', { email: 'a@test.com', code: code2 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.email, 'a@test.com');
});

test('安全：修改类请求缺少来源请求头被拒绝；普通用户不能用管理功能；未登录被拒绝', async () => {
  const r = await userA.post('/api/worlds', { name: 'x', lore: 'y' }, { csrf: false });
  assert.equal(r.status, 403);
  assert.equal((await userA.get('/api/admin/users')).status, 403);
  assert.equal((await client().get('/api/characters')).status, 401);
});

test('验收：给角色 A 说的秘密，角色 B 不知道（同一用户的不同角色互不串用）', async () => {
  const a = await makeCharacter(userA, '阿青');
  const b = await makeCharacter(userA, '小白');
  await say(userA, a.viewBranch.id, '我的秘密：我养了一只猫');
  assert.ok(texts(await events(userA, a.viewBranch.id)).some((t) => t.includes('秘密')));
  assert.ok(!texts(await events(userA, b.viewBranch.id)).some((t) => t.includes('秘密')));
});

test('验收：别人的角色、世界线、聊天一律访问不到', async () => {
  const mine = await makeCharacter(userA, '只属于A');
  const branchId = mine.viewBranch.id;
  await say(userA, branchId, 'A 的私密消息');
  const tries = [
    await userB.get(`/api/characters/${mine.id}`),
    await userB.get(`/api/characters/${mine.id}/branches`),
    await userB.get(`/api/characters/${mine.id}/settings`),
    await userB.get(`/api/branches/${branchId}/events`),
    await userB.post(`/api/branches/${branchId}/messages`, { text: '偷看' }),
    await userB.post(`/api/branches/${branchId}/fork`, { seq: 1, name: '偷' }),
    await userB.patch(`/api/branches/${branchId}`, { name: '改名' }),
    await userB.post(`/api/characters/${mine.id}/view`, { branchId }),
    await userB.del(`/api/characters/${mine.id}`, { confirmName: '只属于A' }),
  ];
  for (const t of tries) assert.equal(t.status, 404);
  const listB = (await userB.get('/api/characters')).body.characters;
  assert.ok(!listB.some((c) => c.id === mine.id));
});

test('验收：从邀请处分叉——新分支只继承分叉点之前的历史，之后各走各的', async () => {
  const c = await makeCharacter(userA, '书店', { personality: '慢热' });
  const main = c.viewBranch.id;
  await say(userA, main, '你好');
  const [inviteMsg] = await say(userA, main, '周六要不要一起去书店？');

  // 原分支：接受邀请
  await say(userA, main, '好呀，周六见');

  // 从“邀请”这条消息分叉（包含这条）
  const fork = await userA.post(`/api/branches/${main}/fork`, { seq: inviteMsg.seq, mode: 'include', name: '婉拒' });
  assert.equal(fork.status, 200);
  const alt = fork.body.branch.id;
  // 分叉后自动切换到新分支，后台活动线不变
  const after = (await userA.get(`/api/characters/${c.id}`)).body.character;
  assert.equal(after.viewBranch.id, alt);

  await say(userA, alt, '抱歉，周六没空');

  const mainUser = userTexts(await events(userA, main));
  const altUser = userTexts(await events(userA, alt));
  assert.deepEqual(mainUser, ['你好', '周六要不要一起去书店？', '好呀，周六见']);
  assert.deepEqual(altUser, ['你好', '周六要不要一起去书店？', '抱歉，周六没空']);

  // 原分支之后继续发展，也不会出现在新分支里
  await say(userA, main, '见面后的经历');
  assert.ok(!userTexts(await events(userA, alt)).includes('见面后的经历'));
  // 新分支内容不会倒灌回原分支
  assert.ok(!userTexts(await events(userA, main)).includes('抱歉，周六没空'));

  // 分叉点之后的“角色回复”不被继承（邀请那条的回复在分叉点之后）
  const altAll = await events(userA, alt);
  const inviteIndex = altAll.findIndex((e) => e.seq === inviteMsg.seq);
  assert.equal(altAll[inviteIndex + 1].data.text, '抱歉，周六没空');
});

test('验收：多层分叉、不能从别的分支的消息分叉、“改写这条再分叉”', async () => {
  const c = await makeCharacter(userA, '多层');
  const main = c.viewBranch.id;
  const [m1] = await say(userA, main, 'm1');
  const [m2] = await say(userA, main, 'm2');
  const b = (await userA.post(`/api/branches/${main}/fork`, { seq: m2.seq, name: 'B' })).body.branch.id;
  const [b1] = await say(userA, b, 'b1');
  await say(userA, b, 'b2');
  const cId = (await userA.post(`/api/branches/${b}/fork`, { seq: b1.seq, name: 'C' })).body.branch.id;
  await say(userA, main, 'm3');
  await say(userA, cId, 'c1');
  assert.deepEqual(userTexts(await events(userA, cId)), ['m1', 'm2', 'b1', 'c1']);

  // 兄弟分支的消息在当前分支看不到，不能拿来分叉
  const [m4] = await say(userA, main, 'm4');
  const badFork = await userA.post(`/api/branches/${cId}/fork`, { seq: m4.seq, name: '越界' });
  assert.equal(badFork.status, 400);

  // 从 C 里看到的祖先消息 m1 处分叉：新分支归属主线，只含 m1
  const d = (await userA.post(`/api/branches/${cId}/fork`, { seq: m1.seq, name: 'D' })).body.branch;
  assert.equal(d.parentId, main);
  assert.deepEqual(userTexts(await events(userA, d.id)), ['m1']);

  // before 模式：不含这条，并把原文返回用于修改
  const e = await userA.post(`/api/branches/${main}/fork`, { seq: m2.seq, mode: 'before', name: '改写' });
  assert.equal(e.body.prefill, 'm2');
  assert.deepEqual(userTexts(await events(userA, e.body.branch.id)), ['m1']);
});

test('验收：分叉继承分叉当时的人设版本；修改设定可选“只当前”或“所有世界线”', async () => {
  const c = await makeCharacter(userA, '版本', { personality: 'v1 性格' });
  const main = c.viewBranch.id;
  const [early] = await say(userA, main, '早期消息');

  const side = (await userA.post(`/api/branches/${main}/fork`, { seq: early.seq, name: '支线' })).body.branch.id;
  await userA.post(`/api/characters/${c.id}/view`, { branchId: main });

  // 只改主线
  const s2 = await userA.post(`/api/characters/${c.id}/settings`, { data: { personality: 'v2 性格' }, scope: 'current', branchId: main, note: '改性格' });
  assert.equal(s2.body.version, 2);
  assert.equal((await userA.get(`/api/characters/${c.id}/settings?branchId=${main}`)).body.settings.version, 2);
  assert.equal((await userA.get(`/api/characters/${c.id}/settings?branchId=${side}`)).body.settings.version, 1);

  // 回复使用各自分支的人设版本
  const [, replyMain] = await say(userA, main, '你是谁');
  const [, replySide] = await say(userA, side, '你是谁');
  assert.match(replyMain.data.text, /人设 v2/);
  assert.match(replySide.data.text, /人设 v1/);

  // 从“改设定之前”的消息分叉：继承 v1，不是现在的 v2
  const old = (await userA.post(`/api/branches/${main}/fork`, { seq: early.seq, name: '旧时' })).body.branch.id;
  assert.equal((await userA.get(`/api/characters/${c.id}/settings?branchId=${old}`)).body.settings.version, 1);

  // 应用到所有世界线
  const s3 = await userA.post(`/api/characters/${c.id}/settings`, { data: { personality: 'v3' }, scope: 'all', branchId: main });
  assert.equal(s3.body.appliedTo.length, 3);
  for (const id of [main, side, old]) {
    assert.equal((await userA.get(`/api/characters/${c.id}/settings?branchId=${id}`)).body.settings.version, 3);
  }
  const versions = (await userA.get(`/api/characters/${c.id}/setting-versions`)).body.versions;
  assert.deepEqual(versions.map((v) => v.version), [3, 2, 1]);
});

test('后台活动线：独立于“当前查看”；归档会自动解除；主线不能归档', async () => {
  const c = await makeCharacter(userA, '后台');
  const main = c.viewBranch.id;
  const [m] = await say(userA, main, 'hi');
  const side = (await userA.post(`/api/branches/${main}/fork`, { seq: m.seq, name: '支' })).body.branch.id;

  let r = await userA.post(`/api/characters/${c.id}/background`, { branchId: main, enabled: true });
  assert.equal(r.body.character.background.branchId, main);
  // 切换查看分支不会改动后台活动线
  r = await userA.post(`/api/characters/${c.id}/view`, { branchId: side });
  assert.equal(r.body.character.background.branchId, main);
  assert.equal(r.body.character.viewBranch.id, side);

  // 设支线为后台线，然后归档它
  await userA.post(`/api/characters/${c.id}/background`, { branchId: side });
  assert.equal((await userA.patch(`/api/branches/${side}`, { archived: true })).status, 200);
  const after = (await userA.get(`/api/characters/${c.id}`)).body.character;
  assert.equal(after.viewBranch.id, main, '查看中的分支被归档后回到主线');
  assert.equal(after.background.branchId, null);
  assert.equal(after.background.enabled, false);
  // 归档后的分支不能继续聊天
  assert.equal((await userA.post(`/api/branches/${side}/messages`, { text: 'x' })).status, 400);

  assert.equal((await userA.patch(`/api/branches/${main}`, { archived: true })).status, 400);
});

test('删除角色需要输入角色名；删除账号会清除全部数据', async () => {
  const { c } = await signup('del@test.com', await newInvite(admin));
  const ch = await makeCharacter(c, '要删的');
  assert.equal((await c.del(`/api/characters/${ch.id}`, { confirmName: '错的' })).status, 400);
  assert.equal((await c.del(`/api/characters/${ch.id}`, { confirmName: '要删的' })).status, 200);
  await makeCharacter(c, '另一个');
  assert.equal((await c.del('/api/me', { confirmEmail: 'del@test.com' })).status, 200);
  assert.equal((await c.get('/api/me')).status, 401);
  const left = app.db.prepare("SELECT COUNT(*) AS n FROM characters c JOIN users u ON u.id=c.user_id WHERE u.email='del@test.com'").get().n;
  assert.equal(left, 0);
});

test('安全：测试模式下，从外网（经 Cloudflare）来的请求拿不到验证码', async () => {
  const res = await fetch(base + '/api/auth/request-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-xsj': '1', 'cf-connecting-ip': '1.2.3.4' },
    body: JSON.stringify({ email: ADMIN }),
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).devCode, undefined);
});

test('退出登录后会话失效', async () => {
  const { c } = await signup('out@test.com', await newInvite(admin));
  assert.equal((await c.get('/api/me')).status, 200);
  const oldCookie = c.getCookie();
  await c.post('/api/auth/logout');
  c.setCookie(oldCookie); // 用退出前的旧凭证再试：服务器端也必须已作废
  assert.equal((await c.get('/api/me')).status, 401);
});

test('世界：创建人物必须选世界；世界不能用别人的；世界里还有人物时不能删', async () => {
  const noWorld = await userA.post('/api/characters', { name: '无世界' });
  assert.equal(noWorld.status, 400);
  const w = (await userA.post('/api/worlds', { name: '大观园', lore: '清代贵族府邸' })).body.world;
  const ch = (await userA.post('/api/characters', { name: '黛玉', worldId: w.id })).body.character;
  assert.equal(ch.world.name, '大观园');
  assert.equal((await userB.post('/api/characters', { name: '偷', worldId: w.id })).status, 400);
  assert.equal((await userB.patch(`/api/worlds/${w.id}`, { lore: '改' })).status, 404);
  assert.equal((await userA.del(`/api/worlds/${w.id}`)).status, 400);
  const list = (await userA.get('/api/worlds')).body.worlds.find((x) => x.id === w.id);
  assert.deepEqual(list.characters.map((x) => x.name), ['黛玉']);
});

test('草稿箱：自动保存、修改、只看得到自己的；用草稿创建人物后草稿自动删除', async () => {
  const d = (await userA.post('/api/drafts', { data: { name: '草稿人', settings: { personality: '内向' } } })).body.draft;
  assert.equal((await userA.patch(`/api/drafts/${d.id}`, { data: { name: '草稿人2' } })).status, 200);
  assert.equal((await userB.get('/api/drafts')).body.drafts.length, 0);
  assert.equal((await userB.del(`/api/drafts/${d.id}`)).status, 404);
  const drafts = (await userA.get('/api/drafts')).body.drafts;
  assert.equal(drafts[0].data.name, '草稿人2');
  const w = (await userA.post('/api/worlds', { name: '草稿世界', lore: '海边小镇' })).body.world;
  await userA.post('/api/characters', { name: '草稿人2', worldId: w.id, draftId: d.id });
  assert.ok(!(await userA.get('/api/drafts')).body.drafts.some((x) => x.id === d.id));
});

test('头像：上传后可以设给角色，别人看不到', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const a = (await userA.post('/api/avatars', { dataUrl: png })).body.avatar;
  const ch = await makeCharacter(userA, '有头像');
  const r = await userA.patch(`/api/characters/${ch.id}`, { avatarId: a.id });
  assert.equal(r.body.character.avatarUrl, a.url);
  assert.equal((await userB.patch(`/api/characters/${ch.id}`, { avatarId: a.id })).status, 404);
  const other = await makeCharacter(userB, 'B 的');
  assert.equal((await userB.patch(`/api/characters/${other.id}`, { avatarId: a.id })).status, 400);
});

test('世界线：可以从头新建一条空白世界线，沿用当前人设，看不到原来的聊天', async () => {
  const ch = await makeCharacter(userA, '新线', { personality: '原来的' });
  await say(userA, ch.viewBranch.id, '主线里的话');
  const r = await userA.post(`/api/characters/${ch.id}/branches`, { name: '重新开始' });
  assert.equal(r.status, 200);
  const evs = await events(userA, r.body.branch.id);
  assert.equal(userTexts(evs).length, 0);
  assert.equal((await userA.get(`/api/characters/${ch.id}/settings?branchId=${r.body.branch.id}`)).body.settings.version, 1);
  assert.equal((await userA.get(`/api/characters/${ch.id}`)).body.character.viewBranch.id, r.body.branch.id);
  // 新建的空白线可以归档，主线不行
  assert.equal((await userA.patch(`/api/branches/${r.body.branch.id}`, { archived: true })).status, 200);
  assert.equal((await userA.patch(`/api/branches/${ch.viewBranch.id}`, { archived: true })).status, 400);
});
