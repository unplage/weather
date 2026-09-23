# AGENTS.md

天气 PWA（和风天气数据源）。纯静态站点，无构建工具、无 package.json、无测试框架/lint。另有可选冒烟脚本 `scripts/smoke.mjs`（`node scripts/smoke.mjs`）。全部代码为中文注释，改动时保持一致。

## 验证方式
- 主验证：`node scripts/smoke.mjs`（检查拆分引用、v1 API、SW 版本、17 项优化标识）。
- 无 dev server / build。用任意静态服务器（如 `python3 -m http.server`）打开 `index.html` 验证，或直接部署到 GitHub Pages。
- 部署于 `/weather/` 子路径（`manifest.json` 的 `start_url: "./"` 为相对路径，适配任意子路径），线上地址 `https://unplage.github.io/weather/`。

## 运行时配置（最重要的 gocha）
- 和风天气 API 的 Host 与 Key 由用户在 UI 齿轮设置中自行填写，存于 `localStorage` 的 `qweather_host` / `qweather_key`。
- **鉴权默认走请求头 `X-QW-Api-Key`**（`qweather_auth` 未设或非 `query` 时）。保存设置时 `probeQweather` 先试 header，网络/CORS 失败再试 `?key=` 并落盘 `qweather_auth=query`。
- Host 是控制台的专属域名（如 `https://m33wt3jj26.re.qweatherapi.com`），**不是** `devapi.qweather.com`。
- `app.js` 中"未配置直接拦截、不再 fallback 到 devapi"是故意行为，不要当 bug 修复。
- 用户手动搜索过的城市存 `localStorage` 的 `userChoseCity=1` + `lastCity`：刷新后**直接恢复上次城市**，不再自动 GPS；点 📍 定位按钮才重新 GPS（清除该标记）。
- 其他偏好：`temp_unit`（`f`=华氏）、`theme`（`dark`）、`favorites`/`recents`（JSON 数组）、`schema_version`（当前 `2`，升级结构时递增并写迁移）。

## API 版本（数据源存活，勿回退到已弃用接口）
- **天气三接口已迁 v1**（路径参数，**纬度在前**）：
  - 实况 `GET /weather/v1/current/{lat}/{lon}`
  - 逐小时 `GET /weather/v1/hourly/{lat}/{lon}?hours=24|240&localTime=true`
  - 逐日 `GET /weather/v1/daily/{lat}/{lon}?days=7|10&localTime=true`
  - v7 天气接口 2027-06-01 停服，**勿再使用 `/v7/weather/*`**。
- **预警已迁 v1**：`GET /weatheralert/v1/current/{lat}/{lon}`（v7 `/v7/warning/now` 2026-10-01 停服）。成功看 `metadata.zeroResult`/`alerts[]`；渲染 `headline`/`severity`/`description`/`instruction`，**勿用已弃用恒为空的 `level`**。
- 仍为 v7 query 型（未弃用）：`/v7/minutely/5m`、`/v7/indices/1d`、`/geo/v2/city/lookup`。
- 空气质量仅用新版 `airquality/v1/current` 接口：**成功响应不含 `code` 字段**（错误走 RFC 7807 `{error:{status,title}}`），渲染以 `indexes` 是否有效为准，勿再用旧版 `v7/air/now`（已停服）。
- **v1 响应字段易错点**（成功响应同样**不含 `code`**，判定用 `isApiError`）：
  - `humidity`/`cloudCover`/`precipitation.probability` 是 **[0,1] 比例**，需 ×100；
  - `visibility.value` 单位是**米**（÷1000 显示 km）；
  - `wind.direction.compass` 是英文码（`sw`/`nne`…），用 `WIND_COMPASS` 映射中文；风速显示用 `windSpeedMs` 统一成 m/s + 级；
  - 逐日取 `daytime`/`nighttime`/`temperatureMax.value`/`astro.sunrise`，无 `fxDate`/`iconDay`/`pop`。
- 所有支持的接口带 `lang=zh-hans`；`localTime=true` 返回查询地当地时间（修跨时区“现在”错标）。
- **坐标**：请求前经 `wgs84ToGcj02`（境外 `outOfChina` 透传），勿直接拿 GPS WGS 打路径参数接口。
- **分钟降水**：仅覆盖中国大陆；`403/404/400` 或空数据且 `outOfChina` 时文案「该地区暂不支持…」，勿当网络错误。

## 服务工作者（sw.js）
- `CACHE_NAME` 末尾版本号（当前 `v10`）在**每次修改应用代码时都必须递增**，否则浏览器喂旧缓存。这是最常见的坑。
- `BASE_PATH` 动态取自 `self.location.pathname`，适配任意子路径，勿硬编码。
- 预缓存含 `index.html` / `styles.css` / `app.js` / `manifest.json`。
- 缓存策略：导航 = 网络优先回退缓存；静态资源 + `cdn.jsdelivr.net` 图标字体 = 缓存优先；**天气 API（qweatherapi.com / qweather.com / api.bigdatacloud.net，跨域）= 统一 5 分钟 TTL**：
  - 缓存键 = 剥掉 `_force` **和 `key`** 后的完整 URL（含 location/路径经纬度）→ **同城市 5 分钟内刷新复用缓存**，超时/换城市走网络；换 Key 不导致缓存穿透。
  - **网络请求必须透传页面原始请求头**（`X-QW-Api-Key`）与含 query 的 URL，勿用空 `new Request(cleanUrl)` 丢掉鉴权。
  - 手动刷新 `_force=1` **跳过缓存强制走网络**；网络失败回退过期缓存（离线兜底）。
  - 从缓存返回时打 `x-sw-cached` / `x-sw-cached-at` 响应头并注入 `Access-Control-Expose-Headers`，页面 `safeFetchJson` 读到后在刷新按钮旁显示「缓存 HH:mm」徽标（点击 = 强制刷新）。**实时数据不打此标记**。
- 注意：曾因同源早退导致跨域 API 缓存整段死代码，**勿再加 `url.origin !== location.origin → return`** 这类入口拦截。
- `clear.html` 是手动清理缓存/注销 SW 的工具页；改动 SW 后可用它让用户清旧缓存。
- SW 有新版本等待时，页面 toast 提示「立即刷新」（`updatefound` → `installed`）。

## 文件结构
- `index.html` — 主应用外壳（CSP、ARIA、外部 CSS/JS 引用）
- `styles.css` — 全局样式（浅色/深色 CSS 变量）
- `app.js` — 主逻辑（鉴权/坐标/渲染/面板）
- `scripts/smoke.mjs` — Node 冒烟测试（无依赖）
- `clear.html` — 缓存清理工具
- `sw.js` — Service Worker
- `manifest.json` — PWA manifest（图标是内联 data: URI SVG）
