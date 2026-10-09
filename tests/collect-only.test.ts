import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadAllSchoolSources, loadConfig, loadSchoolConfigs, mergeSources } from '../src/core/config.ts';
import { collectOnlyIds, notifiable } from '../src/core/tiers.ts';

/**
 * 「只采集不通知」档的测试。
 *
 * 为什么值得测：全国名单里陆续接入的学校，用户还没订阅 —— 它们的通知不该推送、
 * 不该进日报、抓失败也不该告警。但这三件事都发生在 CLI 的分支里，
 * 一旦漏掉一处，用户半夜被一条"某某职业学院选课通知"吵醒，就会把整个功能关掉。
 * 所以把"谁能进通知链路"做成纯函数，在这里钉死。
 */

const sources = [
  { id: 'uestc-jwc', collectOnly: false },
  { id: 'scu-jwc', collectOnly: true },
  { id: 'swjtu-jwc' },
];

test('collectOnlyIds：只收标了 collectOnly 的源', () => {
  const ids = collectOnlyIds(sources);
  assert.deepEqual([...ids], ['scu-jwc']);
  assert.equal(collectOnlyIds([{ id: 'a' }]).size, 0, '默认（不写字段）不该被当成只采集');
});

test('notifiable：只采集的源不进通知链路，其余原样保留顺序', () => {
  const items = [
    { sourceId: 'uestc-jwc', title: 'A' },
    { sourceId: 'scu-jwc', title: 'B' },
    { sourceId: 'swjtu-jwc', title: 'C' },
    { sourceId: 'scu-jwc', title: 'D' },
  ];
  const kept = notifiable(items, sources);
  assert.deepEqual(
    kept.map((i) => i.title),
    ['A', 'C'],
    '电子科大与西南交大的要留下，四川大学的（只采集）要剔除',
  );
  assert.equal(items.length, 4, '不能改动原数组');
});

test('notifiable：没有只采集的源时返回原数组本身（不做多余拷贝）', () => {
  const items = [{ sourceId: 'uestc-jwc' }];
  const all = [{ id: 'uestc-jwc' }];
  assert.equal(notifiable(items, all), items);
  assert.equal(notifiable(items, []), items);
});

test('配置：collectOnly 默认 false，显式写 true 才生效', () => {
  const file = path.join(os.tmpdir(), `notice-radar-collect-only-${process.pid}.yaml`);
  fs.writeFileSync(
    file,
    [
      'school: demo',
      'name: 演示学校',
      'sources:',
      '  - id: a',
      '    name: 教务处·通知',
      '    url: https://example.edu.cn/tzgg.htm',
      '    selectors: { item: ul.news li, title: a@title, link: a@href, date: span.date }',
      '    collectOnly: true',
      '  - id: b',
      '    name: 研究生院·通知',
      '    url: https://example.edu.cn/yjs.htm',
      '    selectors: { item: ul.news li, title: a@title, link: a@href, date: span.date }',
    ].join('\n'),
    'utf8',
  );
  try {
    const cfg = loadConfig(file);
    assert.equal(cfg.sources[0].collectOnly, true);
    assert.equal(cfg.sources[1].collectOnly, false, '没写的源默认还是要通知的');
    assert.deepEqual([...collectOnlyIds(cfg.sources)], ['a']);
    assert.ok(
      cfg.sources[1].alertOnFailure,
      'collectOnly 不改变其它开关：故障告警另有 alertOnFailure 控制',
    );
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('loadAllSchoolSources：日报靠它认出"只采集不通知"的源', () => {
  const all = loadAllSchoolSources();
  assert.ok(all.length >= 5, `只读到 ${all.length} 个源，像是没扫到 config/schools/*.yaml`);

  const collected = all.find((s) => s.id === 'jwc-tzgg');
  assert.ok(collected, '应该读到西南财经大学的教务处源');
  assert.equal(collected.collectOnly, true, '它是只采集不通知（全国名单接入第一阶段的默认档）');

  const notified = all.find((s) => s.id === 'jwc-student');
  assert.ok(notified && !notified.collectOnly, '电子科大的源照旧要通知');

  // 日报的实际用法：拿这份并集去过滤归档
  const history = [{ sourceId: 'jwc-student', title: 'A' }, { sourceId: 'jwc-tzgg', title: 'B' }];
  assert.deepEqual(
    notifiable(history, all).map((i) => i.title),
    ['A'],
    '别的学校（只采集）的通知不该进日报',
  );
});

test('loadSchoolConfigs：按学校分组，撞名的源不会被并到一起', () => {
  const configs = loadSchoolConfigs();
  assert.ok(configs.length >= 5, `只读到 ${configs.length} 所学校，像是没扫到 config/schools/*.yaml`);

  const schools = configs.map((c) => c.school);
  assert.equal(new Set(schools).size, schools.length, '每所学校只出现一次');

  // 同一所学校的多个预设要合成一份（uestc.yaml 电子科大 + uestc-math.yaml 数学科学学院）
  const uestc = configs.find((c) => c.school === 'uestc');
  assert.ok(uestc, '应该有一所 uestc');
  const ids = uestc.sources.map((s) => s.id);
  assert.ok(ids.includes('jwc-student'), 'uestc.yaml 的源要并进来');
  assert.ok(ids.includes('math-jwgg'), 'uestc-math.yaml 的源也要并进来');
  assert.equal(
    uestc.name,
    '电子科技大学',
    '显示名要取 uestc.yaml（学校级），不能被 uestc-math.yaml 的"数学科学学院"顶掉',
  );

  // 撞键的实况：`jwc-tzgg` 这个 id 在 9 所学校的预设里各出现一次。
  // 正因为按学校分组，`radr rate` 才能分学校统计而不把它们混成一个源。
  const owners = configs.filter((c) => c.sources.some((s) => s.id === 'jwc-tzgg'));
  assert.ok(owners.length >= 5, `jwc-tzgg 只出现在 ${owners.length} 所学校里，撞键前提变了`);
  assert.equal(new Set(owners.map((c) => c.school)).size, owners.length);
});

test('mergeSources：按 id 去重，collectOnly 取"或"', () => {
  // 同一所学校可能有多个预设（uestc.yaml / uestc-math.yaml），同一个源会出现两次
  const a = [{ id: 'x', name: '甲', collectOnly: false }, { id: 'y', name: '乙' }];
  const b = [{ id: 'x', name: '甲', collectOnly: true }, { id: 'z', name: '丙' }];
  const merged = mergeSources(a as never, b as never);
  assert.deepEqual(
    merged.map((s) => s.id),
    ['x', 'y', 'z'],
    '重复的源只留一份，且保持首次出现的顺序',
  );
  assert.equal(
    merged.find((s) => s.id === 'x')!.collectOnly,
    true,
    '任一份预设标了只采集，就不通知（不能因为另一份没标就发出去）',
  );
  assert.equal(mergeSources([], []).length, 0);
});
