// sw.js - 针对此天气软件，不通用 Service Worker ！！！！！！！！！！！！！！！！！！！
// 动态确定当前应用的子目录，隔离缓存，确保离线访问正常

// ---------- 1. 动态路径与缓存名称 ----------
// 获取当前 sw.js 所在的目录路径（例如 '/pwa1/'）
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
// 构建带项目标识的缓存名称，避免多项目冲突
// 例如 '/pwa1/' -> 'pwa-cache-pwa1-v1'
const CACHE_NAME = `pwa-cache${BASE_PATH.replace(/\//g, '-')}v8`;
// 当前项目的缓存前缀（含子路径标识），用于清理时只删本项目的旧缓存
const CACHE_PREFIX = `pwa-cache${BASE_PATH.replace(/\//g, '-')}`;

// 预缓存资源列表（全部使用相对于当前 sw.js 的路径）
const PRECACHE_URLS = [
  BASE_PATH,                 // 例如 '/pwa1/'
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  // 如果有图标，可以追加，例如：
  // `${BASE_PATH}favicon.ico`,
  // `${BASE_PATH}logo192.png`,
];

// 静态资源扩展名（用于判断是否缓存优先）
const STATIC_EXTENSIONS = ['js', 'css', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'woff', 'woff2', 'ttf', 'eot', 'ico'];

// ---------- 2. 工具函数 ----------
function isStaticResource(url) {
  const ext = url.pathname.split('.').pop().toLowerCase();
  return STATIC_EXTENSIONS.includes(ext);
}

function isNavigateRequest(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.destination === 'document');
}

// 修复 Bug：缓存前剥离 content-encoding / content-length / transfer-encoding。
// fetch 层已自动解压 body，若保留 gzip 头会把“已解压的数据”再按 gzip 解一次导致缓存损坏
function toCacheableResponse(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// ---------- 3. 安装阶段 ----------
self.addEventListener('install', (event) => {
  console.log('[SW] 安装中，BASE_PATH =', BASE_PATH);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] 预缓存资源:', PRECACHE_URLS);
        // 使用 allSettled 忽略单个资源失败
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn(`预缓存失败 ${url}:`, err)))
        );
      })
      .then(() => self.skipWaiting()) // 立即激活
  );
});

// ---------- 4. 激活阶段（只清理当前项目的旧缓存） ----------
self.addEventListener('activate', (event) => {
  console.log('[SW] 激活中...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          // 只删除当前项目的旧缓存版本（含子路径前缀，避免误删同源其他 PWA）
          if (cache.startsWith(CACHE_PREFIX) && cache !== CACHE_NAME) {
            console.log('[SW] 删除旧缓存:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // 立即控制所有页面
  );
});

// ---------- 5. 请求拦截 ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源 GET 请求
  if (url.origin !== location.origin || request.method !== 'GET') {
    return;
  }

  // ----- 5.1 导航请求（HTML）：网络优先，失败回退缓存 -----
  if (isNavigateRequest(request)) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, toCacheableResponse(networkResponse)));
          }
          return networkResponse;
        })
        .catch(async () => {
          // 网络失败，尝试从缓存获取
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            console.log('[SW] 离线模式，使用缓存页面:', url.pathname);
            return cachedResponse;
          }
          // 连缓存都没有，返回自定义离线页（可预置 offline.html）
          // 如果希望更美观，可以预缓存一个 offline.html 并在这里返回它
          return new Response(
            '<h1>📴 离线状态</h1><p>请检查网络连接后刷新页面。</p>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html' } }
          );
        })
    );
    return;
  }

  // ----- 5.2 静态资源请求：缓存优先，未命中则网络请求并缓存 -----
  // 允许同源或指定的 CDN 跨域资源
  const isAllowedCDN = url.hostname === 'cdn.jsdelivr.net';
  if (isStaticResource(url) && (url.origin === location.origin || isAllowedCDN)) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(networkResponse => {
          // 注意：跨域不透明响应 status 为 0，所以用 !networkResponse.ok 不可靠，直接判断是否存在即可
          if (networkResponse) {
            caches.open(CACHE_NAME).then(cache => cache.put(request, toCacheableResponse(networkResponse)));
          }
          return networkResponse;
        }).catch(() => {
          return new Response('', { status: 408 });
        });
      })
    );
    return;
  }
  // ----- 5.3 API 请求（和风天气数据） -----
  const isWeatherAPI = url.hostname.endsWith('qweatherapi.com') || url.hostname.endsWith('qweather.com') || url.hostname === 'api.bigdatacloud.net';

  if (isWeatherAPI) {
    // 修复 Bug：实时类接口（实况/空气质量/分钟降水/预警）改网络优先（stale-while-revalidate），保证刷新拿到最新值；
    // 预报类接口（逐小时/逐日/指数）保持缓存优先，降低流量消耗。分钟降水数据约 10 分钟更新，不再缓存 1 小时。
    const isRealtimeAPI =
      url.pathname.includes('/v7/weather/now') ||
      url.pathname.includes('/airquality/') ||
      url.pathname.includes('/v7/minutely/') ||
      url.pathname.includes('/v7/warning/now');

    // 手动刷新（index 追加 _force=1）：忽略预报缓存强制走网络；
    // 同时剥掉 _force 参数作为缓存键，避免缓存条目随每次刷新膨胀
    const isForced = url.searchParams.get('_force') === '1';
    const cleanUrl = new URL(url);
    cleanUrl.searchParams.delete('_force');
    const cacheKeyRequest = new Request(cleanUrl.toString(), { method: 'GET' });

    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cachedResponse = await cache.match(cacheKeyRequest);

        if (isRealtimeAPI || isForced) {
          // 网络优先：能联网就取最新并回填缓存；离线/失败才回退缓存
          return fetch(cacheKeyRequest).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(cacheKeyRequest, toCacheableResponse(networkResponse));
            }
            return networkResponse;
          }).catch(() => {
            return cachedResponse || new Response('{"code":"offline"}', { status: 503 });
          });
        }

        // 预报类：缓存优先（带 TTL），后台更新
        const CACHE_MAX_AGE = 60 * 60 * 1000; // 1 小时
        const cachedTime = cachedResponse ? parseInt(cachedResponse.headers.get('x-sw-cached-at') || '0', 10) : 0;
        const cacheFresh = cachedTime > 0 && (Date.now() - cachedTime) < CACHE_MAX_AGE;

        const fetchPromise = fetch(cacheKeyRequest).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const stamped = toCacheableResponse(networkResponse);
            stamped.headers.set('x-sw-cached-at', String(Date.now()));
            cache.put(cacheKeyRequest, stamped);
          }
          return networkResponse;
        }).catch(() => {
          // 离线不做处理，返回 undefined 让外层走缓存
        });

        if (cachedResponse && cacheFresh) {
          return cachedResponse;
        }
        return fetchPromise || cachedResponse || new Response('{"code":"offline"}', { status: 503 });
      })
    );
    return;
  }
  // ----- 5.4 其他请求（如 API）默认不缓存，直接走网络 -----
  // （业务数据通常存储在 IndexedDB 中，不受影响）
});
