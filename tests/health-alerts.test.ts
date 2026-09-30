import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory } from '../src/core/history.ts';
import {
  confirmByStreak,
  detectProblems,
  detectSilence,
  emptyAlerts,
  failureStreak,
  loadAlerts,
  problemTitle,
  renderProblemMarkdown,
  renderSilenceNotice,
  renderSilenceText,
  saveAlerts,
  silenceTitle,
  throttleProblems,
} from '../src/core/health.ts';
import type { History } from '../src/core/history.ts';
import type { Notice, SourceResult } from '../src/types.ts';
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
  bytes: 1234,
  tookMs: 100,
  items: [],
  ...over,
});

const notice = (over: Partial<Notice>): Notice => ({
  id: 'id1',
  sourceId: 'jwc',
  sourceName: '教务处',
  school: 'uestc',
  title: '通知',
  url: 'https://x.edu.cn/1',
  date: '2026-09-02',
  tag: null,
  ...over,
});

// ---------------------------------------------------------------- 硬故障

test('health：抓取失败与「抓到了却解析出 0 条」都要告警', () => {
  const problems = detectProblems([
    result({ sourceId: 'a', sourceName: 'A', ok: false, error: 'HTTP 403', status: 403 }),
    result({ sourceId: 'b', sourceName: 'B', items: [] }),
    result({ sourceId: 'c', sourceName: 'C', items: [notice({})] }),
  ]);
  assert.equal(problems.length, 2);
  assert.deepEqual(problems.map((p) => p.kind), ['fetch-failed', 'parse-empty']);
  assert.match(problems[0].detail, /403/);
  assert.match(problems[1].detail, /选择器可能过时/);
});

test('health：被跳过的源（需要浏览器但没开 --allow-browser）不算故障', () => {
  const problems = detectProblems([
    result({ sourceId: 'math', sourceName: '数学学院', ok: false, skipped: true, error: '需要浏览器', items: [] }),
  ]);
  assert.deepEqual(problems, []);
});

test('health：单次失败不算故障 —— 要连续失败到阈值才告警（实测误报过）', () => {
  assert.equal(failureStreak(undefined), 0);
  assert.equal(failureStreak([]), 0);
  assert.equal(failureStreak(['ok']), 0);
  assert.equal(failureStreak(['ok', 'fail']), 1);
  assert.equal(failureStreak(['fail', 'fail', 'fail']), 3);
  assert.equal(failureStreak(['fail', 'ok', 'fail']), 1, '中间成功过就重新计数');

  const problems = detectProblems([result({ sourceId: 'a', sourceName: 'A', ok: false, error: 'boom' })]);
  const { confirmed, pending } = confirmByStreak(problems, { a: 1 }, 3);
  assert.equal(confirmed.length, 0, '第 1 次失败不告警（网络天气）');
  assert.equal(pending.length, 1);

  const third = confirmByStreak(problems, { a: 3 }, 3);
  assert.equal(third.confirmed.length, 1, '连续第 3 次才告警');
  assert.equal(third.pending.length, 0);

  // Map 形式也支持
  assert.equal(confirmByStreak(problems, new Map([['a', 5]]), 3).confirmed.length, 1);
});

test('health：告警正文写清"连续几次"、是否所有源一起挂、以及怎么排查', () => {
  const problems = detectProblems([
    result({ sourceId: 'a', sourceName: '教务处·重要公告', ok: false, error: 'HTTP 403' }),
  ]);
  const md = renderProblemMarkdown(problems, '电子科技大学', {
    streakOf: () => 3,
    allFailed: true,
    minStreak: 3,
  });
  assert.match(md, /已连续 3 次/);
  assert.match(md, /连续 3 次/, '逐条也要标出次数');
  assert.match(md, /所有源一起失败/, '要说明可能只是网络问题，避免用户白折腾');
  assert.match(md, /radr health/, '给出排查命令');
  assert.match(md, /alerts\.failureNotify/, '告诉用户怎么关掉这类提醒');
});

test('health：同一个源在节流窗口内只告警一次，过期后会再报', () => {
  const problems = detectProblems([result({ sourceId: 'a', sourceName: 'A', ok: false, error: 'boom' })]);
  const t0 = new Date('2026-09-29T00:00:00Z');

  const first = throttleProblems(problems, emptyAlerts(), { now: t0, throttleHours: 12 });
  assert.equal(first.send.length, 1, '第一次要发');
  assert.equal(first.record.lastAlertAt.a, t0.toISOString());

  const second = throttleProblems(problems, first.record, { now: new Date('2026-09-29T06:00:00Z'), throttleHours: 12 });
  assert.equal(second.send.length, 0, '6 小时后不重复打扰');

  const third = throttleProblems(problems, second.record, { now: new Date('2026-09-29T13:00:00Z'), throttleHours: 12 });
  assert.equal(third.send.length, 1, '超过 12 小时可以再提醒一次');
});

