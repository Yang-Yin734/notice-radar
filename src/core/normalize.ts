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
