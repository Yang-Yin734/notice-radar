import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory, emptyHistory } from '../src/core/history.ts';
import {
  beijingDayRange,
  buildDigest,
  digestTitle,
  renderDigestMarkdown,
  renderDigestText,
  rollingRange,
  truncateForPush,
  yesterdayRange,
} from '../src/core/digest.ts';
import type { Notice } from '../src/types.ts';

const notice = (over: Partial<Notice>): Notice => ({
  id: 'id1',
  sourceId: 'jwc',
  sourceName: '教务处',
  school: 'uestc',
  title: '关于选课的通知',
  url: 'https://x.edu.cn/1',
  date: '2026-09-02',
  tag: null,
  ...over,
});

/** 造一份归档：at 是发现时间（UTC） */
function historyWith(rows: { id: string; at: string; over?: Partial<Notice> }[]) {
  const history = emptyHistory();
  for (const row of rows) {
    appendHistory(history, [notice({ id: row.id, ...(row.over ?? {}) })], { at: row.at });
  }
  return history;
}

test('digest：北京时间自然日 → UTC 区间要正确（+8 偏移）', () => {
  const range = beijingDayRange('2026-09-28');
  assert.equal(range.since.toISOString(), '2026-09-27T16:00:00.000Z', '北京 09-28 00:00 = UTC 09-27 16:00');
  assert.equal(range.until.toISOString(), '2026-09-28T16:00:00.000Z');
  assert.equal(range.label, '2026-09-28（北京时间）');
  assert.equal(range.shortLabel, '9月28日');
  assert.throws(() => beijingDayRange('2026/09/28'), /YYYY-MM-DD/);
});

test('digest：昨天（北京时间）随当前时刻变化', () => {
  // UTC 2026-09-29T02:00 = 北京 10:00 → 昨天是北京 09-28
  assert.equal(yesterdayRange(new Date('2026-09-29T02:00:00Z')).shortLabel, '9月28日');
  // UTC 2026-09-28T17:00 = 北京 09-29 01:00 → 昨天是北京 09-28
  assert.equal(yesterdayRange(new Date('2026-09-28T17:00:00Z')).shortLabel, '9月28日');
  // UTC 2026-09-28T15:00 = 北京 23:00 → 昨天是北京 09-27
  assert.equal(yesterdayRange(new Date('2026-09-28T15:00:00Z')).shortLabel, '9月27日');
});

test('digest：只收窗口内「首次发现」的通知，并按来源分组、条数多的在前', () => {
  const history = historyWith([
    { id: 'a', at: '2026-09-28T01:00:00Z', over: { sourceId: 'jwc', sourceName: '教务处', title: '退课通知' } },
    { id: 'b', at: '2026-09-28T02:00:00Z', over: { sourceId: 'math', sourceName: '数学学院', title: '奖学金通知' } },
    { id: 'c', at: '2026-09-28T03:00:00Z', over: { sourceId: 'math', sourceName: '数学学院', title: '讲座通知' } },
    { id: 'd', at: '2026-09-29T20:00:00Z', over: { sourceId: 'jwc', sourceName: '教务处', title: '窗口外的通知' } },
  ]);

  const digest = buildDigest(history, beijingDayRange('2026-09-28'));
  assert.equal(digest.total, 3, '窗口外那条不算');
  assert.equal(digest.empty, false);
  assert.equal(digest.groups.length, 2);
  assert.equal(digest.groups[0].sourceName, '数学学院', '2 条的来源排在 1 条的前面');
  assert.equal(digest.groups[0].total, 2);
  assert.deepEqual(digest.groups.map((g) => g.sourceName), ['数学学院', '教务处']);
});

test('digest：超上限时截断，并记录实际列出多少条', () => {
  const history = historyWith(
    Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      at: '2026-09-28T05:00:00Z',
      over: { sourceId: 'math', sourceName: '数学学院', title: `通知 ${i}` },
    })),
  );
  const digest = buildDigest(history, { ...beijingDayRange('2026-09-28'), maxPerSource: 5, maxItems: 40 });
  assert.equal(digest.total, 12);
  assert.equal(digest.shown, 5);
  assert.equal(digest.groups[0].items.length, 5);

  const md = renderDigestMarkdown(digest);
  assert.match(md, /…另有 7 条/, '被截断的要说明还有多少');
  assert.match(md, /只列了 5\/12 条/, '末尾提示完整内容去哪看');
});

