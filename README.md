# 随行天气 · 精准预报

天气 PWA（和风天气数据源），在线地址：<https://unplage.github.io/weather/>

纯静态站点，无构建工具、无 package.json、无测试/lint，可直接部署到 GitHub Pages 或任意静态服务器。

## 功能

- 实时天气（温度、体感、湿度、风速、气压、能见度、云量、当前降水）
- 分钟级降水预报（2 小时）
- 24 小时逐小时预报、未来 7 天预报
- 灾害预警（全部展示）、生活指数（穿衣/紫外线/感冒/晾晒/洗车/旅游/运动/晨练/钓鱼）
- 空气质量（官方等级色徽标）
- 城市搜索、GPS 定位（IP 兜底、上次城市回退）
- 30 分钟自动刷新 + 回到前台刷新
- Service Worker 离线缓存与安装（PWA）

## 使用前配置（必需）

本应用不内置 API 凭据。使用前需点击页面右上角齿轮 ⚙️ 填写：

1. **API Host**：和风天气控制台中的**专属域名**（如 `https://m33wt3jj26.re.qweatherapi.com`），**不是** `devapi.qweather.com`。
2. **API Key**：您的和风天气 Key。

配置保存在浏览器 `localStorage`（`qweather_host` / `qweather_key`）。未配置时会直接拦截请求并弹出设置面板，不会 fallback 到 devapi。

从 <https://console.qweather.com/setting/> 获取。

## 开发与验证

无构建步骤，用任意静态服务器打开即可：

```bash
python3 -m http.server
```

打开 `http://localhost:8000` 验证。

## 部署

直接部署到 GitHub Pages（本仓库即托管于 `/weather/` 子路径）。`manifest.json` 的 `start_url`/`scope` 为相对路径，可适配任意子路径。

部署后请访问 `clear.html` 清理旧缓存（SW 缓存版本变更后必须，否则浏览器会喂旧缓存）。

## 文件结构

- `index.html` — 主应用（内联所有 JS/CSS）
- `clear.html` — 手动清理缓存/注销 Service Worker 的工具页
- `sw.js` — Service Worker（缓存名称带版本号，改动应用代码时须递增）
- `manifest.json` — PWA manifest（图标为内联 data: URI SVG）

## 安全说明

- 所有接口字段输出均经 HTML 转义，外部图标字体带 SRI 完整性校验
- 请求带 12 秒超时、带请求序号竞态守卫
- API Key 明文保存在本机 `localStorage` 且随请求 URL 传输，请勿在公共/共享设备上使用
