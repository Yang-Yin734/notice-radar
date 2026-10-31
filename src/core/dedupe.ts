import fs from 'node:fs';
import path from 'node:path';
import type { Notice } from '../types.ts';
import { contentCore, sameEvent } from './normalize.ts';

/**
 * 状态：只记"见过哪些通知 ID"。
 * 不存通知正文，不存任何个人信息 —— 这是本项目可以放心提交到公开仓库的前提。
 */
export interface RadarState {
  version: number;
  /** sourceId -> 已见过的 ID 列表（滚动窗口） */
  seen: Record<string, string[]>;
  /**
   * 内容级记账（`内容核|日期`）。与 `seen` 的区别：
   *
   * `seen` 的键是 **ID**，而 ID 里含 sourceId —— 同一份通知从教务处和研究生院
   * 各来一次，就是两个不同的 ID。于是只要两个源不同轮成功（实测 uestc 的几个
   * 源成功率 15–25%，几乎不会同轮成功），同一条通知就会被"各报一次"。
   *
   * 这就是"同一个消息标上两个不同的标签，却分别通知"的成因。
   * `seenEvents` 不看来源、只看内容：报过就不算新。
   *
   * 旧 state.json 没有这个字段，按空数组处理（升级时自动补齐）。
   */
  seenEvents?: string[];
  lastRun: string | null;
}

export const emptyState = (): RadarState => ({ version: 1, seen: {}, seenEvents: [], lastRun: null });

export function loadState(file: string): RadarState {
  if (!fs.existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RadarState;
    return {
      version: parsed.version ?? 1,
      seen: parsed.seen ?? {},
      seenEvents: Array.isArray(parsed.seenEvents) ? parsed.seenEvents : [],
      lastRun: parsed.lastRun ?? null,
    };
  } catch {
    return emptyState();
  }
}

export function saveState(file: string, state: RadarState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** `内容核|日期` —— contentCore 已剔除 `|`，可以安全用单分隔符拆。 */
const eventKey = (n: { title: string; date?: string | null }): string => `${contentCore(n.title)}|${n.date ?? ''}`;

const splitEventKey = (key: string): { core: string; date: string } => {
  const at = key.lastIndexOf('|');
  return at < 0 ? { core: key, date: '' } : { core: key.slice(0, at), date: key.slice(at + 1) };
};

/** 日期容差：同一件事在不同栏目挂出时，列表页日期常差一两天。 */
const DATE_TOLERANCE_DAYS = 2;

const withinTolerance = (a: string, b: string): boolean => {
  if (!a || !b) return true; // 缺日期时只看内容核
  const diff = Math.abs(Date.parse(a) - Date.parse(b));
  return Number.isFinite(diff) && diff <= DATE_TOLERANCE_DAYS * 86400000;
};

/**
 * 挑出没见过的新通知（不修改 state）。
 *
 * 两道判断：
 *   1. 本源的 ID 见过 → 跳过（同一源重复抓到）
 *   2. 内容报过 → 跳过（换个栏目/换个学校抓到同一件事）
 * 第 2 条是本轮修的重复推送问题：原来只有第 1 条，跨源轮换抓取时会反复"新"。
 */
export function splitNew(items: Notice[], state: RadarState): Notice[] {
  const events = (state.seenEvents ?? []).map(splitEventKey);
  return items.filter((n) => {
    if ((state.seen[n.sourceId] ?? []).includes(n.id)) return false;
    const core = contentCore(n.title);
    const date = n.date ?? '';
    return !events.some((e) => e.core === core && withinTolerance(e.date, date));
  });
}

/** 把通知标记为已见，并按窗口裁剪历史，避免 state 无限膨胀。 */
export function markSeen(items: Notice[], state: RadarState, window = 800, eventWindow = 2000): void {
  for (const n of items) {
    const list = state.seen[n.sourceId] ?? [];
    if (!list.includes(n.id)) list.push(n.id);
    state.seen[n.sourceId] = list.slice(-window);
  }

  const events = state.seenEvents ?? [];
  for (const n of items) {
    const key = eventKey(n);
    if (!events.includes(key)) events.push(key);
  }
  state.seenEvents = events.slice(-eventWindow);
  state.lastRun = new Date().toISOString();
}

/**
 * 跨源去重：同一条通知常常同时挂在教务处「重要公告」和「学生事务公告」下。
 * 保留首次出现的那条，把其余来源记进 alsoIn —— 日报里只出现一次，但你知道它在哪还挂着。
 *
 * 判据是「内容核 + 日期容差」：见 `sameEvent`。原来用「归一标题 + 精确日期」，
 * 而不同栏目的日期常差一天（09-14 / 09-15），于是同一件事并不到一起。
 */
export function dedupeAcrossSources(items: Notice[]): Notice[] {
  const out: Notice[] = [];
  // 内容核 -> out 里可能同事件的条目下标（同一核可能对应隔月重发的两条，所以是列表）
  const buckets = new Map<string, number[]>();

  for (const item of items) {
    const core = contentCore(item.title);
    const candidates = buckets.get(core) ?? [];
    const hit = candidates.find((idx) => sameEvent(out[idx], item));

    if (hit === undefined) {
      buckets.set(core, [...candidates, out.length]);
      out.push({ ...item, alsoIn: [] });
      continue;
    }

    const keeper = out[hit];
    const others = keeper.alsoIn ?? [];
    if (keeper.sourceName !== item.sourceName && !others.includes(item.sourceName)) {
      others.push(item.sourceName);
    }
    keeper.alsoIn = others;
  }

  return out;
}