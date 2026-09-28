#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './core/config.ts';
import type { RadarConfig, SourceConfig } from './core/config.ts';
import { fetchHtml } from './core/fetch.ts';
import { getAdapter, listAdapters } from './adapters/index.ts';
import { evaluate } from './core/filter.ts';
import { loadState, markSeen, saveState, splitNew, dedupeAcrossSources } from './core/dedupe.ts';
import { renderDoctor, renderJson, renderMarkdown } from './core/report.ts';
import { notifyAll } from './notify/index.ts';
import type { Notice, SourceResult } from './types.ts';

// 先加载项目根目录的 .env（Node 原生能力，不用 dotenv 依赖）。
// 密钥放 .env 只影响本机，.env 已在 .gitignore 里，不会被提交。
for (const file of ['.env', '.env.local']) {
  if (!fs.existsSync(file)) continue;
  try {
    process.loadEnvFile?.(file);
  } catch {
    // .env 格式不合法时不该让整个程序崩掉
  }
}

const VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

const DEFAULT_CONFIG = path.join('config', 'schools', 'uestc.yaml');
const DEFAULT_STATE = path.join('data', 'state.json');

interface Flags {
  config: string;
  state: string;
  dry: boolean;
  notify: boolean;
  json: string | null;
  delayMs: number;
  max: number;
}

