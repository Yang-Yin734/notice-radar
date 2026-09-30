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

const failed = (over: Partial<SourceResult> = {}) => result({ ok: false, error: 'fetch failed', items: [], ...over });
const at = (minutes: number) => new Date(Date.parse('2026-10-01T00:00:00Z') + minutes * 60_000).toISOString();

test('runs：记录每轮结果，成功=抓到条目，失败=报错或解析出 0 条（issue #6）', () => {
  let state = emptyRuns();
  state = recordRun([result({})], state, { at: at(0) }).state;
  state = recordRun([failed()], state, { at: at(60) }).state;
  state = recordRun([result({ items: [] })], state, { at: at(120) }).state;

  assert.deepEqual(state.sources.jwc, ['ok', 'fail', 'fail']);
  const rate = summarizeRuns(state).get('jwc');
  assert.equal(rate?.runs, 3);
  assert.equal(rate?.ok, 1);
  assert.equal(rate?.last, 'fail');
});

test('runs：同一轮里的重试只算一次失败（poll 工作流一轮最多重试 4 次）', () => {
  // 实测踩过的坑：runs.json 里出现 fail,fail,fail,fail,ok —— 重试到第 3 次就顶到了告警阈值，
  // 而工作流其实第 4 次成功了。所以同一失败期内的重试必须合并。
  const base = emptyRuns();
  let state = recordRun([failed()], base, { at: at(0) }).state;
  assert.deepEqual(state.sources.jwc, ['fail']);

  for (const seconds of [30, 80, 150]) {
    const next = recordRun([failed()], state, { at: new Date(Date.parse(at(0)) + seconds * 1000).toISOString() });
    assert.equal(next.changed, false, '重试不该产生新记录');
    state = next.state;
  }
  assert.deepEqual(state.sources.jwc, ['fail'], '四次尝试只算一次失败');
  assert.equal(state.updatedAt, at(0), '失败期的锚点时间不能被重试推后');

  // 20 分钟后的下一轮仍失败 → 这才是"第二次失败"
  const later = recordRun([failed()], state, { at: at(20) });
  assert.equal(later.changed, true);
  assert.deepEqual(later.state.sources.jwc, ['fail', 'fail']);
});

test('runs：安静的成功不产生记录（否则一天 72 次无谓提交）', () => {
  const state = recordRun([result({})], emptyRuns(), { at: at(0) }).state;
  const again = recordRun([result({})], state, { at: at(20) });
  assert.equal(again.changed, false);
  assert.deepEqual(again.state.sources.jwc, ['ok']);
  assert.equal(again.state.updatedAt, state.updatedAt, '时间戳也不该动');
});

test('runs：恢复成功会清零连续计数，并且这次要被记下来', () => {
  let state = emptyRuns();
  state = recordRun([failed()], state, { at: at(0) }).state;
  state = recordRun([failed()], state, { at: at(20) }).state;
  const recovered = recordRun([result({})], state, { at: at(40) });
  assert.equal(recovered.changed, true, 'fail→ok 必须落盘，否则连续计数清不掉');
  assert.deepEqual(recovered.state.sources.jwc, ['fail', 'fail', 'ok']);
});

test('runs：被跳过的源（需要浏览器）不计入，免得成功率失真', () => {
  const state = recordRun([result({ skipped: true, ok: false, items: [] })], emptyRuns()).state;
  assert.deepEqual(state.sources, {});
});

test('runs：滚动窗口只留最近 N 次', () => {
  let state = emptyRuns();
  for (let i = 0; i < 25; i++) {
    state = recordRun([i % 2 === 0 ? result({}) : failed()], state, { at: at(i * 60), window: 20 }).state;
  }
  assert.equal(state.sources.jwc.length, 20);
});

test('runs：doctor 那一列是「最近 N 次记录」的构成，只记状态变化（要如实标注）', () => {
  // 9 次成功 + 1 次失败：连续成功之间不记录，所以记录里只有 ok→fail 这一次变化
  let state = emptyRuns();
  for (let i = 0; i < 10; i++) state = recordRun([i < 9 ? result({}) : failed()], state, { at: at(i * 60) }).state;
  assert.deepEqual(state.sources.jwc, ['ok', 'fail'], '连续成功不重复记录（否则一天 72 次提交）');
  assert.match(renderRate(summarizeRuns(state).get('jwc')) ?? '', /近 2 次记录：成功 1（50%）/);

  // 反复抖动（ok/fail 交替）才会被如实记下来，并打出警示
  let flaky = emptyRuns();
  for (let i = 0; i < 6; i++) flaky = recordRun([i % 2 === 0 ? result({}) : failed()], flaky, { at: at(i * 60) }).state;
  const rate = summarizeRuns(flaky).get('jwc');
  assert.equal(rate?.runs, 6);
  assert.equal(rate?.ok, 3);
  assert.match(renderRate(rate) ?? '', /50%/);
  assert.match(renderRate(rate) ?? '', /⚠/, '抖动的源要能一眼看出来');
});

test('runs：没有记录的源返回空串，坏文件不影响程序', () => {
  assert.equal(renderRate(undefined), '');
  assert.equal(renderRate({ sourceId: 'x', runs: 0, ok: 0, rate: 0, last: null }), '');

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-runs-')), 'runs.json');
  fs.writeFileSync(file, '不是 json', 'utf8');
  assert.deepEqual(loadRuns(file).sources, {});

  const state = recordRun([result({})], emptyRuns(), { at: at(0) }).state;
  saveRuns(state, file);
  assert.deepEqual(loadRuns(file).sources.jwc, ['ok']);
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
