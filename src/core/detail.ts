/**
 * 详情页正文 → 截止日期。
 *
 * 为什么值得单独跑一趟：实测线上 386 条真实归档里，标题带明确截止日的 **0 条**，
 * 而正文里「退课时间：10月26日12时至10月30日12时」「报名截止时间：11月1日」
 * 这种写法很常见。最初那版只从标题抽（issue #4），在真实数据上一条都没命中。
 *
 * 成本控制：
 *   - 只对标题命中"办事"动作词的新通知抓一次，一轮通常 0-3 条
 *   - 抓失败就当没有截止日，绝不因为拿不到而丢掉这条通知
 *   - 抓取沿用 fetch.ts 的超时与 UA，不额外增加对学校站点的压力
 */
import { fetchHtml } from './fetch.ts';
import { extractDeadlineFromBody, isActionableTitle } from './deadline.ts';
import type { Deadline } from './deadline.ts';

/** 剥掉脚本、样式、注释与标签，留可读文本。 */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface DetailOptions {
  timeoutMs?: number;
  now?: Date;
}

/** 抓一条通知的详情页并抽截止日。抓不到、正文里没有，都返回 null。 */
export async function deadlineFromPage(url: string, options: DetailOptions = {}): Promise<Deadline | null> {
  try {
    const res = await fetchHtml(url, options.timeoutMs ? { timeoutMs: options.timeoutMs } : {});
    return extractDeadlineFromBody(htmlToText(res.html), options.now);
  } catch {
    return null;
  }
}

/**
 * 给一批通知补截止日：只挑"办事型"标题，最多 limit 条，并发受限。
 * 返回新数组（不改原对象），顺序保持不变。
 */
export async function withDeadlines<T extends { title: string; url: string; deadline?: string; date?: string | null }>(
  items: T[],
  options: { limit?: number; concurrency?: number; timeoutMs?: number; now?: Date } = {},
): Promise<T[]> {
  const limit = options.limit ?? 20;
  const concurrency = options.concurrency ?? 3;
  const targets = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.deadline && isActionableTitle(item.title))
    .slice(0, limit);
  if (!targets.length) return items;

  const out = items.slice();
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const slot = targets[cursor++];
      // 参照时刻用这条通知自己的发布日期，而不是"现在"。
      // 否则归档回填时，「2025-2026-2学期退课（3月7日截止）」会被跨年推断推成明年，
      // 变成一条"还有半年才截止"的假提醒。截止日永远是相对发布日期说的。
      const ref = slot.item.date ? new Date(`${slot.item.date}T12:00:00+08:00`) : options.now;
      const deadline = await deadlineFromPage(slot.item.url, { timeoutMs: options.timeoutMs, now: ref });
      if (deadline) out[slot.index] = { ...slot.item, deadline: deadline.date };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, worker));
  return out;
}