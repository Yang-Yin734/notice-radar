/**
 * 从标题里抽「截止日期」，算还剩几天（issue #4）。
 *
 * 为什么值得做：通知标题常自带截止日（"9月30日前提交"），
 * 而"还剩几天"才是决定要不要现在处理的关键信息 —— 也是分级的最好依据：
 * 临近截止的一律当急事推，不用去猜关键词。
 *
 * 只认明确带"截止/前/之前/为止"这类标记的日期，避免把通知自身的日期误当截止日。
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** 北京时间偏移（分钟）：学生脑子里的"今天"是北京时间的今天 */
const BEIJING_OFFSET_MIN = 8 * 60;

export interface Deadline {
  /** YYYY-MM-DD */
  date: string;
  /** 距今天还有几天（0 = 今天截止，负数 = 已过期），按北京时间自然日算 */
  daysLeft: number;
}

/** "日"与截止标记之间可能夹着时间（"9月30日24:00前"、"10月8日 17:00 之前"）。 */
const TIME_GAP = String.raw`(?:\s*(?:上午|下午|晚上|晚|中午)?\s*\d{1,2}\s*(?:[:：点时]\s*\d{0,2}\s*分?)?)?`;

const PATTERNS: { re: RegExp; y: number; m: number; d: number }[] = [
  // 2026年9月30日之前 / 9月30日前 / 9月30日24:00前 / 10月8日 17:00 之前
  {
    re: new RegExp(String.raw`(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*${TIME_GAP}\s*(?:之前|以前|前|截止|为止)`),
    y: 1,
    m: 2,
    d: 3,
  },
  // 截止时间：2026-09-30 / 截止日期 2026年9月30日
  { re: /(?:截止|deadline)[^0-9]{0,10}(?:(\d{4})\s*[年\-/])?\s*(\d{1,2})\s*[月\-/]\s*(\d{1,2})\s*[日号]?/, y: 1, m: 2, d: 3 },
  // 2026-09-30 之前
  {
    re: new RegExp(String.raw`(\d{4})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})\s*${TIME_GAP}\s*(?:之前|以前|前|截止|为止)`),
    y: 1,
    m: 2,
    d: 3,
  },
  // 截止：9月30日
  { re: /(?:截止|deadline)[^0-9]{0,10}(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/, y: 0, m: 1, d: 2 },
];

const pad = (n: number) => String(n).padStart(2, '0');

/** 北京时间的"第几天"（用于算自然日差） */
function beijingDayNumber(date: Date): number {
  return Math.floor((date.getTime() + BEIJING_OFFSET_MIN * 60_000) / DAY_MS);
}

/**
 * 抽截止日。没有明确截止标记就返回 null（不猜）。
 *
 * 年份缺省的处理：先试当年；若算出来的日子已经过去 30 天以上，就认为是明年
 * （12 月看到"1月5日前"这种跨年写法）。
 */
export function extractDeadline(title: string, now: Date = new Date()): Deadline | null {
  if (!title) return null;
  const text = title.replace(/\s+/g, ' ');

  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const month = Number(m[p.m]);
    const day = Number(m[p.d]);
    if (!Number.isFinite(month) || !Number.isFinite(day)) continue;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;

    const explicitYear = p.y > 0 && m[p.y] ? Number(m[p.y]) : null;
    let year = explicitYear ?? now.getUTCFullYear();
    let stamp = Date.UTC(year, month - 1, day);
    if (explicitYear === null) {
      const daysPast = beijingDayNumber(now) - Math.floor((stamp + BEIJING_OFFSET_MIN * 60_000) / DAY_MS);
      if (daysPast > 30) {
        year += 1;
        stamp = Date.UTC(year, month - 1, day);
      }
    }

    // 校验月日真的存在（2 月 30 日这种要挡掉）
    const check = new Date(stamp);
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) continue;

    const date = `${year}-${pad(month)}-${pad(day)}`;
    const daysLeft = Math.floor((stamp + BEIJING_OFFSET_MIN * 60_000) / DAY_MS) - beijingDayNumber(now);
    return { date, daysLeft };
  }
  return null;
}

/** 渲染成推送里的角标：⏰ 剩 3 天 / ⏰ 今天截止 / ⏰ 已过期；太远或没有就不显示。 */
export function renderDeadline(deadline: Deadline | null, options: { maxDays?: number } = {}): string {
  if (!deadline) return '';
  const maxDays = options.maxDays ?? 60;
  if (deadline.daysLeft < 0) return deadline.daysLeft >= -7 ? `⏰ 已过期 ${-deadline.daysLeft} 天` : '';
  if (deadline.daysLeft > maxDays) return '';
  if (deadline.daysLeft === 0) return '⏰ 今天截止';
  if (deadline.daysLeft === 1) return '⏰ 明天截止';
  return `⏰ 剩 ${deadline.daysLeft} 天`;
}

/** 临近截止就算急事：默认 7 天内。 */
export function isUrgentDeadline(deadline: Deadline | null, withinDays = 7): boolean {
  if (!deadline) return false;
  return deadline.daysLeft >= 0 && deadline.daysLeft <= withinDays;
}
