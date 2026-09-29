import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from '../src/dashboard.ts';
import { appendHistory, emptyHistory } from '../src/core/history.ts';
import type { Notice } from '../src/types.ts';

const notice = (over: Partial<Notice>): Notice => ({
  id: 'id1', sourceId: 'jwc', sourceName: '教务处·学生事务公告', school: 'uestc',
  title: '关于退课及补选课的通知', url: 'https://www.jwc.uestc.edu.cn/info/abc', date: '2026-09-02', tag: '教管',
  ...over,
});

/** 从生成的页面里取出内嵌给前端的 bootstrap JSON */
const bootstrapOf = (html: string): any => {
  const m = /<script id="bootstrap" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, '页面里应该有 bootstrap 数据块');
  return JSON.parse(m![1]);
};

test('应用：是一个可装到手机的 PWA（manifest / 图标 / 视口 / SW 注册）', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a' })]);
  const html = renderDashboard(history);

  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, '要有 manifest');
  assert.match(html, /apple-touch-icon/, 'iOS 主屏图标');
  assert.match(html, /apple-mobile-web-app-capable/, 'iOS 全屏应用元信息');
  assert.match(html, /viewport-fit=cover/, '适配刘海屏安全区');
  assert.match(html, /prefers-color-scheme: dark/, '跟随系统深色模式');
  assert.match(html, /serviceWorker[\s\S]*register\('sw\.js'\)/, '注册 service worker 以支持离线');
  assert.match(html, /id="tabbar"/, '底部标签栏（手机导航）');
  assert.match(html, /main \{ max-width:760px/, '电脑上是居中窄栏（通知流每天一两条，宽栏反而难读）');
  assert.match(html, /@media \(min-width:700px\)/, '宽屏时标签栏改成顶部胶囊');
});

test('应用：数据内嵌，首屏不依赖网络', () => {
  const history = emptyHistory();
  appendHistory(history, [
    notice({ id: 'a' }),
    notice({ id: 'b', sourceId: 'news', sourceName: '新闻网·公告', title: '学者论坛：超导百年', tag: '学术' }),
  ]);
  const boot = bootstrapOf(renderDashboard(history, { generatedAt: '2026-09-28T00:00:00.000Z' }));

  assert.equal(boot.total, 2);
  assert.equal(boot.items.length, 2);
  assert.equal(boot.generatedAt, '2026-09-28T00:00:00.000Z');
  assert.equal(boot.dataPath, 'dashboard-data.json', '刷新时拉这个文件');
  assert.deepEqual(
    boot.bySource.map((s: any) => s.sourceId).sort(),
    ['jwc', 'news'],
  );
  assert.ok(boot.items.some((i: any) => i.title === '学者论坛：超导百年'));
});

test('应用：标题里的标签会被转义，不能从 JSON 里逃出去', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'x', title: '<script>alert(1)</script> 关于选课' })]);
  const html = renderDashboard(history);

  assert.ok(!html.includes('<script>alert(1)</script>'), '不该出现可执行的 script 标签');
  assert.match(html, /\\u003cscript>alert\(1\)/, 'JSON 里的 < 应被转义成 \\u003c');
  assert.equal(bootstrapOf(html).items[0].title, '<script>alert(1)</script> 关于选课', '只是转义，没有破坏内容');
});

test('应用：maxItems 只影响内嵌条数，total 仍是全量', () => {
  const history = emptyHistory();
  appendHistory(
    history,
    Array.from({ length: 6 }, (_, i) => notice({ id: `id${i}`, title: `通知 ${i}` })),
  );
  const boot = bootstrapOf(renderDashboard(history, { maxItems: 2 }));
  assert.equal(boot.total, 6, '统计口径是全量');
  assert.equal(boot.items.length, 2, '首屏只内嵌 2 条');
});

test('应用：没有数据也能渲染出界面（不是空白页）', () => {
  const html = renderDashboard(emptyHistory());
  const boot = bootstrapOf(html);
  assert.equal(boot.total, 0);
  assert.deepEqual(boot.items, []);
  assert.match(html, /id="q"/, '搜索框仍在');
  assert.match(html, /安装到手机/, '设置里有安装说明');
  assert.match(html, /添加到主屏幕/);
});

