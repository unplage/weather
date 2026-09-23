// app.js — 随行天气 主逻辑
// 拆分自 index.html；所有变更需同步递增 sw.js 的 CACHE_NAME

// ========== localStorage schema 版本（优化 #16）==========
const STORAGE_SCHEMA_KEY = 'schema_version';
const STORAGE_SCHEMA = 2; // v2: 新增 qweather_auth / temp_unit / theme / favorites / recents

function migrateStorage() {
  try {
    const v = parseInt(localStorage.getItem(STORAGE_SCHEMA_KEY) || '0', 10);
    if (v >= STORAGE_SCHEMA) return;
    // v1→v2：老用户原本走 ?key=，无 auth 标记时默认 query，保持行为不变
    if (!localStorage.getItem('qweather_auth')) {
      localStorage.setItem('qweather_auth', 'query');
    }
    localStorage.setItem(STORAGE_SCHEMA_KEY, String(STORAGE_SCHEMA));
  } catch (e) {
    // 隐私模式等场景忽略
  }
}
migrateStorage();

// ========== 存储工具 ==========
function getQweatherHost() {
  const raw = (localStorage.getItem('qweather_host') || '').trim();
  if (!raw) return '';
  // Host 必须带 scheme；用户漏填时自动补 https://，避免拼出非法 URL
  if (!/^https?:\/\//i.test(raw)) return 'https://' + raw.replace(/^\/+/, '');
  return raw;
}
function getQweatherKey() {
  return localStorage.getItem('qweather_key') || '';
}
// 鉴权方式：header（X-QW-Api-Key，默认）或 query（?key=，CORS 不支持自定义头时的回退）
function getQweatherAuth() {
  return localStorage.getItem('qweather_auth') === 'query' ? 'query' : 'header';
}
function setQweatherAuth(mode) {
  if (mode === 'query') localStorage.setItem('qweather_auth', 'query');
  else localStorage.removeItem('qweather_auth');
}
function setQweatherHost(host) {
  if (host && host.trim() !== '') {
    localStorage.setItem('qweather_host', host.trim().replace(/\/+$/, ''));
  } else {
    localStorage.removeItem('qweather_host');
  }
  updateStatus();
}
function setQweatherKey(key) {
  if (key && key.trim() !== '') {
    localStorage.setItem('qweather_key', key.trim());
  } else {
    localStorage.removeItem('qweather_key');
  }
  updateStatus();
}
function updateStatus() {
  const statusEl = document.getElementById('keyStatus');
  const host = getQweatherHost();
  const key = getQweatherKey();
  if (host && key) {
    statusEl.textContent = '✓ 已设置';
    statusEl.className = 'key-status set';
  } else {
    statusEl.textContent = '未设置';
    statusEl.className = 'key-status';
  }
}

// ========== 温度单位 °C/°F（优化 #8）==========
function getTempUnit() {
  return localStorage.getItem('temp_unit') === 'f' ? 'f' : 'c';
}
function setTempUnit(unit) {
  if (unit === 'f') localStorage.setItem('temp_unit', 'f');
  else localStorage.removeItem('temp_unit');
}
function cToF(c) { return c * 9 / 5 + 32; }
function fmtTemp(c, { withUnit = false } = {}) {
  if (c == null || isNaN(c)) return withUnit ? '--' : '--';
  const unit = getTempUnit();
  const v = unit === 'f' ? cToF(c) : c;
  const n = Math.round(v * 10) / 10;
  const shown = Number.isInteger(n) ? String(n) : n.toFixed(1);
  if (!withUnit) return shown;
  return unit === 'f' ? `${shown}°F` : `${shown}°C`;
}
function tempUnitLabel() { return getTempUnit() === 'f' ? '°F' : '°C'; }

// ========== 主题 深色/浅色（优化 #8）==========
function getTheme() {
  const t = localStorage.getItem('theme');
  if (t === 'dark' || t === 'light') return t;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function setTheme(theme) {
  if (theme === 'dark') localStorage.setItem('theme', 'dark');
  else localStorage.removeItem('theme');
  document.documentElement.setAttribute('data-theme', getTheme());
  const themeColor = theme === 'dark' ? '#0f172a' : '#1E88E5';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor);
}
function applyInitialTheme() {
  document.documentElement.setAttribute('data-theme', getTheme());
  const themeColor = getTheme() === 'dark' ? '#0f172a' : '#1E88E5';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeColor);
}
applyInitialTheme();

// ========== 收藏城市 / 最近搜索（优化 #9）==========
function getCities() {
  try {
    return JSON.parse(localStorage.getItem('favorites') || '[]');
  } catch (e) { return []; }
}
function saveFavorites(list) {
  localStorage.setItem('favorites', JSON.stringify(list));
}
function getRecents() {
  try {
    return JSON.parse(localStorage.getItem('recents') || '[]');
  } catch (e) { return []; }
}
function saveRecents(list) {
  localStorage.setItem('recents', JSON.stringify(list.slice(0, 8)));
}
function cityKey(c) { return `${Math.round(c.lat * 100)}_${Math.round(c.lon * 100)}`; }
function isFavorite(c) {
  return getCities().some(f => cityKey(f) === cityKey(c));
}
function toggleFavorite(c) {
  const list = getCities();
  const idx = list.findIndex(f => cityKey(f) === cityKey(c));
  if (idx >= 0) list.splice(idx, 1);
  else list.push({ lat: c.lat, lon: c.lon, name: c.name });
  saveFavorites(list);
  renderCitiesPanel();
}
function pushRecent(c) {
  const entry = { lat: c.lat, lon: c.lon, name: c.name };
  const list = getRecents().filter(r => cityKey(r) !== cityKey(entry));
  list.unshift(entry);
  saveRecents(list);
}

// ========== 429 限额冷却（优化 #12）==========
let quotaCooldownUntil = 0;
function noteQuotaHit() {
  quotaCooldownUntil = Date.now() + 60 * 1000;
  showToast('请求过于频繁（429），已进入 1 分钟冷却', { type: 'error', ms: 5000 });
}
function inQuotaCooldown() { return Date.now() < quotaCooldownUntil; }

// ========== Toast（优化 #12 / #13）==========
function showToast(message, { type = '', ms = 3500, actions = [] } = {}) {
  let host = document.getElementById('toastHost');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toastHost';
    host.className = 'toast-host';
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const text = document.createElement('span');
  text.textContent = message;
  el.appendChild(text);
  if (actions.length) {
    const box = document.createElement('div');
    box.className = 'toast-actions';
    actions.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', () => { a.onClick(); el.remove(); });
      box.appendChild(b);
    });
    el.appendChild(box);
  }
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

// ========== 配置 ==========
const DEFAULT_LAT = 39.9042;
const DEFAULT_LON = 116.4074;
let currentLat = DEFAULT_LAT;
let currentLon = DEFAULT_LON;
let currentCityName = '北京';
let weatherLoaded = false;
let userChoseCity = localStorage.getItem('userChoseCity') === '1';
let loadSeq = 0;
let lastRefreshTime = 0;
let lastUserLoad = 0;
const USER_LOAD_THROTTLE = 5000;
let cacheHitThisLoad = false;
let cacheHitAt = 0;
// header 鉴权网络/CORS 失败时，本页最多自动回退一次到 query，避免无限重试
let authFallbackTried = false;
// 展开态：240h / 10天（优化 #7）
let hourlyExpanded = false;
let dailyExpanded = false;
let hourlyHours = 24;
let dailyDays = 7;

