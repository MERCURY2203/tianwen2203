import React, { useEffect, useRef, useState } from 'react';
import { del, get, patch, post } from '../api.js';
import { Avatar, Button, ErrorBox, fmtTime, Loading, Sheet, Thread, toast, TopBar, useAsync } from '../ui.jsx';
import { AvatarPicker, LookPicker } from '../parts.jsx';

const EMPTY = { name: '', worldId: '', avatarId: null, avatarUrl: null, settings: {} };

// —— 新建人物：完整的人设表格，自动存草稿 ——
function CreateForm({ fields, worlds, draft, onCreated, onCancel, onNeedWorld }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(draft?.data || {}), settings: { ...(draft?.data?.settings || {}) } }));
  const [draftId, setDraftId] = useState(draft?.id || null);
  const [saveState, setSaveState] = useState(draft ? '已从草稿箱打开' : '');
  const [askWorld, setAskWorld] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = useRef(false);
  const draftIdRef = useRef(draftId);
  draftIdRef.current = draftId;

  // 没有世界时，先弹窗提示去填写世界观
  useEffect(() => { if (!worlds.length) setAskWorld(true); }, []);
  useEffect(() => {
    if (!form.worldId && worlds.length === 1) setForm((f) => ({ ...f, worldId: worlds[0].id }));
  }, [worlds.length]);

  // 停止输入 1 秒后自动存草稿
  useEffect(() => {
    if (!dirty.current) return;
    const hasContent = form.name.trim() || Object.values(form.settings).some((v) => v && v.trim());
    if (!hasContent) return;
    setSaveState('正在保存草稿…');
    const t = setTimeout(async () => {
      try {
        if (draftIdRef.current) await patch(`/api/drafts/${draftIdRef.current}`, { data: form });
        else setDraftId((await post('/api/drafts', { data: form })).draft.id);
        setSaveState('草稿已自动保存');
      } catch { setSaveState('草稿没保存上，稍后会再试'); }
    }, 1000);
    return () => clearTimeout(t);
  }, [form]);

  const update = (patchObj) => { dirty.current = true; setForm((f) => ({ ...f, ...patchObj })); };

  // 去写世界观之前，先把当前填的内容存进草稿箱（什么都没填就不存）
  async function goWriteWorld() {
    setAskWorld(false);
    let id = draftIdRef.current;
    const hasContent = form.name.trim() || form.avatarId || Object.values(form.settings).some((v) => v && v.trim());
    try {
      if (hasContent) {
        if (id) await patch(`/api/drafts/${id}`, { data: form });
        else id = (await post('/api/drafts', { data: form })).draft.id;
      }
    } catch { /* 草稿没存上也继续，表格内容会带过去 */ }
    dirty.current = false;
    onNeedWorld({ id, data: form });
  }
  const setField = (k) => (e) => update({ settings: { ...form.settings, [k]: e.target.value } });

  async function create(e) {
    e.preventDefault();
    if (!form.worldId) { if (worlds.length) toast('请选择 TA 生活在哪个世界'); else setAskWorld(true); return; }
    setBusy(true);
    try {
      const r = await post('/api/characters', {
        name: form.name, settings: form.settings, worldId: form.worldId, avatarId: form.avatarId, draftId,
      });
      dirty.current = false;
      onCreated(r.character);
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }

  const groups = [...new Set(fields.map((f) => f.group))];
  const groupTitle = { '角色': '关于 TA', '例子': '像与不像', '故事': '你和 TA 的故事' };
  const world = worlds.find((w) => w.id === form.worldId);

  return (
    <form className="create" onSubmit={create}>
      <section className="card">
        <div className="create-head">
          <AvatarPicker name={form.name} url={form.avatarUrl}
            onChange={(a) => update({ avatarId: a?.id || null, avatarUrl: a?.url || null })} />
          <label className="field grow">
            <span>TA 叫什么</span>
            <input value={form.name} maxLength={30} required onChange={(e) => update({ name: e.target.value })} />
          </label>
        </div>
        <label className="field">
          <span>生活在哪个世界</span>
          <select value={form.worldId} onChange={(e) => (e.target.value === '__new' ? goWriteWorld() : update({ worldId: e.target.value }))}>
            <option value="">请选择</option>
            {worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            <option value="__new">＋ 新建一个世界</option>
          </select>
        </label>
        {world && <p className="world-peek">{world.lore}</p>}
      </section>

      {groups.map((g) => (
        <section className="card" key={g}>
          <h2 className="card-title">{groupTitle[g] || g}</h2>
          {fields.filter((f) => f.group === g).map((f) => (
            <label className="field" key={f.key}>
              <span>{f.label}</span>
              <textarea rows={3} maxLength={4000} value={form.settings[f.key] || ''} placeholder={f.hint} onChange={setField(f.key)} />
            </label>
          ))}
        </section>
      ))}

      <p className="muted small save-state" aria-live="polite">{saveState}</p>
      <Button busy={busy} type="submit" disabled={!form.name.trim()}>创建人物</Button>
      <button type="button" className="btn btn-ghost" onClick={onCancel}>先不建了（草稿会保留）</button>

      <Sheet open={askWorld} onClose={() => setAskWorld(false)} title="还没有填写世界观">
        <p>每个人物都生活在一个世界里，同一个世界的人物共用这份世界观。先写好世界观，再回来接着填人设。</p>
        <p className="muted small">你在这里已经填的内容会自动存进草稿箱，写完世界观会自动回到这一页。</p>
        <Button onClick={goWriteWorld}>先去填写</Button>
        <button type="button" className="btn btn-ghost" onClick={() => setAskWorld(false)}>稍后再说</button>
      </Sheet>
    </form>
  );
}

// —— 新建 / 编辑世界：完整页面 ——
function WorldPage({ world, fromCreate, onDone, onBack }) {
  const [name, setName] = useState(world?.name || '');
  const [lore, setLore] = useState(world?.lore || '');
  const [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = world ? await patch(`/api/worlds/${world.id}`, { name, lore }) : await post('/api/worlds', { name, lore });
      toast(world ? '世界观已保存' : `世界「${r.world.name}」已创建`);
      onDone(r.world);
    } catch (err) { toast(err.message); setBusy(false); }
  }
  return (
    <div className="page">
      <TopBar title={world ? '编辑世界' : '新建世界'} onBack={onBack} />
      <div className="page-body">
        <form className="create" onSubmit={save}>
          {fromCreate && <p className="lead">写好世界观后会自动回到人物表格，刚才填的人设都还在。</p>}
          <section className="card">
            <label className="field">
              <span>世界名称</span>
              <input value={name} maxLength={30} required placeholder="例如：大观园、现代上海、星际港口" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>世界观</span>
              <textarea rows={12} value={lore} maxLength={8000} required
                placeholder={'故事发生的时代、地点、社会规则\n有没有魔法或科技\n大家怎样生活、怎样联络'}
                onChange={(e) => setLore(e.target.value)} />
            </label>
            {world?.characters?.length > 0 && <p className="muted small">改动会影响这个世界里的所有人物：{world.characters.map((c) => c.name).join('、')}。</p>}
          </section>
          <Button busy={busy} type="submit" disabled={!name.trim() || !lore.trim()}>
            {world ? '保存世界观' : fromCreate ? '保存，回去继续填人设' : '创建世界'}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default function Characters({ characters, current, selectCharacter, refreshCharacters, home, go, startCreating }) {
  const [tab, setTab] = useState('people');
  const [lookFor, setLookFor] = useState(null); // 正在改哪个人物的头像和形象
  const [creating, setCreating] = useState(startCreating ? { draft: null } : null);
  const meta = useAsync(() => get('/api/meta'), []);
  const worlds = useAsync(() => get('/api/worlds'), []);
  const drafts = useAsync(() => get('/api/drafts'), [tab, creating]);
  const [worldPage, setWorldPage] = useState(null); // { world, fromCreate }

  if (worldPage) {
    return (
      <WorldPage world={worldPage.world} fromCreate={worldPage.fromCreate}
        onBack={() => { setWorldPage(null); if (!worldPage.fromCreate) setTab('worlds'); }}
        onDone={async (w) => {
          await worlds.reload();
          await refreshCharacters();
          if (worldPage.fromCreate) {
            // 回到人物表格，并自动选上刚写好的世界
            setCreating((c) => ({ draft: { ...(c?.draft || {}), data: { ...(c?.draft?.data || {}), worldId: w.id } } }));
          } else setTab('worlds');
          setWorldPage(null);
        }} />
    );
  }

  if (creating) {
    if (!meta.data || !worlds.data) return <div className="page"><TopBar title="新人物" onBack={() => setCreating(null)} /><Loading /></div>;
    return (
      <div className="page">
        <TopBar title="新人物" onBack={() => setCreating(null)} />
        <div className="page-body">
          <CreateForm key={JSON.stringify(creating.draft?.data?.worldId || '')} fields={meta.data.settingFields} worlds={worlds.data.worlds} draft={creating.draft}
            onNeedWorld={(draft) => { setCreating({ draft }); setWorldPage({ world: null, fromCreate: true }); }}
            onCancel={() => { setCreating(null); setTab('drafts'); }}
            onCreated={async (c) => {
              await refreshCharacters();
              selectCharacter(c.id);
              toast(`「${c.name}」已创建`);
              go('chat', { thread: c.id });
            }} />
        </div>
      </div>
    );
  }

  const lookChar = characters.find((c) => c.id === lookFor);
  const lookSheet = (
    <Sheet open={!!lookChar} onClose={() => setLookFor(null)} title={lookChar ? `${lookChar.name}的头像和形象` : ''}>
      {lookChar && (
        <>
          <h3 className="card-sub">头像</h3>
          <AvatarPicker name={lookChar.name} color={lookChar.avatarColor} url={lookChar.avatarUrl}
            onChange={async (a) => { try { await patch(`/api/characters/${lookChar.id}`, { avatarId: a?.id || null }); await refreshCharacters(); toast(a ? '头像已更换' : '已改回默认头像'); } catch (e) { toast(e.message); } }} />
          <h3 className="card-sub">房间里的形象</h3>
          <LookPicker current={lookChar} refreshCharacters={refreshCharacters} back="characters"
            go={(n, params) => { setLookFor(null); selectCharacter(lookChar.id); go(n, params); }} />
        </>
      )}
    </Sheet>
  );

  return (
    <div className="page">
      {lookSheet}
      <TopBar title="人物" onBack={home}
        right={tab === 'worlds'
          ? <button className="text-btn" onClick={() => setWorldPage({ world: null, fromCreate: false })}>新建</button>
          : <button className="text-btn" onClick={() => setCreating({ draft: null })}>新建</button>} />
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>人物</button>
        <button role="tab" aria-selected={tab === 'worlds'} onClick={() => setTab('worlds')}>世界</button>
        <button role="tab" aria-selected={tab === 'drafts'} onClick={() => setTab('drafts')}>
          草稿箱{drafts.data?.drafts.length ? `（${drafts.data.drafts.length}）` : ''}
        </button>
      </div>
      <div className="page-body">
        {tab === 'people' && (
          <>
            <p className="lead">每个人物的故事互不相通：对 A 说过的话，B 不会知道。</p>
            {!characters.length && <p className="chat-empty">还没有人物，点右上角「新建」。</p>}
            <ul className="people">
              {characters.map((c) => (
                <li key={c.id}>
                  <button className={'person' + (c.id === current?.id ? ' is-on' : '')}
                    onClick={() => { selectCharacter(c.id); home(); }}>
                    <Avatar name={c.name} color={c.avatarColor} url={c.avatarUrl} size={44} />
                    <span className="person-text">
                      <b>{c.name}</b>
                      <span className="muted small">{c.world ? `在「${c.world.name}」` : '还没选世界'}</span>
                      {c.viewBranch && <Thread name={c.viewBranch.name} />}
                    </span>
                    {c.id === current?.id && <span className="tag tag-red">当前</span>}
                  </button>
                  <button type="button" className="person-edit" onClick={() => setLookFor(c.id)}>头像和形象</button>
                </li>
              ))}
            </ul>
          </>
        )}

        {tab === 'worlds' && (
          <>
            <p className="lead">同一个世界里的人物共用这份世界观，但各自的聊天和记忆互不相通。</p>
            {worlds.error && <ErrorBox error={worlds.error} onRetry={worlds.reload} />}
            {!worlds.data && !worlds.error && <Loading />}
            {worlds.data?.worlds.length === 0 && <p className="chat-empty">还没有世界，点右上角「新建」。</p>}
            {worlds.data?.worlds.map((w) => (
              <section className="card world-card" key={w.id}>
                <div className="row-between">
                  <h2 className="card-title">{w.name}</h2>
                  <button className="text-btn" onClick={() => setWorldPage({ world: w, fromCreate: false })}>编辑</button>
                </div>
                <p className="world-peek">{w.lore}</p>
                <p className="muted small">{w.characters.length ? `住着：${w.characters.map((c) => c.name).join('、')}` : '还没有人物'}</p>
                {!w.characters.length && (
                  <button className="btn-danger-ghost small" onClick={async () => {
                    try { await del(`/api/worlds/${w.id}`); worlds.reload(); toast('已删除'); } catch (e) { toast(e.message); }
                  }}>删除这个世界</button>
                )}
              </section>
            ))}
          </>
        )}

        {tab === 'drafts' && (
          <>
            <p className="lead">新建人物时会自动保存草稿，没写完的可以在这里接着写。</p>
            {drafts.error && <ErrorBox error={drafts.error} onRetry={drafts.reload} />}
            {!drafts.data && !drafts.error && <Loading />}
            {drafts.data?.drafts.length === 0 && <p className="chat-empty">草稿箱是空的。</p>}
            <ul className="people">
              {drafts.data?.drafts.map((d) => (
                <li key={d.id} className="draft-row">
                  <button className="person" onClick={() => setCreating({ draft: d })}>
                    <Avatar name={d.data.name || '?'} color="#c3a6e0" url={d.data.avatarUrl} size={44} />
                    <span className="person-text">
                      <b>{d.data.name || '未命名'}</b>
                      <span className="muted small">保存于 {fmtTime(d.updatedAt)}</span>
                    </span>
                  </button>
                  <button className="text-btn muted-btn" aria-label="删除草稿" onClick={async () => {
                    try { await del(`/api/drafts/${d.id}`); drafts.reload(); toast('草稿已删除'); } catch (e) { toast(e.message); }
                  }}>删除</button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

    </div>
  );
}
