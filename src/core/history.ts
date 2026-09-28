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
