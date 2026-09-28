import fs from 'node:fs';
import path from 'node:path';
import type { Notice } from '../types.ts';

/**
 * 历史归档：state.json 只记"见过哪些 ID"（为了去重），不保存内容。
 * 仪表盘要展示"这条通知什么时候第一次出现"，所以需要一份可累积的历史。
 *
 * 设计取舍：
 *   - 只存通知本身（标题/链接/日期/来源），不存正文 —— 体积小、也不涉及内容版权
 *   - 有上限（默认 3000 条），超了丢最旧的，避免仓库无限膨胀
 *   - 只在"真有新通知"时才写（和 state 同样的门控），所以不会每 20 分钟产生一次提交
 */

export interface HistoryItem extends Notice {
  /** 我们第一次看到它的时间（不是学校发布的时间） */
  firstSeenAt: string;
}

export interface History {
  version: number;
  updatedAt: string;
  items: HistoryItem[];
}

export const DEFAULT_HISTORY_FILE = path.join('data', 'history.json');
export const DEFAULT_CAP = 3000;

export const emptyHistory = (): History => ({ version: 1, updatedAt: new Date(0).toISOString(), items: [] });

export function loadHistory(file: string = DEFAULT_HISTORY_FILE): History {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<History>;
    return {
      version: parsed.version ?? 1,
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      items: Array.isArray(parsed.items) ? (parsed.items as HistoryItem[]) : [],
    };
  } catch {
    return emptyHistory();
  }
}

export function saveHistory(history: History, file: string = DEFAULT_HISTORY_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
}

/** 追加新通知（按 id 去重），按日期倒序排列，并裁到上限。返回新增条数。 */
export function appendHistory(
  history: History,
  notices: Notice[],
  options: { at?: string; cap?: number } = {},
): { history: History; added: number } {
  const at = options.at ?? new Date().toISOString();
  const cap = options.cap ?? DEFAULT_CAP;
  const known = new Set(history.items.map((i) => i.id));

  let added = 0;
  for (const notice of notices) {
    if (known.has(notice.id)) continue;
    known.add(notice.id);
    history.items.push({ ...notice, firstSeenAt: at });
    added++;
  }

  // 日期新的在前；同一天按"第一次看到"的时间排
  history.items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.firstSeenAt.localeCompare(a.firstSeenAt));
  if (history.items.length > cap) history.items = history.items.slice(0, cap);

  history.updatedAt = at;
  history.version = 1;
  return { history, added };
}

export interface SourceStat {
  sourceId: string;
  sourceName: string;
  count: number;
}

/** 每个源累计多少条（仪表盘用） */
export function countBySource(history: History): SourceStat[] {
  const map = new Map<string, SourceStat>();
  for (const item of history.items) {
    const hit = map.get(item.sourceId);
    if (hit) hit.count++;
    else map.set(item.sourceId, { sourceId: item.sourceId, sourceName: item.sourceName, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** 最近若干天每天新增多少条（仪表盘的趋势条用） */
export function countByDay(history: History, days: number, now = new Date()): { day: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const item of history.items) {
    const day = (item.firstSeenAt ?? '').slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([day, count]) => ({ day, count }));
}

export interface TagStat {
  tag: string;
  count: number;
}

export interface HistoryStats {
  total: number;
  /** 最早/最晚"我们第一次看到"的时间 */
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  bySource: SourceStat[];
  byTag: TagStat[];
  /** 最近 12 周每周新增 */
  byWeek: { week: string; count: number }[];
  /** 最近 6 个月每月新增 */
  byMonth: { month: string; count: number }[];
  /** 星期分布（0=周日）—— 看学校习惯哪天发通知 */
  byWeekday: { weekday: number; count: number }[];
  recent7: number;
  recent30: number;
  /** 单日最多新增 */
  busiestDay: { day: string; count: number } | null;
  activeDays: number;
  spanDays: number;
}

const isoWeek = (date: Date): string => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

/** 把归档汇总成一份可直接展示/输出的统计。 */
export function summarize(history: History, now: Date = new Date()): HistoryStats {
  const items = history.items;

  const tagCounts = new Map<string, number>();
  const weekCounts = new Map<string, number>();
  const monthCounts = new Map<string, number>();
  const weekdayCounts = new Map<number, number>();
  const perDay = new Map<string, number>();
  const seenTimes: string[] = [];

  for (const item of items) {
    if (item.tag) tagCounts.set(item.tag, (tagCounts.get(item.tag) ?? 0) + 1);
    if (item.firstSeenAt) {
      seenTimes.push(item.firstSeenAt);
      const when = new Date(item.firstSeenAt);
      if (!Number.isNaN(when.getTime())) {
        const week = isoWeek(when);
        weekCounts.set(week, (weekCounts.get(week) ?? 0) + 1);
        const month = item.firstSeenAt.slice(0, 7);
        monthCounts.set(month, (monthCounts.get(month) ?? 0) + 1);
        weekdayCounts.set(when.getUTCDay(), (weekdayCounts.get(when.getUTCDay()) ?? 0) + 1);
      }
    }
    const day = (item.firstSeenAt ?? '').slice(0, 10);
    if (day) perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }

  const dayMs = 86400000;
  const cutoff = (days: number) => new Date(now.getTime() - days * dayMs).toISOString();
  const recent7 = seenTimes.filter((t) => t >= cutoff(7)).length;
  const recent30 = seenTimes.filter((t) => t >= cutoff(30)).length;

  const sortedDays = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const seenSorted = [...seenTimes].sort();

  const last12Weeks: { week: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const week = isoWeek(new Date(now.getTime() - i * 7 * dayMs));
    last12Weeks.push({ week, count: weekCounts.get(week) ?? 0 });
  }
  const last6Months: { month: string; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const month = d.toISOString().slice(0, 7);
    last6Months.push({ month, count: monthCounts.get(month) ?? 0 });
  }

  const spanDays = seenSorted.length
    ? Math.max(
        1,
        Math.round((new Date(seenSorted[seenSorted.length - 1]).getTime() - new Date(seenSorted[0]).getTime()) / dayMs) + 1,
      )
    : 0;

  return {
    total: items.length,
    firstSeenAt: seenSorted[0] ?? null,
    lastSeenAt: seenSorted[seenSorted.length - 1] ?? null,
    bySource: countBySource(history),
    byTag: [...tagCounts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count),
    byWeek: last12Weeks,
    byMonth: last6Months,
    byWeekday: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, count: weekdayCounts.get(weekday) ?? 0 })),
    recent7,
    recent30,
    busiestDay: sortedDays[0] ? { day: sortedDays[0][0], count: sortedDays[0][1] } : null,
    activeDays: perDay.size,
    spanDays,
  };
}

