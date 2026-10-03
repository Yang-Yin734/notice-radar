#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllSchoolSources, loadConfig, mergeSources, pageUrls, selectSources } from './core/config.ts';
import type { RadarConfig, SourceConfig } from './core/config.ts';
import { fetchHtml } from './core/fetch.ts';
import { renderHtml } from './core/browser.ts';
import { getAdapter, listAdapters } from './adapters/index.ts';
import { evaluate } from './core/filter.ts';
import { loadState, markSeen, saveState, splitNew, dedupeAcrossSources } from './core/dedupe.ts';
import { appendHistory, countBySource, loadHistory, renderStats, saveHistory, summarize } from './core/history.ts';
import { loadRuns, recordRun, saveRuns, summarizeRuns } from './core/runs.ts';
import { renderDashboard } from './dashboard.ts';
import { renderDoctor, renderJson, renderMarkdown } from './core/report.ts';
import { collectOnlyIds, explainTier, immediateItems, notifiable, splitByTier } from './core/tiers.ts';
import {
  DEFAULT_ALERT_FILE,
  confirmByStreak,
  detectProblems,
  detectSilence,
  failureStreak,
  isNetworkWeather,
  loadAlerts,
  problemTitle,
  renderProblemMarkdown,
  renderSilenceNotice,
  renderSilenceText,
  saveAlerts,
  silenceTitle,
  streakThreshold,
  successRate,
  throttleProblems,
  defaultAlertOptions,
} from './core/health.ts';
import {
  beijingDayRange,
  buildDigest,
  digestTitle,
  renderDigestMarkdown,
  renderDigestText,
  rollingRange,
  truncateForPush,
  yesterdayRange,
} from './core/digest.ts';
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

/** 包根目录（本文件在 <root>/src/cli.ts）。
 *  为什么要它：装成 npm 包后，用户是在**自己的目录**里执行 `npx notice-radar`，
 *  此时配置/登记表这些随包发布的文件必须相对包根找，而不是相对当前目录。 */
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULT_CONFIG = path.join('config', 'schools', 'uestc.yaml');
const DEFAULT_STATE = path.join('data', 'state.json');

/** 解析配置文件路径：当前目录找不到就退回包内置的学校预设（npm 全局安装场景）。 */
function resolveConfigPath(given: string): string {
  if (fs.existsSync(given)) return given;
  const inPackage = path.join(PKG_ROOT, given);
  if (fs.existsSync(inPackage)) return inPackage;
  return given; // 让 loadConfig 报出原始路径，错误信息更好懂
}

const loadCfg = (flags: Flags) => loadConfig(resolveConfigPath(flags.config));