// DOM 元素
const cityNameEl = document.getElementById('cityName');
const tempNowEl = document.getElementById('tempNow');
const weatherDescEl = document.getElementById('weatherDesc');
const highLowEl = document.getElementById('highLow');
const humidityEl = document.getElementById('humidity');
const windSpeedEl = document.getElementById('windSpeed');
const feelsLikeEl = document.getElementById('feelsLike');
const aqiEl = document.getElementById('aqi');
const cloudEl = document.getElementById('cloud');
const visibilityEl = document.getElementById('visibility');
const pressureEl = document.getElementById('pressure');
const precipEl = document.getElementById('precip');
const installBtn = document.getElementById('installBtn');
const alertCard = document.getElementById('alertCard');
const alertContent = document.getElementById('alertContent');
const hourlyContainer = document.getElementById('hourlyContainer');
const dailyContainer = document.getElementById('dailyContainer');
const refreshBtn = document.getElementById('refreshBtn');
const searchBtn = document.getElementById('searchBtn');
const searchInput = document.getElementById('searchInput');
const settingsBtn = document.getElementById('settingsBtn');
const indicesCard = document.getElementById('indicesCard');
const indicesGrid = document.getElementById('indicesGrid');
const minutelyCard = document.getElementById('minutelyCard');
const minutelyContainer = document.getElementById('minutelyContainer');
const minutelyAxis = document.getElementById('minutelyAxis');
const minutelySummary = document.getElementById('minutelySummary');
const locateBtn = document.getElementById('locateBtn');
const updatedAtEl = document.getElementById('updatedAt');
const cacheBadge = document.getElementById('cacheBadge');
const footerEl = document.getElementById('footer');
const attrToggle = document.getElementById('attrToggle');
const attrList = document.getElementById('attrList');
const cityPickerOverlay = document.getElementById('cityPickerOverlay');
const cityPickerList = document.getElementById('cityPickerList');
const cityPickerCancelBtn = document.getElementById('cityPickerCancelBtn');
const hourlyToggleBtn = document.getElementById('hourlyToggleBtn');
const dailyToggleBtn = document.getElementById('dailyToggleBtn');
const unitToggleBtn = document.getElementById('unitToggleBtn');
const themeToggleBtn = document.getElementById('themeToggleBtn');
const citiesPanel = document.getElementById('citiesPanel');
const citiesBtn = document.getElementById('citiesBtn');
const citiesList = document.getElementById('citiesList');
const searchError = document.getElementById('searchError');

// 设置面板
const settingsOverlay = document.getElementById('settingsOverlay');
const apiHostInput = document.getElementById('apiHostInput');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const settingsError = document.getElementById('settingsError');
const settingsSuccess = document.getElementById('settingsSuccess');

// ========== 图标生成 ==========
const ICON_CODE_RE = /^[0-9]{3}$/;
function getWeatherIcon(iconCode) {
  if (!iconCode || !ICON_CODE_RE.test(String(iconCode))) return '🌡️';
  return `<i class="qi-${String(iconCode)}"></i>`;
}

// ========== 辅助函数 ==========
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function extractHour(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(?:T|\s)(\d{2}):\d{2}/);
  if (match) return parseInt(match[1], 10);
  return null;
}
function extractDate(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${parseInt(match[2], 10)}月${parseInt(match[3], 10)}日`;
  return null;
}
function coord2(v) {
  return Math.round(parseFloat(v) * 100) / 100;
}

// ========== WGS-84 → GCJ-02（优化 #4）==========
// 中国大陆境内 GPS 坐标转火星坐标，避免和风接口位置偏移；境外原样返回
function outOfChina(lat, lon) {
  return lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function transformLat(x, y) {
  let ret = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y
    + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  ret += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return ret;
}
function transformLon(x, y) {
  let ret = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y
    + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  ret += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  ret += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return ret;
}
function wgs84ToGcj02(lat, lon) {
  if (outOfChina(lat, lon)) return { lat, lon };
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const dLat = transformLat(lon - 105.0, lat - 35.0);
  const dLon = transformLon(lon - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
  dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}
// API 请求统一用 GCJ-02（境外自动透传 WGS）
function apiCoords() {
  const g = wgs84ToGcj02(currentLat, currentLon);
  return { lat: coord2(g.lat), lon: coord2(g.lon) };
}

// ========== v1 接口辅助 ==========
function isApiError(data) {
  return !data || (data.code != null && String(data.code) !== '200');
}

const WIND_COMPASS = {
  n: '北', nne: '北东北', ne: '东北', ene: '东东北',
  e: '东', ese: '东东南', se: '东南', sse: '南东南',
  s: '南', ssw: '南西南', sw: '西南', wsw: '西西南',
  w: '西', wnw: '西西北', nw: '西北', nnw: '北西北',
  vrb: '不定向', none: '无风'
};
// 风速：m/s 为主单位 + 蒲福风级（优化 #5）
function windSpeedMs(wind) {
  if (!wind || wind.speed == null || wind.speed.value == null) return '';
  let ms = parseFloat(wind.speed.value);
  if (isNaN(ms)) return '';
  if (wind.speed.unit === 'km/h') ms = ms / 3.6;
  else if (wind.speed.unit === 'mph') ms = ms * 0.44704;
  else if (wind.speed.unit === 'kn') ms = ms * 0.514444;
  return ms;
}
function windLabel(wind) {
  if (!wind) return '--';
  const compass = wind.direction && wind.direction.compass
    ? (WIND_COMPASS[wind.direction.compass] || wind.direction.compass) : '';
  const ms = windSpeedMs(wind);
  const speedPart = ms !== '' ? `${ms.toFixed(1)} m/s` : '';
  const scale = wind.scale != null ? `${wind.scale}级` : '';
  return [compass, speedPart, scale].filter(Boolean).join(' ') || '--';
}

function pct(v) {
  if (v == null || isNaN(v)) return null;
  return Math.round(v * 100);
}
function hhmm(timeStr) {
  if (!timeStr) return '';
  const m = String(timeStr).match(/T(\d{2}:\d{2})/);
  return m ? m[1] : '';
}
function locationNowHour(sampleTimeStr) {
  if (!sampleTimeStr) return new Date().getHours();
  let offsetMin = 0;
  if (/Z$/.test(sampleTimeStr)) {
    offsetMin = 0;
  } else {
    const m = sampleTimeStr.match(/([+-])(\d{2}):(\d{2})$/);
    if (m) {
      offsetMin = (m[1] === '-' ? -1 : 1) * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
    } else {
      return new Date().getHours();
    }
  }
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcMs + offsetMin * 60000).getHours();
}

// 归因折叠页脚（优化 #2）
let attributionParts = [];
function updateAttribution(...datas) {
  const parts = ['数据源: 和风天气 · 个人PWA'];
  const seen = new Set();
  datas.forEach(d => {
    const attrs = d && d.metadata && d.metadata.attributions;
    if (Array.isArray(attrs)) {
      attrs.forEach(a => {
        if (a && typeof a === 'string' && !seen.has(a)) {
          seen.add(a);
          parts.push(a);
        }
      });
    }
  });
  attributionParts = parts;
  renderFooter();
}
function renderFooter() {
  if (!footerEl) return;
  footerEl.innerHTML = '';
  const main = document.createElement('span');
  main.textContent = attributionParts[0] || '数据源: 和风天气 · 个人PWA';
  footerEl.appendChild(main);
  if (attributionParts.length > 1) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'attr-toggle';
    toggle.id = 'attrToggle';
    toggle.textContent = '数据来源详情 ▾';
    toggle.setAttribute('aria-expanded', attrList && attrList.classList.contains('open') ? 'true' : 'false');
    toggle.addEventListener('click', () => {
      if (!attrList) return;
      const open = attrList.classList.toggle('open');
      toggle.textContent = open ? '数据来源详情 ▴' : '数据来源详情 ▾';
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    footerEl.appendChild(document.createElement('br'));
    footerEl.appendChild(toggle);
    if (!attrList) {
      attrList = document.createElement('ul');
      attrList.id = 'attrList';
      attrList.className = 'attr-list';
      footerEl.appendChild(attrList);
    }
    attrList.innerHTML = '';
    attributionParts.slice(1).forEach(p => {
      const li = document.createElement('li');
      li.textContent = p;
      attrList.appendChild(li);
    });
  }
}

// ========== 鉴权 URL 构建（优化 #1：header 优先）==========
// header 模式：key 走 X-QW-Api-Key，URL 不带 key（避免泄漏进日志/缓存键）
// query 模式：CORS 不允许自定义头时回退 ?key=
function buildApiUrl(base, path, params = {}) {
  // 绝不把 new URL 的异常抛给调用方：旧版是字符串拼接不会抛，
  // 一旦抛错会整批打断 Promise.all，表现为「天气数据加载失败」toast
  let u;
  try {
    let href;
    if (path.startsWith('http')) {
      href = path;
    } else {
      let b = String(base == null ? '' : base).trim().replace(/\/+$/, '');
      // 'https://'.replace(/\/+$/, '') 会变成 'https:'，补回斜杠避免非法 URL
      if (b === 'https:' || b === 'http:') b += '//';
      if (b && !/^https?:\/\//i.test(b)) b = 'https://' + b.replace(/^\/+/, '');
      href = b + path;
    }
    u = new URL(href);
  } catch (e) {
    try {
      u = new URL(path, location.href);
    } catch (e2) {
      console.warn('buildApiUrl 双重回退失败:', e, e2);
      return path;
    }
  }
  Object.entries(params).forEach(([k, v]) => {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  });
  if (getQweatherAuth() === 'query') {
    u.searchParams.set('key', getQweatherKey());
  }
  return u.href;
}
function authHeaders() {
  if (getQweatherAuth() === 'header' && getQweatherKey()) {
    return { 'X-QW-Api-Key': getQweatherKey() };
  }
  return {};
}

// ========== 安全请求 ==========
const FETCH_TIMEOUT = 12000;
async function safeFetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    let target = url;
    const headers = {};
    // header 模式下若 URL 仍残留 key（老调用点），迁到 header
    if (getQweatherAuth() === 'header' && getQweatherKey()) {
      try {
        const u = new URL(target, location.href);
        if (u.searchParams.has('key')) {
          u.searchParams.delete('key');
          target = u.href;
        }
      } catch (e) { /* 相对 URL 等忽略 */ }
      Object.assign(headers, authHeaders());
    }
    const res = await fetch(target, {
      signal: controller.signal,
      headers: Object.keys(headers).length ? headers : undefined
    });
    if (res.headers.get('x-sw-cached') === '1') {
      cacheHitThisLoad = true;
      const at = parseInt(res.headers.get('x-sw-cached-at') || '0', 10);
      if (at > cacheHitAt) cacheHitAt = at;
    }
    if (res.status === 429) {
      noteQuotaHit();
    }
    if (!res.ok) {
      let errorBody;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { code: String(res.status), msg: res.statusText };
      }
      if (errorBody && errorBody.error && errorBody.error.status) {
        errorBody.code = String(errorBody.error.status);
        errorBody.msg = errorBody.error.title || errorBody.error.detail || '';
      }
      if (String(errorBody.code) === '429') noteQuotaHit();
      return errorBody;
    }
    return await res.json();
  } catch (e) {
    return { code: 'network_error', msg: e.name === 'AbortError' ? '请求超时' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ========== 保存时探测 Key（优化 #11）==========
async function probeQweather(host, key) {
  let base = (host || '').trim().replace(/\/+$/, '');
  if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base.replace(/^\/+/, '');
  if (!base || !key) return { ok: false, code: 'missing', msg: '请填写 Host 与 Key' };
  const probePath = '/geo/v2/city/lookup';
  const tryFetch = async (mode) => {
    let u;
    try {
      u = new URL(base + probePath);
      u.searchParams.set('location', '116.41,39.92');
      u.searchParams.set('lang', 'zh-hans');
      if (mode === 'query') u.searchParams.set('key', key);
    } catch (e) {
      return { ok: false, network: true, msg: 'Host 无效，无法构造探测地址' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(u.href, {
        signal: controller.signal,
        headers: mode === 'header' ? { 'X-QW-Api-Key': key } : undefined
      });
      let body;
      try { body = await res.json(); } catch { body = {}; }
      if (res.status === 429) return { ok: false, code: '429', msg: '请求过于频繁' };
      if (body && body.code && body.code !== '200') {
        return { ok: false, code: String(body.code), msg: body.msg || 'Key 无效或无权限' };
      }
      if (body && body.location && body.location.length) return { ok: true, mode };
      if (res.ok) return { ok: true, mode };
      return { ok: false, code: String(res.status), msg: body.msg || `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, network: true, msg: e.name === 'AbortError' ? '探测超时' : '网络或 CORS 失败' };
    } finally {
      clearTimeout(timer);
    }
  };
  // 先 header，CORS/网络失败再试 query
  let r = await tryFetch('header');
  if (!r.ok && r.network) {
    r = await tryFetch('query');
  }
  if (r.ok) setQweatherAuth(r.mode || 'header');
  return r;
}

