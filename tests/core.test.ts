import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeId, normalizeTitle, parseDateLoose, resolveUrl } from '../src/core/normalize.ts';
import { evaluate } from '../src/core/filter.ts';
import { emptyState, markSeen, splitNew } from '../src/core/dedupe.ts';
import type { Notice } from '../src/types.ts';

test('parseDateLoose：吃得下国内高校常见的各种日期写法', () => {
  assert.equal(parseDateLoose('2026/09/02'), '2026-09-02');
  assert.equal(parseDateLoose('2026-9-2'), '2026-09-02');
  assert.equal(parseDateLoose('2026.09.02'), '2026-09-02');
  assert.equal(parseDateLoose('2026年9月2日'), '2026-09-02');
  assert.equal(parseDateLoose('发布时间：2026-09-02 10:30'), '2026-09-02');
  assert.equal(parseDateLoose('09-02', new Date('2026-01-01')), '2026-09-02');
  assert.equal(parseDateLoose(''), null);
  assert.equal(parseDateLoose(null), null);
  assert.equal(parseDateLoose('没有任何日期'), null);
  assert.equal(parseDateLoose('2026/13/40'), null, '非法月日必须返回 null');
});

test('normalizeTitle / makeId：归一后 ID 稳定，改标题就换 ID', () => {
  assert.equal(normalizeTitle('  关于  退课\u200b 的通知 '), '关于退课的通知');
  assert.equal(normalizeTitle('学 术'), '学术', '汉字之间的排版空格要去掉');
  assert.equal(normalizeTitle('2026 年 通 知'), '2026 年通知', '汉字与数字之间的空格保留');
  const a = makeId('s1', '关于退课的通知', '2026-09-02');
  const b = makeId('s1', ' 关于退课的通知 ', '2026-09-02');
  assert.equal(a, b, '空白差异不该产生新 ID');
  assert.notEqual(a, makeId('s1', '关于退课的通知', null));
  assert.notEqual(a, makeId('s2', '关于退课的通知', '2026-09-02'));
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('resolveUrl：相对链接补全，空链接与 # 退回列表页', () => {
  assert.equal(resolveUrl('/a.htm', 'https://x.edu.cn', 'https://x.edu.cn/list'),
    'https://x.edu.cn/a.htm');
  assert.equal(resolveUrl('https://y.com/b', 'https://x.edu.cn', 'https://x.edu.cn/list'),
    'https://y.com/b');
  assert.equal(resolveUrl('#', 'https://x.edu.cn', 'https://x.edu.cn/list'), 'https://x.edu.cn/list');
  assert.equal(resolveUrl('', 'https://x.edu.cn', 'https://x.edu.cn/list'), 'https://x.edu.cn/list');
});

test('evaluate：排除优先，包含为空则全放行', () => {
  const include = ['选课', '考试'];
  assert.equal(evaluate('关于退课及补选课的通知', include, []).pass, true);
  assert.equal(evaluate('关于招标采购的公告', include, []).reason, 'no-include');
  assert.equal(evaluate('关于考试用品的招标公告', include, ['招标']).reason, 'excluded');
  assert.equal(evaluate('任何标题', [], []).pass, true);
  assert.deepEqual(evaluate('关于选课的通知', include, []).hits, ['选课']);
});

test('dedupe：第二次运行不该重复报同一条通知', () => {
  const state = emptyState();
  const notice: Notice = {
    id: 'abc123', sourceId: 's1', sourceName: '源', school: 'x',
    title: '关于退课的通知', url: 'https://x.edu.cn/1', date: '2026-09-02', tag: null,
  };

  assert.equal(splitNew([notice], state).length, 1, '第一次应视为新通知');
  markSeen([notice], state);
  assert.equal(splitNew([notice], state).length, 0, '标记后再跑不该重复');
  assert.equal(state.seen.s1.length, 1);
});

test('dedupe：窗口裁剪后状态不会无限增长', () => {
  const state = emptyState();
  const many: Notice[] = Array.from({ length: 10 }, (_, i) => ({
    id: `id${i}`, sourceId: 's1', sourceName: '源', school: 'x',
    title: `通知 ${i}`, url: `https://x.edu.cn/${i}`, date: null, tag: null,
  }));
  markSeen(many, state, 5);
  assert.equal(state.seen.s1.length, 5, '只保留最近 5 条');
  assert.equal(state.seen.s1.at(-1), 'id9');
});