interface Flags {
  config: string;
  state: string;
  dry: boolean;
  notify: boolean;
  json: string | null;
  delayMs: number;
  max: number;
  writeAlways: boolean;
  /** 允许用真浏览器渲染 requiresBrowser 的源（默认关，见 README 合规一节） */
  allowBrowser: boolean;
  out: string | null;
  expect: string | null;
  window: boolean;
  /** digest：时间窗（二选一，缺省=昨天北京时间） */
  date: string | null;
  hours: number | null;
  /** digest：窗口内没有新通知时也照常输出/发送 */
  force: boolean;
  /** digest：只有显式 --notify 才真的发送（默认只预览） */
  send: boolean;
  /** 用户是否显式传了 --max（digest 的默认上限与 run 不同） */
  maxExplicit: number | null;
  /** tiers：看最近多少天 */
  days: number | null;
  /** 只跑指定源（逗号分隔），调试单个源用（issue #2） */
  only: string | null;
  /** digest：推送**全部归档**（不分时间窗、不截断）—— 用来验证推送链路 */
  all: boolean;
  /** test-notify：只测某个通道（issue：微信通道多了，要能单独验） */
  channel: string | null;
  /** doctor：每个源顺带打印前 N 条解析结果（接入新学校时确认"没抓错东西"） */
  show: number;
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
    writeAlways: argv.includes('--write-always'),
    allowBrowser: argv.includes('--allow-browser'),
    out: get('out'),
    expect: get('expect'),
    window: argv.includes('--window'),
    date: get('date'),
    hours: get('hours') ? Number(get('hours')) : null,
    force: argv.includes('--force'),
    send: argv.includes('--notify'),
    maxExplicit: get('max') ? Number(get('max')) : null,
    days: get('days') ? Number(get('days')) : null,
    only: get('only'),
    all: argv.includes('--all'),
    channel: get('channel'),
    show: get('show') ? Number(get('show')) : 0,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 抓取 + 解析。不做过滤，也不动状态 —— doctor 和 run 共用这一段。
 *  支持 --only=<id> 只跑指定源（issue #2）与多页翻页（issue #7）。 */
async function collect(cfg: RadarConfig, flags: Flags): Promise<SourceResult[]> {
  const results: SourceResult[] = [];
  const enabled = cfg.sources.filter((s) => s.enabled);
  const sources = selectSources(enabled, flags.only);
  if (flags.only && sources.length === 0) {
    throw new Error(`--only=${flags.only} 没匹配到任何启用的源。可用：${enabled.map((s) => s.id).join(', ')}`);
  }
  if (flags.only && sources.length > 0) {
    console.log(`▸ --only：只跑 ${sources.length} 个源（${sources.map((s) => s.id).join(', ')}）`);
  }

  for (const [index, source] of sources.entries()) {
    if (index > 0 && flags.delayMs > 0) await sleep(flags.delayMs); // 串行 + 间隔，别给学校站点添麻烦
    results.push(await collectOne(cfg, source, flags));
  }
  return results;
}

async function collectOne(cfg: RadarConfig, source: SourceConfig, flags: Flags): Promise<SourceResult> {
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

  // 需要浏览器渲染的源：默认跳过，只有显式 --allow-browser 才动真浏览器。
  // 原因：那类站点部署了机器人挑战，用真浏览器访问是"绕开它的拦截"，得让人明确同意。
  if (source.requiresBrowser && !flags.allowBrowser) {
    return {
      ...base,
      skipped: true,
      error: '需要浏览器渲染：加 --allow-browser（本机有 Chrome/Edge 时）才会抓这个源',
    };
  }

  const t0 = Date.now();
  const urls = pageUrls(source.url, source.pages);
  const items: Notice[] = [];
  const seen = new Set<string>();
  let status: number | null = null;
  let bytes = 0;

  for (const [index, pageUrl] of urls.entries()) {
    // 翻页之间也要保持间隔，不连续猛击学校站点（issue #7）
    if (index > 0 && flags.delayMs > 0) await sleep(flags.delayMs);
    try {
      let html: string;
      let pageStatus: number | null;
      let pageBytes: number;

      if (source.requiresBrowser) {
        const headless = source.browserHeadless;
        if (!headless && index === 0) {
          console.log(`    · ${source.id}: 该站点会拒绝无头浏览器，将以可见浏览器窗口抓取（窗口会自动关闭）`);
        }
        const res = await renderHtml(pageUrl, {
          executablePath: process.env.NOTICE_RADAR_BROWSER,
          expect: source.browserExpect ?? '通知',
          headless,
          onLog: (msg) => console.log(`    · ${source.id}: ${msg}`),
        });
        html = res.html;
        pageStatus = 200;
        pageBytes = res.html.length;
      } else {
        const res = await fetchHtml(pageUrl);
        html = res.html;
        pageStatus = res.status;
        pageBytes = res.bytes;
      }

      status = pageStatus;
      bytes += pageBytes;
      const parsed = adapter.parse({ source, school: cfg.school, html });
      for (const item of parsed) {
        if (seen.has(item.id)) continue; // 跨页去重：同一条挂两页只算一次
        seen.add(item.id);
        items.push(item);
      }
      if (urls.length > 1) {
        console.log(
          `    · ${source.id}: 第 ${index + 1}/${urls.length} 页解析 ${parsed.length} 条（去重后累计 ${items.length} 条）`,
        );
      }
    } catch (e) {
      const message = (e as Error).message;
      if (index === 0) return { ...base, error: message, tookMs: Date.now() - t0 };
      // 第一页成功、后面某页失败：保留已有结果，但明确说出来（不静默降级）
      console.log(`    · ${source.id}: 第 ${index + 1}/${urls.length} 页失败（${message}），保留前 ${index} 页的 ${items.length} 条`);
      break;
    }
  }

  return { ...base, ok: true, status, bytes, tookMs: Date.now() - t0, items };
}

function filterItems(results: SourceResult[], cfg: RadarConfig): Notice[] {  const byId = new Map(cfg.sources.map((s) => [s.id, s]));
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

/**
 * 把推送结果写进 data/last-notify.json。
 * 为什么值得单独落盘：Actions 的日志接口需要 token，而"云端到底推出去没有"是部署时最容易卡住的问题。
 * 写进仓库后，任何人都能从提交记录里直接查证（`data/last-notify.json`）。
 * 必须脱敏：Server酱 返回里带 readkey（能用来读/删那条消息），不能进公开仓库。
 */
function writeNotifyLog(statePath: string, title: string, count: number, outcomes: { channel: string; ok: boolean; detail: string }[]): string {
  const sanitize = (detail: string) =>
    detail.replace(/"readkey"\s*:\s*"[^"]*"/g, '"readkey":"***"').replace(/SCT[A-Za-z0-9]{10,}/g, 'SCT***').slice(0, 400);
  const file = path.join(path.dirname(statePath), 'last-notify.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ at: new Date().toISOString(), title, count, outcomes: outcomes.map((o) => ({ ...o, detail: sanitize(o.detail) })) }, null, 2)}\n`,
    'utf8',
  );
  return file;
}

/** 只测推送通道，不抓任何站点 —— 用来确认 SERVERCHAN_KEY 之类配好了没有。
 *  支持 --channel=<type> 单独验某个通道（微信通道多了以后很有用）。 */
async function cmdTestNotify(flags: Flags): Promise<number> {
  const cfg = loadCfg(flags);
  const wanted = cfg.notify.filter((n) => n.enabled && (!flags.channel || n.type === flags.channel));
  const channels = wanted.map((n) => n.type).join(', ') || '(没有匹配的启用通道)';
  console.log(`▸ 推送通道测试：${cfg.name}（${channels}）`);
  if (flags.channel && wanted.length === 0) {
    console.log(
      `  配置文件里启用着的通道：${cfg.notify.filter((n) => n.enabled).map((n) => n.type).join(', ') || '(无)'}`,
    );
    return 2;
  }

  const now = new Date();
  const markdown = [
    `# ${cfg.name} · 推送通道测试`,
    '',
    '这条消息用来验证推送密钥（如 `SERVERCHAN_KEY`）是否配置正确 —— 收到就说明云端/本机都能推到你的手机。',
    '',
    `- 配置文件：\`${flags.config}\``,
    `- 发送时间：${now.toISOString()}`,
    `- 通道：${channels}`,
    '',
    '如果这条能收到，但通知日报收不到，那问题在抓取或关键词，不在推送。',
  ].join('\n');

  const outcomes = await notifyAll(wanted, `${cfg.name} · 推送通道测试`, markdown);
  for (const o of outcomes) console.log(`  ${o.ok ? '✓' : '✗'} 通知[${o.channel}] ${o.detail}`);
  if (!flags.dry) console.log(`  · 结果已记录到 ${writeNotifyLog(flags.state, `${cfg.name} · 推送通道测试`, 0, outcomes)}`);

  // 判定必须忽略 stdout：它永远"成功"，否则这个自检会永远显示通过（真踩过这个坑）
  const remote = outcomes.filter((o) => o.channel !== 'stdout');
  if (remote.length === 0) {
    console.log('\n▸ 配置里没有真正的推送通道（只有 stdout），这个测试说明不了问题。');
    return 1;
  }
  const anyRemoteOk = remote.some((o) => o.ok);
  console.log(
    anyRemoteOk
      ? `\n▸ 推送通道可用：${remote.filter((o) => o.ok).map((o) => o.channel).join(', ')}`
      : '\n▸ 所有推送通道都失败了 —— 检查密钥/网络。',
  );
  return anyRemoteOk ? 0 : 1;
}

/** 通知频次统计：读归档，输出总览 + 来源/标签/周/星期分布。 */
function cmdStats(flags: Flags): number {
  const historyFile = path.join(path.dirname(flags.state), 'history.json');
  const history = loadHistory(historyFile);
  const stats = summarize(history);

  if (flags.json) {
    fs.mkdirSync(path.dirname(flags.json), { recursive: true });
    fs.writeFileSync(flags.json, `${JSON.stringify(stats, null, 2)}\n`, 'utf8');
    console.log(`▸ 统计 JSON 已写入 ${flags.json}`);
  }

  let name = '通知雷达';
  try {
    name = loadCfg(flags).name;
  } catch {
    /* 配置坏了也不该影响看统计 */
  }
  console.log(renderStats(stats, name));
  if (stats.total === 0) console.log('\n  （归档还是空的：跑一次 `radr run` 就会开始积累）');
  return 0;
}

/** 每日日报：把某个时间窗内「首次发现」的通知合成**一条**消息。
 *
 *  默认只打印预览（不发送、不动任何状态）—— 加 --notify 才真的推。
 *  为什么要有它：现在每 20 分钟发现新通知就推一次，期中期末手机上会很吵；
 *  日报把一天的内容合成一条，读者只需要看一次。 */
async function cmdDigest(flags: Flags): Promise<number> {
  const historyFile = path.join(path.dirname(flags.state), 'history.json');
  const history = loadHistory(historyFile);

  const range = flags.all
    ? { since: new Date(0), until: new Date(Date.now() + 60_000), label: '全部归档', shortLabel: '全部归档' }
    : flags.date
      ? beijingDayRange(flags.date)
      : flags.hours
        ? rollingRange(flags.hours)
        : yesterdayRange();

  let name = '校园通知雷达';
  let appUrl = 'https://yang-yin734.github.io/notice-radar/';
  let channels = null as ReturnType<typeof loadCfg>['notify'] | null;
  let cfg: ReturnType<typeof loadCfg> | null = null;
  try {
    cfg = loadCfg(flags);
    name = cfg.name;
    channels = cfg.notify;
  } catch {
    /* 配置坏了也要能看日报 */
  }

  // 只采集不通知的源不进日报（它们的条目仍在归档与仪表盘里）。
  // 注意要用**所有学校预设**的源：collectOnly 写在各校自己的配置里，
  // 只看默认配置会把别的学校（用户还没订阅）的通知一起发出去。
  const allSources = mergeSources(cfg?.sources ?? [], loadAllSchoolSources());
  const digestInput = { ...history, items: notifiable(history.items, allSources) };
  const digest = buildDigest(digestInput, {
    ...range,
    // --all：把所有归档都列出来（测试推送链路用），不按时间窗也不截断
    maxItems: flags.all ? history.items.length : (flags.maxExplicit ?? cfg?.push.digestMaxItems ?? 40),
    maxPerSource: flags.all ? history.items.length : (cfg?.push.digestMaxPerSource ?? 8),
    appUrl,
  });

  // 长期静默的源：放进日报顶部（不当急事推，但一定要让你看见）。
  // 只采集不通知的源不算"静默" —— 用户还没订阅它们，没动静是正常的。
  const silenceSources = allSources.filter((s) => !s.collectOnly);
  const silence = cfg ? detectSilence(history, silenceSources, defaultAlertOptions(cfg.alerts)) : [];
  const notice = renderSilenceNotice(silence);
  const markdown = renderDigestMarkdown(digest, { name, appUrl, notice });
  const title = flags.all ? `${name} · 全部 ${digest.total} 条通知`.slice(0, 32) : digestTitle(digest, name);
  const payload = truncateForPush(markdown);

  if (flags.json) {
    fs.mkdirSync(path.dirname(flags.json), { recursive: true });
    fs.writeFileSync(flags.json, `${JSON.stringify(digest, null, 2)}\n`, 'utf8');
    console.log(`▸ 日报 JSON 已写入 ${flags.json}`);
  }
  if (flags.out) {
    fs.mkdirSync(path.dirname(flags.out), { recursive: true });
    fs.writeFileSync(flags.out, markdown, 'utf8');
    console.log(`▸ 日报 Markdown 已写入 ${flags.out}`);
  }

  if (!flags.send || flags.dry) {
    console.log(
      `${flags.dry ? '▸ 演练模式（--dry：不发送）' : '▸ 预览模式（不会发送）'} · 时间窗：${digest.label} · 共 ${digest.total} 条` +
        (silence.length ? ` · ${silence.length} 个源疑似异常` : ''),
    );
    console.log(`  推送标题：${title}`);
    console.log('');
    console.log(markdown.trimEnd());
    console.log('');
    console.log('  要真的发送：radr digest --notify（建议先在本地试一条）');
    return 0;
  }

  if (digest.empty && !flags.force) {
    console.log(`▸ ${digest.label} 没有新通知，按默认策略**不打扰**（要强发加 --force）`);
    return 0;
  }
  if (payload.truncated) {
    console.log(`▸ 正文 ${markdown.length} 字符，超过推送上限已截断到 ${payload.text.length} 字符（已如实标注）`);
  }
  const outcomes = await notifyAll(channels ?? [], title, payload.text);
  for (const o of outcomes) console.log(`  ${o.ok ? '✓' : '✗'} ${o.channel}：${o.detail}`);
  // 与 run/test-notify 一致：推送结果留痕，能从提交记录查证（密钥已脱敏）
  if (!flags.dry) console.log(`  · 推送结果已记录到 ${writeNotifyLog(flags.state, title, digest.total, outcomes)}`);
  const anyOk = outcomes.some((o) => o.ok);
  console.log(anyOk ? `▸ 日报已发送（${digest.total} 条）` : '✗ 没有任何通道发送成功');
  return anyOk ? 0 : 1;
}

/** 看看当前关键词表会把归档里的通知怎么分档（调关键词时用它，不联网、不推送）。 */
function cmdTiers(flags: Flags): number {
  const cfg = loadCfg(flags);
  const historyFile = path.join(path.dirname(flags.state), 'history.json');
  const history = loadHistory(historyFile);
  const days = flags.days ?? 14;
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = history.items.filter((n) => Date.parse(n.firstSeenAt ?? '') >= since);
  const split = splitByTier(recent, cfg.push);

  if (flags.json) {
    fs.mkdirSync(path.dirname(flags.json), { recursive: true });
    fs.writeFileSync(
      flags.json,
      `${JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          days,
          digestRest: cfg.push.digestRest,
          urgent: split.urgent.map((n) => ({ id: n.id, sourceName: n.sourceName, title: n.title, why: explainTier(n, cfg.push), url: n.url })),
          digest: split.digest.map((n) => ({ id: n.id, sourceName: n.sourceName, title: n.title, url: n.url })),
          mute: split.mute.map((n) => ({ id: n.id, title: n.title, url: n.url })),
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    console.log(`▸ 分档结果已写入 ${flags.json}`);
  }

  console.log(`▸ ${cfg.name}：最近 ${days} 天归档 ${recent.length} 条`);
  if (!cfg.push.digestRest) {
    console.log('  （分级已关闭 push.digestRest=false：所有新通知都即时推，下面只是分类展示）');
  }
  console.log('');
  console.log(`  ⚡ 立刻推（命中急事关键词）：${split.urgent.length} 条`);
  for (const n of split.urgent.slice(0, 40)) {
    console.log(`      ${explainTier(n, cfg.push).replace('命中关键词', '')} ${n.sourceName}：${n.title.slice(0, 44)}`);
  }
  if (split.urgent.length > 40) console.log(`      …另 ${split.urgent.length - 40} 条`);
  console.log('');
  console.log(`  📋 进日报（每天早 8:00 汇总）：${split.digest.length} 条`);
  for (const n of split.digest.slice(0, 15)) console.log(`      ${n.sourceName}：${n.title.slice(0, 44)}`);
  if (split.digest.length > 15) console.log(`      …另 ${split.digest.length - 15} 条`);
  console.log('');
  console.log(`  🔇 静音：${split.mute.length} 条`);
  console.log('');
  console.log('  想改词表：编辑配置里的 push.urgent / push.mute，再跑一次本命令核对。');
  console.log('  急事太多就删词，太少就加词；--json 可导出逐条结果。');
  return 0;
}

/** 抓取健康检查：只看归档，不联网。长期静默的源在这里能一眼看到。 */
async function cmdHealth(flags: Flags): Promise<number> {
  const cfg = loadCfg(flags);
  const historyFile = path.join(path.dirname(flags.state), 'history.json');
  const history = loadHistory(historyFile);
  // 同样要用所有学校预设：只采集不通知的源不算"长期静默"
  const healthSources = mergeSources(loadAllSchoolSources(), cfg.sources);
  const silence = detectSilence(
    history,
    healthSources.filter((s) => !s.collectOnly),
    defaultAlertOptions(cfg.alerts),
  );

  if (flags.json) {
    fs.mkdirSync(path.dirname(flags.json), { recursive: true });
    fs.writeFileSync(flags.json, `${JSON.stringify({ checkedAt: new Date().toISOString(), silence }, null, 2)}\n`, 'utf8');
    console.log(`▸ 健康检查 JSON 已写入 ${flags.json}`);
  }

  const enabled = cfg.sources.filter((s) => s.enabled);
  console.log(`▸ ${cfg.name}：${enabled.length} 个源，归档 ${history.items.length} 条`);
  console.log(`  静默阈值：${cfg.alerts.silenceDays} 天（单源可用 silenceDays 覆盖）`);
  console.log('');
  if (silence.length === 0) {
    console.log('  ✓ 所有源最近都有动静，没发现疑似失效。');
  } else {
    for (const issue of silence) {
      const text = issue.kind === 'never'
        ? `观察 ${issue.days} 天一条都没抓到过（选择器可能不对）`
        : `${issue.days} 天没有新通知（阈值 ${issue.threshold} 天）`;
      console.log(`  ⚠ ${issue.sourceName}：${text}`);
      if (issue.lastSeenAt) console.log(`      最后一次拿到新通知：${issue.lastSeenAt}`);
    }
    console.log('');
    console.log('  不一定是故障（寒暑假本来就安静）；确认站点是否还在更新，跑 `radr doctor` 看逐源状态。');
  }

  if (!flags.send) return 0;
  if (silence.length === 0) {
    console.log('\n▸ 没有异常，不发告警。');
    return 0;
  }
  const outcomes = await notifyAll(cfg.notify, silenceTitle(silence, cfg.name), renderSilenceNotice(silence));
  for (const o of outcomes) console.log(`  ${o.ok ? '✓' : '✗'} 告警[${o.channel}] ${o.detail}`);
  return outcomes.some((o) => o.ok) ? 0 : 1;
}

/** 适配器市场：列出已知学校预设与维护者（数据来自 config/schools/registry.json）。 */
function cmdSchools(flags: Flags): number {
  const registryFile = [path.join('config', 'schools', 'registry.json'), path.join(PKG_ROOT, 'config', 'schools', 'registry.json')]
    .find((p) => fs.existsSync(p)) ?? path.join('config', 'schools', 'registry.json');
  if (!fs.existsSync(registryFile)) {
    console.error(`找不到 ${registryFile}`);
    return 1;
  }
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')) as {
    version: number;
    updatedAt?: string;
    schools: {
      id: string;
      name: string;
      presets: string[];
      sources?: number;
      maintainers: string[];
      status: string;
      lastVerified: string;
      notes?: string;
    }[];
  };

  if (flags.json) {
    fs.writeFileSync(flags.json, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    console.log(`▸ 已写入 ${flags.json}`);
  }

  const statusMark: Record<string, string> = { verified: '✓ 可用', community: '~ 社区维护', broken: '✗ 已知失效' };
  console.log(`▸ 已知学校预设：${registry.schools.length} 个（更新于 ${registry.updatedAt ?? '未知'}）\n`);
  let missing = 0;
  for (const school of registry.schools) {
    console.log(`  ${school.id.padEnd(12)} ${school.name}   ${statusMark[school.status] ?? school.status}`);
    console.log(`      ${'维护者'.padEnd(6)}${school.maintainers.join(', ')}   最后验证：${school.lastVerified}`);
    for (const preset of school.presets) {
      // 登记表里的路径相对包根（用户可能在任何目录执行 npx notice-radar schools）
      const exists = fs.existsSync(preset) || fs.existsSync(path.join(PKG_ROOT, preset));
      if (!exists) missing++;
      console.log(`      ${exists ? '预设' : '缺失'}  ${preset}${exists ? '' : '  ← 文件不存在'}`);
    }
    if (school.notes) console.log(`      备注  ${school.notes}`);
    console.log('');
  }
  console.log('  想加自己的学校：docs/add-your-school.md；登记进 config/schools/registry.json 就会出现在这里。');
  return missing === 0 ? 0 : 1;
}

async function cmdRun(flags: Flags): Promise<number> {
  const cfg = loadCfg(flags);
  const state = loadState(flags.state);

  console.log(`▸ ${cfg.name}（${cfg.school}）：${cfg.sources.filter((s) => s.enabled).length} 个源`);
  const results = await collect(cfg, flags);
  const matched = filterItems(results, cfg);
  // 先跨源去重（教务处同一条通知常挂两个栏目），再算新增；但状态里把命中的都记上，
  // 免得下次换个栏目又把同一条当新通知报一遍。
  const filtered = dedupeAcrossSources(matched);
  const fresh = splitNew(filtered, state);

  for (const r of results) {
    const kept = filterItems([r], cfg).length;
    const isNew = fresh.filter((n) => n.sourceId === r.sourceId).length;
    const mark = r.skipped ? '⏭' : r.ok ? (r.items.length === 0 ? '⚠' : '✓') : '✗';
    console.log(`  ${mark} ${r.sourceName}：解析 ${r.items.length} → 过滤后 ${kept} → 新增 ${isNew}${r.ok ? '' : ` (${r.error})`}`);
  }

  // 「只采集不通知」的源：条目照常进归档/仪表盘/按校数据，但不进推送与日报
  const notifyFresh = notifiable(fresh, cfg.sources);
  const heldBack = fresh.length - notifyFresh.length;

  const split = splitByTier(notifyFresh, cfg.push);
  const immediate = immediateItems(notifyFresh, cfg.push);
  const deferred = cfg.push.digestRest ? split.digest : [];
  const muted = split.mute;

  let markdown = renderMarkdown(results, immediate, { maxPerSource: flags.max });
  if (deferred.length > 0) {
    markdown += `\n> 另有 ${deferred.length} 条常规通知（未命中急事关键词），会在每天早上 8:00 的日报里汇总。\n`;
  }

  if (notifyFresh.length === 0 && heldBack > 0) {
    console.log(`\n▸ 本轮 ${heldBack} 条都来自「只采集不通知」的源：已进归档，不推送也不进日报。`);
  } else if (immediate.length === 0 && fresh.length > 0) {
    console.log(`\n▸ 本轮 ${fresh.length} 条都是常规通知：不即时推送，等日报汇总。`);
    for (const n of deferred) console.log(`    · ${n.sourceName}：${n.title.slice(0, 46)}`);
  } else {
    console.log(`\n${markdown}`);
  }
  if (fresh.length > 0) {
    console.log(
      `▸ 分级：急事 ${immediate.length} 条（立即推）· 常规 ${deferred.length} 条（进日报）· 静音 ${muted.length} 条` +
        (cfg.push.digestRest ? '' : '（分级已关闭：全部即时推）'),
    );
    for (const n of immediate) console.log(`    ⚡ ${explainTier(n, cfg.push)}：${n.title.slice(0, 42)}`);
  }
  if (heldBack > 0) {
    console.log(`▸ 其中 ${heldBack} 条来自「只采集不通知」的源（collectOnly）：已进归档，不推送`);
  }

  // 只在真有新通知时才写文件。
  // 否则 poll 每 20 分钟都会因为 lastRun 变化而产生一次无意义的提交（一天 72 个），
  // 把提交历史淹掉，也会让本地推送老是撞上"远端已更新"。
  const shouldWrite = !flags.dry && (fresh.length > 0 || flags.writeAlways);

  if (flags.json) {
    if (shouldWrite) {
      fs.mkdirSync(path.dirname(flags.json), { recursive: true });
      fs.writeFileSync(flags.json, renderJson(results, fresh), 'utf8');
      console.log(`\n▸ JSON 已写入 ${flags.json}`);
    } else {
      console.log('\n▸ 没有新通知，跳过 JSON 产物（要强制写加 --write-always）');
    }
  }

  if (flags.notify && immediate.length > 0) {
    const title = `${cfg.name} · 新增 ${immediate.length} 条`;
    const outcomes = await notifyAll(cfg.notify, title, markdown);
    for (const o of outcomes) console.log(`  ${o.ok ? '✓' : '✗'} 通知[${o.channel}] ${o.detail}`);
    if (!flags.dry) console.log(`  · 推送结果已记录到 ${writeNotifyLog(flags.state, title, immediate.length, outcomes)}`);
  } else if (fresh.length === 0) {
    console.log('\n▸ 没有新通知，跳过推送。');
  } else if (notifyFresh.length === 0) {
    console.log('\n▸ 新通知都来自「只采集不通知」的源，不推送。');
  } else if (immediate.length === 0) {
    console.log('\n▸ 常规通知不即时推送（已进归档，日报会汇总）。');
  }

  // ---- 抓取健康告警：静默失效是最阴险的失败模式（以为在收通知，其实早就断了）----
  // 但**必须**区分"网络天气"和"真故障"：runner 抓国内站点本来就约每 3 次有 1 次整体不通。
  // 实测踩过坑：单次失败就告警 → 4 个源在同一秒一起告警，而下一轮全部恢复正常（纯误报）。
  // 所以：只有**连续**失败到阈值才告警，阈值见 alerts.failureStreak。
  const runsFile = path.join(path.dirname(flags.state), 'runs.json');
  const runsRecord = recordRun(results, loadRuns(runsFile));
  const streakOf = (sourceId: string) => failureStreak(runsRecord.state.sources[sourceId]);

  const problems = detectProblems(results);
  // 「只采集不通知」的源连故障告警也不发：这些学校用户还没订阅，报警只会变成噪音
  const silent = collectOnlyIds(cfg.sources);
  const alertProblems = silent.size ? problems.filter((p) => !silent.has(p.sourceId)) : problems;
  if (alertProblems.length < problems.length) {
    console.log(`▸ ${problems.length - alertProblems.length} 个源是「只采集不通知」，不参与故障告警`);
  }
  // 整轮网络不通（所有源都是 fetch failed 这类网络层错误）= 网络天气：
  // 用户处理不了，而且状态没被改动、下一轮成功会照常补发，所以要用高得多的阈值才提醒。
  const weather = isNetworkWeather(problems, { totalSources: results.filter((r) => !r.skipped).length });
  if (weather) {
    console.log(
      `▸ 本轮所有源都是网络层失败（runner 到国内站点不通）→ 按「网络天气」处理：` +
        `连续 ${cfg.alerts.weatherStreak} 次（约 4 小时）才提醒；通知不会丢，下一轮成功会补发`,
    );
  }

  // 阈值按源算：长期不稳的源（例如只对国内 IP 友好的 WAF 站点）自动放宽，
  // 否则以 60% 的失败率、阈值 3，一两个小时就会骚扰用户一次（实测就是这样）。
  const sourceById = new Map(cfg.sources.map((s) => [s.id, s]));
  const rateOf = (id: string) => successRate(runsRecord.state.sources[id]);
  const rateTextOf = (id: string) => {
    const list = runsRecord.state.sources[id];
    if (!list || list.length === 0) return null;
    const ok = list.filter((x) => x === 'ok').length;
    return `近 ${list.length} 次成功 ${ok} 次`;
  };
  const thresholdOf = (id: string) => {
    const base = weather ? cfg.alerts.weatherStreak : cfg.alerts.failureStreak;
    return streakThreshold(base, rateOf(id), sourceById.get(id)?.failureStreak);
  };

  for (const p of problems) {
    const streak = streakOf(p.sourceId);
    const need = thresholdOf(p.sourceId);
    const note = streak >= need ? `连续第 ${streak} 次（阈值 ${need}）` : `本轮失败（第 ${streak} 次，阈值 ${need}）`;
    const muted = silent.has(p.sourceId) ? '（只采集不通知，不告警）' : '';
    console.log(`    ⚠ ${p.sourceName}：${p.detail} —— ${note}${muted}`);
  }

  // 显式关掉告警的源（alertOnFailure: false）不参与告警；日志与日报里仍能看到它
  const alertable = alertProblems.filter((p) => sourceById.get(p.sourceId)?.alertOnFailure !== false);
  if (alertable.length < alertProblems.length) {
    console.log(`▸ ${alertProblems.length - alertable.length} 个源配置了 alertOnFailure: false，不参与告警`);
  }

  const { confirmed, pending } = confirmByStreak(
    alertable,
    Object.fromEntries(Object.entries(runsRecord.state.sources).map(([id, list]) => [id, failureStreak(list)])),
    thresholdOf,
  );
  if (pending.length > 0) {
    console.log(`▸ ${pending.length} 个源本轮失败，但未达各自阈值，暂不告警`);
  }

  if (cfg.alerts.failureNotify && confirmed.length > 0 && flags.notify && !flags.dry) {
    const alertFile = path.join(path.dirname(flags.state), path.basename(DEFAULT_ALERT_FILE));
    const { send, record } = throttleProblems(confirmed, loadAlerts(alertFile), {
      throttleHours: cfg.alerts.throttleHours,
    });
    if (send.length === 0) {
      console.log(`▸ ${confirmed.length} 个源连续失败，但 ${cfg.alerts.throttleHours} 小时内已告警过，不重复打扰。`);
    } else {
      const considered = results.filter((r) => !r.skipped);
      const allFailed = considered.length > 0 && considered.every((r) => !r.ok || r.items.length === 0);
      const outcomes = await notifyAll(
        cfg.notify,
        problemTitle(send, cfg.name),
        renderProblemMarkdown(send, cfg.name, {
          streakOf,
          allFailed,
          minStreak: cfg.alerts.failureStreak,
          rateOf: rateTextOf,
        }),
      );
      for (const o of outcomes) console.log(`  ${o.ok ? '✓' : '✗'} 告警[${o.channel}] ${o.detail}`);
      if (outcomes.some((o) => o.ok)) {
        saveAlerts(record, alertFile);
        console.log(`▸ 已就 ${send.length} 个源发出告警（节流记录：${alertFile}）`);
      }
    }
  }

  if (flags.dry) {
    console.log('\n▸ --dry：未写入状态文件。');
  } else if (shouldWrite) {
    markSeen(matched, state);
    saveState(flags.state, state);

    // 同时归档到 history.json —— state 只记"见过哪些 ID"，历史才留下内容，供 Pages 仪表盘用
    const historyFile = path.join(path.dirname(flags.state), 'history.json');
    const history = loadHistory(historyFile);
    const { added } = appendHistory(history, filtered);
    saveHistory(history, historyFile);

    console.log(`\n▸ 状态已更新：${flags.state}（下次只报新增）`);
    console.log(`▸ 历史归档：${historyFile}（本次新增 ${added} 条，累计 ${history.items.length} 条）`);
  } else {
    console.log('\n▸ 没有新通知：不写状态文件（要强制写加 --write-always）');
  }

  // 每个源最近 N 次成功率（issue #6）：有新通知、出问题、或"连续失败的状态发生了变化"时写。
  // 其余情况（安静地成功）不写文件 —— 否则一天 72 次提交会把历史淹掉。
  if (!flags.dry && (shouldWrite || problems.length > 0 || runsRecord.changed)) {
    if (runsRecord.changed || problems.length > 0) {
      saveRuns(runsRecord.state, runsFile);
      console.log(`▸ 抓取近况已记录：${runsFile}（doctor 里会显示"最近 N 次成功 X 次"）`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return okCount === 0 ? 1 : 0;
}

/** 把历史归档渲染成静态仪表盘（给 GitHub Pages 用）。 */
function cmdDashboard(flags: Flags): number {
  const historyFile = path.join(path.dirname(flags.state), 'history.json');
  const outFile = flags.out ?? path.join('docs', 'index.html');
  const history = loadHistory(historyFile);
  const generatedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const pkgJsonPath = [path.join('package.json'), path.join(PKG_ROOT, 'package.json')].find((p) => fs.existsSync(p)) ?? 'package.json';
  const pkgVersion = (JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as { version: string }).version;
  fs.writeFileSync(outFile, renderDashboard(history, { generatedAt, version: pkgVersion }), 'utf8');

  // 顺手把原始数据也放进 Pages 目录，方便别人二次利用（自己做图表、接别的工具）
  const dataFile = path.join(path.dirname(outFile), 'dashboard-data.json');
  fs.writeFileSync(
    dataFile,
    `${JSON.stringify({ generatedAt, total: history.items.length, bySource: countBySource(history), items: history.items }, null, 2)}\n`,
    'utf8',
  );

  console.log(`▸ 仪表盘已生成：${outFile}（归档 ${history.items.length} 条）`);
  console.log(`▸ 原始数据：${dataFile}`);

  // 版本清单：应用靠它判断"线上是不是有比我更新的版本"，从而在应用内提示升级
  const versionFile = path.join(path.dirname(outFile), 'version.json');
  fs.writeFileSync(
    versionFile,
    `${JSON.stringify(
      {
        app: 'notice-radar',
        version: pkgVersion,
        apkUrl: 'https://github.com/Yang-Yin734/notice-radar/releases/download/android-latest/notice-radar.apk',
        publishedAt: generatedAt,
        notes: `https://github.com/Yang-Yin734/notice-radar/releases/tag/v${pkgVersion}`,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`▸ 版本清单：${versionFile}（v${pkgVersion}）`);

  if (history.items.length === 0) console.log('  （历史还是空的：等第一次抓到新通知后就会有内容）');
  return 0;
}

async function cmdDoctor(flags: Flags): Promise<number> {
  const cfg = loadCfg(flags);
  console.log(`▸ 体检 ${cfg.name}：${cfg.sources.filter((s) => s.enabled).length} 个源\n`);
  const results = await collect(cfg, flags);
  const rates = summarizeRuns(loadRuns(path.join(path.dirname(flags.state), 'runs.json')));
  console.log(renderDoctor(results, rates));
  const skipped = results.filter((r) => r.skipped).length;
  const broken = results.filter((r) => (!r.ok && !r.skipped) || (r.ok && r.items.length === 0)).length;

  // --show=N：把每条源的前 N 条解析结果打出来。
  // 为什么需要：接入新学校时，只看"解析出 20 条"不够 —— 得看清是不是把导航项、
  // 隐藏的正文摘要、或者别的栏目的东西当成通知了（西电/HUST 都踩过）。
  if (flags.show > 0) {
    for (const r of results) {
      if (!r.ok || r.items.length === 0) continue;
      console.log(`\n▸ ${r.sourceName}：前 ${Math.min(flags.show, r.items.length)} 条`);
      for (const n of r.items.slice(0, flags.show)) {
        console.log(`   ${n.date ?? '（无日期）'}  ${n.title.slice(0, 56)}`);
        console.log(`      ${n.url.slice(0, 96)}`);
      }
    }
  }

  console.log('\n提示：状态 202 或体积 <4KB 通常是 WAF 挑战页；抓到了但条目为 0 说明选择器过时了。');
  if (skipped > 0) console.log(`本次跳过了 ${skipped} 个需要浏览器渲染的源（加 --allow-browser 可启用）。`);
  return broken === 0 ? 0 : 1;
}

/** 渲染任意页面并把 DOM 存下来 —— 面对 WAF 站点时，用它摸清真实结构、再写选择器。 */
async function cmdFetch(flags: Flags, url: string): Promise<number> {
  if (!url) {
    console.error('用法：radr fetch <url> [--out=文件] [--expect=关键字]');
    return 2;
  }
  const res = await renderHtml(url, {
    executablePath: process.env.NOTICE_RADAR_BROWSER,
    expect: flags.expect ?? undefined,
    headless: !flags.window,
    onLog: (msg) => console.log(`  · ${msg}`),
  });
  console.log(`标题：${res.title}`);
  console.log(`DOM：${res.html.length} 字节，用时 ${res.tookMs}ms，浏览器 ${res.browser}`);
  if (flags.out) {
    fs.mkdirSync(path.dirname(flags.out), { recursive: true });
    fs.writeFileSync(flags.out, res.html, 'utf8');
    console.log(`已写入 ${flags.out}`);
  } else {
    console.log('\n--- 前 3000 字符 ---');
    console.log(res.html.slice(0, 3000));
  }
  return 0;
}

function cmdList(flags: Flags): number {
  const cfg = loadCfg(flags);
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
  radr run      [--config=路径] [--dry] [--no-notify] [--json=路径] [--delay=毫秒] [--max=条数] [--only=源id] [--write-always] [--allow-browser]
  radr doctor   [--config=路径] [--only=源id] [--allow-browser]      体检：每个源能不能抓、解析出几条（含最近 N 次成功率）
  radr list     [--config=路径]                        列出配置里的源
  radr test-notify [--config=路径] [--channel=通道]     只发一条测试消息，验证推送密钥配好没有（serverchan/email/webhook/stdout）
  radr dashboard [--out=docs/index.html]               把历史归档渲染成静态仪表盘（GitHub Pages 用）
  radr stats     [--state=data/state.json] [--json=文件]  通知频次统计（来源/标签/周/星期分布）
  radr digest    [--date=YYYY-MM-DD | --hours=24 | --all] [--max=条数] [--out=文件] [--notify] [--force]
                                                       每日日报：把一天的新通知合成一条消息（默认只预览）
                                                       --all = 推送**全部归档**（验证推送链路用，不截断）
  radr schools   [--json=文件]                         列出已知学校预设与维护者（适配器市场）
  radr health    [--config=路径] [--json=文件] [--notify]  抓取健康检查：哪些源长期没动静（只读归档，不联网）
  radr tiers     [--days=14] [--json=文件]             查看关键词分档：哪些会立刻推、哪些进日报
  radr fetch    <url> [--out=文件] [--expect=关键字]    用真浏览器渲染页面并导出 DOM（摸 WAF 站点的结构用）
  radr --version                                       打印版本

说明：
  · 默认只在「有新通知」时才写状态与 JSON 产物 —— 跑在 GitHub Actions 上不会每轮都空转出一次提交。
  · 配置里标了 requiresBrowser: true 的源（站点有 JS 机器人挑战）默认跳过，必须显式加 --allow-browser。

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
  else if (command === 'test-notify') code = await cmdTestNotify(flags);
  else if (command === 'dashboard') code = cmdDashboard(flags);
  else if (command === 'stats') code = cmdStats(flags);
  else if (command === 'digest') code = await cmdDigest(flags);
  else if (command === 'schools') code = cmdSchools(flags);
  else if (command === 'health') code = await cmdHealth(flags);
  else if (command === 'tiers') code = cmdTiers(flags);
  else if (command === 'fetch') code = await cmdFetch(flags, rest.find((a) => /^https?:\/\//.test(a)) ?? '');
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