// ========== 反向地理编码 ==========
async function fetchCityName(lat, lon) {
  const host = getQweatherHost();
  const key = getQweatherKey();
  if (!host || !key) return '';
  const base = host.replace(/\/+$/, '');
  const c = wgs84ToGcj02(lat, lon);
  const url = buildApiUrl(base, '/geo/v2/city/lookup', {
    location: `${coord2(c.lon)},${coord2(c.lat)}`,
    lang: 'zh-hans'
  });
  try {
    const data = await safeFetchJson(url);
    if (data.code === '200' && data.location && data.location.length > 0) {
      return data.location[0].name;
    }
    return '';
  } catch (e) {
    console.warn('反向地理编码失败:', e);
    return '';
  }
}

// ========== 搜索城市（优化 #10：防抖 + 行内错误）==========
let searchDebounceTimer = 0;
function showSearchError(msg) {
  if (!searchError) return;
  searchError.textContent = msg;
  searchError.classList.add('show');
  clearTimeout(searchError._hideTimer);
  searchError._hideTimer = setTimeout(() => searchError.classList.remove('show'), 5000);
}
function hideSearchError() {
  if (!searchError) return;
  searchError.classList.remove('show');
}
function applyChosenCity(r) {
  currentLat = coord2(parseFloat(r.lat));
  currentLon = coord2(parseFloat(r.lon));
  currentCityName = r.name;
  cityNameEl.innerText = currentCityName;
  weatherLoaded = true;
  userChoseCity = true;
  localStorage.setItem('userChoseCity', '1');
  const entry = { lat: currentLat, lon: currentLon, name: currentCityName };
  localStorage.setItem('lastCity', JSON.stringify(entry));
  pushRecent(entry);
  hideSearchError();
  if (searchInput) searchInput.value = '';
  loadAllWeather(true);
}

function showCityPicker(list) {
  cityPickerList.innerHTML = '';
  list.forEach(r => {
    const btn = document.createElement('button');
    btn.className = 'city-pick-item';
    btn.type = 'button';
    btn.textContent = [r.name, r.admin, r.country].filter(Boolean).join(' · ');
    btn.onclick = () => {
      cityPickerOverlay.classList.remove('active');
      applyChosenCity(r);
    };
    cityPickerList.appendChild(btn);
  });
  cityPickerOverlay.classList.add('active');
}

async function searchCity(query) {
  if (!query) return;
  const host = getQweatherHost();
  const key = getQweatherKey();
  if (!host || !key) {
    showSearchError('请先在设置中配置 API Host 和 Key');
    openSettings();
    return;
  }
  searchBtn.disabled = true;
  const base = host.replace(/\/+$/, '');
  const url = buildApiUrl(base, '/geo/v2/city/lookup', {
    location: query,
    number: 10,
    lang: 'zh-hans'
  });
  try {
    const data = await safeFetchJson(url);
    if (data.code === '429') {
      showSearchError('请求过于频繁，请稍后再试');
    } else if (data.code === '200' && data.location && data.location.length > 0) {
      if (data.location.length > 1) {
        showCityPicker(data.location);
      } else {
        applyChosenCity(data.location[0]);
      }
    } else if (data.code === 'network_error') {
      showSearchError('网络错误，请稍后重试');
    } else {
      showSearchError(`未找到“${query}”，试试拼音或更具体的名称`);
    }
  } catch (error) {
    console.error('城市搜索失败:', error);
    showSearchError('城市搜索失败，请检查网络');
  } finally {
    searchBtn.disabled = false;
  }
}

