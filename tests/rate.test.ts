import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rateOfRows, renderRateReport, summarizeRate } from '../src/core/report.ts';
import type { SourceResult } from '../src/types.ts';

const result = (over: Partial<SourceResult> = {}): SourceResult => ({
  sourceId: 'jwc',
  sourceName: '教务处',
  url: 'https://x.edu.cn/',
  adapter: 'html-list',
  ok: true,
  error: null,
  status: 200,
  bytes: 1000,
  tookMs: 100,
  items: [
    {
      id: 'n1',
      sourceId: 'jwc',
      sourceName: '教务处',
      school: 'uestc',
      title: '通知',
      url: 'https://x.edu.cn/1',
      date: '2026-09-02',
      tag: null,
    },
  ],
  ...over,
});

test('rate：成功率 = 正常 / 计入统计的源，跳过的不进分母', () => {
  const rate = summarizeRate('uestc', '电子科技大学', [
    result(), // 正常
    result({ sourceId: 'b', sourceName: 'B 教务处' }), // 正常
    result({ sourceId: 'c', sourceName: 'C 教务处', ok: false, error: 'fetch failed (ENOTFOUND)', items: [] }),
    result({ sourceId: 'd', sourceName: 'D 学院', skipped: true, ok: false, items: [] }),
  ]);

  assert.equal(rate.total, 3, '跳过的不该进分母（那是没开 --allow-browser 的预期行为）');
  assert.equal(rate.ok, 2);
  assert.equal(rate.failed, 1);
  assert.equal(rate.skipped, 1);
  assert.equal(rate.tookMs, 400);
  assert.deepEqual(rate.problems, ['C 教务处：fetch failed (ENOTFOUND)']);
});

test('rate：抓到了却解析不出条目算失败（选择器过时就是这么表现的）', () => {
  const rate = summarizeRate('hnu', '湖南大学', [
    result({ sourceId: 'a', sourceName: 'A', items: [] }), // HTTP 200，但 0 条
    result({ sourceId: 'b', sourceName: 'B' }),
  ]);
  assert.equal(rate.empty, 1);
  assert.equal(rate.total, 2);
  assert.match(rate.problems.join('\n'), /A：抓到了但没解析出条目（选择器可能过时）/);
});

test('rate：一份配置全是跳过时不能说 100%（分母是 0，标 —）', () => {
  const rate = summarizeRate('uestc', '数学科学学院', [result({ skipped: true, ok: false, items: [] })]);
  assert.equal(rate.total, 0);
  assert.equal(rateOfRows([rate]), 0);
  assert.match(renderRateReport([rate]), /—/, '没有可统计的源就别显示百分比');
});

test('rate：报告表格里有每所学校、合计与失败明细', () => {
  const rows = [
    summarizeRate('uestc', '电子科技大学', [result(), result({ sourceId: 'b', sourceName: 'B' })]),
    summarizeRate('hnu', '湖南大学', [result({ sourceId: 'c', sourceName: 'C', ok: false, error: 'HTTP 202', items: [] })]),
  ];
  assert.equal(rateOfRows(rows), 2 / 3);

  const text = renderRateReport(rows);
  assert.match(text, /电子科技大学/);
  assert.match(text, /湖南大学/);
  assert.match(text, /合计 2 所/);
  assert.match(text, /67%/);
  assert.match(text, /失败 \/ 无条目明细：/);
  assert.match(text, /湖南大学 · C：HTTP 202/);
});

test('rate：成功率的表格按显示宽度对齐（中文名字不会把后面的列挤歪）', () => {
  const text = renderRateReport([
    summarizeRate('a', '短', [result()]),
    summarizeRate('b', '一个相当长的学校名称', [result()]),
  ]);
  const rows = text.split('\n').filter((l) => l.startsWith('短') || l.startsWith('一个相当长'));
  assert.equal(rows.length, 2);
  // 中文一个字符占两列，所以要比"显示宽度"而不是字符下标
  const width = (s: string) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  const columnOfRate = (line: string) => width(line.slice(0, line.indexOf('100%')));
  assert.equal(columnOfRate(rows[0]), columnOfRate(rows[1]), '两行的成功率要落在同一列');
  assert.equal(columnOfRate(rows[0]), 73, '成功率列从显示宽度 73 开始（26+5+6+8+6+6+7+9）');
});
