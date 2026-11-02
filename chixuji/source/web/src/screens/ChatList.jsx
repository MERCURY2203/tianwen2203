// 聊天软件首页（像微信）：同一个世界里的每个人物一行，点进去才是聊天
import React, { useEffect, useState } from 'react';
import { get } from '../api.js';
import { Avatar, ErrorBox, Loading, TopBar } from '../ui.jsx';

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === new Date(Date.now() - 86400e3).toDateString()) return '昨天';
  if (now - d < 6 * 86400e3) return '星期' + '日一二三四五六'[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function ChatList({ current, home, go, selectCharacter, unread = {} }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = () => get(`/api/local/chats?characterId=${current.id}`).then((r) => { setData(r); setError(null); }, setError);
  useEffect(() => {
    load();
    const onNew = () => load();
    window.addEventListener('xsj:new-events', onNew);
    return () => window.removeEventListener('xsj:new-events', onNew);
  }, [current.id]);

  function open(c) {
    if (c.id !== current.id) selectCharacter(c.id);
    go('chat', { thread: c.id });
  }

  return (
    <div className="page chatlist">
      <TopBar title={data?.world ? `聊天 · ${data.world.name}` : '聊天'} onBack={home} />
      <div className="chatlist-body">
        {error && <ErrorBox error={error} onRetry={load} />}
        {!data && !error && <Loading />}
        <ul className="chatlist-list">
          {data?.chats.map(({ character: c, last }) => {
            const n = unread.chat?.[c.id] || 0;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => open(c)}>
                  <span className="chatlist-ava">
                    <Avatar name={c.name} color={c.avatarColor} url={c.avatarUrl} size={48} />
                    {n > 0 && <span className="chatlist-badge">{n > 99 ? '99+' : n}</span>}
                  </span>
                  <span className="chatlist-main">
                    <span className="chatlist-top"><b>{c.name}</b><time>{when(last?.at)}</time></span>
                    <span className="chatlist-msg">{last ? last.text : '还没有聊过，点进来打个招呼'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {data && data.chats.length === 1 && <p className="chatlist-tip">同一个世界里再创建人物，就会出现在这里。</p>}
      </div>
    </div>
  );
}