// ========== 城市面板（收藏 / 最近，优化 #9）==========
function renderCitiesPanel() {
  if (!citiesList) return;
  const current = { lat: currentLat, lon: currentLon, name: currentCityName };
  const favs = getCities();
  const recents = getRecents();
  citiesList.innerHTML = '';

  const mkRow = (c, { star = false } = {}) => {
    const row = document.createElement('div');
    row.className = 'city-row';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'city-pick-item';
    btn.textContent = c.name;
    btn.setAttribute('aria-current', cityKey(c) === cityKey(current) ? 'true' : 'false');
    btn.onclick = () => {
      citiesPanel.classList.remove('active');
      applyChosenCity(c);
    };
    row.appendChild(btn);
    if (star) {
      const s = document.createElement('button');
      s.type = 'button';
      s.className = 'city-star' + (isFavorite(c) ? ' active' : '');
      s.textContent = isFavorite(c) ? '★' : '☆';
      s.setAttribute('aria-label', isFavorite(c) ? `取消收藏 ${c.name}` : `收藏 ${c.name}`);
      s.onclick = () => toggleFavorite(c);
      row.appendChild(s);
    }
    return row;
  };

  // 当前城市：可收藏
  const curTitle = document.createElement('div');
  curTitle.className = 'cities-group-title';
  curTitle.textContent = '当前';
  citiesList.appendChild(curTitle);
  citiesList.appendChild(mkRow(current, { star: true }));

  if (favs.length) {
    const t = document.createElement('div');
    t.className = 'cities-group-title';
    t.textContent = '收藏';
    citiesList.appendChild(t);
    favs.forEach(c => citiesList.appendChild(mkRow(c, { star: true })));
  }
  if (recents.length) {
    const t = document.createElement('div');
    t.className = 'cities-group-title';
    t.textContent = '最近';
    citiesList.appendChild(t);
    recents.forEach(c => {
      if (cityKey(c) === cityKey(current)) return;
      citiesList.appendChild(mkRow(c, { star: true }));
    });
  }
}

// ========== 定位 ==========
// 定位看门狗：权限弹窗挂起或个别浏览器不回调 timeout 时，强制走回退链，避免一直「定位中...」
const LOCATE_WATCHDOG_MS = 15000;

function restoreLastCity() {
  const lastCity = localStorage.getItem('lastCity');
  if (!lastCity) return false;
  try {
    const c = JSON.parse(lastCity);
    if (c.lat == null || c.lon == null) return false;
    currentLat = parseFloat(c.lat);
    currentLon = parseFloat(c.lon);
    currentCityName = c.name;
    cityNameEl.innerText = currentCityName;
    weatherLoaded = true;
    loadAllWeather();
    return true;
  } catch (e) {
    return false;
  }
}

function fallbackToLastCity() {
  if (userChoseCity) return false;
  return restoreLastCity();
}

async function getIpLocation() {
  if (userChoseCity) return false;
  try {
    const data = await safeFetchJson('https://api.bigdatacloud.net/data/reverse-geocode-client?localityLanguage=zh');
    if (userChoseCity) return false;
    if (data && data.latitude != null && data.longitude != null) {
      currentLat = data.latitude;
      currentLon = data.longitude;
      currentCityName = data.city || data.locality || data.principalSubdivision || '当前位置';
      cityNameEl.innerText = currentCityName;
      try {
        localStorage.setItem('lastCity', JSON.stringify({ lat: currentLat, lon: currentLon, name: currentCityName }));
      } catch (e) { /* 隐私模式忽略 */ }
      weatherLoaded = true;
      loadAllWeather();
      return true;
    }
  } catch (e) {
    console.warn('IP 定位失败:', e);
  }
  return false;
}

function getCurrentPosition() {
  let settled = false;
  let watchdogTimer = 0;
  const clearWatchdog = () => { clearTimeout(watchdogTimer); watchdogTimer = 0; };

  const tryFallbacks = (err) => {
    if (settled) return;
    settled = true;
    clearWatchdog();
    console.warn('定位失败:', err);
    if (userChoseCity) return;
    cityNameEl.innerText = '定位中...';
    getIpLocation().then(ok => {
      if (userChoseCity) return;
      if (!ok && !fallbackToLastCity()) {
        cityNameEl.innerText = '📍 无法定位，请手动搜索';
        weatherLoaded = false;
      }
    }).catch(() => {
      if (userChoseCity) return;
      if (!fallbackToLastCity()) {
        cityNameEl.innerText = '📍 无法定位，请手动搜索';
        weatherLoaded = false;
      }
    });
  };

  // 总看门狗：权限弹窗一直未处理 / 回调丢失时兜底
  watchdogTimer = setTimeout(() => {
    if (!settled) tryFallbacks(new Error('定位看门狗超时'));
  }, LOCATE_WATCHDOG_MS);

  if (!navigator.geolocation) {
    tryFallbacks(new Error('geolocation 不支持'));
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (settled || userChoseCity) return;
      settled = true;
      clearWatchdog();
      try {
        currentLat = pos.coords.latitude;
        currentLon = pos.coords.longitude;
      } catch (e) {
        tryFallbacks(e);
        return;
      }
      // 先立刻出结果，反查城市名不阻塞首屏（safeFetchJson 自带超时）
      currentCityName = '当前位置';
      cityNameEl.innerText = currentCityName;
      weatherLoaded = true;
      loadAllWeather();
      fetchCityName(currentLat, currentLon).then(name => {
        if (userChoseCity) return;
        if (name) {
          currentCityName = name;
          cityNameEl.innerText = currentCityName;
          try {
            localStorage.setItem('lastCity', JSON.stringify({ lat: currentLat, lon: currentLon, name: currentCityName }));
          } catch (e) { /* 忽略 */ }
          pushRecent({ lat: currentLat, lon: currentLon, name: currentCityName });
        }
      }).catch(() => { /* 城市名反查失败不影响天气 */ });
      const firstLat = currentLat, firstLon = currentLon;
      navigator.geolocation.getCurrentPosition(
        (pos2) => {
          if (userChoseCity) return;
          const dLat = Math.abs(pos2.coords.latitude - firstLat);
          const dLon = Math.abs(pos2.coords.longitude - firstLon);
          if (dLat < 0.001 && dLon < 0.001) return;
          currentLat = pos2.coords.latitude;
          currentLon = pos2.coords.longitude;
          loadAllWeather();
        },
        () => {},
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    },
    tryFallbacks,
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
  );
}

// ========== 核心加载 ==========
async function fetchAqi(base, lat, lon, force) {
  try {
    const c = wgs84ToGcj02(lat, lon);
    const path = `/airquality/v1/current/${coord2(c.lat)}/${coord2(c.lon)}`;
    const url = buildApiUrl(base, path, force ? { _force: '1' } : {});
    return await safeFetchJson(url);
  } catch (e) {
    // 单路失败不能 reject 掉整个 Promise.all
    console.warn('AQI 请求构造失败:', e);
    return { code: 'network_error', msg: e && e.message };
  }
}

