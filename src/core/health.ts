import fs from 'node:fs';
import path from 'node:path';
import type { AlertsConfig, SourceConfig } from './config.ts';
import type { History } from './history.ts';
import type { SourceResult } from '../types.ts';

/**
 * 抓取健康告警（M4 #1）。
 *
 * 要解决的失败模式：**静默失效**——你以为一直在收通知，其实某个源两周前就抓挂了
 * （站点改版 / 选择器过时 / 被 WAF 拦了）。以前的 health 只让 CI 变红，
 * GitHub 的失败邮件很容易被忽略，手机上更收不到。
 *
 * 两类信号：
 *   1. 本轮就发现的硬故障（抓取失败 / 抓到了却解析出 0 条）→ 立刻推微信，带节流
 *   2. 长期静默（某源连续 N 天没有新通知）→ 放进每天日报的顶部，不当急事推
 */

export const DEFAULT_ALERT_FILE = path.join('data', 'alerts.json');

export interface AlertRecord {
  /** sourceId → 上次告警时间（ISO） */
  lastAlertAt: Record<string, string>;
  updatedAt: string;
}

export const emptyAlerts = (): AlertRecord => ({ lastAlertAt: {}, updatedAt: new Date(0).toISOString() });

export function loadAlerts(file: string = DEFAULT_ALERT_FILE): AlertRecord {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AlertRecord>;
    return { ...emptyAlerts(), ...parsed, lastAlertAt: { ...(parsed.lastAlertAt ?? {}) } };
  } catch {
    return emptyAlerts();
  }
}

export function saveAlerts(record: AlertRecord, file: string = DEFAULT_ALERT_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------- 硬故障

export interface SourceProblem {
  sourceId: string;
  sourceName: string;
  kind: 'fetch-failed' | 'parse-empty';
  detail: string;
}

/**
 * 从一次运行的结果里挑出「需要告警」的源。
 *
 * 注意 skipped（需要浏览器但没开 --allow-browser）不算故障 —— 那是预期行为。
 */
export function detectProblems(results: SourceResult[]): SourceProblem[] {
  const problems: SourceProblem[] = [];
  for (const r of results) {
    if (r.skipped) continue;
    if (!r.ok) {
      problems.push({
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        kind: 'fetch-failed',
        detail: r.error ?? `HTTP ${r.status ?? '?'}`,
      });
      continue;
    }
    if (r.items.length === 0) {
      problems.push({
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        kind: 'parse-empty',
        detail: '页面抓到了，但没解析出任何条目（选择器可能过时）',
      });
    }
  }
  return problems;
}

/** 节流：同一个源在 throttleHours 内只告警一次。 */
export function throttleProblems(
  problems: SourceProblem[],
  record: AlertRecord,
  options: { now?: Date; throttleHours?: number } = {},
): { send: SourceProblem[]; record: AlertRecord } {
  const now = options.now ?? new Date();
  const throttleMs = (options.throttleHours ?? 12) * 60 * 60 * 1000;
  const send: SourceProblem[] = [];
  const lastAlertAt = { ...record.lastAlertAt };

  for (const p of problems) {
    const last = Date.parse(lastAlertAt[p.sourceId] ?? '');
    if (Number.isFinite(last) && now.getTime() - last < throttleMs) continue;
    send.push(p);
    lastAlertAt[p.sourceId] = now.toISOString();
  }
  return { send, record: { lastAlertAt, updatedAt: now.toISOString() } };
}

/** 网络层错误：连都连不上（DNS/TCP/TLS/超时），而不是站点返回了错误码。 */
const NETWORK_ERROR =
  /fetch failed|timeout|timed out|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket|aborted|network|getaddrinfo/i;

export function isNetworkError(detail: string): boolean {
  return NETWORK_ERROR.test(detail ?? '');
}

/**
 * 本轮是不是「整轮网络不通」（= 网络天气）。
 *
 * 判据（两条都要满足）：
 *   1. **所有**参与抓取的源都失败了（有源是好的就说明线路通，那属于单源故障，要正常告警）
 *   2. 失败原因都是**网络层**错误（连不上），而不是站点返回了错误码或解析不出条目
 *
 * 为什么要这么严：这种情况用户处理不了（是 runner 到国内站点的跨境网络问题），
 * 而且状态文件没被改动、下一轮成功时会照常补发 —— 所以不该按普通故障阈值反复提醒。
 */
export function isNetworkWeather(problems: SourceProblem[], options: { totalSources?: number } = {}): boolean {
  if (problems.length === 0) return false;
  // 有源没失败 → 线路是通的，这是单源故障，不能当"天气"放过
  if (typeof options.totalSources === 'number' && problems.length < options.totalSources) return false;
  return problems.every((p) => p.kind === 'fetch-failed' && isNetworkError(p.detail));
}

/** 末尾连续失败了多少次（决定"这是网络抖动还是真故障"）。 */
export function failureStreak(list: ('ok' | 'fail')[] | undefined): number {
  if (!list || list.length === 0) return 0;
  let streak = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] !== 'fail') break;
    streak++;
  }
  return streak;
}

