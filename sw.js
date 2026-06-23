const CACHE_NAME = 'weather-pwa-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json'
];

// 安装阶段缓存静态文件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// 网络优先策略：天气API使用 NetworkFirst，静态资源使用 CacheFirst
self.addEventListener('fetch', event => {
  const url = event.request.url;
  // 天气API请求（open-meteo 和 和风天气）采用 NetworkFirst，确保数据新鲜
  if (url.includes('api.open-meteo.com') || url.includes('devapi.qweather.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clonedRes = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedRes));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // 其他静态资源，优先使用缓存
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  }
});

// 清理旧缓存
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => key !== CACHE_NAME && caches.delete(key))
    ))
  );
  self.clients.claim();
);