async function loadAllWeather(force) {
  if (inQuotaCooldown() && force) {
    showToast('仍在 429 冷却中，请稍候再刷新', { type: 'error', ms: 3000 });
    return;
  }
  const mySeq = ++loadSeq;
  showLoading();
  cacheHitThisLoad = false;
  cacheHitAt = 0;
  try {
    const host = getQweatherHost();
    const key = getQweatherKey();

    if (!host || !key) {
      showToast('请先点击齿轮设置 API Host 和 Key', { type: 'error' });
      openSettings();
      hideLoading();
      return;
    }

    const base = host.replace(/\/+$/, '');
    const forceParam = force ? '1' : '';
    const coords = apiCoords();
    const latPath = coords.lat;
    const lonPath = coords.lon;
    const commonQuery = {
      location: `${lonPath},${latPath}`,
      lang: 'zh-hans'
    };
    if (force) commonQuery._force = '1';

    const hours = hourlyExpanded ? 240 : 24;
    const days = dailyExpanded ? 10 : 7;
    hourlyHours = hours;
    dailyDays = days;

    // 先全部构 URL（buildApiUrl 已兜底不抛），再发起请求
    const nowUrl = buildApiUrl(base, `/weather/v1/current/${latPath}/${lonPath}`, {
      lang: 'zh-hans', _force: forceParam || undefined
    });
    const hourlyUrl = buildApiUrl(base, `/weather/v1/hourly/${latPath}/${lonPath}`, {
      hours, localTime: 'true', lang: 'zh-hans', _force: forceParam || undefined
    });
    const dailyUrl = buildApiUrl(base, `/weather/v1/daily/${latPath}/${lonPath}`, {
      days, localTime: 'true', lang: 'zh-hans', _force: forceParam || undefined
    });
    const warningUrl = buildApiUrl(base, `/weatheralert/v1/current/${latPath}/${lonPath}`, {
      lang: 'zh-hans', _force: forceParam || undefined
    });
    const indicesUrl = buildApiUrl(base, '/v7/indices/1d', {
      ...commonQuery,
      type: '1,3,5,6,7,8,9,10,13,14,15,16'
    });
    const minutelyUrl = buildApiUrl(base, '/v7/minutely/5m', commonQuery);

    const [nowData, hourlyData, dailyData, aqiData, warningData, indicesData, minutelyData] = await Promise.all([
      safeFetchJson(nowUrl),
      safeFetchJson(hourlyUrl),
      safeFetchJson(dailyUrl),
      fetchAqi(base, currentLat, currentLon, force),
      safeFetchJson(warningUrl),
      safeFetchJson(indicesUrl),
      safeFetchJson(minutelyUrl)
    ]);

    if (mySeq !== loadSeq) return;

    // header 模式整批网络失败（典型为 CORS 拒绝自定义头）→ 自动改 query?key= 重试一次
    const allNetworkError = [nowData, hourlyData, dailyData, warningData, indicesData]
      .every(d => d && d.code === 'network_error');
    if (allNetworkError && !authFallbackTried && getQweatherAuth() === 'header' && getQweatherKey()) {
      authFallbackTried = true;
      setQweatherAuth('query');
      showToast('接口请求失败，已自动切换为 query 鉴权重试', { ms: 4000 });
      await loadAllWeather(force);
      return;
    }

    // 每个渲染单独兜底：单块数据异常不能整页报「加载失败」
    const safeRender = (label, fn, ...args) => {
      try { fn(...args); } catch (e) { console.error(label, e); }
    };
    safeRender('renderCurrentWeather', renderCurrentWeather, nowData, dailyData);
    safeRender('renderHourly', renderHourly, hourlyData);
    safeRender('renderDaily', renderDaily, dailyData);
    safeRender('renderAqi', renderAqi, aqiData);
    safeRender('renderWarning', renderWarning, warningData);
    safeRender('renderIndices', renderIndices, indicesData);
    safeRender('renderMinutely', renderMinutely, minutelyData, coords);
    safeRender('updateAttribution', updateAttribution, nowData, hourlyData, dailyData, aqiData, warningData);

    lastRefreshTime = Date.now();
    try {
      const t = new Date();
      if (updatedAtEl) {
        updatedAtEl.textContent = `更新于 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      }
      if (cacheBadge) {
        if (cacheHitThisLoad) {
          cacheBadge.style.display = '';
          if (cacheHitAt) {
            const d = new Date(cacheHitAt);
            cacheBadge.textContent = `缓存 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          } else {
            cacheBadge.textContent = '缓存';
          }
        } else {
          cacheBadge.style.display = 'none';
        }
      }
    } catch (e) {
      console.warn('更新时间/缓存徽标渲染失败:', e);
    }
  } catch (error) {
    if (mySeq !== loadSeq) return;
    console.error('loadAllWeather 失败:', error);
    const detail = error && error.message ? `（${error.message}）` : '';
    showToast(`天气数据加载失败，请检查网络或配置${detail}`, { type: 'error', ms: 5000 });
  } finally {
    if (mySeq === loadSeq) {
      hideLoading();
    }
  }
}

// ========== 渲染函数 ==========
function renderCurrentWeather(data, dailyData) {
  if (isApiError(data) || !data.condition || !data.temperature) {
    tempNowEl.innerHTML = `--<small>${tempUnitLabel()}</small>`;
    weatherDescEl.innerHTML = '暂无';
    highLowEl.innerHTML = `最高 -- / 最低 --`;
    humidityEl.innerText = '--%';
    windSpeedEl.innerText = '--';
    feelsLikeEl.innerText = '--';
    cloudEl.innerText = '--';
    visibilityEl.innerText = '--';
    pressureEl.innerText = '-- hPa';
    precipEl.innerText = '-- mm';
    return;
  }
  tempNowEl.innerHTML = `${fmtTemp(data.temperature.value)}<small>${tempUnitLabel()}</small>`;
  weatherDescEl.innerHTML = `${getWeatherIcon(data.condition.code)} ${esc(data.condition.text)}`;

  const today = dailyData && dailyData.days && dailyData.days[0];
  if (today && today.temperatureMax && today.temperatureMax.value != null
      && today.temperatureMin && today.temperatureMin.value != null) {
    highLowEl.innerHTML = `最高 ${fmtTemp(today.temperatureMax.value)} / 最低 ${fmtTemp(today.temperatureMin.value)}`;
  } else {
    highLowEl.innerHTML = '最高 -- / 最低 --';
  }

  const humidity = pct(data.humidity);
  humidityEl.innerText = humidity != null ? `${humidity}%` : '--%';
  windSpeedEl.innerText = windLabel(data.wind);
  feelsLikeEl.innerText = data.feelsLike && data.feelsLike.value != null ? fmtTemp(data.feelsLike.value) : '--';
  const cloud = pct(data.cloudCover);
  cloudEl.innerText = cloud != null ? `${cloud}%` : '--';
  if (data.visibility && data.visibility.value != null) {
    visibilityEl.innerText = `${(data.visibility.value / 1000).toFixed(1)} km`;
  } else {
    visibilityEl.innerText = '--';
  }
  pressureEl.innerText = data.pressure && data.pressure.value != null ? `${data.pressure.value} hPa` : '-- hPa';
  const precip = data.precipitation && data.precipitation.amount;
  precipEl.innerText = precip && precip.value != null ? `${precip.value} mm` : '-- mm';
}

function renderHourly(data) {
  if (isApiError(data) || !Array.isArray(data.hours) || data.hours.length === 0) {
    hourlyContainer.innerHTML = `<div class="empty">${data && data.code === 'network_error' ? '小时预报获取失败' : '暂无小时预报'}</div>`;
    return;
  }
  const hours = data.hours.slice(0, hourlyHours);
  const currentHour = locationNowHour(hours[0] && hours[0].forecastTime);
  let firstDate = null;
  hourlyContainer.innerHTML = '';
  hours.forEach((h, idx) => {
    const hour = h.forecastTime ? extractHour(h.forecastTime) : null;
    const date = h.forecastTime ? extractDate(h.forecastTime) : null;
    if (idx === 0) firstDate = date;
    let displayHour;
    if (hour !== null) {
      displayHour = hour === currentHour && idx === 0 ? '现在' : `${hour}:00`;
      if (date && firstDate && date !== firstDate) {
        displayHour = `${date} ${displayHour}`;
      }
    } else {
      displayHour = '--:00';
    }
    const temp = h.temperature ? fmtTemp(h.temperature.value) : '--';
    const pop = pct(h.precipitation && h.precipitation.probability) || 0;
    const precipMm = h.precipitation && h.precipitation.amount ? (h.precipitation.amount.value || 0) : 0;
    const condText = h.condition ? h.condition.text : '';
    const iconCode = h.condition ? h.condition.code : '';
    const div = document.createElement('div');
    div.className = 'hour-item';
    div.title = `${condText} · ${windLabel(h.wind)} · 降水 ${pop}% · 雨量 ${precipMm} mm`;
    div.innerHTML = `
      <div class="hour-time">${esc(displayHour)}</div>
      <div class="hour-icon">${getWeatherIcon(iconCode)}</div>
      <div class="hour-temp">${esc(temp)}</div>
      <div class="hour-rain">💧${esc(pop)}%</div>
    `;
    hourlyContainer.appendChild(div);
  });
}

