// 测试用的“假 DeepSeek”：接口格式和真的一样，并把收到的每个请求记下来供检查
import http from 'node:http';

export async function startFakeDeepSeek({ delayMs = 0 } = {}) {
  const requests = [];
  const state = { failNext: null, nextReply: null };
  const server = http.createServer(async (req, res) => {
    // 和 DeepSeek 一样允许网页直接调用（纯前端版测试用）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    requests.push({ auth: req.headers.authorization, body });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const ok = (content, finish = 'stop') => send(200, {
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }],
      usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 600, prompt_cache_miss_tokens: 400, completion_tokens: 50, total_tokens: 1050 },
    });

    if (!/^Bearer sk-(good|mem)/.test(req.headers.authorization || '')) return send(401, { error: { message: 'Authentication Fails' } });
    if (state.failNext) { const s = state.failNext; state.failNext = null; return send(s, { error: { message: 'boom' } }); }

    const msgs = body.messages || [];
    // 看图
    const hasImage = msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
    if (hasImage) return ok('一只橘猫趴在窗台上，旁边的便签写着“看不清”。');

    // 朋友圈 / 日记任务（纯前端版）
    const sys = msgs[0]?.content || '';
    const task = msgs.at(-1)?.content || '';
    if (typeof task === 'string' && task.includes('【任务：发朋友圈】')) return ok(JSON.stringify({ post: '今天的晚霞很好看', skip: false }));
    if (typeof task === 'string' && task.includes('【任务：看朋友圈】')) {
      const sad = task.includes('难过');
      return ok(JSON.stringify({ like: true, comment: sad ? '怎么了？' : '', dm: sad ? '看到你的朋友圈了，还好吗？' : '' }));
    }
    if (typeof task === 'string' && task.includes('【任务：回复评论】')) return ok(JSON.stringify({ reply: '谢谢你～' }));
    if (typeof task === 'string' && task.includes('【任务：要看手机】')) return ok(JSON.stringify({ ask: '你现在在哪？给我看看。', skip: false }));
    if (typeof task === 'string' && task.includes('【任务：查手机被拒绝】')) return ok(JSON.stringify({ reply: '好吧，不看就不看。' }));
    if (typeof task === 'string' && task.includes('【任务：查手机】')) {
      const where = /位置：(.+?)（/.exec(task)?.[1];
      return ok(JSON.stringify({
        log: where ? `他盯着屏幕上的「${where}」看了很久。` : `他往下划着聊天记录，停在${task.includes('凌晨') ? '凌晨那几条' : '最后一句'}。`,
        reply: where ? `这么晚还在${where}？` : '这个人是谁？',
        memory: where ? `她晚上会在${where}` : '她最近常和别人聊天',
      }));
    }
    if (typeof task === 'string' && task.includes('【任务：照片纸条】')) return ok(JSON.stringify({ note: '这张我也很喜欢。下次换我给你拍。', dm: task.includes('海边') ? '照片墙上那张海边，是那天吗？' : '' }));
    if (typeof task === 'string' && task.includes('【任务：写日记】')) return ok('今天和你聊了一会儿，心里很安静。');
    void sys;

    // 记忆整理（JSON 模式）
    if (body.response_format?.type === 'json_object') {
      const user = msgs.find((m) => m.role === 'user')?.content || '';
      const memories = [];
      for (const line of user.split('\n')) {
        const m = /^\[#(\d+)\] 用户：(.*)$/.exec(line);
        if (!m) continue;
        const seq = Number(m[1]);
        const k = m[2].indexOf('记住：');
        if (k >= 0) memories.push({ kind: 'fact', holder: 'user', content: m[2].slice(k + 3), important: false, source: [seq] });
        if (m[2].includes('确定关系')) memories.push({ kind: 'fact', holder: 'both', content: '双方确定了恋爱关系', important: true, source: [seq] });
      }
      // 一条没有真实来源的候选：程序必须拒绝
      memories.push({ kind: 'fact', holder: 'both', content: '双方已经一起去过书店', important: false, source: [999999] });
      return ok(JSON.stringify({ memories }));
    }

    // 角色回复
    const last = [...msgs].reverse().find((m) => m.role === 'user');
    const text = typeof last?.content === 'string' ? last.content : '';
    if (text.includes('触发过滤')) return ok('', 'content_filter');
    if (state.nextReply) { const r = state.nextReply; state.nextReply = null; return ok(r); }
    const name = /你正在扮演「(.+?)」/.exec(msgs[0]?.content || '')?.[1] || '角色';
    return ok(`${name}：回复「${text.split('\n').pop().slice(0, 20)}」`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    state,
    close: () => new Promise((r) => server.close(r)),
    replyCalls: () => requests.filter((r) => !r.body.response_format && !r.body.messages.some((m) => Array.isArray(m.content))),
  };
}