test('应用：设置页能开关微信推送（读写仓库变量 PUSH_ENABLED）', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a' })]);
  const html = renderDashboard(history, { repo: 'me/my-radar' });
  const boot = bootstrapOf(html);

  assert.equal(boot.repo, 'me/my-radar', '仓库信息进 bootstrap（推送开关要用）');
  assert.match(html, /id="view-settings"/, '有设置页');
  assert.match(html, /data-view="settings"/, '标签栏有"设置"');
  assert.match(html, /id="push-toggle"/, '推送开关');
  assert.match(html, /role="switch"/, '开关有无障碍语义');
  assert.match(html, /actions\/variables\/PUSH_ENABLED/, '读仓库变量');
  assert.match(html, /PUSH_ENABLED', value:/, '写仓库变量');
  assert.match(html, /id="gh-token" type="password"/, '令牌只存本机');
  assert.match(html, /Fine-grained tokens/, '告诉用户该建哪种令牌');
  assert.match(html, /settings\/variables\/actions/, '也给"不想给令牌"的手动路径');
});

test('应用：能检测并提示新版本（应用内更新）', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a' })]);
  const html = renderDashboard(history, { version: '1.2.3' });
  const boot = bootstrapOf(html);

  assert.equal(boot.version, '1.2.3', '当前版本进 bootstrap');
  assert.equal(boot.versionFile, 'version.json', '版本清单路径');
  assert.match(html, /id="update-banner"/, '有"有新版本"横幅');
  assert.match(html, /id="check-update"/, '设置里有"检查更新"按钮');
  assert.match(html, /function cmpVersion/, '会做版本比较');
  assert.match(html, /updatefound/, '监听 Service Worker 新版本');
  assert.match(html, /SKIP_WAITING/, '点更新时让新 SW 立即接管');
  assert.match(html, /当前版本 v1\.2\.3/, '设置页显示当前版本');
});

test('应用：iOS 引导"添加到主屏幕"而不是下载 APK', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a' })]);
  const html = renderDashboard(history);

  assert.match(html, /iPhone\|iPad\|iPod/, '能识别 iOS');
  assert.match(html, /装成 iPhone 应用/, 'iOS 上换文案');
  assert.match(html, /用 <b>Safari<\/b> 打开本页/, '设置里写清 iOS 步骤');
  assert.match(html, /iOS 不允许像 Android 那样直接装安装包/, '如实说明 iOS 的限制');
});

test('应用：APK 下载入口在显眼位置（顶部横幅 + 关于里的大按钮）', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a' })]);
  const html = renderDashboard(history, { apkUrl: 'https://example.com/notice-radar.apk' });
  const boot = bootstrapOf(html);

  assert.equal(boot.apkUrl, 'https://example.com/notice-radar.apk', '下载地址进 bootstrap（fork 可改）');
  assert.match(html, /id="install-banner"/, '列表顶部有安装横幅');
  assert.match(html, /id="apk-download-top" href="https:\/\/example\.com\/notice-radar\.apk"/, '横幅里的下载按钮');
  assert.match(html, /id="apk-download-about"/, '"关于"里的大按钮');
  assert.match(html, /Android\/i\.test\(ua\)/, '只在 Android 上弹出 APK 横幅');
  assert.match(html, /notice-radar:install-dismissed/, '关掉后不再打扰（记在本机）');
});

test('应用：数据源是「内置优先 + 多镜像」，github.io 不排第一', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a' })]);
  const mirror = 'https://cdn.jsdelivr.net/gh/me/repo@main/docs/dashboard-data.json';
  const html = renderDashboard(history, {
    dataUrls: [mirror, 'https://yang-yin734.github.io/notice-radar/dashboard-data.json'],
  });
  const boot = bootstrapOf(html);

  assert.deepEqual(boot.dataUrls, [mirror, 'https://yang-yin734.github.io/notice-radar/dashboard-data.json']);
  assert.ok(boot.dataUrls[0].includes('jsdelivr'), '镜像排在 github.io 之前（国内可达性更好）');
  assert.match(html, /notice-radar:data-cache/, '抓到的新数据会缓存到本机');
  assert.match(html, /function refreshFromNetwork/, '按顺序尝试多个数据源');
  assert.match(html, /内置数据/, '数据来源会显示给用户');
  assert.match(html, /indexOf\('dashboard-data\.json'\)/, '版本检查也改用镜像地址（APK 内那份永远等于自己）');
});
