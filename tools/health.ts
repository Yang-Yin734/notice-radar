import fs from 'node:fs';
import path from 'node:path';

/**
 * 故障判定：区分"网络天气"和"真故障"。
 *
 * 背景：宿主机在境外时，抓境内学校站点会偶发整体不可达（实测约每 3 次有 1 次）。
 * 如果每次都让 CI 变红，用户会被 GitHub 的失败邮件淹没；但如果一律放过，
 * 真故障（站点改版、解析全废）就没人知道了。
 *
 * 规则：
 *   - 成功一次 → 计数清零
 *   - 连续失败 < 阈值 → 只记 warning，CI 仍是绿的
 *   - 连续失败 == 阈值 → 判为真故障，CI 变红（每次"故障期"只报一次，之后静默直到恢复）
 */

export const DEFAULT_HEALTH_FILE = path.join('data', 'health.json');
export const DEFAULT_THRESHOLD = 3;

export interface HealthState {
  /** 连续"所有源都抓不到"的次数 */
  consecutiveAllFail: number;
  updatedAt: string;
  lastOutcome: 'ok' | 'fail';
  /** 本轮故障期是否已经报过红，避免同一个故障反复发邮件 */
  reported: boolean;
}

export const emptyHealth = (): HealthState => ({
  consecutiveAllFail: 0,
  updatedAt: new Date(0).toISOString(),
  lastOutcome: 'ok',
  reported: false,
});

export function loadHealth(file: string = DEFAULT_HEALTH_FILE): HealthState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<HealthState>;
    return { ...emptyHealth(), ...parsed, consecutiveAllFail: Number(parsed.consecutiveAllFail ?? 0) };
  } catch {
    return emptyHealth();
  }
}

export function saveHealth(state: HealthState, file: string = DEFAULT_HEALTH_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export interface HealthVerdict {
  state: HealthState;
  /** 是否应该把这次运行判为失败（CI 变红） */
  fail: boolean;
  /** 状态是否发生变化（决定要不要写文件 —— 不变化就不写，免得每轮都产生一次提交） */
  changed: boolean;
  message: string;
  level: 'ok' | 'warning' | 'error';
}

export function updateHealth(
  outcome: 'ok' | 'fail',
  previous: HealthState,
  options: { now?: string; threshold?: number } = {},
): HealthVerdict {
  const now = options.now ?? new Date().toISOString();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  if (outcome === 'ok') {
    const wasFailing = previous.consecutiveAllFail > 0;
    const state: HealthState = { consecutiveAllFail: 0, updatedAt: now, lastOutcome: 'ok', reported: false };
    return {
      state,
      fail: false,
      changed: wasFailing || previous.lastOutcome !== 'ok',
      message: wasFailing ? `抓取恢复正常（此前连续失败 ${previous.consecutiveAllFail} 次）` : '抓取正常',
      level: 'ok',
    };
  }

  const consecutiveAllFail = previous.consecutiveAllFail + 1;
  const shouldReport = consecutiveAllFail >= threshold && !previous.reported;
  const state: HealthState = {
    consecutiveAllFail,
    updatedAt: now,
    lastOutcome: 'fail',
    reported: previous.reported || shouldReport,
  };

  const message = shouldReport
    ? `连续 ${consecutiveAllFail} 次全部源抓取失败 —— 判为真故障（不是偶发网络抖动），请检查站点或解析`
    : consecutiveAllFail >= threshold
      ? `连续 ${consecutiveAllFail} 次全部源失败（本轮故障已报过一次，不再重复打扰）`
      : `第 ${consecutiveAllFail} 次全部源失败（连续 ${threshold} 次才判故障，先记为网络天气）`;

  return {
    state,
    fail: shouldReport,
    changed: true, // 连续计数每次都会变，但下面 CLI 里只在需要时报红；写文件由调用方按 changedInc 判断
    message,
    level: shouldReport ? 'error' : 'warning',
  };
}

// ---------- CLI ----------
// 用法：node tools/health.ts --outcome=ok|fail [--file=路径] [--threshold=3]

function isMain(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('health.ts') || entry.endsWith('health.mjs') || entry.endsWith('health.js');
}

if (isMain()) {
  const args = process.argv.slice(2);
  const valueOf = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const outcome = valueOf('outcome');
  const file = valueOf('file') ?? DEFAULT_HEALTH_FILE;
  const threshold = Number(valueOf('threshold') ?? DEFAULT_THRESHOLD);

  if (outcome !== 'ok' && outcome !== 'fail') {
    console.error('用法：node tools/health.ts --outcome=ok|fail [--file=路径] [--threshold=3]');
    process.exit(2);
  }

  const previous = loadHealth(file);
  const verdict = updateHealth(outcome, previous, { threshold });

  // 只在计数真的变化时写文件：这样"连续失败"期间不会每 20 分钟就产生一次提交
  const written = verdict.state.consecutiveAllFail !== previous.consecutiveAllFail ||
    verdict.state.lastOutcome !== previous.lastOutcome ||
    verdict.state.reported !== previous.reported;
  if (written) saveHealth(verdict.state, file);

  const prefix = verdict.level === 'error' ? '::error::' : verdict.level === 'warning' ? '::warning::' : '';
  console.log(`${prefix}${verdict.message}`);
  if (!written) console.log('（连续计数未变化，未写 health 文件）');
  process.exit(verdict.fail ? 1 : 0);
}
