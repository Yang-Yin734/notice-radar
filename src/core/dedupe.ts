import fs from 'node:fs';
import path from 'node:path';
import type { Notice } from '../types.ts';

/**
 * 状态：只记"见过哪些通知 ID"。
 * 不存通知正文，不存任何个人信息 —— 这是本项目可以放心提交到公开仓库的前提。
 */
export interface RadarState {
  version: number;
  /** sourceId -> 已见过的 ID 列表（滚动窗口） */
  seen: Record<string, string[]>;
  lastRun: string | null;
}

export const emptyState = (): RadarState => ({ version: 1, seen: {}, lastRun: null });

export function loadState(file: string): RadarState {
  if (!fs.existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as RadarState;
    return { version: parsed.version ?? 1, seen: parsed.seen ?? {}, lastRun: parsed.lastRun ?? null };
  } catch {
    return emptyState();
  }
}

export function saveState(file: string, state: RadarState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/** 挑出没见过的新通知（不修改 state）。 */
export function splitNew(items: Notice[], state: RadarState): Notice[] {
  return items.filter((n) => !(state.seen[n.sourceId] ?? []).includes(n.id));
}

/** 把通知标记为已见，并按窗口裁剪历史，避免 state 无限膨胀。 */
export function markSeen(items: Notice[], state: RadarState, window = 800): void {
  for (const n of items) {
    const list = state.seen[n.sourceId] ?? [];
    if (!list.includes(n.id)) list.push(n.id);
    state.seen[n.sourceId] = list.slice(-window);
  }
  state.lastRun = new Date().toISOString();
}