/** 把统计渲染成终端里好看的文本（radr stats）。 */
export function renderStats(stats: HistoryStats, name = '通知雷达'): string {
  const lines: string[] = [];
  const bar = (n: number, max: number, width = 18): string => {
    const filled = max > 0 ? Math.round((n / max) * width) : 0;
    return '█'.repeat(filled) + '·'.repeat(Math.max(0, width - filled));
  };
  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  lines.push(`▸ ${name} 归档统计`);
  lines.push('');
  lines.push(`  累计归档      ${stats.total} 条`);
  if (stats.firstSeenAt) lines.push(`  最早一条      ${stats.firstSeenAt.slice(0, 16).replace('T', ' ')}`);
  if (stats.lastSeenAt) lines.push(`  最近一条      ${stats.lastSeenAt.slice(0, 16).replace('T', ' ')}`);
  lines.push(`  最近 7 天     ${stats.recent7} 条`);
  lines.push(`  最近 30 天    ${stats.recent30} 条`);
  lines.push(`  有新增的天数  ${stats.activeDays} / ${stats.spanDays} 天`);
  if (stats.busiestDay) lines.push(`  单日最多      ${stats.busiestDay.day}（${stats.busiestDay.count} 条）`);
  lines.push('');

  const maxSource = Math.max(1, ...stats.bySource.map((s) => s.count));
  lines.push('  按来源');
  for (const s of stats.bySource) lines.push(`    ${bar(s.count, maxSource)} ${String(s.count).padStart(4)}  ${s.sourceName}`);
  lines.push('');

  if (stats.byTag.length) {
    const maxTag = Math.max(1, ...stats.byTag.map((t) => t.count));
    lines.push('  按标签');
    for (const t of stats.byTag.slice(0, 10)) lines.push(`    ${bar(t.count, maxTag)} ${String(t.count).padStart(4)}  ${t.tag}`);
    lines.push('');
  }

  const maxWeek = Math.max(1, ...stats.byWeek.map((w) => w.count));
  lines.push('  最近 12 周');
  for (const w of stats.byWeek) lines.push(`    ${bar(w.count, maxWeek, 10)} ${String(w.count).padStart(3)}  ${w.week}`);
  lines.push('');

  const maxWeekday = Math.max(1, ...stats.byWeekday.map((d) => d.count));
  lines.push('  星期分布（发布规律）');
  for (const d of stats.byWeekday) {
    lines.push(`    ${bar(d.count, maxWeekday, 10)} ${String(d.count).padStart(3)}  ${weekdayNames[d.weekday]}`);
  }
  return lines.join('\n');
}
