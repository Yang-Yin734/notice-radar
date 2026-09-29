import type { PushConfig } from './config.ts';
import type { Notice } from '../types.ts';

/**
 * 通知分级：把新通知分成「立刻推」「进日报」「静音」三档。
 *
 * 背景（用户反馈）：每 20 分钟发现新通知就推一次，期中期末手机上会很吵；
 * 但选课/退课这类抢时间的通知又不能等到第二天早上。
 * 所以按关键词分级：命中 push.urgent 的立刻推，其余交给每天早上的日报。
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

/** 一条通知属于哪一档。标题与标签都参与匹配。 */
export function classify(notice: Notice, push: PushConfig): Tier {
  const text = `${notice.title} ${notice.tag ?? ''}`;
  if (matchKeyword(text, push.mute)) return 'mute';
  if (matchKeyword(text, push.urgent)) return 'urgent';
  return 'digest';
}

export function splitByTier(items: Notice[], push: PushConfig): TieredSplit {
  const split: TieredSplit = { urgent: [], digest: [], mute: [] };
  for (const n of items) split[classify(n, push)].push(n);
  return split;
}

/** 只有显式关掉分级（push.digestRest=false）才恢复"所有新通知都即时推"的老行为。 */
export function immediateItems(items: Notice[], push: PushConfig): Notice[] {
  if (!push.digestRest) return items;
  const { urgent } = splitByTier(items, push);
  return urgent;
}

/** 命中急事关键词时，告诉用户命中哪一个 —— 避免"为什么这条推了那条没推"的困惑。 */
export function explainTier(notice: Notice, push: PushConfig): string {
  const text = `${notice.title} ${notice.tag ?? ''}`;
  const hit = matchKeyword(text, push.urgent);
  return hit ? `命中关键词「${hit}」` : '常规通知';
}