/**
 * 只留下"连续失败够多次"的问题。
 *
 * 为什么必须这样过滤：GitHub runner 抓国内站点本来就约每 3 次有 1 次整体不通，
 * 单次失败多半是网络天气。实测真踩过：4 个源在同一秒一起告警，下一轮就全部恢复正常。
 */
export function confirmByStreak(
  problems: SourceProblem[],
  streaks: Map<string, number> | Record<string, number>,
  minStreak: number,
): { confirmed: SourceProblem[]; pending: SourceProblem[] } {
  const get = (id: string): number => (streaks instanceof Map ? (streaks.get(id) ?? 0) : (streaks[id] ?? 0));
  const confirmed: SourceProblem[] = [];
  const pending: SourceProblem[] = [];
  for (const p of problems) {
    if (get(p.sourceId) >= minStreak) confirmed.push(p);
    else pending.push(p);
  }
  return { confirmed, pending };
}

export interface ProblemRenderOptions {
  /** 每个源连续失败了几次 */
  streakOf?: (sourceId: string) => number;
  /** 本轮是不是所有源都失败了（那就更可能是网络天气） */
  allFailed?: boolean;
  minStreak?: number;
}

export function renderProblemMarkdown(
  problems: SourceProblem[],
  name = '校园通知雷达',
  options: ProblemRenderOptions = {},
): string {
  const { streakOf, allFailed, minStreak } = options;
  const lines: string[] = [];
  lines.push(`# ${name} · 抓取异常（${problems.length} 个源）`);
  lines.push('');
  if (typeof minStreak === 'number') {
    lines.push(`以下源**已连续 ${minStreak} 次**抓取失败，不是偶发网络抖动：`);
    lines.push('');
  }
  for (const p of problems) {
    const label = p.kind === 'fetch-failed' ? '抓取失败' : '抓到了但解析不出条目';
    const streak = streakOf?.(p.sourceId);
    const times = streak && streak > 1 ? `（连续 ${streak} 次）` : '';
    lines.push(`- **${p.sourceName}**${times}：${label} —— ${p.detail}`);
  }
  lines.push('');
  if (allFailed) {
    lines.push('> 注意：本轮**所有源一起失败**，多半是 runner 到国内站点的网络问题；');
    lines.push('> 之所以还是提醒你，是因为它已经连续失败到阈值了。');
    lines.push('');
  }
  lines.push('排查顺序：');
  lines.push('1. 本机跑 `radr doctor`（或 `radr doctor --only=源id`）看是站点变了还是网络问题');
  lines.push('2. `radr health` 看各源近况与静默情况');
  lines.push('3. 若是站点改版，改 `selectors` 即可（见 docs/add-your-school.md）');
  lines.push('');
  lines.push('不想收这类提醒：把配置里 `alerts.failureNotify` 改成 false，');
  lines.push('或把 `alerts.failureStreak` 调大（例如 6 = 约 2 小时都不通才提醒）。');
  return `${lines.join('\n')}\n`;
}

export function problemTitle(problems: SourceProblem[], name = '校园通知雷达'): string {
  const text = problems.length === 1
    ? `${name} · ${problems[0].sourceName} 抓取异常`
    : `${name} · ${problems.length} 个源抓取异常`;
  return text.slice(0, 32);
}

// ---------------------------------------------------------------- 长期静默

