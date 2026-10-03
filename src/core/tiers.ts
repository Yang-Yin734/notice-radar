import type { PushConfig } from './config.ts';
import type { Notice } from '../types.ts';
import { extractDeadline, isUrgentDeadline } from './deadline.ts';

/**
 * 通知分级：把新通知分成「立刻推」「进日报」「静音」三档。
 *
 * 背景（用户反馈）：每 20 分钟发现新通知就推一次，期中期末手机上会很吵；
 * 但选课/退课这类抢时间的通知又不能等到第二天早上。
 * 所以按关键词分级：命中 push.urgent 的立刻推，其余交给每天早上的日报。
 *
 * 还有一条更准的信号：标题自带**临近的截止日**（"9月30日前提交"）——
 * 关键词表未必抓得到，但"还剩 3 天"谁都能判断是急事，所以也算 urgent（issue #4）。
 */

export type Tier = 'urgent' | 'digest' | 'mute';

export interface TieredSplit {
  /** 立刻推 */
  urgent: Notice[];
  /** 进日报 */
  digest: Notice[];
  /** 静音（保留在归档与仪表盘里，只是不打扰） */
  mute: Notice[];
}

/** 在 text 里找第一个命中的关键词，返回它（用于告诉用户"为什么这条是急事"）。 */
export function matchKeyword(text: string, keywords: string[]): string | null {
  if (!text || keywords.length === 0) return null;
  const hay = text.toLowerCase();
  for (const raw of keywords) {
    const kw = raw.trim();
    if (!kw) continue;
    if (hay.includes(kw.toLowerCase())) return kw;
  }
  return null;
}

/** 一条通知属于哪一档。标题与标签都参与匹配；临近截止的算急事。 */
export function classify(notice: Notice, push: PushConfig, now: Date = new Date()): Tier {
  const text = `${notice.title} ${notice.tag ?? ''}`;
  if (matchKeyword(text, push.mute)) return 'mute';
  if (matchKeyword(text, push.urgent)) return 'urgent';
  if (isUrgentDeadline(extractDeadline(notice.title, now))) return 'urgent';
  return 'digest';
}

export function splitByTier(items: Notice[], push: PushConfig, now: Date = new Date()): TieredSplit {
  const split: TieredSplit = { urgent: [], digest: [], mute: [] };
  for (const n of items) split[classify(n, push, now)].push(n);
  return split;
}

/** 只有显式关掉分级（push.digestRest=false）才恢复"所有新通知都即时推"的老行为。 */
export function immediateItems(items: Notice[], push: PushConfig, now: Date = new Date()): Notice[] {
  if (!push.digestRest) return items;
  const { urgent } = splitByTier(items, push, now);
  return urgent;
}

/** 命中急事关键词时，告诉用户命中哪一个 —— 避免"为什么这条推了那条没推"的困惑。 */
export function explainTier(notice: Notice, push: PushConfig, now: Date = new Date()): string {
  const text = `${notice.title} ${notice.tag ?? ''}`;
  const hit = matchKeyword(text, push.urgent);
  if (hit) return `命中关键词「${hit}」`;
  const deadline = extractDeadline(notice.title, now);
  if (isUrgentDeadline(deadline)) return `临近截止（${deadline?.date}）`;
  return '常规通知';
}

// ---------------------------------------------------------------- 只采集不通知

/** 配置里标了 `collectOnly: true` 的源 —— 抓，但不打扰（不进推送、不进日报、不报故障）。 */
export function collectOnlyIds(sources: { id: string; collectOnly?: boolean }[]): Set<string> {
  const ids = new Set<string>();
  for (const s of sources) if (s.collectOnly) ids.add(s.id);
  return ids;
}

/**
 * 从通知链路里剔除"只采集不通知"的源。
 *
 * **只用在推送/日报/告警这一侧**：写归档、写仪表盘、写按校数据文件时要用全量，
 * 否则那些学校的通知就白抓了（用户以后订阅时翻不到历史）。
 */
export function notifiable<T extends { sourceId: string }>(
  items: T[],
  sources: { id: string; collectOnly?: boolean }[],
): T[] {
  const silent = collectOnlyIds(sources);
  return silent.size === 0 ? items : items.filter((i) => !silent.has(i.sourceId));
}