function renderDaily(data) {
  if (isApiError(data) || !Array.isArray(data.days) || data.days.length === 0) {
    dailyContainer.innerHTML = `<div class="empty">${data && data.code === 'network_error' ? '逐日预报获取失败' : '暂无逐日预报'}</div>`;
    return;
  }
  dailyContainer.innerHTML = '';
  data.days.forEach((d, idx) => {
    const localStart = d.forecastStartTime || '';
    let dateDisplay = '';
    if (idx === 0) {
      dateDisplay = '今天';
    } else {
      const dateStr = localStart ? extractDate(localStart) : null;
      dateDisplay = dateStr || '未知日期';
    }
    const day = d.daytime || {};
    const night = d.nighttime || {};
    const row = document.createElement('div');
    row.className = 'daily-row';
    const iconCode = day.condition ? day.condition.code : '';
    const weatherText = day.condition ? day.condition.text : '';
    const nightText = night.condition ? night.condition.text : '';
    const pop = day.precipitation ? pct(day.precipitation.probability) : null;
    const humidity = pct(day.humidity);
    const sunrise = d.astro ? hhmm(d.astro.sunrise) : '';
    const sunset = d.astro ? hhmm(d.astro.sunset) : '';
    const tooltip = [
      nightText ? `夜间 ${nightText}` : '',
      pop != null ? `降水概率 ${pop}%` : '',
      d.uvIndexMax != null ? `紫外线 ${d.uvIndexMax}` : '',
      humidity != null ? `湿度 ${humidity}%` : '',
      sunrise && sunset ? `日出 ${sunrise} · 日落 ${sunset}` : '',
      day.wind ? `${windLabel(day.wind)}` : ''
    ].filter(Boolean).join(' · ');
    if (tooltip) row.title = tooltip;
    const tempMax = d.temperatureMax ? fmtTemp(d.temperatureMax.value) : '--';
    const tempMin = d.temperatureMin ? fmtTemp(d.temperatureMin.value) : '--';
    row.innerHTML = `
      <div class="daily-date">${esc(dateDisplay)}</div>
      <div class="daily-icon">${getWeatherIcon(iconCode)}</div>
      <div class="daily-text"></div>
      <div class="daily-temp">${esc(tempMax)} / ${esc(tempMin)}</div>
    `;
    row.querySelector('.daily-text').textContent = weatherText;
    dailyContainer.appendChild(row);
  });
}

