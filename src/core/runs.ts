import fs from 'node:fs';
import path from 'node:path';
import type { SourceResult } from '../types.ts';

/**
 * 每个源最近 N 次抓取的成功率（issue #6）。
 *
 * 为什么需要：`radr doctor` 只看当下 —— 某个源今天成功、昨天失败、前天也失败，
 * 表格里却显示"✓ 正常"。滚动窗口才能看出"这个源其实一直不稳"。
 *
 * 落盘时机（刻意保守，避免每天 72 个无意义提交）：
 *   · 本轮有新通知（本来就要写状态）→ 一起写
 *   · 或者本轮有源出问题 → 必须写（这正是要看的信息）
 */

export const DEFAULT_RUNS_FILE = path.join('data', 'runs.json');
export const DEFAULT_WINDOW = 20;
/**
 * 同一次「失败期」的判定窗口（分钟）。
 *
 * 为什么需要：poll 工作流为了扛住跨境网络抖动，一轮里最多重试 4 次（间隔 30/50/70 秒）。
 * 如果每次尝试都记一条 fail，"重试到第 3 次"就会顶到告警阈值 —— 而工作流最终可能第 4 次成功。
 * 实测数据就是这样：`fail,fail,fail,fail,ok`。所以同一失败期内的重试只算一次。
 * 窗口取得比 crontab 间隔（20 分钟）小，保证"真正持续不通"仍然能被计数。
 */
export const DEFAULT_PERIOD_MINUTES = 15;

export interface RunsState {
  version: number;
  updatedAt: string;
  /** sourceId → 最近的抓取结果（旧的在前面，新的在后面） */
  sources: Record<string, ('ok' | 'fail')[]>;
}

export const emptyRuns = (): RunsState => ({ version: 1, updatedAt: new Date(0).toISOString(), sources: {} });

export function loadRuns(file: string = DEFAULT_RUNS_FILE): RunsState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RunsState>;
    return { ...emptyRuns(), ...parsed, sources: { ...(parsed.sources ?? {}) } };
  } catch {
    return emptyRuns();
  }
}

export function saveRuns(state: RunsState, file: string = DEFAULT_RUNS_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * 记录一轮结果。skipped（需要浏览器但没开开关）不算失败也不计入 —— 那是预期行为。
 *
 * 记账规则（每一分都是为了"不产生无谓提交、也不误报"）：
 *   · 连续成功 → 不记（安静运行不该产生提交）
 *   · 第一次失败 → 记（并成为这次失败期的锚点）
 *   · 同一失败期内的重试（相隔小于 periodMinutes）→ 不记（工作流的 4 次重试只算一次失败）
 *   · 之后每隔一轮仍失败（新的一次失败期）→ 记（连续计数增长）
 *   · 失败之后的第一次成功 → 记（把连续计数清零）
 */
export function recordRun(
  results: SourceResult[],
  state: RunsState,
  options: { at?: string; window?: number; periodMinutes?: number } = {},
): { state: RunsState; changed: boolean } {
  const at = options.at ?? new Date().toISOString();
  const window = options.window ?? DEFAULT_WINDOW;
  const periodMs = (options.periodMinutes ?? DEFAULT_PERIOD_MINUTES) * 60_000;
  const atMs = Date.parse(at);
  const anchorMs = Date.parse(state.updatedAt);
  const samePeriod = Number.isFinite(atMs) && Number.isFinite(anchorMs) && atMs - anchorMs < periodMs;

  const sources: Record<string, ('ok' | 'fail')[]> = { ...state.sources };
  let appended = false;

  for (const r of results) {
    if (r.skipped) continue;
    const outcome: 'ok' | 'fail' = r.ok && r.items.length > 0 ? 'ok' : 'fail';
    const list = sources[r.sourceId] ?? [];
    const prev = list[list.length - 1];

    if (prev === outcome) {
      if (outcome === 'ok') continue; // 一直成功：不记
      if (samePeriod) continue; // 同一失败期内的重试：不记
    }

    sources[r.sourceId] = [...list, outcome].slice(-window);
    appended = true;
  }

  return {
    // 没有真正需要记的东西时，保持 updatedAt 不变 ——
    // 它同时是"失败期"的锚点，乱动会让持续故障被错误地合并掉
    state: { version: 1, updatedAt: appended ? at : state.updatedAt, sources },
    changed: appended,
  };
}

export interface SourceRate {
  sourceId: string;
  runs: number;
  ok: number;
  /** 0-1 */
  rate: number;
  last: 'ok' | 'fail' | null;
}

export function summarizeRuns(state: RunsState): Map<string, SourceRate> {
  const map = new Map<string, SourceRate>();
  for (const [sourceId, list] of Object.entries(state.sources)) {
    const ok = list.filter((x) => x === 'ok').length;
    map.set(sourceId, {
      sourceId,
      runs: list.length,
      ok,
      rate: list.length === 0 ? 0 : ok / list.length,
      last: list.length === 0 ? null : list[list.length - 1],
    });
  }
  return map;
}

/**
 * doctor 表格里那一列。
 *
 * 口径说明（重要，别误读）：记录的是**状态变化**（第一次失败、每个持续失败期、以及恢复成功），
 * 安静的成功不记 —— 否则每 20 分钟一轮会产生 72 次提交/天，把提交历史淹掉。
 * 所以这里的百分比是"最近 N 次记录的构成"，用来发现**不稳定**的源，而不是精确的可用率。
 */
export function renderRate(rate?: SourceRate): string {
  if (!rate || rate.runs === 0) return '';
  const percent = Math.round(rate.rate * 100);
  const warn = rate.runs >= 3 && rate.rate < 0.8 ? ' ⚠' : '';
  return `近 ${rate.runs} 次记录：成功 ${rate.ok}（${percent}%）${warn}`;
}
