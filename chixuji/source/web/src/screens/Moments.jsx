// 朋友圈（仿微信）：只显示当前人物和你在这条世界线上的动态
import React, { useEffect, useRef, useState } from 'react';
import { get, post, useImageSrc } from '../api.js';
import { compressImage } from '../image.js';
import { cropImage } from '../crop.jsx';
import { Avatar, Button, ErrorBox, Loading, PickButton, Sheet, toast } from '../ui.jsx';

export function timeAgo(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d >= today) return `${Math.floor(diff / 3600)}小时前`;
  if (d >= new Date(today.getTime() - 86400e3)) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function Pic({ id, single }) {
  const src = useImageSrc(id);
  return <span className={'wx-pic' + (single ? ' is-single' : '')}>{src && <img src={src} alt="" loading="lazy" />}</span>;
}

function Compose({ current, onClose, onPosted }) {
  const [text, setText] = useState('');
  const [pics, setPics] = useState([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  async function pick(e) {
    const files = [...(e.target.files || [])].slice(0, 9 - pics.length);
    e.target.value = '';
    for (const f of files) {
      try { const img = await compressImage(f); setPics((p) => [...p, img]); } catch (err) { toast(err.message); }
    }
  }
  async function send() {
    setBusy(true);
    try {
      const imageIds = [];
      for (const p of pics) imageIds.push((await post('/api/images', { characterId: current.id, ...p })).image.id);
      await post(`/api/branches/${current.viewBranch.id}/moments`, { text, imageIds });
      onPosted();
    } catch (err) { toast(err.message); setBusy(false); }
  }
  return (
    <div className="page wx-compose">
      <header className="wx-compose-top">
        <button className="wx-text-btn" onClick={onClose}>取消</button>
        <button className="wx-send" disabled={busy || (!text.trim() && !pics.length)} onClick={send}>{busy ? '发表中' : '发表'}</button>
      </header>
      <div className="page-body">
        <textarea className="wx-compose-text" autoFocus rows={5} maxLength={2000} value={text} placeholder="这一刻的想法…" onChange={(e) => setText(e.target.value)} />
        <div className="wx-compose-grid">
          {pics.map((p, i) => (
            <span key={i} className="wx-pic"><img src={p.dataUrl} alt="" />
              <button className="wx-pic-del" aria-label="去掉这张" onClick={() => setPics(pics.filter((_, j) => j !== i))}>×</button>
            </span>
          ))}
          {pics.length < 9 && <button className="wx-pic wx-pic-add" onClick={() => fileRef.current?.click()} aria-label="添加图片">＋</button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={pick} />
        <div className="wx-compose-who"><span>谁可以看</span><span>只有{current.name}（这条世界线）</span></div>
      </div>
    </div>
  );
}

export default function Moments({ me, current, home, go, refreshUnread, route }) {
  const person = route?.person === 'me' || route?.person === 'char' ? route.person : null; // 看某个人的相册
  const [cover, setCover] = useState(undefined);
  const [coverSheet, setCoverSheet] = useState(false);
  const coverFile = useRef(null);
  useEffect(() => { get('/api/local/moments-cover').then((r) => setCover(r.cover), () => setCover(null)); }, []);
  async function pickCover(e) {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    try {
      const d = await cropImage(f, { aspect: 1.35, size: 1200, title: '裁剪朋友圈封面' });
      if (!d) return;
      await post('/api/local/moments-cover', { dataUrl: d }); setCover(d); setCoverSheet(false); toast('封面换好了');
    } catch (err) { toast(err.message); }
  }
  async function resetCover() {
    try { await post('/api/local/moments-cover', { dataUrl: null }); setCover(null); setCoverSheet(false); toast('已恢复默认封面'); } catch (err) { toast(err.message); }
  }
  const branchId = current.viewBranch.id;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [menu, setMenu] = useState(null); // 展开“赞 / 评论”的那条
  const [commentFor, setCommentFor] = useState(null);
  const [comment, setComment] = useState('');
  const [composing, setComposing] = useState(false);
  const [removing, setRemoving] = useState(null); // { target: 'moment'|'comment', seq, mine, text }
  const [busy, setBusy] = useState('');

  async function doRemove(forget) {
    const r = removing;
    setBusy(forget ? 'forget' : 'keep');
    try {
      await post(`/api/branches/${branchId}/${r.target === 'moment' ? 'moments' : 'comments'}/${r.seq}/remove`, { forget });
      toast(r.mine ? (forget ? `已删除，${current.name}也不记得了` : '已删除') : '已隐藏');
      setRemoving(null); load();
    } catch (e) { toast(e.message); } finally { setBusy(''); }
  }

  const markRead = () => post(`/api/characters/${current.id}/read`, { area: 'moments' }).then(() => refreshUnread?.(), () => {});
  async function load() {
    try { setData(await get(`/api/branches/${branchId}/moments`)); setError(null); } catch (e) { setError(e); }
  }
  useEffect(() => { load(); }, [branchId]);
  // TA 过一会儿才会看到你的朋友圈：开着页面时隔几秒刷新一下
  useEffect(() => {
    const t = setInterval(load, 5000);
    const onNew = () => { load(); markRead(); };
    markRead();
    window.addEventListener('xsj:new-events', onNew);
    return () => { clearInterval(t); window.removeEventListener('xsj:new-events', onNew); markRead(); };
  }, [branchId]);

  async function like(p) {
    setMenu(null);
    try { await post(`/api/branches/${branchId}/moments/${p.seq}/like`); load(); } catch (e) { toast(e.message); }
  }
  async function sendComment(e) {
    e.preventDefault();
    try {
      await post(`/api/branches/${branchId}/moments/${commentFor.seq}/comments`, { text: comment });
      setComment(''); setCommentFor(null); load();
    } catch (err) { toast(err.message); }
  }

  if (composing) return <Compose current={current} onClose={() => setComposing(false)} onPosted={() => { setComposing(false); load(); toast('已发表'); }} />;

  const myName = me?.name || '我';
  const nameOf = (a) => (a === 'user' ? myName : current.name);
  // 头像和全局一致；点头像看这个人的相册
  const avatarOf = (a, size) => (
    <button type="button" className="wx-ava-btn" onClick={(e) => { e.stopPropagation(); go('moments', { person: a === 'user' ? 'me' : 'char' }); }} aria-label={`看${nameOf(a)}的朋友圈`}>
      {a === 'user'
        ? <Avatar name={myName} color="#c9c5d1" url={me?.avatarUrl} size={size} />
        : <Avatar name={current.name} color={current.avatarColor} url={current.avatarUrl} size={size} />}
    </button>
  );
  const coverStyle = cover ? { background: `center / cover no-repeat url(${cover})` } : undefined;
  const coverParts = (
    <>
      <input ref={coverFile} type="file" accept="image/*" hidden onChange={pickCover} />
      <Sheet open={coverSheet} onClose={() => setCoverSheet(false)} title="朋友圈封面">
        <PickButton onClick={() => coverFile.current?.click()}>{cover ? '换一张封面' : '从相册选一张'}</PickButton>
        {cover && <button type="button" className="text-btn" onClick={resetCover}>恢复默认封面</button>}
      </Sheet>
    </>
  );

  // —— 某个人的相册（像微信点头像进去那样）——
  if (person) {
    const who = person === 'me' ? 'user' : 'character';
    const list = (data?.posts || []).filter((p) => p.author === who);
    const days = [];
    for (const p of list) {
      const d = new Date(p.createdAt); const key = d.toDateString();
      const last = days[days.length - 1];
      if (last && last.key === key) last.posts.push(p); else days.push({ key, d, posts: [p] });
    }
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400e3).toDateString();
    return (
      <div className="page wx">
        <div className="wx-scroll">
          <div className="wx-cover" style={person === 'me' ? coverStyle : undefined} onClick={() => person === 'me' && setCoverSheet(true)}>
            <div className="wx-cover-bar">
              <button className="icon-btn wx-light" onClick={(e) => { e.stopPropagation(); go('moments'); }} aria-label="返回">
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </div>
            <div className="wx-owner">
              <span className="wx-owner-name">{nameOf(who)}</span>
              <span className="wx-owner-avatar">{who === 'user'
                ? <Avatar name={myName} color="#c9c5d1" url={me?.avatarUrl} size={70} />
                : <Avatar name={current.name} color={current.avatarColor} url={current.avatarUrl} size={70} />}</span>
            </div>
          </div>
          {!data && !error && <Loading />}
          {data && !list.length && <p className="wx-empty">{nameOf(who)}还没有发过朋友圈。</p>}
          <ul className="wx-album">
            {days.map((g) => (
              <li key={g.key} className="wx-day">
                <div className="wx-date">
                  {g.key === today ? <b>今天</b> : g.key === yesterday ? <b>昨天</b> : <><b>{g.d.getDate()}</b><small>{g.d.getMonth() + 1}月</small></>}
                </div>
                <div className="wx-day-posts">
                  {g.posts.map((p) => (
                    <div key={p.seq} className={'wx-album-post' + (p.imageIds.length ? '' : ' is-text')}>
                      {p.imageIds.length > 0 && <span className="wx-album-pic"><Pic id={p.imageIds[0]} /></span>}
                      <span className="wx-album-text">
                        {p.text || ''}
                        {p.imageIds.length > 1 && <small>共{p.imageIds.length}张</small>}
                      </span>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
        {coverParts}
      </div>
    );
  }

  return (
    <div className="page wx" onClick={() => setMenu(null)}>
      <div className="wx-scroll">
        <div className="wx-cover" style={coverStyle} onClick={() => setCoverSheet(true)}>
          <div className="wx-cover-bar" onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn wx-light" onClick={home} aria-label="返回">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button className="icon-btn wx-light" onClick={() => setComposing(true)} aria-label="发朋友圈">
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
            </button>
          </div>
          <div className="wx-owner" onClick={(e) => { e.stopPropagation(); go('moments', { person: 'me' }); }}>
            <span className="wx-owner-name">{myName}</span>
            <span className="wx-owner-avatar"><Avatar name={myName} color="#c9c5d1" url={me?.avatarUrl} size={70} /></span>
          </div>
        </div>

        {error && <ErrorBox error={error} onRetry={load} />}
        {!data && !error && <Loading />}
        {data && !data.posts.length && (
          <p className="wx-empty">还没有动态。点右上角的相机发一条，{current.name}可能会看到。<br />想让 TA 自己发朋友圈，在「设置」里打开“TA 会自己发朋友圈”。</p>
        )}

        <ul className="wx-list">
          {data?.posts.map((p) => (
            <li className="wx-post" key={p.seq}>
              {avatarOf(p.author, 42)}
              <div className="wx-body">
                <div className="wx-name">{nameOf(p.author)}</div>
                {p.text && <div className="wx-text">{p.text}</div>}
                {p.imageIds.length > 0 && (
                  <div className={'wx-pics n' + Math.min(p.imageIds.length, 3)}>
                    {p.imageIds.map((id) => <Pic key={id} id={id} single={p.imageIds.length === 1} />)}
                  </div>
                )}
                <div className="wx-meta">
                  <span>{timeAgo(p.createdAt)}
                    {p.author === 'user' && <button className="wx-del" onClick={(e) => { e.stopPropagation(); setRemoving({ target: 'moment', seq: p.seq, mine: true, text: p.text }); }}>删除</button>}
                  </span>
                  <span className="wx-actions-wrap">
                    {menu === p.seq && (
                      <span className="wx-actions" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => like(p)}>♡ {p.likes.includes('user') ? '取消' : '赞'}</button>
                        <button onClick={() => { setMenu(null); setCommentFor(p); }}>评论</button>
                        {p.author !== 'user' && <button onClick={() => { setMenu(null); setRemoving({ target: 'moment', seq: p.seq, mine: false, text: p.text }); }}>隐藏</button>}
                      </span>
                    )}
                    <button className="wx-dots" aria-label="赞或评论" onClick={(e) => { e.stopPropagation(); setMenu(menu === p.seq ? null : p.seq); }}>··</button>
                  </span>
                </div>
                {(p.likes.length > 0 || p.comments.length > 0) && (
                  <div className="wx-box">
                    {p.likes.length > 0 && <div className="wx-likes">♡ {p.likes.map(nameOf).join('，')}</div>}
                    {p.comments.length > 0 && (
                      <div className="wx-comments">
                        {p.comments.map((c) => (
                          <button className="wx-comment" key={c.seq} onClick={(e) => { e.stopPropagation(); setRemoving({ target: 'comment', seq: c.seq, mine: c.author === 'user', text: c.text }); }}>
                            <b>{nameOf(c.author)}</b>：{c.text}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <Sheet open={!!removing} onClose={() => setRemoving(null)}
        title={removing?.mine ? (removing.target === 'moment' ? '删除这条朋友圈' : '删除这条评论') : (removing?.target === 'moment' ? '隐藏这条朋友圈' : '隐藏这条评论')}>
        {removing && (
          <>
            {removing.text && <p className="sheet-quote">「{removing.text.length > 60 ? removing.text.slice(0, 60) + '…' : removing.text}」</p>}
            {removing.mine ? (
              <>
                <p className="muted small">删除后在这条世界线上就看不到了（分出去的其他世界线不受影响）。{current.name}要不要也忘掉它？</p>
                <Button kind="danger" busy={busy === 'forget'} disabled={!!busy} onClick={() => doRemove(true)}>删除，并让{current.name}也忘掉</Button>
                <Button kind="ghost" busy={busy === 'keep'} disabled={!!busy} onClick={() => doRemove(false)}>只删除，{current.name} 还记得</Button>
                <p className="muted small">「忘掉」会撤掉因为它产生的记忆；{current.name}因为它私聊你的话还会留在聊天记录里。</p>
              </>
            ) : (
              <>
                <p className="muted small">隐藏后只是你看不到，{current.name}还记得发过它。</p>
                <Button kind="ghost" busy={busy === 'keep'} disabled={!!busy} onClick={() => doRemove(false)}>隐藏</Button>
              </>
            )}
            <button className="text-btn" onClick={() => setRemoving(null)}>取消</button>
          </>
        )}
      </Sheet>

      {coverParts}
      {commentFor && (
        <form className="wx-comment-bar" onSubmit={sendComment} onClick={(e) => e.stopPropagation()}>
          <input autoFocus value={comment} maxLength={300} placeholder={`评论${nameOf(commentFor.author)}的动态`} onChange={(e) => setComment(e.target.value)} />
          <button className="wx-send" disabled={!comment.trim()}>发送</button>
          <button type="button" className="wx-text-btn" onClick={() => setCommentFor(null)}>取消</button>
        </form>
      )}
    </div>
  );
}
