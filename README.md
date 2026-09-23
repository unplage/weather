# 随行天气 · 精准预报

天气 PWA（和风天气数据源），在线地址：<https://unplage.github.io/weather/>

纯静态站点，无构建工具、无 package.json、无依赖；可直接部署到 GitHub Pages 或任意静态服务器。另有 Node 冒烟脚本 `scripts/smoke.mjs`。

## 功能

- 实时天气（温度、体感、湿度、风速 m/s+风级、气压、能见度、云量、当前降水、当日最高/最低）
- 分钟级降水预报（2 小时；境外友好提示）
- 24 小时逐小时 / 未来 7 天（可展开 240h / 10 天）
- 灾害预警（全部展示，含严重程度与防御建议）、生活指数（运动/穿衣/紫外线/旅游/过敏/舒适度/感冒/空气污染扩散/化妆/晾晒/交通/防晒）
- 空气质量（官方等级色徽标）
- 城市搜索（防抖 + 行内错误 + 多结果消歧）、收藏 / 最近城市、GPS 定位（📍；手动搜索的城市刷新后恢复）
- °C/°F 切换、深色模式、数据来源归因折叠页脚
- 5 分钟内同城市刷新复用 SW 缓存（带「缓存」徽标），手动刷新强制实时；429 冷却提示；SW 更新 toast
- 30 分钟自动刷新 + 回到前台刷新
- Service Worker 离线缓存与安装（PWA）

## 使用前配置（必需）

本应用不内置 API 凭据。使用前需点击页面右上角齿轮 ⚙️ 填写：

1. **API Host**：和风天气控制台中的**专属域名**（如 `https://m33wt3jj26.re.qweatherapi.com`），**不是** `devapi.qweather.com`。
2. **API Key**：您的和风天气 Key（保存时自动探测校验；统一经请求参数 `?key=` 发送）。

配置保存在浏览器 `localStorage`（`qweather_host` / `qweather_key` 等）。未配置时会直接拦截请求并弹出设置面板，不会 fallback 到 devapi。

从 <https://console.qweather.com/setting/> 获取。

## 开发与验证

```bash
node scripts/smoke.mjs   # 冒烟：拆分引用 / v1 API / SW 版本 / 关键功能标识
python3 -m http.server   # 静态预览
```

打开 `http://localhost:8000` 验证。

## 部署

直接部署到 GitHub Pages（本仓库即托管于 `/weather/` 子路径）。`manifest.json` 的 `start_url`/`scope` 为相对路径，可适配任意子路径。

部署后请访问 `clear.html` 清理旧缓存（SW 缓存版本变更后必须，否则浏览器会喂旧缓存）。

## 文件结构

- `index.html` — 主应用外壳（CSP、ARIA、引用外部资源）
- `styles.css` — 全局样式（浅色/深色主题）
- `app.js` — 主逻辑
- `scripts/smoke.mjs` — 冒烟测试
- `clear.html` — 手动清理缓存/注销 Service Worker 的工具页
- `sw.js` — Service Worker（缓存名称带版本号，改动应用代码时须递增）
- `manifest.json` — PWA manifest（图标为内联 data: URI SVG）

## 安全说明

- 所有接口字段输出均经 HTML 转义，外部图标字体带 SRI 完整性校验
- 页面带 CSP `meta`；请求带 12 秒超时、请求序号竞态守卫；429 进入 1 分钟冷却
- API Key 明文保存在本机 `localStorage`（默认走请求头，降低 URL 日志泄漏面），请勿在公共/共享设备上使用
