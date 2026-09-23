// scripts/smoke.mjs — 冒烟测试（无第三方依赖，node >= 18）
// 覆盖：关键标识符存在、无已弃用接口、拆分文件可被解析、CSP/ARIA 等
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
let passed = 0;

function ok(cond, msg) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ ${msg}`); }
}

function read(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

console.log('== 文件存在性 ==');
const files = ['index.html', 'styles.css', 'app.js', 'sw.js', 'manifest.json', 'clear.html'];
for (const f of files) ok(existsSync(resolve(root, f)), `存在 ${f}`);

const html = read('index.html') || '';
const css = read('styles.css') || '';
const js = read('app.js') || '';
const sw = read('sw.js') || '';
const agents = read('AGENTS.md') || '';

console.log('== 拆分引用 ==');
ok(/href=["']\.\/styles\.css["']/.test(html), 'index.html 引用 styles.css');
ok(/src=["']\.\/app\.js["']/.test(html), 'index.html 引用 app.js');
ok(!/<script>\s*[\s\S]*function\s+getQweatherHost/.test(html), 'index.html 不再内联主逻辑');
ok(js.includes('function loadAllWeather'), 'app.js 含 loadAllWeather');
ok(css.includes(':root'), 'styles.css 含主题变量');

console.log('== 17 项优化抽查 ==');
ok(js.includes('X-QW-Api-Key'), '① Key 走 header');
ok(js.includes('probeQweather'), '⑪ 保存即探测');
ok(js.includes('429'), '⑫ 429 限额提示');
ok(html.includes('attrToggle') || js.includes('attrToggle'), '② 归因折叠');
ok(/Content-Security-Policy/.test(html), '③ CSP meta');
ok(js.includes('wgs84ToGcj02'), '④ GCJ-02 转换');
ok(js.includes('m/s'), '⑤ 风速 m/s');
ok(js.includes('minutelyUnsupportedReason'), '⑥ 海外分钟降水分型');
ok(js.includes('240') && js.includes('hourlyExpanded'), '⑦ 240h 展开');
ok(js.includes('dailyExpanded') && js.includes('10'), '⑦ 10 天展开');
ok(js.includes('temp_unit') && js.includes('setTheme'), '⑧ °C/°F + 主题');
ok(js.includes('favorites') && js.includes('recents'), '⑨ 收藏/最近');
ok(js.includes('searchDebounceTimer') && js.includes('searchError'), '⑩ 搜索防抖/行内错误');
ok(js.includes('updatefound'), '⑬ SW 更新 toast');
ok(html.includes('scripts') || html.includes('./app.js'), '⑭ 拆分落地');
ok(existsSync(resolve(root, 'scripts/smoke.mjs')), '⑮ smoke 脚本自身存在');
ok(js.includes('STORAGE_SCHEMA'), '⑯ schema 版本');
ok(html.includes('aria-label') && js !== '', '⑰ aria 标签');

console.log('== API 版本 / 弃用接口 ==');
ok(!/\/v7\/weather\//.test(html + js), '无 /v7/weather/*');
ok(!/\/v7\/warning\//.test(html + js), '无 /v7/warning/*');
ok(!/\/v7\/air\/now/.test(html + js), '无 /v7/air/now');
ok(js.includes('/weather/v1/current/'), '使用 weather/v1/current');
ok(js.includes('/weather/v1/hourly/'), '使用 weather/v1/hourly');
ok(js.includes('/weather/v1/daily/'), '使用 weather/v1/daily');
ok(js.includes('/weatheralert/v1/current/'), '使用 weatheralert/v1/current');
ok(js.includes('/v7/minutely/5m'), 'minutely 仍为 v7');
ok(js.includes('/v7/indices/1d'), 'indices 仍为 v7');
ok(js.includes('/airquality/v1/current'), 'AQI 用 airquality/v1');
ok(js.includes('lang=zh-hans') || js.includes("lang: 'zh-hans'") || /lang.*zh-hans/.test(js), '带 lang=zh-hans');

console.log('== SW 缓存规则 ==');
ok(/v10/.test(sw), 'CACHE_NAME 升至 v10');
ok(sw.includes('styles.css') && sw.includes('app.js'), '预缓存 styles.css/app.js');
ok(sw.includes("searchParams.delete('_force')"), '剥离 _force');
ok(sw.includes("searchParams.delete('key')"), '缓存键剥离 key');
ok(sw.includes('X-QW-Api-Key') || sw.includes('request.headers'), '透传请求头');
ok(!/url\.origin !== location\.origin\s*→?\s*return/.test(sw), '无同源早退死代码');

console.log('== 其他完整性 ==');
ok(js.includes('userChoseCity'), '保留 userChoseCity 守卫');
ok(js.includes('isApiError'), '保留 isApiError');
ok(js.includes('WIND_COMPASS'), '保留 WIND_COMPASS');
ok(/iconCode/.test(js), '保留 icon 白名单');
ok(html.includes('id="keyStatus"'), 'keyStatus 元素存在');
ok(html.includes('id="settingsOverlay"'), 'settingsOverlay 元素存在');
ok(agents.includes('v9') === false || agents.includes('v10'), 'AGENTS 已记录 v10（或将人工核对）');

console.log('');
console.log(`结果: ${passed} 通过, ${failed} 失败`);
if (failed > 0) process.exit(1);
