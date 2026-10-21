import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadAllSchoolSources, loadConfig, mergeSources } from '../src/core/config.ts';
import { loadScopedHistory } from '../src/core/history.ts';
import { collectOnlyIds } from '../src/core/tiers.ts';

/**
 * 诊断命令（stats / tiers）只看「会通知」的条目。
 *
 * 为什么值得测：云端 poll 会把全国 19 所学校的源都跑一遍，其中绝大多数是
 * `collectOnly`（只采集不通知），它们的条目照样写进 data/history.json（仪表盘
 * 按校视图要用）。于是 `radr tiers` 直接读全量的话，用户会看到别的学校的通知、
 * 以为自己的关键词表配错了 —— 2026-10 的评审就是这么发现问题的。
 *
 * 这一层过滤下沉到了 `loadScopedHistory()`，这里钉死三件事：
 * 剔除 collectOnly、配置坏了不丢数据、真实配置下确实生效。
 */

function writeTempHistory(items: Array<Record<string, unknown>>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radr-scoped-'));
  const file = path.join(dir, 'history.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items }), 'utf8');
  return file;
}

const seenAt = new Date().toISOString();

const item = (sourceId: string, title: string) => ({
  sourceId,
  title,
  url: `https://example.edu/${encodeURIComponent(title)}`,
  firstSeenAt: seenAt,
});

const sources = [
  { id: 'jwc-uestc', collectOnly: false },
  { id: 'jwc-nankai', collectOnly: true },
  { id: 'jwc-swjtu' },
];

test('loadScopedHistory：剔除 collectOnly 源的条目，其余保持原顺序', () => {
  const file = writeTempHistory([
    item('jwc-uestc', '本校考试安排'),
    item('jwc-nankai', '南开验收公示'),
    item('jwc-swjtu', '西南交大选课'),
    item('jwc-nankai', '南开第二批公示'),
  ]);

  const history = loadScopedHistory(file, sources);
  assert.deepEqual(
    history.items.map((i) => i.title),
    ['本校考试安排', '西南交大选课'],
    '只采集不通知的学校不该出现在我的诊断里',
  );
  assert.equal(history.version, 1, '版本号等元信息要原样带过来');
  assert.equal(history.updatedAt.length > 0, true);
});

test('loadScopedHistory：sources 为空时一条都不丢（配置读坏了也不该把归档变空）', () => {
  const file = writeTempHistory([item('jwc-uestc', 'A'), item('jwc-nankai', 'B')]);
  const history = loadScopedHistory(file, []);
  assert.equal(history.items.length, 2);
});

test('loadScopedHistory：归档文件不存在时返回空归档而不是抛错', () => {
  const missing = path.join(os.tmpdir(), 'radr-not-exist', 'history.json');
  const history = loadScopedHistory(missing, sources);
  assert.deepEqual(history.items, []);
});

test('真实配置：uestc 视角下，别校（collectOnly）的归档条目确实被挡掉', () => {
  const cfg = loadConfig(path.join('config', 'schools', 'uestc.yaml'));
  const scoped = mergeSources(cfg.sources, loadAllSchoolSources());

  const silent = collectOnlyIds(scoped);
  assert.ok(silent.size > 0, '全校预设里应当有 collectOnly 学校（否则这个测试就失去意义）');

  const mine = cfg.sources[0]?.id;
  assert.ok(mine, 'uestc.yaml 至少要有一个源');

  const silentId = [...silent][0]!;
  const file = writeTempHistory([item(mine, '本校通知'), item(silentId, '别校通知')]);

  const history = loadScopedHistory(file, scoped);
  assert.deepEqual(
    history.items.map((i) => i.title),
    ['本校通知'],
    `sourceId=${silentId} 属于 collectOnly 学校，不该出现在 uestc 的诊断里`,
  );
});

test('mergeSources：本地配置优先，同 id 的源不会串到别校的 name/url', () => {
  const cfg = loadConfig(path.join('config', 'schools', 'uestc.yaml'));
  const merged = mergeSources(cfg.sources, loadAllSchoolSources());

  for (const local of cfg.sources) {
    const hit = merged.find((s) => s.id === local.id);
    assert.ok(hit, `合并后应保留本地源 ${local.id}`);
    assert.equal(hit.name, local.name, `源 ${local.id} 的 name 被别校预设覆盖了`);
    assert.equal(hit.url, local.url, `源 ${local.id} 的 url 被别校预设覆盖了`);
  }
});
