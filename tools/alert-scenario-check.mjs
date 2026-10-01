// 验证两条告警路径（用预置旧锚点的 runs.json 模拟"已经连续失败两轮、时间过去 2 小时"）
// 用法：node tools/alert-scenario-check.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const note = (id) => ({ id, sourceId: id, sourceName: id, school: 'demo', title: '通知', url: 'https://x.cn/1', date: '2026-10-01', tag: null });

function scenario(name, { config, sources, expectAlert }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-scenario-'));
  const state = path.join(dir, 'state.json');
  const cfgFile = path.join(dir, 'config.yaml');
  fs.writeFileSync(cfgFile, config, 'utf8');
  // 预置：这些源已经连续失败 2 次，且锚点时间在 2 小时前 → 本次成功累加就到达阈值
  fs.writeFileSync(
    path.join(dir, 'runs.json'),
    `${JSON.stringify({ version: 1, updatedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), sources: Object.fromEntries(sources.map((s) => [s, ['fail', 'fail']])) }, null, 2)}\n`,
    'utf8',
  );

  const run = spawnSync('node', ['src/cli.ts', 'run', `--config=${cfgFile}`, `--state=${state}`, '--delay=0'], {
    cwd: repo,
    encoding: 'utf8',
  });
  const out = `${run.stdout}\n${run.stderr}`;
  const alerted = /已就 \d+ 个源发出告警/.test(out);
  const weather = /按「网络天气」处理/.test(out);
  const ok = alerted === expectAlert;
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  console.log(`    告警发出：${alerted}（期望 ${expectAlert}）· 判定为网络天气：${weather}`);
  for (const line of out.split('\n').filter((l) => /⚠|▸ \d+ 个源本轮失败|网络天气|已就 |告警\[/.test(l)).slice(0, 5)) {
    console.log(`    ${line.trim()}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return ok;
}

const head = (extra) => `school: demo
name: 场景自检
notify:
  - type: stdout
alerts:
  failureNotify: true
  failureStreak: 3
  weatherStreak: 12
  throttleHours: 12
${extra}sources:
`;

let allOk = true;

// 场景一：整轮网络不通（两个源都是连不上的地址）→ 属于网络天气，不该打扰
allOk = scenario('场景一：所有源网络不通（fetch failed）→ 不告警', {
  config:
    head('') +
    `  - id: dead-a
    name: 打不通A
    url: https://127.0.0.1:9/a
    adapter: html-list
    selectors:
      item: div.item
      title: a
  - id: dead-b
    name: 打不通B
    url: https://127.0.0.1:9/b
    adapter: html-list
    selectors:
      item: div.item
      title: a
`,
  sources: ['dead-a', 'dead-b'],
  expectAlert: false,
}) && allOk;

// 场景二：单个源真的坏了（适配器名写错 = 非网络错误）→ 必须告警
allOk = scenario('场景二：单个源配置/站点真坏（非网络错误）→ 必须告警', {
  config:
    head('') +
    `  - id: broken
    name: 坏掉的源
    url: https://example.edu.cn/broken
    adapter: 不存在的适配器
`,
  sources: ['broken'],
  expectAlert: true,
}) && allOk;

console.log(allOk ? '\n✓ 两条路径都符合预期' : '\n✗ 有不符合预期的场景');
process.exit(allOk ? 0 : 1);
