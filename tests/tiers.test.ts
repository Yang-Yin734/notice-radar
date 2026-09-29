import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_URGENT_KEYWORDS } from '../src/core/config.ts';
import type { PushConfig } from '../src/core/config.ts';
import { classify, explainTier, immediateItems, matchKeyword, splitByTier } from '../src/core/tiers.ts';
import type { Notice } from '../src/types.ts';

const push = (over: Partial<PushConfig> = {}): PushConfig => ({
  urgent: DEFAULT_URGENT_KEYWORDS,
  mute: [],
  digestRest: true,
  digestMaxPerSource: 8,
  digestMaxItems: 40,
  ...over,
});

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

test('tiers：默认关键词能认出抢时间的通知（退课/缓补考/推免）', () => {
  const p = push();
  assert.equal(classify(notice({ title: '关于2026-2027-1学期本科生退课及补选课的通知' }), p), 'urgent');
  assert.equal(classify(notice({ title: '关于大面积课程开学缓补考安排的通知' }), p), 'urgent');
  assert.equal(classify(notice({ title: '数学科学学院2027届推免生工作实施细则' }), p), 'urgent');
  assert.equal(classify(notice({ title: '关于2026年研究生国家奖学金评定的通知' }), p), 'urgent');
});

test('tiers：讲座、活动这类常规通知进日报（不打扰）', () => {
  const p = push();
  assert.equal(classify(notice({ title: '名师讲堂：Geometry, Mesh, and Higher-Order Finite Elements' }), p), 'digest');
  assert.equal(classify(notice({ title: '关于举办教职工羽毛球比赛的通知' }), p), 'digest');
  assert.equal(classify(notice({ title: '校园网维护通知' }), p), 'digest');
});

test('tiers：标签也参与匹配（有的源只把分类放在 tag 里）', () => {
  const p = push();
  assert.equal(classify(notice({ title: '关于开展问卷调查的通知', tag: '考试' }), p), 'urgent');
  assert.equal(classify(notice({ title: '关于开展问卷调查的通知', tag: '讲座' }), p), 'digest');
});

test('tiers：mute 优先级最高（既不时推也不进日报）', () => {
  const p = push({ mute: ['讲座'] });
  assert.equal(classify(notice({ title: '名师讲堂：某讲座', tag: null }), p), 'mute');
  // 同时命中 mute 与 urgent 时，mute 赢
  assert.equal(classify(notice({ title: '退课讲座安排' }), p), 'mute');
});

test('tiers：大小写不敏感，能匹配英文关键词', () => {
  const p = push({ urgent: ['CET', 'GPA'] });
  assert.equal(classify(notice({ title: '关于 cet-6 报名的通知' }), p), 'urgent');
  assert.equal(matchKeyword('我的 gpa 查询', ['GPA']), 'GPA');
  assert.equal(matchKeyword('无关内容', ['GPA']), null);
  assert.equal(matchKeyword('', ['GPA']), null);
});

test('tiers：空关键词列表不误判', () => {
  const p = push({ urgent: [], mute: [] });
  assert.equal(classify(notice({ title: '退课通知' }), p), 'digest');
  assert.equal(matchKeyword('退课通知', ['  ']), null, '只有空白的关键词要跳过');
});

test('tiers：分组结果把三类分开，immediateItems 只取急事', () => {
  const p = push({ mute: ['讲座'] });
  const items = [
    notice({ id: 'a', title: '退课通知' }),
    notice({ id: 'b', title: '名师讲堂：某讲座' }),
    notice({ id: 'c', title: '校园网维护通知' }),
  ];
  const split = splitByTier(items, p);
  assert.deepEqual(split.urgent.map((n) => n.id), ['a']);
  assert.deepEqual(split.digest.map((n) => n.id), ['c']);
  assert.deepEqual(split.mute.map((n) => n.id), ['b']);
  assert.deepEqual(immediateItems(items, p).map((n) => n.id), ['a']);
});

test('tiers：关掉分级后恢复「全都即时推」的老行为', () => {
  const p = push({ digestRest: false });
  const items = [notice({ id: 'a', title: '退课通知' }), notice({ id: 'b', title: '讲座通知' })];
  assert.deepEqual(immediateItems(items, p).map((n) => n.id), ['a', 'b']);
});

test('tiers：能说明一条通知为什么被判为急事（用户看得懂）', () => {
  const p = push();
  assert.equal(explainTier(notice({ title: '关于退课的通知' }), p), '命中关键词「退课」');
  assert.equal(explainTier(notice({ title: '关于讲座的通知' }), p), '常规通知');
});
