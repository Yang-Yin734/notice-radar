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

export function renderProblemMarkdown(problems: SourceProblem[], name = '校园通知雷达'): string {
  const lines: string[] = [];
  lines.push(`# ${name} · 抓取异常（${problems.length} 个源）`);
  lines.push('');
  for (const p of problems) {
    const label = p.kind === 'fetch-failed' ? '抓取失败' : '解析不出条目';
    lines.push(`- **${p.sourceName}**：${label} —— ${p.detail}`);
  }
  lines.push('');
  lines.push('可能是站点改版或选择器过时。本机跑 `radr doctor` 能看到逐源状态；');
  lines.push('如果是站点结构变了，改 `selectors` 即可（见 docs/add-your-school.md）。');
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
