const CACHE_NAME = 'weather-pwa-v2-1335';
const urlsToCache = [
  '/weather/',
  '/weather/index.html',
  '/weather/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;
  // 天气API请求（Open-Meteo 和 和风天气）采用 NetworkFirst
  if (url.includes('api.open-meteo.com') ||
      url.includes('qweatherapi.com') ||
      url.includes('devapi.qweather.com')) {
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
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => key !== CACHE_NAME && caches.delete(key))
    ))
  );
  self.clients.claim();
});
