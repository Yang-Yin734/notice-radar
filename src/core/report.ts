import type { Notice, SourceResult } from '../types.ts';

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

/** 渲染 Markdown 日报：适合直接推送到 Server酱/邮件，也适合提交进仓库当历史记录。 */
export function renderMarkdown(results: SourceResult[], fresh: Notice[], options: ReportOptions = {}): string {
  const { title = '校园通知雷达', maxPerSource = 20 } = options;
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  const lines: string[] = [];
  lines.push(`# ${title} · ${stamp()}`);
  lines.push('');
  lines.push(`本次检查 ${results.length} 个源（成功 ${ok.length} / 失败 ${failed.length}），**新增 ${fresh.length} 条**。`);
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
      const also = n.alsoIn && n.alsoIn.length > 0 ? `　<sub>另见：${n.alsoIn.join('、')}</sub>` : '';
      lines.push(`- **${date}** ${tag}[${n.title}](${n.url})${also}`);
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

  lines.push('---');
  lines.push('');
  lines.push('由 [notice-radar](https://github.com/) 自动生成：只抓公开页面，不登录、不存储个人信息。');
  return lines.join('\n');
}

/** doctor 用的体检表：一眼看出哪个源坏了、是站点变了还是选择器过时了。 */
export function renderDoctor(results: SourceResult[]): string {
  const pad = (s: string, width: number) => {
    const visual = [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
    return s + ' '.repeat(Math.max(0, width - visual));
  };
  const lines: string[] = [];
  lines.push(`${pad('源', 26)}${pad('适配器', 14)}${pad('状态', 8)}${pad('体积', 10)}${pad('耗时', 9)}${pad('条目', 6)}判定`);
  lines.push('-'.repeat(88));
  for (const r of results) {
    const verdict = !r.ok ? `✗ ${r.error}` : r.items.length === 0 ? '⚠ 抓到了但没解析出条目（选择器可能过时）' : '✓ 正常';
    lines.push(
      pad(r.sourceName, 26) +
        pad(r.adapter, 14) +
        pad(String(r.status ?? 'ERR'), 8) +
        pad(String(r.bytes), 10) +
        pad(`${r.tookMs}ms`, 9) +
        pad(String(r.items.length), 6) +
        verdict,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  const empty = results.filter((r) => r.ok && r.items.length === 0).length;
  lines.push('');
  lines.push(`合计 ${results.length} 个源：正常 ${results.length - failed - empty}，无条目 ${empty}，失败 ${failed}`);
  return lines.join('\n');
}

export function renderJson(results: SourceResult[], fresh: Notice[]): string {
  return `${JSON.stringify({ generatedAt: new Date().toISOString(), results, fresh }, null, 2)}\n`;
}
