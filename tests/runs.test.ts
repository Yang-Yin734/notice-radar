import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyRuns, loadRuns, recordRun, renderRate, saveRuns, summarizeRuns } from '../src/core/runs.ts';
import type { SourceResult } from '../src/types.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const result = (over: Partial<SourceResult>): SourceResult => ({
  sourceId: 'jwc',
  sourceName: '教务处',
  url: 'https://x.edu.cn/',
  adapter: 'html-list',
  ok: true,
  error: null,
  status: 200,
  bytes: 1000,
  tookMs: 50,
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

test('runs：记录每轮结果，成功=抓到条目，失败=报错或解析出 0 条（issue #6）', () => {
  const at = '2026-10-01T00:00:00.000Z';
  let state = emptyRuns();

  state = recordRun([result({})], state, { at }).state;
  state = recordRun([result({ ok: false, error: 'boom', items: [] })], state, { at }).state;
  state = recordRun([result({ items: [] })], state, { at }).state;

  assert.deepEqual(state.sources.jwc, ['ok', 'fail', 'fail']);
  const rate = summarizeRuns(state).get('jwc');
  assert.equal(rate?.runs, 3);
  assert.equal(rate?.ok, 1);
  assert.equal(rate?.last, 'fail');
});

test('runs：被跳过的源（需要浏览器）不计入，免得成功率失真', () => {
  const state = recordRun([result({ skipped: true, ok: false, items: [] })], emptyRuns()).state;
  assert.deepEqual(state.sources, {});
});

test('runs：滚动窗口只留最近 N 次', () => {
  let state = emptyRuns();
  for (let i = 0; i < 25; i++) {
    state = recordRun([result({ ok: i % 2 === 0, items: i % 2 === 0 ? result({}).items : [] })], state, { window: 20 }).state;
  }
  assert.equal(state.sources.jwc.length, 20);
});

test('runs：doctor 那一列的文案（低于 80% 会打警示）', () => {
  let state = emptyRuns();
  for (let i = 0; i < 10; i++) state = recordRun([result({ ok: i < 9, items: i < 9 ? result({}).items : [] })], state).state;
  const good = summarizeRuns(state).get('jwc');
  assert.equal(renderRate(good), '最近 10 次成功 9 次（90%）');
  assert.ok(!renderRate(good)?.includes('⚠'));

  let bad = emptyRuns();
  for (let i = 0; i < 4; i++) bad = recordRun([result({ ok: i === 0, items: i === 0 ? result({}).items : [] })], bad).state;
  assert.match(renderRate(summarizeRuns(bad).get('jwc')) ?? '', /25%（⚠|）/);
  assert.match(renderRate(summarizeRuns(bad).get('jwc')) ?? '', /⚠/);
});

test('runs：没有记录的源返回空串，坏文件不影响程序', () => {
  assert.equal(renderRate(undefined), '');
  assert.equal(renderRate({ sourceId: 'x', runs: 0, ok: 0, rate: 0, last: null }), '');

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-runs-')), 'runs.json');
  fs.writeFileSync(file, '不是 json', 'utf8');
  assert.deepEqual(loadRuns(file).sources, {});

  const state = recordRun([result({})], emptyRuns()).state;
  saveRuns(state, file);
  assert.deepEqual(loadRuns(file).sources.jwc, ['ok']);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