test('health：告警标题与正文说清是哪个源、怎么办', () => {
  const problems = detectProblems([result({ sourceId: 'a', sourceName: '数学科学学院·教务公告', ok: false, error: 'HTTP 404' })]);
  assert.match(problemTitle(problems, '电子科技大学'), /数学科学学院/);
  assert.ok(problemTitle(problems, '电子科技大学').length <= 32);

  const md = renderProblemMarkdown(problems, '电子科技大学');
  assert.match(md, /数学科学学院·教务公告/);
  assert.match(md, /HTTP 404/);
  assert.match(md, /radr doctor/, '要告诉用户下一步怎么查');
});

// ---------------------------------------------------------------- 长期静默

function historyOf(rows: { sourceId: string; at: string }[]): History {
  const history = emptyHistory();
  history.items = rows.map((r, i) => ({
    ...notice({ id: `n${i}`, sourceId: r.sourceId, sourceName: r.sourceId }),
    firstSeenAt: r.at,
  }));
  return history;
}

test('health：某源连续 N 天没动静要报出来，正常源不报', () => {
  const history = historyOf([
    { sourceId: 'busy', at: '2026-09-28T00:00:00Z' },
    { sourceId: 'quiet', at: '2026-08-01T00:00:00Z' },
  ]);
  const issues = detectSilence(
    history,
    [
      { id: 'busy', name: '教务处', enabled: true },
      { id: 'quiet', name: '数学学院', enabled: true },
    ],
    { silenceDays: 14, now: new Date('2026-09-29T00:00:00Z') },
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].sourceId, 'quiet');
  assert.equal(issues[0].kind, 'silent');
  assert.equal(issues[0].days, 59);
  assert.equal(issues[0].lastSeenAt, '2026-08-01T00:00:00Z');
});

test('health：单源阈值覆盖全局（假期本来就安静的源可以放宽）', () => {
  const history = historyOf([{ sourceId: 'term', at: '2026-08-20T00:00:00Z' }]);
  const sources = [{ id: 'term', name: '学期性栏目', enabled: true, silenceDays: 90 }];
  const issues = detectSilence(history, sources, { silenceDays: 14, now: new Date('2026-09-29T00:00:00Z') });
  assert.deepEqual(issues, [], '90 天阈值下还不算异常');
});

test('health：从未抓到过条目的源也能识别（但要看观察期够不够）', () => {
  const history = historyOf([{ sourceId: 'ok', at: '2026-09-28T00:00:00Z' }]);
  const sources = [
    { id: 'ok', name: '教务处', enabled: true },
    { id: 'ghost', name: '新加的源', enabled: true },
  ];
  const now = new Date('2026-09-29T00:00:00Z');

  const issues = detectSilence(history, sources, { warmupDays: 3, now });
  assert.deepEqual(issues, [], '归档只观察了 1 天，先不下结论');

  const later = detectSilence(history, sources, { warmupDays: 3, now: new Date('2026-10-05T00:00:00Z') });
  assert.equal(later.length, 1);
  assert.equal(later[0].kind, 'never');
  assert.match(renderSilenceNotice(later), /一条都没抓到过/);
});

test('health：被禁用的源不参与静默判定', () => {
  const history = historyOf([{ sourceId: 'a', at: '2026-09-28T00:00:00Z' }]);
  const issues = detectSilence(history, [{ id: 'off', name: '已停用', enabled: false }], {
    now: new Date('2026-10-30T00:00:00Z'),
  });
  assert.deepEqual(issues, []);
});

test('health：没有异常时不产出任何提示文字（不制造噪音）', () => {
  assert.equal(renderSilenceNotice([]), '');
  assert.equal(renderSilenceText([]), '');
  const issues = detectSilence(historyOf([{ sourceId: 'q', at: '2026-08-01T00:00:00Z' }]), [
    { id: 'q', name: '数学学院', enabled: true },
  ], { silenceDays: 14, now: new Date('2026-09-29T00:00:00Z') });
  assert.match(renderSilenceNotice(issues), /59 天没有新通知（阈值 14 天）/);
  assert.match(renderSilenceText(issues), /阈值 14 天/);
  assert.ok(silenceTitle(issues, '电子科技大学').length <= 32);
});

test('health：节流记录能落盘并读回（含损坏文件容错）', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'radar-alerts-')), 'alerts.json');
  const record = throttleProblems(
    detectProblems([result({ sourceId: 'a', sourceName: 'A', ok: false, error: 'x' })]),
    emptyAlerts(),
    { now: new Date('2026-09-29T00:00:00Z') },
  ).record;
  saveAlerts(record, file);
  assert.equal(loadAlerts(file).lastAlertAt.a, '2026-09-29T00:00:00.000Z');

  fs.writeFileSync(file, '{ 坏掉的 json', 'utf8');
  assert.deepEqual(loadAlerts(file).lastAlertAt, {}, '坏文件退回空记录，不能让程序崩');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
