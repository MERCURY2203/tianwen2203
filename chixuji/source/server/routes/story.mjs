// 角色、设定、世界线、聊天
import { now, tx } from '../lib/db.mjs';
import { bad, int, notFound, str } from '../lib/http.mjs';
import { requireUser } from '../lib/auth.mjs';
import { deleteImageFiles } from '../lib/chat.mjs';
import {
  appendEvent, cleanSettings, createSettingVersion, effectiveSettings, getBranch, newId,
  SETTING_FIELDS, visibleEventBySeq, visibleEvents,
} from '../lib/story.mjs';

const MAX_CHARACTERS = 20;
const MAX_BRANCHES = 100;
const COLORS = ['#e8a0b4', '#9db4e8', '#a8d5ba', '#f2c48d', '#c3a6e0', '#8fd0d6', '#e6b8a2', '#b5c99a'];
const MESSAGE_KINDS = ['user_message', 'char_message'];

export default function storyRoutes(r, { db, config }) {
  // —— 权限：每次都确认“这个东西属于当前登录的人” ——
  function ownCharacter(ctx, id) {
    const u = requireUser(ctx);
    const c = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(id, u.id);
    if (!c) throw notFound('找不到这个角色');
    return c;
  }
  function ownBranch(ctx, id) {
    const u = requireUser(ctx);
    const b = db
      .prepare('SELECT b.* FROM branches b JOIN characters c ON c.id = b.character_id WHERE b.id = ? AND c.user_id = ?')
      .get(id, u.id);
    if (!b) throw notFound('找不到这条世界线');
    return b;
  }

  const branchName = (id) => (id ? db.prepare('SELECT name FROM branches WHERE id = ?').get(id)?.name ?? null : null);

  function characterView(c) {
    const view = c.view_branch_id ? getBranch(db, c.view_branch_id) : null;
    const settings = view ? effectiveSettings(db, view) : null;
    return {
      id: c.id,
      name: c.name,
      avatarColor: c.avatar_color,
      avatarUrl: c.avatar_id ? `/api/avatars/${c.avatar_id}` : null,
      world: c.world_id ? db.prepare('SELECT id, name FROM worlds WHERE id = ?').get(c.world_id) ?? null : null,
      viewBranch: view ? { id: view.id, name: view.name, archived: !!view.archived_at } : null,
      background: {
        enabled: !!c.background_enabled,
        branchId: c.background_branch_id,
        branchName: branchName(c.background_branch_id),
      },
      settingsVersion: settings?.version ?? null,
      createdAt: c.created_at,
      updatedAt: c.updated_at,
    };
  }

  r.get('/api/meta', async () => ({ settingFields: SETTING_FIELDS }));

  // —— 角色 ——
  r.get('/api/characters', async (ctx) => {
    const u = requireUser(ctx);
    const rows = db.prepare('SELECT * FROM characters WHERE user_id = ? ORDER BY created_at').all(u.id);
    return { characters: rows.map(characterView) };
  });

  function ownWorldId(u, v) {
    if (v === null || v === undefined || v === '') return null;
    const w = db.prepare('SELECT id FROM worlds WHERE id = ? AND user_id = ?').get(String(v), u.id);
    if (!w) throw bad('找不到这个世界');
    return w.id;
  }
  function ownAvatarId(u, v) {
    if (v === null || v === undefined || v === '') return null;
    const a = db.prepare('SELECT id FROM avatars WHERE id = ? AND user_id = ?').get(String(v), u.id);
    if (!a) throw bad('头像找不到了，请重新上传');
    return a.id;
  }

  r.post('/api/characters', async (ctx) => {
    const u = requireUser(ctx);
    const name = str(ctx.body.name, { name: '角色名', min: 1, max: 30 });
    const settings = cleanSettings(ctx.body.settings || {});
    const worldId = ownWorldId(u, ctx.body.worldId);
    if (!worldId) throw bad('请选择 TA 生活在哪个世界');
    const avatarId = ownAvatarId(u, ctx.body.avatarId);
    const count = db.prepare('SELECT COUNT(*) AS n FROM characters WHERE user_id = ?').get(u.id).n;
    if (count >= MAX_CHARACTERS) throw bad(`最多可以创建 ${MAX_CHARACTERS} 个角色`);
    const c = tx(db, () => {
      const id = newId();
      const t = now();
      db.prepare('INSERT INTO characters (id, user_id, name, avatar_color, world_id, avatar_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, u.id, name, COLORS[count % COLORS.length], worldId, avatarId, t, t);
      if (ctx.body.draftId) db.prepare('DELETE FROM drafts WHERE id = ? AND user_id = ?').run(String(ctx.body.draftId), u.id);
      const branchId = newId();
      db.prepare('INSERT INTO branches (id, character_id, name, created_at) VALUES (?, ?, ?, ?)').run(branchId, id, '主线', t);
      const v = createSettingVersion(db, id, settings, '初始设定');
      appendEvent(db, { characterId: id, branchId, kind: 'settings_change', data: { versionId: v.id, version: v.version, note: '初始设定' } });
      db.prepare('UPDATE characters SET view_branch_id = ? WHERE id = ?').run(branchId, id);
      return db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    });
    return { character: characterView(c) };
  });

  r.get('/api/characters/:id', async (ctx) => ({ character: characterView(ownCharacter(ctx, ctx.params.id)) }));

  r.patch('/api/characters/:id', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    const name = ctx.body.name !== undefined ? str(ctx.body.name, { name: '角色名', min: 1, max: 30 }) : c.name;
    let color = c.avatar_color;
    if (ctx.body.avatarColor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(ctx.body.avatarColor)) throw bad('颜色格式不对');
      color = ctx.body.avatarColor;
    }
    const u = ctx.user;
    const worldId = ctx.body.worldId !== undefined ? ownWorldId(u, ctx.body.worldId) : c.world_id;
    const avatarId = ctx.body.avatarId !== undefined ? ownAvatarId(u, ctx.body.avatarId) : c.avatar_id;
    db.prepare('UPDATE characters SET name = ?, avatar_color = ?, world_id = ?, avatar_id = ?, updated_at = ? WHERE id = ?')
      .run(name, color, worldId, avatarId, now(), c.id);
    return { character: characterView(db.prepare('SELECT * FROM characters WHERE id = ?').get(c.id)) };
  });

  r.delete('/api/characters/:id', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    if (str(ctx.body.confirmName, { name: '角色名', min: 1, max: 30 }) !== c.name) throw bad('输入的角色名不一致');
    deleteImageFiles(db, config, { characterId: c.id });
    db.prepare('DELETE FROM characters WHERE id = ?').run(c.id);
    return { ok: true };
  });

  // —— 设定（带版本；修改时选择作用范围） ——
  r.get('/api/characters/:id/settings', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    const branch = ctx.query.get('branchId') ? ownBranch(ctx, ctx.query.get('branchId')) : getBranch(db, c.view_branch_id);
    if (branch.character_id !== c.id) throw notFound();
    return { branchId: branch.id, branchName: branch.name, settings: effectiveSettings(db, branch), fields: SETTING_FIELDS };
  });

  r.get('/api/characters/:id/setting-versions', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    const rows = db.prepare('SELECT id, version, note, created_at FROM setting_versions WHERE character_id = ? ORDER BY version DESC').all(c.id);
    return { versions: rows.map((v) => ({ id: v.id, version: v.version, note: v.note, createdAt: v.created_at })) };
  });

  r.post('/api/characters/:id/settings', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    const data = cleanSettings(ctx.body.data);
    const note = str(ctx.body.note, { name: '修改说明', max: 100 });
    const scope = ctx.body.scope === 'all' ? 'all' : 'current';
    const branch = ctx.body.branchId ? ownBranch(ctx, ctx.body.branchId) : getBranch(db, c.view_branch_id);
    if (branch.character_id !== c.id) throw notFound();
    const targets = scope === 'all'
      ? db.prepare('SELECT * FROM branches WHERE character_id = ? AND archived_at IS NULL').all(c.id)
      : [branch];
    const v = tx(db, () => {
      const v = createSettingVersion(db, c.id, data, note);
      for (const b of targets) {
        appendEvent(db, { characterId: c.id, branchId: b.id, kind: 'settings_change', data: { versionId: v.id, version: v.version, note } });
      }
      db.prepare('UPDATE characters SET updated_at = ? WHERE id = ?').run(now(), c.id);
      return v;
    });
    return { version: v.version, appliedTo: targets.map((b) => ({ id: b.id, name: b.name })) };
  });

  // —— 世界线 ——
  r.get('/api/characters/:id/branches', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    const rows = db.prepare('SELECT * FROM branches WHERE character_id = ? ORDER BY created_at').all(c.id);
    const counts = new Map(
      db.prepare(`SELECT branch_id, COUNT(*) AS n FROM events WHERE character_id = ? AND kind IN ('user_message','char_message') GROUP BY branch_id`)
        .all(c.id).map((x) => [x.branch_id, x.n]),
    );
    const mainId = rows.find((b) => !b.parent_branch_id)?.id;
    const edge = (b, dir) => {
      const e = db.prepare(`SELECT seq, kind, data, created_at FROM events WHERE branch_id = ? AND kind IN ('user_message','char_message') AND hidden_at IS NULL ORDER BY seq ${dir} LIMIT 1`).get(b.id);
      if (!e) return null;
      const d = JSON.parse(e.data);
      return { seq: e.seq, kind: e.kind, text: (d.text || '（图片）').slice(0, 40), at: e.created_at };
    };
    const branches = rows.map((b) => {
      let forkPreview = null;
      if (b.parent_branch_id) {
        const parent = getBranch(db, b.parent_branch_id);
        const [ev] = visibleEvents(db, parent, { beforeSeq: b.fork_seq + 1, limit: 1, kinds: MESSAGE_KINDS });
        forkPreview = ev ? { seq: ev.seq, kind: ev.kind, text: ev.data.text.slice(0, 40) } : null;
      }
      return {
        id: b.id,
        name: b.name,
        parentId: b.parent_branch_id,
        forkSeq: b.fork_seq,
        forkPreview,
        ownMessages: counts.get(b.id) || 0,
        first: edge(b, 'ASC'),
        last: edge(b, 'DESC'),
        archived: !!b.archived_at,
        isMain: b.id === mainId,
        createdAt: b.created_at,
        isView: b.id === c.view_branch_id,
        isBackground: b.id === c.background_branch_id,
      };
    });
    return { branches, viewBranchId: c.view_branch_id, background: characterView(c).background };
  });

  r.post('/api/branches/:id/fork', async (ctx) => {
    const from = ownBranch(ctx, ctx.params.id);
    const seq = int(ctx.body.seq, { name: '消息位置', min: 1, max: Number.MAX_SAFE_INTEGER });
    const mode = ctx.body.mode === 'before' ? 'before' : 'include';
    const name = str(ctx.body.name, { name: '世界线名称', min: 1, max: 30 });
    // 只能从“当前世界线看得到”的消息分叉
    const ev = visibleEventBySeq(db, from, seq);
    if (!ev || !MESSAGE_KINDS.includes(ev.kind)) throw bad('只能从这条世界线里的消息分叉');
    const n = db.prepare('SELECT COUNT(*) AS n FROM branches WHERE character_id = ?').get(from.character_id).n;
    if (n >= MAX_BRANCHES) throw bad(`每个角色最多 ${MAX_BRANCHES} 条世界线`);
    // include：新分支包含这条消息；before：从这条消息之前分出（用来“改写这条再继续”）
    const forkSeq = mode === 'include' ? ev.seq : ev.seq - 1;
    const id = newId();
    tx(db, () => {
      db.prepare('INSERT INTO branches (id, character_id, name, parent_branch_id, fork_seq, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, from.character_id, name, ev.branchId, forkSeq, now());
      db.prepare('UPDATE characters SET view_branch_id = ?, updated_at = ? WHERE id = ?').run(id, now(), from.character_id);
    });
    return {
      branch: { id, name, parentId: ev.branchId, forkSeq },
      prefill: mode === 'before' && ev.kind === 'user_message' ? ev.data.text : null,
    };
  });

  // 从头开始一条新世界线：没有任何聊天记录，沿用当前查看的世界线的人设版本
  r.post('/api/characters/:id/branches', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    const name = str(ctx.body.name, { name: '世界线名称', min: 1, max: 30 });
    const n = db.prepare('SELECT COUNT(*) AS n FROM branches WHERE character_id = ?').get(c.id).n;
    if (n >= MAX_BRANCHES) throw bad(`每个角色最多 ${MAX_BRANCHES} 条世界线`);
    const settings = effectiveSettings(db, getBranch(db, c.view_branch_id));
    const id = newId();
    tx(db, () => {
      db.prepare('INSERT INTO branches (id, character_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, c.id, name, now());
      if (settings) appendEvent(db, { characterId: c.id, branchId: id, kind: 'settings_change', data: { versionId: settings.versionId, version: settings.version, note: '新世界线' } });
      db.prepare('UPDATE characters SET view_branch_id = ?, updated_at = ? WHERE id = ?').run(id, now(), c.id);
    });
    return { branch: { id, name } };
  });

  r.patch('/api/branches/:id', async (ctx) => {
    const b = ownBranch(ctx, ctx.params.id);
    const c = db.prepare('SELECT * FROM characters WHERE id = ?').get(b.character_id);
    tx(db, () => {
      if (ctx.body.name !== undefined) {
        db.prepare('UPDATE branches SET name = ? WHERE id = ?').run(str(ctx.body.name, { name: '世界线名称', min: 1, max: 30 }), b.id);
      }
      if (ctx.body.archived === true && !b.archived_at) {
        const first = db.prepare('SELECT id FROM branches WHERE character_id = ? AND parent_branch_id IS NULL ORDER BY created_at LIMIT 1').get(c.id);
        if (first.id === b.id) throw bad('主线不能归档');
        db.prepare('UPDATE branches SET archived_at = ? WHERE id = ?').run(now(), b.id);
        if (c.view_branch_id === b.id) {
          const root = db.prepare("SELECT id FROM branches WHERE character_id = ? AND parent_branch_id IS NULL ORDER BY created_at LIMIT 1").get(c.id);
          db.prepare('UPDATE characters SET view_branch_id = ? WHERE id = ?').run(root.id, c.id);
        }
        if (c.background_branch_id === b.id) {
          db.prepare('UPDATE characters SET background_branch_id = NULL, background_enabled = 0 WHERE id = ?').run(c.id);
        }
      }
      if (ctx.body.archived === false && b.archived_at) {
        db.prepare('UPDATE branches SET archived_at = NULL WHERE id = ?').run(b.id);
      }
    });
    return { ok: true };
  });

  // 切换“当前查看”的世界线（不影响后台活动线）
  r.post('/api/characters/:id/view', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    const b = ownBranch(ctx, str(ctx.body.branchId, { name: '世界线', min: 1, max: 64 }));
    if (b.character_id !== c.id) throw notFound();
    db.prepare('UPDATE characters SET view_branch_id = ?, updated_at = ? WHERE id = ?').run(b.id, now(), c.id);
    return { character: characterView(db.prepare('SELECT * FROM characters WHERE id = ?').get(c.id)) };
  });

  // 后台活动：开关 + 指定唯一一条后台活动线（真正的后台行为在第 5 阶段接入）
  r.post('/api/characters/:id/background', async (ctx) => {
    const c = ownCharacter(ctx, ctx.params.id);
    let branchId = c.background_branch_id;
    if (ctx.body.branchId !== undefined) {
      if (ctx.body.branchId === null) branchId = null;
      else {
        const b = ownBranch(ctx, String(ctx.body.branchId));
        if (b.character_id !== c.id) throw notFound();
        if (b.archived_at) throw bad('已归档的世界线不能设为后台活动线');
        branchId = b.id;
      }
    }
    let enabled = ctx.body.enabled !== undefined ? ctx.body.enabled === true : !!c.background_enabled;
    if (enabled && !branchId) throw bad('请先指定一条后台活动世界线');
    if (!branchId) enabled = false;
    db.prepare('UPDATE characters SET background_enabled = ?, background_branch_id = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, branchId, now(), c.id);
    return { character: characterView(db.prepare('SELECT * FROM characters WHERE id = ?').get(c.id)) };
  });
}