function parseFlags(argv: string[]): Flags {
  const get = (name: string): string | null => {
    const withEq = argv.find((a) => a.startsWith(`--${name}=`));
    if (withEq) return withEq.slice(name.length + 3);
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
    return null;
  };
  return {
    config: get('config') ?? DEFAULT_CONFIG,
    state: get('state') ?? DEFAULT_STATE,
    dry: argv.includes('--dry'),
    notify: !argv.includes('--no-notify'),
    json: get('json'),
    delayMs: Number(get('delay') ?? 1200),
    max: Number(get('max') ?? 20),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 抓取 + 解析。不做过滤，也不动状态 —— doctor 和 run 共用这一段。 */
async function collect(cfg: RadarConfig, delayMs: number): Promise<SourceResult[]> {
  const results: SourceResult[] = [];
  const sources = cfg.sources.filter((s) => s.enabled);

  for (const [index, source] of sources.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs); // 串行 + 间隔，别给学校站点添麻烦
    results.push(await collectOne(cfg, source));
  }
  return results;
}

async function collectOne(cfg: RadarConfig, source: SourceConfig): Promise<SourceResult> {
  const base: SourceResult = {
    sourceId: source.id,
    sourceName: source.name,
    url: source.url,
    adapter: source.adapter,
    ok: false,
    error: null,
    status: null,
    bytes: 0,
    tookMs: 0,
    items: [],
  };

  const adapter = getAdapter(source.adapter);
  if (!adapter) {
    return { ...base, error: `未知适配器 "${source.adapter}"（可用：${listAdapters().join(', ')}）` };
  }

  const t0 = Date.now();
  try {
    const res = await fetchHtml(source.url);
    const items = adapter.parse({ source, school: cfg.school, html: res.html });
    return { ...base, ok: true, status: res.status, bytes: res.bytes, tookMs: Date.now() - t0, items };
  } catch (e) {
    return { ...base, error: (e as Error).message, tookMs: Date.now() - t0 };
  }
}

function filterItems(results: SourceResult[], cfg: RadarConfig): Notice[] {
  const byId = new Map(cfg.sources.map((s) => [s.id, s]));
  const kept: Notice[] = [];
  for (const r of results) {
    const source = byId.get(r.sourceId);
    if (!source) continue;
    for (const item of r.items) {
      if (evaluate(item.title, source.include, source.exclude).pass) kept.push(item);
    }
  }
  return kept;
}

async function cmdRun(flags: Flags): Promise<number> {
  const cfg = loadConfig(flags.config);
  const state = loadState(flags.state);

  console.log(`▸ ${cfg.name}（${cfg.school}）：${cfg.sources.filter((s) => s.enabled).length} 个源`);
  const results = await collect(cfg, flags.delayMs);
  const matched = filterItems(results, cfg);
  // 先跨源去重（教务处同一条通知常挂两个栏目），再算新增；但状态里把命中的都记上，
  // 免得下次换个栏目又把同一条当新通知报一遍。
  const filtered = dedupeAcrossSources(matched);
  const fresh = splitNew(filtered, state);

  for (const r of results) {
    const kept = filterItems([r], cfg).length;
    const isNew = fresh.filter((n) => n.sourceId === r.sourceId).length;
    const mark = r.ok ? (r.items.length === 0 ? '⚠' : '✓') : '✗';
    console.log(`  ${mark} ${r.sourceName}：解析 ${r.items.length} → 过滤后 ${kept} → 新增 ${isNew}${r.ok ? '' : ` (${r.error})`}`);
  }

  const markdown = renderMarkdown(results, fresh, { maxPerSource: flags.max });
  console.log(`\n${markdown}`);

  if (flags.json) {
    fs.mkdirSync(path.dirname(flags.json), { recursive: true });
    fs.writeFileSync(flags.json, renderJson(results, fresh), 'utf8');
    console.log(`\n▸ JSON 已写入 ${flags.json}`);
  }

  if (flags.notify && fresh.length > 0) {
    const outcomes = await notifyAll(cfg.notify, `校园通知雷达 · 新增 ${fresh.length} 条`, markdown);
    for (const o of outcomes) console.log(`  ${o.ok ? '✓' : '✗'} 通知[${o.channel}] ${o.detail}`);
  } else if (fresh.length === 0) {
    console.log('\n▸ 没有新通知，跳过推送。');
  }

  if (flags.dry) {
    console.log('\n▸ --dry：未写入状态文件。');
  } else {
    markSeen(matched, state);
    saveState(flags.state, state);
    console.log(`\n▸ 状态已更新：${flags.state}（下次只报新增）`);
  }

  const okCount = results.filter((r) => r.ok).length;
  return okCount === 0 ? 1 : 0;
}

async function cmdDoctor(flags: Flags): Promise<number> {
  const cfg = loadConfig(flags.config);
  console.log(`▸ 体检 ${cfg.name}：${cfg.sources.filter((s) => s.enabled).length} 个源\n`);
  const results = await collect(cfg, flags.delayMs);
  console.log(renderDoctor(results));
  const broken = results.filter((r) => !r.ok || r.items.length === 0).length;
  console.log('\n提示：状态 202 或体积 <4KB 通常是 WAF 挑战页；抓到了但条目为 0 说明选择器过时了。');
  return broken === 0 ? 0 : 1;
}

function cmdList(flags: Flags): number {
  const cfg = loadConfig(flags.config);
  console.log(`${cfg.name}（${cfg.school}）· 适配器：${listAdapters().join(', ')}\n`);
  for (const s of cfg.sources) {
    const state = s.enabled ? ' ' : '×';
    console.log(`${state} ${s.id.padEnd(18)} ${s.adapter.padEnd(12)} 含${String(s.include.length).padStart(2)}词 排${String(s.exclude.length).padStart(2)}词  ${s.name}`);
    console.log(`  ${s.url}`);
  }
  return 0;
}

function usage(): void {
  console.log(`notice-radar v${VERSION} —— 把高校官网通知变成能推到手机的信息流

用法：
  radr run      [--config=路径] [--dry] [--no-notify] [--json=路径] [--delay=毫秒] [--max=条数]
  radr doctor   [--config=路径]          体检：每个源能不能抓、解析出几条
  radr list     [--config=路径]          列出配置里的源
  radr --version                         打印版本

默认配置：${DEFAULT_CONFIG}
默认状态：${DEFAULT_STATE}（只记"见过哪些通知"，不含正文与个人信息）
推送密钥：从环境变量或项目根目录的 .env 读（默认 SERVERCHAN_KEY），永不落盘。`);
}

const [, , command = 'run', ...rest] = process.argv;
const flags = parseFlags(rest);

let code = 0;
try {
  if (command === 'run') code = await cmdRun(flags);
  else if (command === 'doctor') code = await cmdDoctor(flags);
  else if (command === 'list') code = cmdList(flags);
  else if (command === '--version' || command === '-v' || command === 'version') console.log(VERSION);
  else if (command === 'help' || command === '--help' || command === '-h') usage();
  else {
    console.error(`未知命令：${command}\n`);
    usage();
    code = 2;
  }
} catch (e) {
  console.error(`✗ ${(e as Error).message}`);
  code = 1;
}
process.exit(code);
