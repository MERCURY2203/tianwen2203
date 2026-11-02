// 日记：角色每段聊天后写下的心里话
import React, { useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { Button, ErrorBox, Loading, Thread, toast, TopBar, useAsync } from '../ui.jsx';

const WEEK = '日一二三四五六';
export function dateTitle(iso) {
  const d = new Date(iso);
  const h = d.getHours();
  const part = h < 6 ? '深夜' : h < 11 ? '早上' : h < 14 ? '中午' : h < 18 ? '下午' : '晚上';
  return `${d.getMonth() + 1}月${d.getDate()}日　星期${WEEK[d.getDay()]}　${part}`;
}

export default function Diary({ current, home, go, refreshUnread }) {
  const branchId = current.viewBranch.id;
  const q = useAsync(() => get(`/api/branches/${branchId}/diary`), [branchId]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const markRead = () => post(`/api/characters/${current.id}/read`, { area: 'diary' }).then(() => refreshUnread?.(), () => {});
    markRead();
    const onNew = () => { q.reload(); markRead(); };
    window.addEventListener('xsj:new-events', onNew);
    return () => window.removeEventListener('xsj:new-events', onNew);
  }, [branchId]);

  async function writeNow() {
    setBusy(true);
    try { await post(`/api/branches/${branchId}/diary`); toast(`${current.name}写好了`); q.reload(); }
    catch (e) { toast(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="page diary">
      <TopBar title={`${current.name}的日记`} onBack={home} sub={<Thread name={current.viewBranch.name} onClick={() => go('worldlines')} />} />
      <div className="page-body">
        {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
        {!q.data && !q.error && <Loading />}
        {q.data && (
          <>
            {!q.data.auto && <p className="lead">在「设置」里打开“聊完天自动写日记”，TA 会在每段聊天结束后写一篇。</p>}
            {q.data.pending >= 2 && (
              <Button kind="ghost" busy={busy} onClick={writeNow}>让 TA 现在写一篇（最近 {q.data.pending} 条消息）</Button>
            )}
            {!q.data.entries.length && <p className="chat-empty">日记本还是空的。</p>}
            {q.data.entries.map((e) => (
              <article className="diary-page" key={e.seq}>
                <h2>{dateTitle(e.createdAt)}</h2>
                <p>{e.text}</p>
              </article>
            ))}
            <p className="muted small">日记是 TA 的心里话，里面的担心和猜测只是 TA 的想法。看日记这件事，TA 并不知道。</p>
          </>
        )}
      </div>
    </div>
  );
}
