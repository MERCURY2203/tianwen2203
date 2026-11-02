// 只缓存界面文件（让“添加到桌面”后打开更快），聊天等私密数据一律不缓存
const CACHE = 'xsj-shell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;

  // 带哈希的打包文件：先用缓存
  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/') || url.pathname.includes('/sprites/')) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })),
    );
    return;
  }
  // 页面本身：先联网拿最新的，断网时用缓存
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(new URL('./', self.registration.scope).href, copy));
        return res;
      }).catch(() => caches.match(new URL('./', self.registration.scope).href)),
    );
  }
});