test('digest：标签统计按出现次数排序', () => {
  const history = historyWith([
    { id: 'a', at: '2026-09-28T01:00:00Z', over: { tag: '考试' } },
    { id: 'b', at: '2026-09-28T02:00:00Z', over: { tag: '考试' } },
    { id: 'c', at: '2026-09-28T03:00:00Z', over: { tag: '教管' } },
    { id: 'd', at: '2026-09-28T04:00:00Z', over: { tag: null } },
  ]);
  const digest = buildDigest(history, beijingDayRange('2026-09-28'));
  assert.deepEqual(digest.tagCounts, [
    { tag: '考试', count: 2 },
    { tag: '教管', count: 1 },
  ]);
  assert.match(renderDigestMarkdown(digest), /标签：考试 2 · 教管 1/);
});

test('digest：推送标题不超过 32 字（Server酱限制）', () => {
  const history = historyWith([{ id: 'a', at: '2026-09-28T01:00:00Z' }]);
  const busy = buildDigest(history, { ...beijingDayRange('2026-09-28'), label: '2026-09-28（北京时间）' });
  assert.ok(digestTitle(busy, '电子科技大学').length <= 32);
  assert.equal(digestTitle(busy, '电子科技大学'), '电子科技大学 · 9月28日 新增 1 条');

  const quiet = buildDigest(emptyHistory(), beijingDayRange('2026-09-28'));
  assert.equal(digestTitle(quiet, '电子科技大学'), '电子科技大学 · 9月28日 无新通知');
});

test('digest：空窗口渲染成安静的短消息（不制造噪音）', () => {
  const digest = buildDigest(emptyHistory(), beijingDayRange('2026-09-28'));
  assert.equal(digest.empty, true);
  assert.equal(digest.total, 0);
  const md = renderDigestMarkdown(digest);
  assert.match(md, /这段时间没有新通知/);
  assert.ok(!md.includes('## '), '没有内容就不该有分组标题');
  assert.match(renderDigestText(digest), /这段时间没有新通知/);
});

test('digest：Markdown 版带链接和标签，纯文本版带裸链接', () => {
  const history = historyWith([
    { id: 'a', at: '2026-09-28T01:00:00Z', over: { tag: '教管', title: '退课及补选课的通知', url: 'https://x.edu.cn/a' } },
  ]);
  const digest = buildDigest(history, beijingDayRange('2026-09-28'));

  const md = renderDigestMarkdown(digest, { appUrl: 'https://app.example/' });
  assert.match(md, /\[退课及补选课的通知\]\(https:\/\/x\.edu\.cn\/a\)/);
  assert.match(md, /`教管`/);
  assert.match(md, /\[打开应用\]\(https:\/\/app\.example\/\)/);

  const text = renderDigestText(digest, { appUrl: 'https://app.example/' });
  assert.match(text, /https:\/\/x\.edu\.cn\/a/, '纯文本版保留可点链接');
  assert.match(text, /【教务处】1 条/);
});

test('digest：推送正文超长时截断并如实标注（Server酱 上限约 32KB）', () => {
  const short = 'abc\n';
  assert.deepEqual(truncateForPush(short, 100), { text: short, truncated: false });

  const long = '通知内容\n'.repeat(50);
  const cut = truncateForPush(long, 100);
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length < long.length);
  assert.match(cut.text, /内容过长/, '截断了就必须说明，不能假装发全了');
});

test('digest：滚动窗口按小时计算', () => {
  const range = rollingRange(24, new Date('2026-09-29T00:00:00Z'));
  assert.equal(range.since.toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(range.until.toISOString(), '2026-09-29T00:00:00.000Z');
  assert.equal(range.shortLabel, '近24小时');
});
