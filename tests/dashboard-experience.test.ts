import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDashboard } from '../src/dashboard.ts';
import { appendHistory, emptyHistory } from '../src/core/history.ts';
import type { Notice } from '../src/types.ts';

/**
 * 应用体验的三条回归线（都是"真机上才看得出来、单测里能钉住"的东西）：
 *
 *   1. 深浅色必须**首帧就正确**（脚本在 <style> 之前），点一下要同步改
 *      class / color-scheme / theme-color 三样 —— 只改 class 的话手机状态栏不跟。
 *   2. 点收藏 / 点标题**不能重建整张列表**（每点一次重建 200 张卡片 = "按了没反应"）。
 *   3. 首次使用要有一句提示，且点过就记住。
 */

const notice = (over: Partial<Notice>): Notice => ({
  id: 'id1', sourceId: 'jwc', sourceName: '教务处·学生事务公告', school: 'uestc',
  title: '关于退课及补选课的通知', url: 'https://www.jwc.uestc.edu.cn/info/abc', date: '2026-09-02', tag: '教管',
  ...over,
});

const render = (): string => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a' }), notice({ id: 'b', title: '四六级报名' })]);
  return renderDashboard(history);
};

test('体验：深浅色脚本在样式之前，首帧不会先白一下', () => {
  const html = render();
  const script = html.indexOf("localStorage.getItem('notice-radar:theme')");
  // 注意用 `<style>\n`：脚本自己的注释里就写着「放在 <style> 之前」，别匹配到那句
  const style = html.indexOf('<style>\n');
  assert.ok(script > 0, '要有提前读主题的脚本');
  assert.ok(style > script, '这段脚本必须排在样式表之前，否则样式已经按系统色画过一帧了');
  assert.match(html, /html\.style\.colorScheme/, '同步 color-scheme，滚动条/表单控件才跟着变');
});

test('体验：切深浅色时 class、color-scheme、theme-color 三样一起改', () => {
  const html = render();
  assert.match(html, /<meta name="theme-color" id="theme-color"/, 'theme-color 要有 id 才改得到');
  assert.match(html, /function paintTheme\(/, '统一走 paintTheme()');
  assert.match(html, /setAttribute\('content', dark \? '#12161f' : '#eef1f6'\)/, '手机状态栏颜色跟着变');
  assert.match(html, /html\.style\.colorScheme = dark \? 'dark' : 'light'/, 'color-scheme 跟着变');
  assert.match(html, /aria-pressed/, '按钮要能读出当前状态（读屏用户）');
  // 跟随系统时要跟着系统切换，不能等刷新
  assert.match(html, /prefers-color-scheme: dark\)'\)\.addEventListener\('change'/, '系统切换时同步');
});

test('体验：点收藏 / 点标题只改那一张卡片，不重建列表', () => {
  const html = render();
  assert.match(html, /fav\.classList\.toggle\('on', on\)/, '收藏状态就地改');
  assert.match(html, /card\.classList\.add\('read'\)/, '已读状态就地改');
  // 反例：收藏分支里不该出现"独立一行 renderList();"（在"收藏"页取消收藏那种必要重建除外）
  const favHandler = html.slice(html.indexOf("var fav = e.target.closest('[data-fav]')"));
  const head = favHandler.slice(0, favHandler.indexOf('var open ='));
  assert.ok(!/^[ \t]*renderList\(\);/m.test(head), '收藏分支不该整表重建');
  assert.match(head, /state\.filter === 'fav' && !on\) renderList\(\)/, '只有"收藏页取消收藏"才需要重建');
});

test('体验：搜索输入合并成一次重建（90ms），别每个字都重画', () => {
  const html = render();
  assert.match(html, /setTimeout\(function \(\) \{ state\.query = value; renderList\(\); \}, 90\)/, '输入防抖');
});

test('体验：首次使用有一行提示，点过就记住', () => {
  const html = render();
  assert.match(html, /id="tips"/, '提示条存在');
  assert.match(html, /id="tips-close"/, '可关闭');
  assert.match(html, /notice-radar:tips/, '关闭状态持久化');
  assert.match(html, /第一次用/, '文案别写成内部黑话');
});

test('体验：屏幕外卡片跳过布局（content-visibility），后台更新挪到空闲时', () => {
  const html = render();
  assert.match(html, /content-visibility: auto/, '两百张卡片要能跳过屏外渲染');
  assert.match(html, /contain-intrinsic-size/, '给估算高度，滚动条不跳');
  assert.match(html, /requestIdleCallback\(run, \{ timeout: 5000 \}\)/, '静默更新让出主线程');
  assert.match(html, /navigator\.onLine === false/, '离线时不做无意义的拉取');
  assert.ok(!html.includes('setTimeout(function () { refreshFromNetwork(false); }, 800)'), '打开后第 800ms 抢主线程的老逻辑应删掉');
});

test('体验：设置页不再调用已删除的函数（每次点击都抛 ReferenceError）', () => {
  const html = render();
  assert.ok(!html.includes('loadPushState('), 'loadPushState 已在 v0.11.0 删除，别留悬空调用');
  assert.match(html, /if \(view === 'settings'\) checkVersion\(false\);/, '设置页仍然检查版本');
});
