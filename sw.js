// sw.js - 针对此天气软件，不通用 Service Worker ！！！！！！！！！！！！！！！！！！！
// 动态确定当前应用的子目录，隔离缓存，确保离线访问正常

// ---------- 1. 动态路径与缓存名称 ----------
// 获取当前 sw.js 所在的目录路径（例如 '/weather/'）
const BASE_PATH = self.location.pathname.replace(/[^/]+$/, '');
// 构建带项目标识的缓存名称，避免多项目冲突（每次改应用代码必须递增版本号）
const CACHE_NAME = `pwa-cache${BASE_PATH.replace(/\//g, '-')}v13`;
// 当前项目的缓存前缀（含子路径标识），清理时只删本项目的旧缓存
const CACHE_PREFIX = `pwa-cache${BASE_PATH.replace(/\//g, '-')}`;

// 天气 API 缓存 TTL：5 分钟内同城市（同 URL）刷新可复用；超时/换城市/强制刷新走网络
const API_TTL_MS = 5 * 60 * 1000;

// 预缓存资源列表（全部使用相对于当前 sw.js 的路径）
const PRECACHE_URLS = [
  BASE_PATH,                 // 例如 '/weather/'
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.json`,
  `${BASE_PATH}styles.css`,
  `${BASE_PATH}app.js`,
];

// 预缓存时绕过 HTTP 缓存（GitHub Pages max-age=600 会把旧 app.js 塞进新 SW 缓存）
function precacheBypass(url) {
  return new Request(url, { cache: 'reload' });
}

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

// 从缓存返回时打标记头，并注入 CORS Expose，让页面 JS 能读到 x-sw-cached*
function markCachedResponse(cached, cachedAt) {
  const headers = new Headers(cached.headers);
  headers.set('x-sw-cached', '1');
  headers.set('x-sw-cached-at', String(cachedAt));
  // 跨域响应若无 ACAO（缓存条目头丢失场景），补上以通过 CORS 检查
  if (!headers.get('access-control-allow-origin')) {
    headers.set('access-control-allow-origin', '*');
  }
  const exposed = (headers.get('access-control-expose-headers') || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const h of ['x-sw-cached', 'x-sw-cached-at']) {
    if (!exposed.includes(h)) exposed.push(h);
  }
  headers.set('access-control-expose-headers', exposed.join(', '));
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
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
        // 使用 allSettled 忽略单个资源失败；cache:'reload' 绕开 HTTP 缓存拿最新 app.js
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(precacheBypass(url)).catch(err => console.warn(`预缓存失败 ${url}:`, err)))
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
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  const isSameOrigin = url.origin === location.origin;
  const isAllowedCDN = url.hostname === 'cdn.jsdelivr.net';
  const isWeatherAPI =
    url.hostname.endsWith('qweatherapi.com') ||
    url.hostname.endsWith('qweather.com') ||
    url.hostname === 'api.bigdatacloud.net';

  // 只处理：同源导航/静态、白名单 CDN 静态、天气 API；其余放行走网络
  const shouldHandle =
    isNavigateRequest(request) ||
    (isStaticResource(url) && (isSameOrigin || isAllowedCDN)) ||
    isWeatherAPI;
  if (!shouldHandle) return;

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
          return new Response(
            '<h1>📴 离线状态</h1><p>请检查网络连接后刷新页面。</p>',
            { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        })
    );
    return;
  }

  // ----- 5.2 同源 JS/CSS：网络优先（在线永远吃到新版，防 SW 旧缓存卡死），失败回退缓存 -----
  // CDN 图标字体仍缓存优先（体积小、版本钉死）
  const isSameOriginStatic = isStaticResource(url) && isSameOrigin;
  if (isSameOriginStatic) {
    event.respondWith(
      fetch(request).then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, toCacheableResponse(networkResponse)));
        }
        return networkResponse;
      }).catch(async () => {
        const cachedResponse = await caches.match(request);
        if (cachedResponse) return cachedResponse;
        return new Response('', { status: 408 });
      })
    );
    return;
  }

  if (isStaticResource(url) && isAllowedCDN) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then(networkResponse => {
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

  // ----- 5.3 天气 API：5 分钟同城市缓存，超时/_force 实时 -----
  // 缓存键 = 剥掉 _force 与 key 后的 URL（含 location/路径经纬度）→ 换城市天然不命中。
  // key 从缓存键剥离：query 鉴权时不因换 Key 导致缓存穿透。
  // 网络请求保留原始 URL（含 query key）。
  const isForced = url.searchParams.get('_force') === '1';

  const cacheKeyUrl = new URL(url.href);
  cacheKeyUrl.searchParams.delete('_force');
  cacheKeyUrl.searchParams.delete('key');
  const cacheKeyRequest = new Request(cacheKeyUrl.href, { method: 'GET' });

  const fetchUrl = new URL(url.href);
  fetchUrl.searchParams.delete('_force');
  // 保留原始请求头与 mode；勿用空 headers 覆盖
  const networkRequestInit = {
    method: request.method,
    headers: request.headers,
    mode: request.mode,
    credentials: request.credentials,
    redirect: request.redirect,
    integrity: request.integrity,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy,
  };

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(cacheKeyRequest);
    let cachedAt = 0;
    if (cachedResponse) {
      cachedAt = parseInt(cachedResponse.headers.get('x-sw-cached-at') || '0', 10) || 0;
    }
    const cacheFresh = cachedResponse && cachedAt > 0 && (Date.now() - cachedAt) < API_TTL_MS;

    if (cacheFresh && !isForced) {
      // 5 分钟内同城市刷新：复用缓存，并打上 x-sw-cached 标记供页面提示
      return markCachedResponse(cachedResponse, cachedAt);
    }

    try {
      const networkResponse = await fetch(new Request(fetchUrl.href, networkRequestInit));
      if (networkResponse && networkResponse.status === 200) {
        const stamped = toCacheableResponse(networkResponse);
        stamped.headers.set('x-sw-cached-at', String(Date.now()));
        cache.put(cacheKeyRequest, stamped);
      }
      // 实时数据不打缓存标记，页面收到即视为最新
      return networkResponse;
    } catch (err) {
      // 网络失败：回退缓存（哪怕过期），并标记为缓存数据
      if (cachedResponse) {
        return markCachedResponse(cachedResponse, cachedAt || Date.now());
      }
      return new Response('{"code":"network_error"}', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'application/json' }
      });
    }
  })());
});
