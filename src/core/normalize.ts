import { createHash } from 'node:crypto';

/** 标题归一：去掉多余空白与零宽字符，让"同一条通知"在不同抓取里得到同一个 ID。 */
export function normalizeTitle(input: string): string {
  return (
    input
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      // 有些站点把中文逐字排版（「学 术」「关 于」），去掉汉字之间的空格
      .replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '')
      .trim()
  );
}

/**
 * 内容核：只留"这件事是什么"，去掉虚词、栏目后缀、括号补充与标点。
 *
 * 为什么需要它：同一份通知挂在不同栏目时，标题常带不同的壳 ——
 * 「关于X的通知」/「关于开展X工作的通知」/「X（教务处）」。
 * 只做空白归一会把它们判成两条，于是同一件事被两个来源各报一次。
 *
 * 只用于判重，**不参与 makeId**：改这里不能让历史 ID 变掉。
 */
export function contentCore(title: string): string {
  return normalizeTitle(title)
    .replace(/^关于/, '')
    // 括号里的补充说明：栏目名、文号、承办单位
    .replace(/[（(][^）)]{0,40}[)）]/g, '')
    // 尾巴上的文种：通知/通告/公告/公示/通报，可带一个"的"
    .replace(/(的)?(通知|通告|公告|公示|通报)$/g, '')
    // "报名工作" 与 "报名" 在公文里是同一件事；这一步要在去掉文种之后做
    .replace(/工作$/, '')
    .replace(/[\s，,。.、：:；;！!？?\-—_·|~/\\]+/g, '');
}

/**
 * 两条通知是不是"同一件事"：内容核相同，且日期差不超过 toleranceDays 天。
 *
 * 容差是必需的：同一份通知挂首页那天和挂教务处那天常差一两天
 * （实测「全国大学英语四、六级考试报名」在 oaa-tzgg 记 09-14、jwc-tzgg 记 09-15）。
 * 真·重发（隔周/隔月再发一次同名通知）会远超出容差，仍会各报一次。
 */
export function sameEvent(
  a: { title: string; date?: string | null },
  b: { title: string; date?: string | null },
  toleranceDays = 2,
): boolean {
  if (contentCore(a.title) !== contentCore(b.title)) return false;
  const da = a.date ?? null;
  const db = b.date ?? null;
  // 缺日期时只看标题：同一标题来自不同栏目，几乎肯定是同一件事
  if (!da || !db) return true;
  const diff = Math.abs(Date.parse(da) - Date.parse(db));
  return Number.isFinite(diff) && diff <= toleranceDays * 86400000;
}

/** 稳定 ID：源 + 标题 + 日期 的哈希前 16 位。改标题会变成新 ID，这是有意的（重发=新通知）。 */
export function makeId(sourceId: string, title: string, date: string | null): string {
  const basis = `${sourceId}|${normalizeTitle(title)}|${date ?? ''}`;
  return createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

/**
 * 宽松日期解析：国内高校列表页的日期格式五花八门。
 * 支持 2026/09/02、2026-9-2、2026.09.02、2026年9月2日、09-02（补当前年）。
 */
export function parseDateLoose(input: string | null | undefined, now = new Date()): string | null {
  if (!input) return null;
  const text = input.replace(/[\u200b-\u200d\ufeff]/g, ' ').trim();
  if (!text) return null;

  const pad = (n: number) => String(n).padStart(2, '0');
  const valid = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100;

  const full = /(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(text);
  if (full) {
    const [y, m, d] = [Number(full[1]), Number(full[2]), Number(full[3])];
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  const short = /(?:^|[^\d])(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?:[^\d]|$)/.exec(text);
  if (short) {
    const [m, d] = [Number(short[1]), Number(short[2])];
    const y = now.getFullYear();
    return valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }

  return null;
}

/** 判断链接是否站内相对路径 */
export function isRelative(href: string): boolean {
  return !/^https?:\/\//i.test(href);
}

/** 用 baseUrl 把相对链接补全；baseUrl 缺失时退回列表页地址。 */
export function resolveUrl(href: string, baseUrl: string, fallback: string): string {
  const clean = (href ?? '').trim();
  if (!clean || clean === '#') return fallback;
  if (!isRelative(clean)) return clean;
  try {
    return new URL(clean, baseUrl).toString();
  } catch {
    return fallback;
  }
}
