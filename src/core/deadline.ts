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
 * 从月/日（可带年份）算出 Deadline。
 *
 * 年份缺省的处理：先试当年；若算出来的日子已经过去 30 天以上，就认为是明年
 * （12 月看到"1月5日前"这种跨年写法）。
 */
function buildDeadline(explicitYear: number | null, month: number, day: number, now: Date): Deadline | null {
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

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
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;

  const date = `${year}-${pad(month)}-${pad(day)}`;
  const daysLeft = Math.floor((stamp + BEIJING_OFFSET_MIN * 60_000) / DAY_MS) - beijingDayNumber(now);
  return { date, daysLeft };
}

export function extractDeadline(title: string, now: Date = new Date()): Deadline | null {
  if (!title) return null;
  const text = title.replace(/\s+/g, ' ');

  for (const p of PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    const explicitYear = p.y > 0 && m[p.y] ? Number(m[p.y]) : null;
    const built = buildDeadline(explicitYear, Number(m[p.m]), Number(m[p.d]), now);
    if (built) return built;
  }
  return null;
}

/**
 * 正文里抽截止日的宽规则，顺序即优先级，命中即返回。
 *
 * 为什么不能复用标题那套：教务处正文的常见写法是
 *   「退课时间：10月26日12时至10月30日12时」「报名截止时间：11月1日」
 *   「8 月31日9:00至9月4日」—— 中间夹时间、用"时"不用冒号、
 *   甚至日期与"月/日"之间有空格。标题那套（要求紧跟"前/截止"）一条都抓不到。
 */
const BODY_RULES: { re: RegExp; pick: (m: RegExpExecArray) => { y: string | null; m: string; d: string } }[] = [
  // 区间取结束日：10月26日12时至10月30日12时 / 9月4日至5日 / 8月31日9:00至9月4日
  {
    re: new RegExp(String.raw`(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*${TIME_GAP}\s*(?:至|到|—|－|~|-)\s*(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*[日号]`),
    pick: (m) => ({ y: null, m: m[3] ?? m[1], d: m[4] }),
  },
  // 明确截止语 + 日期：报名截止时间：11月1日 / 截止日期 2026年9月30日
  {
    re: new RegExp(String.raw`(?:截止|截至)(?:时间|日期)?[^0-9]{0,10}(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]`),
    pick: (m) => ({ y: m[1] ?? null, m: m[2], d: m[3] }),
  },
  // 办事动作 + 时间/日期 + 日期：退课时间：10月26日 / 报名时间：9月1日
  {
    re: new RegExp(
      String.raw`(?:退课|补选|选课|报名|申请|提交|申报|缴费|确认|注册|报到|评教)[^。；]{0,16}(?:时间|日期)[^0-9]{0,8}(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]`,
    ),
    pick: (m) => ({ y: m[1] ?? null, m: m[2], d: m[3] }),
  },
  // 日期 + 截止语：10月8日 17:00 之前
  {
    re: new RegExp(String.raw`(?:(\d{4})\s*年)?\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?\s*${TIME_GAP}\s*(?:之前|以前|前|止|截止)`),
    pick: (m) => ({ y: m[1] ?? null, m: m[2], d: m[3] }),
  },
];

/** 从详情页正文（已剥掉标签的纯文本）里抽截止日。抽不到返回 null，不猜。 */
export function extractDeadlineFromBody(body: string, now: Date = new Date()): Deadline | null {
  if (!body) return null;
  const text = body.replace(/\s+/g, ' ');
  for (const rule of BODY_RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    const { y, m: month, d } = rule.pick(m);
    const built = buildDeadline(y ? Number(y) : null, Number(month), Number(d), now);
    if (built) return built;
  }
  return null;
}

/** 标题里出现"办事"动作词，才值得去抓正文找截止日（讲座、公示本来就没有截止日）。 */
export function isActionableTitle(title: string): boolean {
  return /退课|补选|选课|报名|申请|提交|申报|缴费|注册|报到|评教|确认|评审|材料|资格|审核/.test(title);
}

/**
 * 展示用：优先用落库的 `deadline` 现算剩余天数，没有再回退到标题。
 *
 * 为什么不把 daysLeft 一起落库：它是相对量，隔天就过期（归档会变成"剩 -37 天"）。
 * 存日期、算天数，才是能长期放进归档的写法治。
 */
export function resolveDeadline(notice: { title: string; deadline?: string }, now: Date = new Date()): Deadline | null {
  if (notice.deadline) {
    const [y, m, d] = notice.deadline.split('-').map(Number);
    const built = buildDeadline(y, m, d, now);
    if (built) return built;
  }
  return extractDeadline(notice.title, now);
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
