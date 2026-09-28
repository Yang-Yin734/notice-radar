import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendHistory, countByDay, countBySource, emptyHistory, loadHistory, saveHistory } from '../src/core/history.ts';
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

test('history：追加新通知并打上 firstSeenAt，重复 ID 不会重复入档', () => {
  const history = emptyHistory();
  const at = '2026-09-28T00:00:00.000Z';

  const first = appendHistory(history, [notice({ id: 'a' }), notice({ id: 'b' })], { at });
  assert.equal(first.added, 2);
  assert.equal(history.items.length, 2);
  assert.ok(history.items.every((i) => i.firstSeenAt === at));
  assert.equal(history.updatedAt, at);

  const second = appendHistory(history, [notice({ id: 'a' }), notice({ id: 'c' })], { at: '2026-09-29T00:00:00.000Z' });
  assert.equal(second.added, 1, '只有 c 是新的');
  assert.equal(history.items.length, 3);
});

test('history：按日期倒序，新的在前', () => {
  const history = emptyHistory();
  appendHistory(history, [
    notice({ id: 'old', date: '2026-01-01' }),
    notice({ id: 'new', date: '2026-09-02' }),
    notice({ id: 'mid', date: '2026-05-05' }),
  ]);
  assert.deepEqual(history.items.map((i) => i.id), ['new', 'mid', 'old']);
});

test('history：超过上限时丢最旧的，仓库不会无限膨胀', () => {
  const history = emptyHistory();
  const many: Notice[] = Array.from({ length: 10 }, (_, i) =>
    notice({ id: `id${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}` }),
  );
  appendHistory(history, many, { cap: 4 });
  assert.equal(history.items.length, 4);
  // 留下的是日期最新的 4 条：01-10 … 01-07
  assert.deepEqual(history.items.map((i) => i.id), ['id9', 'id8', 'id7', 'id6']);
});

test('history：按源统计与按天统计', () => {
  const history = emptyHistory();
  appendHistory(
    history,
    [
      notice({ id: 'a', sourceId: 'jwc', sourceName: '教务处' }),
      notice({ id: 'b', sourceId: 'jwc', sourceName: '教务处' }),
      notice({ id: 'c', sourceId: 'news', sourceName: '新闻网' }),
    ],
    { at: '2026-09-28T10:00:00.000Z' },
  );

  const bySource = countBySource(history);
  assert.equal(bySource[0].sourceId, 'jwc');
  assert.equal(bySource[0].count, 2);
  assert.equal(bySource[1].count, 1);

  const byDay = countByDay(history, 3, new Date('2026-09-28T12:00:00.000Z'));
  assert.equal(byDay.length, 3);
  assert.equal(byDay.at(-1)?.day, '2026-09-28');
  assert.equal(byDay.at(-1)?.count, 3);
  assert.equal(byDay[0].count, 0, '更早的日子应为 0');
});

test('history：读写文件能往返，文件不存在时返回空历史', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-radar-history-'));
  const file = path.join(dir, 'history.json');

  assert.equal(loadHistory(file).items.length, 0, '文件不存在不该抛错');
  const history = emptyHistory();
  appendHistory(history, [notice({ id: 'x' })]);
  saveHistory(history, file);
  assert.equal(loadHistory(file).items[0].id, 'x');

  fs.rmSync(dir, { recursive: true, force: true });
});
