import type { Notice, SourceResult } from '../types.ts';
import { extractDeadline, renderDeadline } from './deadline.ts';
import { renderRate, type SourceRate } from './runs.ts';

export interface ReportOptions {
  title?: string;
  maxPerSource?: number;
  /** 抓取失败/无新内容时是否也要出报告 */
  alwaysRender?: boolean;
}

function stamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 渲染 Markdown 日报：适合直接推送到手机/邮件，也适合提交进仓库当历史记录。 */
export function renderMarkdown(results: SourceResult[], fresh: Notice[], options: ReportOptions = {}): string {
  const { title = '校园通知雷达', maxPerSource = 20 } = options;
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  const lines: string[] = [];
  lines.push(`# ${title} · ${stamp()}`);
  lines.push('');
  lines.push(
    `本次检查 ${results.length} 个源（成功 ${ok.length} / 失败 ${failed.length}${skipped.length ? ` / 跳过 ${skipped.length}` : ''}），**新增 ${fresh.length} 条**。`,
  );
  lines.push('');

  if (fresh.length === 0) {
    lines.push('> 没有新通知。');
    lines.push('');
  }

  const bySource = new Map<string, Notice[]>();
  for (const n of fresh) {
    const list = bySource.get(n.sourceId) ?? [];
    list.push(n);
    bySource.set(n.sourceId, list);
  }

  for (const r of ok) {
    const items = bySource.get(r.sourceId) ?? [];
    if (items.length === 0) continue;
    lines.push(`## ${r.sourceName}（${items.length} 条新）`);
    lines.push('');
    for (const n of items.slice(0, maxPerSource)) {
      const date = n.date ?? '日期未知';
      const tag = n.tag ? `\`${n.tag}\` ` : '';
      // 标题里自带截止日就标出"还剩几天"（issue #4）
      const due = renderDeadline(extractDeadline(n.title));
      const dueText = due ? `**${due}** ` : '';
      const also = n.alsoIn && n.alsoIn.length > 0 ? `　<sub>另见：${n.alsoIn.join('、')}</sub>` : '';
      lines.push(`- **${date}** ${tag}${dueText}[${n.title}](${n.url})${also}`);
    }
    if (items.length > maxPerSource) lines.push(`- …另有 ${items.length - maxPerSource} 条，见状态文件`);
    lines.push('');
  }

  if (failed.length > 0) {
    lines.push('## 抓取失败');
    lines.push('');
    for (const r of failed) lines.push(`- ${r.sourceName}：${r.error ?? '未知错误'}`);
    lines.push('');
  }

  if (skipped.length > 0) {
    lines.push('## 本次跳过');
    lines.push('');
    for (const r of skipped) lines.push(`- ${r.sourceName}：${r.error ?? '已跳过'}`);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('由 [notice-radar](https://github.com/) 自动生成：只抓公开页面，不登录、不存储个人信息。');
  return lines.join('\n');
}

/** doctor 用的体检表：一眼看出哪个源坏了、是站点变了还是选择器过时了。
 *  rates（可选）来自 data/runs.json —— 当下成功但一直不稳的源也能看出来（issue #6）。 */
export function renderDoctor(results: SourceResult[], rates?: Map<string, SourceRate>): string {
  const pad = (s: string, width: number) => {
    const visual = [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
    return s + ' '.repeat(Math.max(0, width - visual));
  };
  const lines: string[] = [];
  lines.push(
    `${pad('源', 26)}${pad('适配器', 14)}${pad('状态', 8)}${pad('体积', 10)}${pad('耗时', 9)}${pad('条目', 6)}${pad('近况', 24)}判定`,
  );
  lines.push('-'.repeat(112));
  for (const r of results) {
    const verdict = r.skipped
      ? '⏭ 跳过（需要浏览器渲染）'
      : !r.ok
        ? `✗ ${r.error}`
        : r.items.length === 0
          ? '⚠ 抓到了但没解析出条目（选择器可能过时）'
          : '✓ 正常';
    lines.push(
      pad(r.sourceName, 26) +
        pad(r.adapter, 14) +
        pad(String(r.status ?? (r.skipped ? '—' : 'ERR')), 8) +
        pad(String(r.bytes), 10) +
        pad(`${r.tookMs}ms`, 9) +
        pad(String(r.items.length), 6) +
        pad(renderRate(rates?.get(r.sourceId)) || '—', 24) +
        verdict,
    );
  }
  const failed = results.filter((r) => !r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const empty = results.filter((r) => r.ok && r.items.length === 0).length;
  lines.push('');
  lines.push(
    `合计 ${results.length} 个源：正常 ${results.length - failed - empty - skipped}，无条目 ${empty}，失败 ${failed}${skipped ? `，跳过 ${skipped}` : ''}`,
  );
  return lines.join('\n');
}

export function renderJson(results: SourceResult[], fresh: Notice[]): string {
  return `${JSON.stringify({ generatedAt: new Date().toISOString(), results, fresh }, null, 2)}\n`;
}

// ------------------------------------------------------------ 抓取成功率

export interface SchoolRate {
  school: string;
  name: string;
  /** 计入成功率的源数（不含"跳过"—— 那是没开 --allow-browser 的预期行为） */
  total: number;
  /** 抓到并且解析出条目 */
  ok: number;
  /** 抓到了但一条也没解析出来：最阴险的失败（选择器过时了，看起来还"成功"） */
  empty: number;
  /** 网络层失败 */
  failed: number;
  skipped: number;
  items: number;
  tookMs: number;
  /** 失败/无条目的明细，一行一条 */
  problems: string[];
}

/**
 * 口径（重要，别把两个数字混着看）：
 *   · 成功率 = ok / total，`total` **不含** skipped（需要浏览器但没开开关 = 预期行为，不该拉低成功率）
 *   · `empty`（抓到了却没条目）算失败：选择器过时就是这么表现的
 */
export function summarizeRate(school: string, name: string, results: SourceResult[]): SchoolRate {
  const considered = results.filter((r) => !r.skipped);
  const ok = considered.filter((r) => r.ok && r.items.length > 0);
  const empty = considered.filter((r) => r.ok && r.items.length === 0);
  const failed = considered.filter((r) => !r.ok);
  return {
    school,
    name,
    total: considered.length,
    ok: ok.length,
    empty: empty.length,
    failed: failed.length,
    skipped: results.length - considered.length,
    items: results.reduce((n, r) => n + r.items.length, 0),
    tookMs: results.reduce((n, r) => n + r.tookMs, 0),
    problems: [
      ...failed.map((r) => `${r.sourceName}：${r.error ?? '抓取失败'}`),
      ...empty.map((r) => `${r.sourceName}：抓到了但没解析出条目（选择器可能过时）`),
    ],
  };
}

const percent = (rate: SchoolRate): string =>
  rate.total === 0 ? '—' : `${Math.round((rate.ok / rate.total) * 100)}%`;

function padVisual(s: string, width: number): string {
  const visual = [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, width - visual));
}

export function renderRateReport(rows: SchoolRate[]): string {
  const lines: string[] = [];
  const total = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total,
      ok: acc.ok + r.ok,
      empty: acc.empty + r.empty,
      failed: acc.failed + r.failed,
      skipped: acc.skipped + r.skipped,
      items: acc.items + r.items,
    }),
    { total: 0, ok: 0, empty: 0, failed: 0, skipped: 0, items: 0 },
  );

  lines.push(
    `${padVisual('学校', 26)}${padVisual('源', 5)}${padVisual('正常', 6)}${padVisual('无条目', 8)}${padVisual('失败', 6)}${padVisual('跳过', 6)}${padVisual('条目', 7)}${padVisual('耗时', 9)}成功率`,
  );
  lines.push('-'.repeat(88));
  for (const r of rows) {
    lines.push(
      padVisual(r.name, 26) +
        padVisual(String(r.total), 5) +
        padVisual(String(r.ok), 6) +
        padVisual(String(r.empty), 8) +
        padVisual(String(r.failed), 6) +
        padVisual(String(r.skipped), 6) +
        padVisual(String(r.items), 7) +
        padVisual(`${(r.tookMs / 1000).toFixed(1)}s`, 9) +
        percent(r),
    );
  }

  lines.push('-'.repeat(88));
  lines.push(
    padVisual(`合计 ${rows.length} 所`, 26) +
      padVisual(String(total.total), 5) +
      padVisual(String(total.ok), 6) +
      padVisual(String(total.empty), 8) +
      padVisual(String(total.failed), 6) +
      padVisual(String(total.skipped), 6) +
      padVisual(String(total.items), 7) +
      padVisual('', 9) +
      (total.total === 0 ? '—' : `${Math.round((total.ok / total.total) * 100)}%`),
  );

  const problems = rows.flatMap((r) => r.problems.map((p) => `${r.name} · ${p}`));
  if (problems.length > 0) {
    lines.push('');
    lines.push('失败 / 无条目明细：');
    for (const p of problems) lines.push(`  ✗ ${p}`);
  }
  return lines.join('\n');
}

export const rateOfRows = (rows: SchoolRate[]): number => {
  const total = rows.reduce((n, r) => n + r.total, 0);
  const ok = rows.reduce((n, r) => n + r.ok, 0);
  return total === 0 ? 0 : ok / total;
};
