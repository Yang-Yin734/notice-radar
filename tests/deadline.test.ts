import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDeadline, isUrgentDeadline, renderDeadline } from '../src/core/deadline.ts';

// 固定"现在"：北京时间 2026-10-01 10:00（= UTC 2026-10-01T02:00Z）
const NOW = new Date('2026-10-01T02:00:00Z');

test('deadline：常见中文写法都能抽出截止日（issue #4）', () => {
  const cases: [string, string][] = [
    ['关于退课的通知（9月30日前提交）', '2026-09-30'],
    ['请于10月8日之前完成报名', '2026-10-08'],
    ['9月30日24:00前', '2026-09-30'],
    ['10月8日 17:00 之前', '2026-10-08'],
    ['国家级考试9月30日截止', '2026-09-30'],
    ['截止时间：2026-10-05', '2026-10-05'],
    ['截止日期 2026年10月9日', '2026-10-09'],
    ['请于2026-10-05前提交', '2026-10-05'],
  ];
  for (const [title, expected] of cases) {
    assert.equal(extractDeadline(title, NOW)?.date, expected, title);
  }
});

test('deadline：没有截止标记就不猜（通知自身的日期不算截止）', () => {
  assert.equal(extractDeadline('关于2026-09-20举办讲座的通知', NOW), null);
  assert.equal(extractDeadline('数学科学学院2027届推免工作实施细则', NOW), null);
  assert.equal(extractDeadline('', NOW), null);
});

test('deadline：按北京时间的自然日算还剩几天', () => {
  assert.equal(extractDeadline('10月1日前', NOW)?.daysLeft, 0, '当天');
  assert.equal(extractDeadline('10月2日前', NOW)?.daysLeft, 1, '明天');
  assert.equal(extractDeadline('10月8日前', NOW)?.daysLeft, 7);
  assert.equal(extractDeadline('9月30日前', NOW)?.daysLeft, -1, '昨天（已过期）');
});

test('deadline：缺年份时先按当年算，已经过去很久就当成明年（跨年写法）', () => {
  // 现在 10 月，标题写"1月5日前" → 应是明年
  const jan = extractDeadline('请于1月5日前提交材料', NOW);
  assert.equal(jan?.date, '2027-01-05');
  assert.equal(jan?.daysLeft, 96);
  // 刚刚过去的日期仍算当年（30 天缓冲），不是明年
  assert.equal(extractDeadline('9月28日前', NOW)?.date, '2026-09-28');
});

test('deadline：非法日期（2月30日）不认', () => {
  assert.equal(extractDeadline('请于2月30日前提交', NOW), null);
  assert.equal(extractDeadline('13月5日前', NOW), null);
});

test('deadline：角标文案分档，太远的不显示', () => {
  assert.equal(renderDeadline(extractDeadline('10月1日前', NOW)), '⏰ 今天截止');
  assert.equal(renderDeadline(extractDeadline('10月2日前', NOW)), '⏰ 明天截止');
  assert.equal(renderDeadline(extractDeadline('10月8日前', NOW)), '⏰ 剩 7 天');
  assert.equal(renderDeadline(extractDeadline('9月30日前', NOW)), '⏰ 已过期 1 天');
  assert.equal(renderDeadline(extractDeadline('2026-12-31前', NOW)), '', '超过 60 天不打扰');
  assert.equal(renderDeadline(extractDeadline('8月1日前', NOW)), '', '过期太久也不再提');
  assert.equal(renderDeadline(null), '');
});

test('deadline：只有 7 天内到期才算急事（用于自动分级）', () => {
  assert.equal(isUrgentDeadline(extractDeadline('10月3日前', NOW)), true);
  assert.equal(isUrgentDeadline(extractDeadline('9月30日前', NOW)), false, '已过期不再算急事');
  assert.equal(isUrgentDeadline(extractDeadline('10月20日前', NOW)), false);
  assert.equal(isUrgentDeadline(null), false);
});
