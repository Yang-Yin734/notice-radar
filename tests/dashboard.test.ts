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

test('dashboard：渲染出通知、来源筛选和统计', () => {
  const history = emptyHistory();
  appendHistory(history, [
    notice({ id: 'a' }),
    notice({ id: 'b', sourceId: 'news', sourceName: '新闻网·公告', title: '学者论坛：超导百年', tag: '学术', url: 'https://news.uestc.edu.cn/info/1/2.htm' }),
  ]);

  const html = renderDashboard(history, { generatedAt: '2026-09-28T00:00:00.000Z' });

  assert.match(html, /通知归档/);
  assert.match(html, /关于退课及补选课的通知/);
  assert.match(html, /学者论坛：超导百年/);
  assert.match(html, /教务处·学生事务公告/, '来源名应出现');
  assert.match(html, /data-source="news"/, '来源筛选按钮/属性应存在');
  assert.match(html, /累计归档<b>2<\/b>/);
});

test('dashboard：转义 HTML，标题里的标签不会变成真标签', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'x', title: '<script>alert(1)</script> 关于选课' })]);
  const html = renderDashboard(history);
  assert.ok(!html.includes('<script>alert(1)</script>'), '不该把标题原样插进 HTML');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, '应被转义');
});

test('dashboard：没有数据时给提示而不是崩掉', () => {
  const html = renderDashboard(emptyHistory());
  assert.match(html, /还没有归档数据/);
  assert.match(html, /累计归档<b>0<\/b>/);
});

test('dashboard：maxItems 限制本页条数，但统计仍按全量算', () => {
  const history = emptyHistory();
  appendHistory(
    history,
    Array.from({ length: 6 }, (_, i) => notice({ id: `id${i}`, title: `通知 ${i}` })),
  );
  const html = renderDashboard(history, { maxItems: 2 });
  assert.match(html, /累计归档<b>6<\/b>/, '统计用全量');
  assert.match(html, /本页展示<b>2<\/b>/, '本页只渲染 2 条');
  assert.ok(!html.includes('通知 5'), '被截断的条目不出现');
});
