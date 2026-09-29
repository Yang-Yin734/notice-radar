// 通知雷达的 Service Worker。
//
// 目标：**在 GitHub 上挂的网页版永远是最新的**，同时保留离线可用。
//
// 策略：
//   - 页面外壳（index.html、'./'）：**网络优先**，拿到就用并更新缓存；离线时回落到缓存
//     （以前是缓存优先，结果回访用户可能一直看到旧版界面 —— 这正是要避免的）
//   - 图标 / manifest：缓存优先（基本不变）
//   - dashboard-data.json / version.json：网络优先
//   - 新版本 SW 一旦装上就 skipWaiting + clients.claim 立即接管，页面不弹任何"有更新"提示
const CACHE = 'notice-radar-v3';
const SHELL_ASSETS = ['./manifest.webmanifest', './icon-192.png', './icon-512.png'];
const NETWORK_FIRST = ['/', '/index.html', 'dashboard-data.json', 'version.json', 'index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['./', ...SHELL_ASSETS]))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// 页面若发来 SKIP_WAITING（保留兼容），立刻接管
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isNetworkFirst(url) {
  const path = url.pathname;
  if (path.endsWith('/')) return true;
  return NETWORK_FIRST.some((name) => path.endsWith(name));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isNetworkFirst(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./'))),
    );
    return;
  }

  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
