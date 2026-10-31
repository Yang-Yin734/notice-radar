import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dedupeAcrossSources, emptyState, loadState, markSeen, saveState, splitNew } from '../src/core/dedupe.ts';
import { appendHistory, emptyHistory } from '../src/core/history.ts';
import { contentCore, sameEvent } from '../src/core/normalize.ts';
import type { Notice } from '../src/types.ts';

const notice = (over: Partial<Notice>): Notice => ({
  id: 'id1',
  sourceId: 's1',
  sourceName: '教务处',
  school: 'uestc',
  title: '关于选课的通知',
  url: 'https://x.edu.cn/1',
  date: '2026-09-02',
  tag: null,
  ...over,
});

test('contentCore：不同虚词/栏目后缀的同一件事，内容核相同', () => {
  assert.equal(contentCore('关于做好2026年推免工作的通知'), contentCore('做好2026年推免工作通知'));
  assert.equal(contentCore('关于X的通知'), contentCore('X'));
  assert.equal(contentCore('X（教务处）'), contentCore('X'));
  assert.equal(contentCore('关于X的通知'), contentCore('关于X的公告'));
  // 不同的事不能撞在一起
  assert.notEqual(contentCore('关于选课的通知'), contentCore('关于考试的通知'));
});

test('sameEvent：标题相同、日期差一两天仍算同一件事', () => {
  assert.ok(
    sameEvent(
      { title: '关于2026年下半年全国大学英语四、六级考试报名的通知', date: '2026-09-14' },
      { title: '关于2026年下半年全国大学英语四、六级考试报名工作的通知', date: '2026-09-15' },
    ),
    '不同栏目挂出时间常差一天',
  );
  // 缺日期时只看标题
  assert.ok(sameEvent({ title: '关于X的通知', date: null }, { title: '关于X的通知', date: '2026-09-02' }));
});

test('sameEvent：隔个月重发的同名通知不算同一件事', () => {
  assert.equal(sameEvent({ title: '关于停电的通知', date: '2026-09-14' }, { title: '关于停电的通知', date: '2026-10-14' }), false);
  assert.equal(sameEvent({ title: '关于停电的通知', date: '2026-09-14' }, { title: '关于停电的通知', date: '2026-09-16' }), true);
});

test('dedupeAcrossSources：同一件事挂两个栏目 → 并成一条，另一个来源记进 alsoIn', () => {
  const out = dedupeAcrossSources([
    notice({ id: 'a', sourceId: 'jwc-important', sourceName: '教务处·重要公告', title: '关于做好2026年推免工作的通知' }),
    notice({ id: 'b', sourceId: 'jwc-student', sourceName: '教务处·学生事务公告', title: '关于做好2026年推免工作的通知' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'a', '保留首次出现的那条');
  assert.deepEqual(out[0].alsoIn, ['教务处·学生事务公告']);
});

test('dedupeAcrossSources：不同通知不会被误合并', () => {
  const out = dedupeAcrossSources([
    notice({ id: 'a', title: '关于选课的通知' }),
    notice({ id: 'b', title: '关于考试的通知' }),
    notice({ id: 'c', title: '关于选课的通知', date: '2026-11-02' }),
  ]);
  assert.equal(out.length, 3, '隔了两个月的同名通知是另一件事');
});

test('splitNew：换个栏目抓到同一件事，不再当新通知（重复推送的根因）', () => {
  const state = emptyState();
  const first = notice({ id: 'a', sourceId: 'jwc-important', sourceName: '教务处·重要公告', title: '关于推免工作的通知' });
  markSeen([first], state);

  const fromOther = notice({ id: 'b', sourceId: 'jwc-student', sourceName: '教务处·学生事务公告', title: '关于推免工作的通知' });
  assert.deepEqual(splitNew([fromOther], state), [], '两个源很少同轮成功，换栏目抓到不该再报一次');

  // 真的新通知照常报
  const reallyNew = notice({ id: 'c', sourceId: 'jwc-student', title: '关于补考安排的通知' });
  assert.equal(splitNew([reallyNew], state).length, 1);
});

test('splitNew：同一源重复抓到同一条，仍然不算新', () => {
  const state = emptyState();
  markSeen([notice({ id: 'a' })], state);
  assert.deepEqual(splitNew([notice({ id: 'a' })], state), []);
});

test('state：旧文件没有 seenEvents 字段也能读，并自动补空数组', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-state-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, seen: { jwc: ['a'] }, lastRun: null }), 'utf8');

  const state = loadState(file);
  assert.deepEqual(state.seenEvents, [], '缺失时按空数组处理');
  assert.deepEqual(state.seen.jwc, ['a'], '老字段照旧');

  saveState(file, state);
  assert.deepEqual(loadState(file).seenEvents, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('appendHistory：跨批次从另一个栏目抓到同一件事 → 只补来源，不复制一条', () => {
  const history = emptyHistory();
  const first = appendHistory(
    history,
    [notice({ id: 'a', sourceId: 'news-notice', sourceName: '新闻网·公告', title: '成电讲坛 | Jack Dongarra' })],
    { at: '2026-10-28T02:00:00.000Z' },
  );
  assert.equal(first.added, 1);
  assert.equal(first.merged, 0);

  const second = appendHistory(
    history,
    [notice({ id: 'b', sourceId: 'news-academic', sourceName: '新闻网·学术', title: '成电讲坛 | Jack Dongarra' })],
    { at: '2026-10-28T08:00:00.000Z' },
  );
  assert.equal(second.added, 0, '同一条通知不该在归档里出现两次');
  assert.equal(second.merged, 1);
  assert.equal(history.items.length, 1);
  assert.deepEqual(history.items[0].alsoIn, ['新闻网·学术'], '仍能看到它还挂在哪个栏目');
});

test('appendHistory：并进已有条目时保留首次发现时间', () => {
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'a', title: '关于X的通知' })], { at: '2026-09-01T00:00:00.000Z' });
  appendHistory(history, [notice({ id: 'b', title: 'X' })], { at: '2026-09-05T00:00:00.000Z' });
  assert.equal(history.items[0].firstSeenAt, '2026-09-01T00:00:00.000Z');
});