export interface SilenceIssue {
  sourceId: string;
  sourceName: string;
  kind: 'silent' | 'never';
  /** silent：距最后一次拿到新通知多少天；never：归档已观察多少天 */
  days: number;
  lastSeenAt: string | null;
  threshold: number;
}

export interface SilenceOptions {
  /** 全局阈值（天），源的 silenceDays 优先 */
  silenceDays?: number;
  /** 观察期不足这么多天就不下"从未抓到过"的结论 */
  warmupDays?: number;
  now?: Date;
}

/**
 * 找出"最近一直没动静"的源。
 *
 * 判定用的是我们的**发现时间**（firstSeenAt），因为那才代表"这条链路还活着"；
 * 通知自身的日期可能很旧（学校归档页里全是历史通知）。
 */
export function detectSilence(
  history: History,
  sources: Pick<SourceConfig, 'id' | 'name' | 'enabled' | 'silenceDays'>[],
  options: SilenceOptions = {},
): SilenceIssue[] {
  const now = options.now ?? new Date();
  const globalDays = options.silenceDays ?? 14;
  const warmupDays = options.warmupDays ?? 3;
  const dayMs = 24 * 60 * 60 * 1000;

  const bySource = new Map<string, string>();
  for (const item of history.items) {
    const at = item.firstSeenAt ?? '';
    if (!at) continue;
    const prev = bySource.get(item.sourceId);
    if (!prev || at > prev) bySource.set(item.sourceId, at);
  }

  // 归档最早的一条：用来判断"我们观察了多久"
  const oldest = history.items.reduce<string | null>((min, i) => {
    const at = i.firstSeenAt ?? '';
    if (!at) return min;
    return !min || at < min ? at : min;
  }, null);
  const observedDays = oldest ? (now.getTime() - Date.parse(oldest)) / dayMs : 0;

  const issues: SilenceIssue[] = [];
  for (const s of sources) {
    if (!s.enabled) continue;
    const threshold = s.silenceDays ?? globalDays;
    const lastSeenAt = bySource.get(s.id) ?? null;

    if (!lastSeenAt) {
      if (observedDays >= warmupDays) {
        issues.push({
          sourceId: s.id,
          sourceName: s.name,
          kind: 'never',
          days: Math.floor(observedDays),
          lastSeenAt: null,
          threshold,
        });
      }
      continue;
    }

    const days = (now.getTime() - Date.parse(lastSeenAt)) / dayMs;
    if (days >= threshold) {
      issues.push({
        sourceId: s.id,
        sourceName: s.name,
        kind: 'silent',
        days: Math.floor(days),
        lastSeenAt,
        threshold,
      });
    }
  }
  return issues.sort((a, b) => b.days - a.days);
}

/** 日报顶部那一段提示。没有异常就返回空字符串（不制造噪音）。 */
export function renderSilenceNotice(issues: SilenceIssue[]): string {
  if (issues.length === 0) return '';
  const lines: string[] = [];
  lines.push(`> ⚠️ **${issues.length} 个来源可能有问题**（下面这些源最近没有新通知）`);
  for (const i of issues) {
    if (i.kind === 'never') {
      lines.push(`> - ${i.sourceName}：观察了 ${i.days} 天，一条都没抓到过（选择器可能不对）`);
    } else {
      lines.push(`> - ${i.sourceName}：${i.days} 天没有新通知（阈值 ${i.threshold} 天）`);
    }
  }
  lines.push('> ');
  lines.push('> 不一定是故障（寒暑假本来就安静），但值得跑一次 `radr doctor` 确认。');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function renderSilenceText(issues: SilenceIssue[]): string {
  if (issues.length === 0) return '';
  return issues
    .map((i) =>
      i.kind === 'never'
        ? `⚠ ${i.sourceName}：观察 ${i.days} 天，一条都没抓到过`
        : `⚠ ${i.sourceName}：${i.days} 天没有新通知（阈值 ${i.threshold} 天）`,
    )
    .join('\n');
}

export function silenceTitle(issues: SilenceIssue[], name = '校园通知雷达'): string {
  return `${name} · ${issues.length} 个来源可能有问题`.slice(0, 32);
}

export const defaultAlertOptions = (alerts: AlertsConfig) => ({
  silenceDays: alerts.silenceDays,
  warmupDays: alerts.warmupDays,
  throttleHours: alerts.throttleHours,
});
