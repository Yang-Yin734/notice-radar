import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDeadline, extractDeadlineFromBody, isActionableTitle, isUrgentDeadline, renderDeadline, resolveDeadline } from '../src/core/deadline.ts';

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

// ---------------------------------------------------------------- 正文抽取
// 这些写法全部来自 uestc 详情页的真实正文：注意「9 月 4 日」中间有空格、
// 区间用「时」+「至」而不是冒号，都是标题版正则覆盖不到的形式。

const BODY_CASES: [string, string][] = [
  ['一、退课时间：10月26日12时至10月30日12时。', '2026-10-30'],
  ['报名截止时间：11月1日，逾期不再受理。', '2026-11-01'],
  ['补选课安排 9 月 4 日至 5 日，每天 9:00-17:00。', '2026-09-05'],
  ['重新学习报名：8 月31日9:00至9月4日17:00。', '2026-09-04'],
];

test('deadline：正文里的时间区间取结束日（标题里抽不到的那批）', () => {
  for (const [body, expected] of BODY_CASES) {
    assert.equal(extractDeadlineFromBody(body, NOW)?.date, expected, body);
  }
});

test('deadline：正文里的「前/截止」写法', () => {
  assert.equal(extractDeadlineFromBody('请于10月12日前将材料交至教务处。', NOW)?.date, '2026-10-12');
});

test('deadline：正文没有日期就不猜', () => {
  assert.equal(extractDeadlineFromBody('本次讲座由张老师主讲，欢迎参加。', NOW), null);
  assert.equal(extractDeadlineFromBody('', NOW), null);
});

test('deadline：只有办事型标题才值得去抓正文', () => {
  assert.equal(isActionableTitle('关于2026-2027-1学期中期退课及补选课的通知'), true);
  assert.equal(isActionableTitle('电子科技大学2027届系列双选会报名公告'), true);
  assert.equal(isActionableTitle('成电讲坛 | 潘永信院士学术报告'), false);
  assert.equal(isActionableTitle('关于开展2026~2027学年本科生学籍电子注册的通知'), true);
});

test('deadline：优先用落库的截止日，剩余天数现算（相对量存不住）', () => {
  assert.equal(resolveDeadline({ title: '某通知', deadline: '2026-10-08' }, NOW)?.date, '2026-10-08');
  assert.equal(resolveDeadline({ title: '某通知', deadline: '2026-10-08' }, NOW)?.daysLeft, 7);
  // 没有落库值就回退到标题
  assert.equal(resolveDeadline({ title: '请于10月8日前报名' }, NOW)?.date, '2026-10-08');
  assert.equal(resolveDeadline({ title: '讲座通知' }, NOW), null);
});
