// 人物相关的共用部件：换头像、新建/编辑世界
import React, { useRef, useState } from 'react';
import { cropImage } from './crop.jsx';
import { post, patch } from './api.js';
import { compressImage } from './image.js';
import { LOOKS, sprite } from './looks.js';
import { dollUrl } from './doll.js';
import { Avatar, Button, PickButton, Sheet, toast } from './ui.jsx';

export function AvatarPicker({ name, color, url, onChange, size = 72 }) {
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await cropImage(file, { aspect: 1, size: 512, round: true, title: '裁剪头像' });
      if (!dataUrl) return;
      const r = await post('/api/avatars', { dataUrl });
      await onChange(r.avatar);
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }
  return (
    <div className="avatar-picker">
      <button type="button" className="avatar-btn" onClick={() => ref.current?.click()} disabled={busy} aria-label="换头像">
        <Avatar name={name || '?'} color={color || '#c3a6e0'} url={url} size={size} />
        <span className="avatar-badge">{busy ? '…' : '换'}</span>
      </button>
      <input ref={ref} type="file" accept="image/*" hidden onChange={pick} />
      <PickButton busy={busy} onClick={() => ref.current?.click()}>{url ? '换头像' : '上传头像'}</PickButton>
      {url && <button type="button" className="text-btn muted-btn" onClick={() => onChange(null)}>用默认头像</button>}
    </div>
  );
}

// world 为空 = 新建；required = 还没有世界，必须先写一个
export function WorldSheet({ open, world, required, onClose, onSaved }) {
  const [name, setName] = useState(world?.name || '');
  const [lore, setLore] = useState(world?.lore || '');
  const [busy, setBusy] = useState(false);
  const [lastKey, setLastKey] = useState(null);
  const key = open ? (world?.id || 'new') : null;
  if (key !== lastKey) { setLastKey(key); setName(world?.name || ''); setLore(world?.lore || ''); }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = world ? await patch(`/api/worlds/${world.id}`, { name, lore }) : await post('/api/worlds', { name, lore });
      toast(world ? '世界观已保存' : `世界「${r.world.name}」已创建`);
      onSaved(r.world);
    } catch (err) { toast(err.message); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title={world ? '编辑世界' : required ? '先写下 TA 生活的世界' : '新建世界'}>
      <form onSubmit={save}>
        {required && <p className="muted small">每个人物都生活在一个世界里，同一个世界的人物共用这份世界观。你写到一半的人设已经自动存进草稿箱，写完世界观可以接着改。</p>}
        <label className="field">
          <span>世界名称</span>
          <input value={name} maxLength={30} required placeholder="例如：大观园、现代上海、星际港口" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>世界观</span>
          <textarea rows={6} value={lore} maxLength={8000} required placeholder="故事发生的时代、地点、社会规则、有没有魔法或科技……" onChange={(e) => setLore(e.target.value)} />
        </label>
        {world?.characters?.length > 0 && <p className="muted small">改动会影响这个世界里的所有人物：{world.characters.map((c) => c.name).join('、')}。</p>}
        <Button busy={busy} type="submit" disabled={!name.trim() || !lore.trim()}>{world ? '保存世界观' : '创建世界'}</Button>
      </form>
    </Sheet>
  );
}

// 房间里的形象：自己给 TA 画的小人 + 预设的几套小人 + 默认
export function LookPicker({ current, refreshCharacters, go, back }) {
  async function choose(look, msg) {
    try {
      await patch(`/api/characters/${current.id}`, { look });
      await refreshCharacters();
      toast(msg);
    } catch (e) { toast(e.message); }
  }
  return (
    <div className="look-grid" role="radiogroup" aria-label={`${current.name}的形象`}>
      {current.doll && (
        <button type="button" role="radio" aria-checked={current.look === 'doll'} className={current.look === 'doll' ? 'is-on' : ''}
          onClick={() => choose('doll', `${current.name}换上了你画的小人`)}>
          <img className="is-pixel" src={dollUrl(current.doll)} alt="" />
          <b>你画的</b>
        </button>
      )}
      <button type="button" className="look-draw" onClick={() => go('doll', { target: 'character', back })}>
        <span className="look-pen" aria-hidden="true">✏️</span>
        <b>{current.doll ? `修改${current.name}的小人` : `给${current.name}画小人`}</b>
      </button>
      {LOOKS.map((l) => (
        <button key={l.id} type="button" role="radio" aria-checked={current.look === l.id} className={current.look === l.id ? 'is-on' : ''}
          onClick={() => choose(l.id, `已换成预设形象 ${l.name}`)}>
          <img src={sprite(l.id)} alt="" />
          <b>预设 {l.name}</b>
        </button>
      ))}
      <button type="button" role="radio" aria-checked={!current.look} className={!current.look ? 'is-on' : ''}
        onClick={() => choose(null, '已换回默认形象')}>
        <span className="look-plain" aria-hidden="true" style={{ background: current.avatarColor }} />
        <b>默认</b>
      </button>
    </div>
  );
}
