import type { History, HistoryItem } from './history.ts';

/** 北京时间偏移（分钟）。归档里的时间是 UTC ISO，展示与时间窗按北京时间为准。 */
const BEIJING_OFFSET_MIN = 8 * 60;

export interface DigestRange {
  since: Date;
  until: Date;
  /** 长标签，写在正文里，如 "2026-09-28（北京时间）" */
  label: string;
  /** 短标签，写进推送标题（Server酱标题限 32 字），如 "9月28日" */
  shortLabel: string;
}

export interface DigestOptions extends DigestRange {
  /** 正文里最多列多少条（默认 40） */
  maxItems?: number;
  /** 每个来源最多列多少条（默认 8） */
  maxPerSource?: number;
  /** 应用/仪表盘地址，放在文末 */
  appUrl?: string;
}

export interface DigestGroup {
  sourceId: string;
  sourceName: string;
  /** 该来源在窗口内的总数（可能大于 items.length） */
  total: number;
  items: HistoryItem[];
}

export interface Digest {
  label: string;
  shortLabel: string;
  sinceIso: string;
  untilIso: string;
  /** 窗口内总条数 */
  total: number;
  /** 实际列出的条数 */
  shown: number;
  groups: DigestGroup[];
  tagCounts: { tag: string; count: number }[];
  empty: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 北京时间某个自然日的区间（[since, until)）。 */
export function beijingDayRange(day: string): DigestRange {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) throw new Error(`--date 需要 YYYY-MM-DD 格式，收到：${day}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const since = new Date(Date.UTC(y, mo - 1, d) - BEIJING_OFFSET_MIN * 60_000);
  const until = new Date(since.getTime() + DAY_MS);
  return {
    since,
    until,
    label: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}（北京时间）`,
    shortLabel: `${mo}月${d}日`,
  };
}

/** 昨天（北京时间）—— 每天早 8 点推日报时用的默认窗口。 */
export function yesterdayRange(now: Date = new Date()): DigestRange {
  const beijing = new Date(now.getTime() + BEIJING_OFFSET_MIN * 60_000);
  beijing.setUTCDate(beijing.getUTCDate() - 1);
  return beijingDayRange(beijing.toISOString().slice(0, 10));
}

/** 滚动窗口：最近 N 小时。 */
export function rollingRange(hours: number, now: Date = new Date()): DigestRange {
  const since = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return { since, until: now, label: `最近 ${hours} 小时`, shortLabel: `近${hours}小时` };
}

/** 把归档里某个时间窗内「首次发现」的通知合成一份日报。 */
export function buildDigest(history: History, options: DigestOptions): Digest {
  const { since, until, label, shortLabel, maxItems = 40, maxPerSource = 8 } = options;
  const sinceMs = since.getTime();
  const untilMs = until.getTime();

  const inWindow = history.items.filter((n) => {
    const t = Date.parse(n.firstSeenAt ?? '');
    return Number.isFinite(t) && t >= sinceMs && t < untilMs;
  });

  const bySource = new Map<string, HistoryItem[]>();
  for (const n of inWindow) {
    const list = bySource.get(n.sourceId) ?? [];
    list.push(n);
    bySource.set(n.sourceId, list);
  }

  let budget = maxItems;
  const groups: DigestGroup[] = [];
  for (const [sourceId, all] of bySource) {
    // 通知日期新的在前；同日期按发现时间倒序
    all.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.firstSeenAt.localeCompare(a.firstSeenAt));
    const take = Math.max(0, Math.min(all.length, maxPerSource, budget));
    budget -= take;
    groups.push({ sourceId, sourceName: all[0]?.sourceName ?? sourceId, total: all.length, items: all.slice(0, take) });
  }
  // 条数多的来源排前面，读者一眼看到"哪个学院今天话多"
  groups.sort((a, b) => b.total - a.total || a.sourceName.localeCompare(b.sourceName, 'zh'));

  const tagMap = new Map<string, number>();
  for (const n of inWindow) {
    if (!n.tag) continue;
    tagMap.set(n.tag, (tagMap.get(n.tag) ?? 0) + 1);
  }
  const tagCounts = [...tagMap.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh'));

  return {
    label,
    shortLabel,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    total: inWindow.length,
    shown: groups.reduce((sum, g) => sum + g.items.length, 0),
    groups,
    tagCounts,
    empty: inWindow.length === 0,
  };
}