function renderAqi(data) {
  const resetAqiStyle = () => {
    aqiEl.style.background = '';
    aqiEl.style.color = '';
    aqiEl.style.padding = '';
    aqiEl.style.borderRadius = '';
  };
  if (!data || data.code === 'network_error') {
    resetAqiStyle();
    aqiEl.innerText = '无数据';
    return;
  }
  if (data.error && data.error.status) {
    resetAqiStyle();
    const status = data.error.status;
    if (status === 400) aqiEl.innerText = '该位置暂无空气质量数据';
    else if (status === 401) aqiEl.innerText = 'Key 无效';
    else if (status === 403) aqiEl.innerText = '需升级订阅或额度不足';
    else if (status === 429) aqiEl.innerText = '请求过于频繁';
    else aqiEl.innerText = `错误 ${status}`;
    return;
  }
  if (data.code && data.code !== '200') {
    resetAqiStyle();
    if (String(data.code) === '429') {
      noteQuotaHit();
      aqiEl.innerText = '请求过于频繁';
    } else {
      aqiEl.innerText = data.code === '403' ? '需升级订阅' : `错误 ${data.code}`;
    }
    return;
  }

  let aqi = null, category = '', color = null;
  if (data.indexes && data.indexes.length > 0) {
    const target = data.indexes.find(i => i.code === 'cn-mee')
      || data.indexes.find(i => i.code === 'us-epa')
      || data.indexes.find(i => i.code !== 'qaqi')
      || data.indexes[0];
    if (target) {
      aqi = target.aqi;
      category = target.category || '';
      color = target.color || null;
    }
  }

  if (aqi == null) {
    resetAqiStyle();
    aqiEl.innerText = '暂不可用';
    return;
  }
  aqiEl.innerText = `${aqi}${category ? ` (${category})` : ''}`;
  if (color) {
    let cssColor = color;
    if (typeof color === 'object' && color.red != null) {
      const { red, green, blue, alpha = 1 } = color;
      cssColor = `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }
    aqiEl.style.background = cssColor;
    aqiEl.style.color = '#fff';
    aqiEl.style.padding = '1px 8px';
    aqiEl.style.borderRadius = '12px';
  }
}

const SEVERITY_CN = {
  minor: '蓝色',
  moderate: '黄色',
  severe: '橙色',
  extreme: '红色',
  unknown: '级别未知'
};
const SEVERITY_COLOR = {
  minor: '#3b82f6',
  moderate: '#eab308',
  severe: '#f97316',
  extreme: '#dc2626',
  unknown: '#9ca3af'
};

function renderWarning(data) {
  if (isApiError(data)) {
    alertCard.style.display = 'block';
    alertContent.innerHTML = '';
    const fail = document.createElement('div');
    fail.textContent = data.code === 'network_error'
      ? '预警获取失败（网络错误），请点刷新重试'
      : `预警获取失败（${data.code || '未知错误'}），请点刷新重试`;
    alertContent.appendChild(fail);
    return;
  }
  const zero = data.metadata && data.metadata.zeroResult === true;
  const alerts = Array.isArray(data.alerts) ? data.alerts : [];
  if (zero || alerts.length === 0) {
    alertCard.style.display = 'none';
    alertContent.innerHTML = '';
    return;
  }
  alertContent.innerHTML = '';
  alerts.forEach(warn => {
    const item = document.createElement('div');
    item.style.marginBottom = '8px';
    const title = document.createElement('div');
    title.style.fontWeight = '600';
    title.textContent = warn.headline || (warn.eventType && warn.eventType.name) || '天气预警';
    if (warn.severity && SEVERITY_COLOR[warn.severity]) {
      const chip = document.createElement('span');
      chip.className = 'severity-chip';
      const fromApiColor = warn.color && warn.color.red != null;
      chip.style.background = fromApiColor
        ? `rgba(${warn.color.red}, ${warn.color.green}, ${warn.color.blue}, ${warn.color.alpha != null ? warn.color.alpha : 1})`
        : SEVERITY_COLOR[warn.severity];
      if (!fromApiColor && warn.severity === 'moderate') chip.classList.add('on-light');
      chip.textContent = SEVERITY_CN[warn.severity] || warn.severity;
      title.appendChild(chip);
    }
    const text = document.createElement('div');
    text.textContent = warn.description || '';
    item.appendChild(title);
    item.appendChild(text);
    if (warn.instruction) {
      const inst = document.createElement('div');
      inst.style.marginTop = '4px';
      inst.textContent = `建议：${warn.instruction}`;
      item.appendChild(inst);
    }
    alertContent.appendChild(item);
  });
  alertCard.style.display = 'block';
}

function renderIndices(data) {
  if (isApiError(data)) {
    indicesCard.style.display = 'block';
    indicesGrid.innerHTML = `<div class="empty">${data.code === 'network_error' ? '生活指数获取失败，请点刷新重试' : `生活指数获取失败（${esc(data.code || '')}）`}</div>`;
    return;
  }
  if (!data.daily || data.daily.length === 0) {
    indicesCard.style.display = 'none';
    return;
  }
  indicesCard.style.display = 'block';
  indicesGrid.innerHTML = '';
  data.daily.forEach(item => {
    const div = document.createElement('div');
    div.className = 'index-item';
    div.innerHTML = `
      <div class="index-name"></div>
      <div class="index-level"></div>
      <div class="index-desc"></div>
    `;
    div.querySelector('.index-name').textContent = item.name;
    const levelText = item.category
      ? (item.level != null ? `${item.category} · ${item.level}` : item.category)
      : (item.level != null ? String(item.level) : '');
    div.querySelector('.index-level').textContent = levelText;
    div.querySelector('.index-desc').textContent = item.text || '';
    indicesGrid.appendChild(div);
  });
}

// 海外分钟降水（优化 #6）：接口不覆盖或坐标在境外时给出分型文案
function minutelyUnsupportedReason(coords, data) {
  const code = data && data.code != null ? String(data.code) : '';
  if (code === 'network_error') return '网络错误，分钟级降水获取失败';
  // 和风分钟降水仅覆盖中国大陆；境外常见 403/404/400
  if (code === '403' || code === '404' || code === '400') {
    if (outOfChina(currentLat, currentLon)) {
      return '该地区暂不支持分钟级降水预报（仅限中国大陆）';
    }
    return `分钟级降水暂不可用（${code}）`;
  }
  if (code && code !== '200') {
    if (outOfChina(currentLat, currentLon) && (code === '403' || code === '404')) {
      return '该地区暂不支持分钟级降水预报';
    }
    return `分钟级降水获取失败（${code}）`;
  }
  return null;
}

function renderMinutely(data, coords) {
  if (isApiError(data)) {
    minutelyCard.style.display = 'block';
    minutelyContainer.innerHTML = '';
    minutelyAxis.innerHTML = '';
    minutelySummary.textContent = minutelyUnsupportedReason(coords, data)
      || '分钟级降水获取失败，请点刷新重试';
    return;
  }
  if (!data.minutely || data.minutely.length === 0) {
    minutelyCard.style.display = 'block';
    minutelyContainer.innerHTML = '';
    minutelyAxis.innerHTML = '';
    minutelySummary.textContent = outOfChina(currentLat, currentLon)
      ? '该地区暂不支持分钟级降水预报（仅限中国大陆）'
      : '暂无分钟级降水数据';
    return;
  }
  minutelyCard.style.display = 'block';

  const items = data.minutely;
  const isSnow = items.some(d => d.type === 'snow');
  const RAIN_THRESHOLD = 0.1;

  function barColor(precip) {
    const mmh = precip * 12;
    if (mmh < 1.2) return 'var(--scroll-track)';
    if (isSnow) {
      if (mmh < 2.5) return '#e0e7ff';
      if (mmh < 8) return '#a5b4fc';
      return '#6366f1';
    }
    if (mmh < 2.5) return '#93c5fd';
    if (mmh < 8) return '#3b82f6';
    if (mmh < 16) return '#1d4ed8';
    return '#1e3a8a';
  }

  const precipValues = items.map(d => parseFloat(d.precip) || 0);
  const maxPrecip = Math.max(...precipValues, 0.1);

  minutelyContainer.innerHTML = '';
  items.forEach((item, idx) => {
    const p = parseFloat(item.precip) || 0;
    const bar = document.createElement('div');
    bar.className = 'minute-bar';
    const height = p > RAIN_THRESHOLD ? Math.max(6, (p / maxPrecip) * 76) : 6;
    bar.style.height = height + 'px';
    bar.style.background = barColor(p);
    bar.title = `+${idx * 5}分钟 · ${p.toFixed(2)} mm`;
    minutelyContainer.appendChild(bar);
  });

  const totalMin = items.length * 5;
  minutelyAxis.innerHTML = '';
  const axisMarks = [
    [0, '现在'],
    [30, '+30m'],
    [60, '+1h'],
    [90, '+1.5h'],
    [120, '+2h']
  ].filter(([min]) => min < totalMin || (min === 0));
  if (totalMin > 0 && totalMin !== 120 && !axisMarks.some(([m]) => m === totalMin)) {
    axisMarks.push([totalMin, totalMin >= 60 ? `+${(totalMin / 60).toFixed(totalMin % 60 ? 1 : 0)}h` : `+${totalMin}m`]);
  }
  axisMarks.forEach(([, label]) => {
    const span = document.createElement('span');
    span.textContent = label;
    minutelyAxis.appendChild(span);
  });

  const hasRainNow = precipValues[0] > RAIN_THRESHOLD;
  let firstRainIdx = -1, firstStopIdx = -1;
  for (let i = 0; i < precipValues.length; i++) {
    if (firstRainIdx === -1 && precipValues[i] > RAIN_THRESHOLD) firstRainIdx = i;
    if (firstRainIdx !== -1 && firstStopIdx === -1 && precipValues[i] <= RAIN_THRESHOLD) firstStopIdx = i;
  }
  const noun = isSnow ? '雪' : '雨';
  let prediction = '';
  if (firstRainIdx === -1) {
    prediction = `未来2小时无降${noun}`;
  } else if (hasRainNow) {
    if (firstStopIdx !== -1) {
      prediction = `当前正在下${noun}，预计${firstStopIdx * 5}分钟后停${noun}`;
    } else {
      prediction = `当前正在下${noun}，未来2小时持续`;
    }
  } else {
    const startMin = firstRainIdx * 5;
    if (firstStopIdx !== -1) {
      const duration = (firstStopIdx - firstRainIdx) * 5;
      prediction = `${startMin}分钟后开始下${noun}，持续约${duration}分钟`;
    } else {
      prediction = `${startMin}分钟后开始下${noun}，未来2小时持续`;
    }
  }

  const maxPrecipVal = Math.max(...precipValues);
  const maxIntensity = (maxPrecipVal * 12).toFixed(1);
  const intensityText = maxPrecipVal > RAIN_THRESHOLD ? ` · 最大强度 ${maxIntensity} mm/h` : '';

  const summaryText = (data.summary && data.summary.trim()) ? data.summary.trim() : prediction;
  minutelySummary.textContent = summaryText + intensityText;
}

// ========== 加载状态 ==========
function showLoading() {
  document.querySelectorAll('.loading').forEach(el => el.innerHTML = '加载中...');
}
function hideLoading() {
  const loadingElements = document.querySelectorAll('.loading');
  loadingElements.forEach(el => {
    if (el.parentElement && el.parentElement.children.length === 1) {
      el.innerHTML = '加载失败或无数据';
    }
  });
}

// ========== 设置面板 ==========
function openSettings() {
  apiHostInput.value = getQweatherHost();
  apiKeyInput.value = getQweatherKey();
  if (settingsError) settingsError.classList.remove('show');
  if (settingsSuccess) settingsSuccess.classList.remove('show');
  settingsOverlay.classList.add('active');
}

function closeSettings() {
  settingsOverlay.classList.remove('active');
}

async function saveSettings() {
  let host = apiHostInput.value.trim();
  const key = apiKeyInput.value.trim();
  // Host 只支持 HTTPS；漏填 scheme 时自动补全而非直接报错
  if (host && !/^https?:\/\//i.test(host)) {
    host = 'https://' + host.replace(/^\/+/, '');
    apiHostInput.value = host;
  }
  if (host && !/^https:\/\//i.test(host)) {
    if (settingsError) {
      settingsError.textContent = 'API Host 必须是 https:// 域名（例如 https://m33wt3jj26.re.qweatherapi.com）';
      settingsError.classList.add('show');
    } else {
      alert('API Host 必须是 https:// 域名');
    }
    return;
  }
  if (settingsError) settingsError.classList.remove('show');
  if (settingsSuccess) settingsSuccess.classList.remove('show');

  // 保存即探测（优化 #11）：能填就校验，避免存了坏 Key 才在首页报错
  if (host && key) {
    saveSettingsBtn.disabled = true;
    const original = saveSettingsBtn.textContent;
    saveSettingsBtn.textContent = '校验中...';
    try {
      const probe = await probeQweather(host, key);
      if (!probe.ok) {
        const msg = probe.code === '429'
          ? '请求过于频繁，请稍后再保存'
          : `Key 校验失败：${probe.msg || probe.code}`;
        if (settingsError) {
          settingsError.textContent = msg;
          settingsError.classList.add('show');
        } else {
          alert(msg);
        }
        return;
      }
      setQweatherHost(host);
      setQweatherKey(key);
      authFallbackTried = false; // 用户重新保存设置后允许再次尝试 header
      if (settingsSuccess) {
        settingsSuccess.textContent = `✓ 校验通过（${probe.mode === 'query' ? 'query 鉴权' : 'header 鉴权'}）`;
        settingsSuccess.classList.add('show');
      }
      showToast('设置已保存并通过校验', { type: 'success' });
    } finally {
      saveSettingsBtn.disabled = false;
      saveSettingsBtn.textContent = original;
    }
  } else {
    setQweatherHost(host);
    setQweatherKey(key);
  }

  // 短暂展示成功态后关闭
  setTimeout(() => {
    closeSettings();
    if (weatherLoaded) {
      loadAllWeather(true);
    } else if (userChoseCity && restoreLastCity()) {
      // 已手动选过城：直接恢复
    } else {
      getCurrentPosition();
    }
  }, settingsSuccess && settingsSuccess.classList.contains('show') ? 600 : 0);
}

// ========== 自动刷新 ==========
function throttledUserLoad(force) {
  const now = Date.now();
  if (!force && now - lastUserLoad < USER_LOAD_THROTTLE) return;
  lastUserLoad = now;
  loadAllWeather(force);
}

function startAutoRefresh() {
  setInterval(() => {
    if (weatherLoaded && getQweatherHost() && getQweatherKey() && !inQuotaCooldown()) {
      throttledUserLoad(false);
    }
  }, 30 * 60 * 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && weatherLoaded &&
        getQweatherHost() && getQweatherKey() && !inQuotaCooldown()) {
      const now = Date.now();
      if (!lastRefreshTime || now - lastRefreshTime > 5 * 60 * 1000) {
        throttledUserLoad(false);
      }
    }
  });
}

// ========== 初始化 ==========
function init() {
  updateStatus();
  userChoseCity = localStorage.getItem('userChoseCity') === '1';

  // 工具栏按钮状态
  if (unitToggleBtn) {
    unitToggleBtn.textContent = tempUnitLabel();
    unitToggleBtn.setAttribute('aria-label', `温度单位 ${tempUnitLabel()}，点击切换`);
  }
  if (themeToggleBtn) {
    themeToggleBtn.textContent = getTheme() === 'dark' ? '☀️' : '🌙';
    themeToggleBtn.setAttribute('aria-label', getTheme() === 'dark' ? '切换到浅色模式' : '切换到深色模式');
  }

  const hasConfig = getQweatherHost() && getQweatherKey();
  if (!hasConfig) {
    openSettings();
    cityNameEl.innerText = '请先设置 API Host 和 Key';
    weatherLoaded = false;
  } else if (userChoseCity) {
    if (!restoreLastCity()) {
      userChoseCity = false;
      localStorage.removeItem('userChoseCity');
      cityNameEl.innerText = '定位中...';
      weatherLoaded = false;
      getCurrentPosition();
    }
  } else {
    cityNameEl.innerText = '定位中...';
    weatherLoaded = false;
    getCurrentPosition();
  }

  refreshBtn.onclick = () => {
    if (weatherLoaded) {
      throttledUserLoad(true);
    } else {
      getCurrentPosition();
    }
  };

  cacheBadge.onclick = () => throttledUserLoad(true);

  locateBtn.onclick = () => {
    userChoseCity = false;
    localStorage.removeItem('userChoseCity');
    cityNameEl.innerText = '定位中...';
    weatherLoaded = false;
    getCurrentPosition();
  };

  // 搜索：防抖 + Enter（优化 #10）
  searchBtn.onclick = () => searchCity(searchInput.value.trim());
  searchInput.addEventListener('input', () => {
    hideSearchError();
    clearTimeout(searchDebounceTimer);
    const q = searchInput.value.trim();
    if (q.length < 2) return;
    searchDebounceTimer = setTimeout(() => searchCity(q), 500);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(searchDebounceTimer);
      searchCity(searchInput.value.trim());
    }
  });

  // 展开 240h / 10天（优化 #7）
  if (hourlyToggleBtn) {
    hourlyToggleBtn.onclick = () => {
      hourlyExpanded = !hourlyExpanded;
      hourlyToggleBtn.textContent = hourlyExpanded ? '收起 24h' : '展开 240h';
      hourlyToggleBtn.setAttribute('aria-pressed', hourlyExpanded ? 'true' : 'false');
      if (weatherLoaded) loadAllWeather(true);
    };
  }
  if (dailyToggleBtn) {
    dailyToggleBtn.onclick = () => {
      dailyExpanded = !dailyExpanded;
      dailyToggleBtn.textContent = dailyExpanded ? '收起 7天' : '展开 10天';
      dailyToggleBtn.setAttribute('aria-pressed', dailyExpanded ? 'true' : 'false');
      if (weatherLoaded) loadAllWeather(true);
    };
  }

  // °C/°F 切换（优化 #8）
  if (unitToggleBtn) {
    unitToggleBtn.onclick = () => {
      setTempUnit(getTempUnit() === 'c' ? 'f' : 'c');
      unitToggleBtn.textContent = tempUnitLabel();
      if (weatherLoaded) loadAllWeather(false); // 本地重渲染即可，但数据可能缓存
    };
  }
  // 深色模式（优化 #8）
  if (themeToggleBtn) {
    themeToggleBtn.onclick = () => {
      const next = getTheme() === 'dark' ? 'light' : 'dark';
      setTheme(next);
      themeToggleBtn.textContent = next === 'dark' ? '☀️' : '🌙';
      themeToggleBtn.setAttribute('aria-label', next === 'dark' ? '切换到浅色模式' : '切换到深色模式');
    };
  }

  // 城市面板（优化 #9）
  if (citiesBtn && citiesPanel) {
    citiesBtn.onclick = () => {
      const open = !citiesPanel.classList.contains('active');
      if (open) renderCitiesPanel();
      citiesPanel.classList.toggle('active', open);
      citiesBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    const citiesCloseBtn = document.getElementById('citiesCloseBtn');
    if (citiesCloseBtn) {
      citiesCloseBtn.onclick = () => {
        citiesPanel.classList.remove('active');
        citiesBtn.setAttribute('aria-expanded', 'false');
      };
    }
    citiesPanel.addEventListener('click', (e) => {
      if (e.target === citiesPanel) {
        citiesPanel.classList.remove('active');
        citiesBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  settingsBtn.onclick = openSettings;
  cancelSettingsBtn.onclick = closeSettings;
  saveSettingsBtn.onclick = saveSettings;
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });
  cityPickerCancelBtn.onclick = () => cityPickerOverlay.classList.remove('active');
  cityPickerOverlay.addEventListener('click', (e) => {
    if (e.target === cityPickerOverlay) cityPickerOverlay.classList.remove('active');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettings();
      cityPickerOverlay.classList.remove('active');
      if (citiesPanel) citiesPanel.classList.remove('active');
    }
  });

  // 安装引导
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'flex';
  });
  installBtn.onclick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  };
  window.addEventListener('appinstalled', () => {
    installBtn.style.display = 'none';
  });

  startAutoRefresh();

  // SW 注册 + 更新提示（优化 #13）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('SW registered', reg);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('应用已更新，刷新以使用新版本', {
                ms: 10000,
                actions: [
                  { label: '立即刷新', onClick: () => location.reload() },
                  { label: '稍后', onClick: () => {} }
                ]
              });
            }
          });
        });
      })
      .catch(err => console.log('SW failed', err));

    // 已有新 SW 等待激活时也提示
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // skipWaiting 后首次接管；不强制刷新以免打断
    });
  }
}

init();
