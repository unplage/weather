# AGENTS.md

天气 PWA（和风天气数据源）。纯静态站点，无构建工具、无 package.json、无测试/lint。全部代码为中文注释，改动时保持一致。

## 验证方式
- 无 dev server / build / test。用任意静态服务器（如 `python3 -m http.server`）打开 `index.html` 验证，或直接部署到 GitHub Pages。
- 部署于 `/weather/` 子路径（`manifest.json` 的 `start_url: "./"` 为相对路径，适配任意子路径），线上地址 `https://unplage.github.io/weather/`。

## 运行时配置（最重要的 gocha）
- 和风天气 API 的 Host 与 Key 由用户在 UI 齿轮设置中自行填写，存于 `localStorage` 的 `qweather_host` / `qweather_key`。
- Host 是控制台的专属域名（如 `https://m33wt3jj26.re.qweatherapi.com`），**不是** `devapi.qweather.com`。
- `index.html` 中"未配置直接拦截、不再 fallback 到 devapi"是故意行为，不要当 bug 修复。

## 服务工作者（sw.js）
- `CACHE_NAME` 末尾版本号（当前 `v8`）在**每次修改应用代码时都必须递增**，否则浏览器喂旧缓存。这是最常见的坑。
- `BASE_PATH` 动态取自 `self.location.pathname`，适配任意子路径，勿硬编码。
- 缓存策略（仅拦截同源 GET）：导航 = 网络优先回退缓存；静态资源 + `cdn.jsdelivr.net` 图标字体 = 缓存优先；天气 API 分两类——**实时接口**（`/weather/now`、`/airquality`、`/minutely`、`/warning/now`）= 网络优先（刷新即实时），**预报接口**（24h/7d/indices/geo）+ `api.bigdatacloud.net` = 缓存优先、后台更新。
- 手动刷新按钮会给请求追加 `_force=1`，SW 据此忽略预报缓存强制走网络，并剥掉该参数作缓存键（避免缓存膨胀）；新缓存统一剥离 `content-encoding` 等头再写入，防止已解压 body 二次解压损坏。
- 空气质量仅用新版 `airquality/v1/current` 接口：**成功响应不含 `code` 字段**（错误走 RFC 7807 `{error:{status,title}}`），渲染以 `indexes` 是否有效为准，勿再用旧版 `v7/air/now`（已停服）或校验 `code === '200'`。
- `clear.html` 是手动清理缓存/注销 SW 的工具页；改动 SW 后可用它让用户清旧缓存。

## 文件结构
- `index.html` — 主应用（内联所有 JS/CSS）
- `clear.html` — 缓存清理工具
- `sw.js` — Service Worker
- `manifest.json` — PWA manifest（图标是内联 data: URI SVG）
