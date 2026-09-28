// 通知雷达的 Service Worker：让装到手机上的应用能离线打开，并支持"发现新版本 → 立即更新"。
//
// 策略：
//   - 应用外壳（HTML/manifest/图标）：缓存优先，先给用户看到界面
//   - dashboard-data.json / version.json：网络优先，拿不到再用缓存
//     （版本清单必须网络优先，否则测不出"线上有新版本"）
// 数据是公开的通知归档，缓存到本机不涉及隐私；收藏/已读在 localStorage，不在这里。
const CACHE = 'notice-radar-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
// 这些走"网络优先"：内容/版本随时会变，缓存只作离线兜底
const NETWORK_FIRST = ['dashboard-data.json', 'version.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
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

// 页面检测到新版本后会发这个消息，让等待中的 SW 立刻接管，然后页面刷新
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

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

  if (NETWORK_FIRST.some((name) => url.pathname.endsWith(name))) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
