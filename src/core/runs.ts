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
 */
export function recordRun(
  results: SourceResult[],
  state: RunsState,
  options: { at?: string; window?: number } = {},
): { state: RunsState; changed: boolean } {
  const at = options.at ?? new Date().toISOString();
  const window = options.window ?? DEFAULT_WINDOW;
  const sources: Record<string, ('ok' | 'fail')[]> = { ...state.sources };
  let changed = false;

  for (const r of results) {
    if (r.skipped) continue;
    const outcome: 'ok' | 'fail' = r.ok && r.items.length > 0 ? 'ok' : 'fail';
    const list = [...(sources[r.sourceId] ?? []), outcome].slice(-window);
    const before = sources[r.sourceId] ?? [];
    if (before.length !== list.length || before[before.length - 1] !== list[list.length - 1]) changed = true;
    sources[r.sourceId] = list;
  }

  return { state: { version: 1, updatedAt: at, sources }, changed };
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

/** doctor 表格里那一列："最近 20 次成功 18 次（90%）"；没有记录就留空。 */
export function renderRate(rate?: SourceRate): string {
  if (!rate || rate.runs === 0) return '';
  const percent = Math.round(rate.rate * 100);
  const warn = rate.runs >= 3 && rate.rate < 0.8 ? ' ⚠' : '';
  return `最近 ${rate.runs} 次成功 ${rate.ok} 次（${percent}%）${warn}`;
}