/** 推送标题（Server酱 限 32 字，这里一律裁到 32）。 */
export function digestTitle(digest: Digest, name = '校园通知雷达'): string {
  const text = digest.empty ? `${name} · ${digest.shortLabel} 无新通知` : `${name} · ${digest.shortLabel} 新增 ${digest.total} 条`;
  return text.slice(0, 32);
}

export interface DigestRenderOptions {
  name?: string;
  appUrl?: string;
  /** 正文末尾的自述行 */
  footer?: string;
}

/** 渲染成 Markdown：Server酱/邮件都吃这个格式。 */
export function renderDigestMarkdown(digest: Digest, options: DigestRenderOptions = {}): string {
  const { name = '校园通知雷达', appUrl, footer } = options;
  const lines: string[] = [];

  lines.push(`# ${name} · ${digest.label}`);
  lines.push('');

  if (digest.empty) {
    lines.push('这段时间没有新通知。');
    lines.push('');
    if (appUrl) lines.push(`[打开应用](${appUrl})`);
    lines.push('');
    lines.push(footer ?? '由 notice-radar 自动汇总：只抓公开页面，不登录、不存储个人信息。');
    return `${lines.join('\n').trim()}\n`;
  }

  lines.push(`共 **${digest.total} 条**新通知，来自 **${digest.groups.length} 个来源**。`);
  if (digest.tagCounts.length > 0) {
    lines.push('');
    lines.push(`标签：${digest.tagCounts.slice(0, 6).map((t) => `${t.tag} ${t.count}`).join(' · ')}`);
  }
  lines.push('');

  for (const g of digest.groups) {
    lines.push(`## ${g.sourceName}（${g.total} 条）`);
    lines.push('');
    for (const n of g.items) {
      const tag = n.tag ? `\`${n.tag}\` ` : '';
      lines.push(`- **${n.date ?? '日期未知'}** ${tag}[${n.title}](${n.url})`);
    }
    if (g.total > g.items.length) lines.push(`- …另有 ${g.total - g.items.length} 条`);
    lines.push('');
  }

  if (digest.shown < digest.total) {
    lines.push(`> 只列了 ${digest.shown}/${digest.total} 条，完整内容见应用。`);
    lines.push('');
  }
  if (appUrl) lines.push(`[打开应用](${appUrl})`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(footer ?? '由 notice-radar 自动汇总：只抓公开页面，不登录、不存储个人信息。');
  return `${lines.join('\n').trim()}\n`;
}

/** 渲染成纯文本：webhook/终端里更直观。 */
export function renderDigestText(digest: Digest, options: DigestRenderOptions = {}): string {
  const { name = '校园通知雷达', appUrl } = options;
  const lines: string[] = [];
  lines.push(`${name} · ${digest.label}`);
  lines.push('');
  if (digest.empty) {
    lines.push('这段时间没有新通知。');
  } else {
    lines.push(`共 ${digest.total} 条新通知，来自 ${digest.groups.length} 个来源。`);
    if (digest.tagCounts.length > 0) {
      lines.push(`标签：${digest.tagCounts.slice(0, 6).map((t) => `${t.tag} ${t.count}`).join(' · ')}`);
    }
    lines.push('');
    for (const g of digest.groups) {
      lines.push(`【${g.sourceName}】${g.total} 条`);
      for (const n of g.items) {
        const tag = n.tag ? `[${n.tag}] ` : '';
        lines.push(`  · ${n.date ?? '日期未知'} ${tag}${n.title}`);
        lines.push(`    ${n.url}`);
      }
      if (g.total > g.items.length) lines.push(`  · …另有 ${g.total - g.items.length} 条`);
      lines.push('');
    }
  }
  if (appUrl) lines.push(`应用：${appUrl}`);
  return `${lines.join('\n').trim()}\n`;
}
