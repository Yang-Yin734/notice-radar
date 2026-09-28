import type { History, HistoryItem } from './core/history.ts';
import { countByDay, countBySource } from './core/history.ts';

/**
 * 把历史归档渲染成一个**自包含**的静态页面（内联 CSS + 原生 JS，不依赖任何 CDN）。
 * 为什么自包含：GitHub Pages 上不需要额外资源、离线也能看、也不会有 CORS 问题。
 *
 * 列表是服务端（构建时）预渲染的，JS 只做"显示/隐藏"过滤 —— 所以关掉 JS 也能读。
 */

export interface DashboardOptions {
  title?: string;
  /** 页面里最多渲染多少条（历史里保留更多，页面别太大） */
  maxItems?: number;
  generatedAt?: string;
  repoUrl?: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = (input: string): string => input.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

const tagColor = (tag: string | null): string => {
  if (!tag) return '#495057';
  if (/考试|补考|缓考/.test(tag)) return '#e8590c';
  if (/教管|教学/.test(tag)) return '#1c7ed6';
  if (/学生事务/.test(tag)) return '#2f9e44';
  if (/实践/.test(tag)) return '#7048e8';
  if (/学术|讲座/.test(tag)) return '#0b7285';
  return '#495057';
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export function renderDashboard(history: History, options: DashboardOptions = {}): string {
  const { title = '校园通知雷达', maxItems = 800, generatedAt = new Date().toISOString(), repoUrl = 'https://github.com/Yang-Yin734/notice-radar' } = options;
  const items = history.items.slice(0, maxItems);
  const bySource = countBySource(history);
  const trend = countByDay(history, 14, new Date(generatedAt));
  const maxTrend = Math.max(1, ...trend.map((t) => t.count));
  const maxSource = Math.max(1, ...bySource.map((s) => s.count));

  // 按日期分组（items 已按日期倒序）
  const groups = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const day = item.date ?? '日期未知';
    const list = groups.get(day) ?? [];
    list.push(item);
    groups.set(day, list);
  }

  const trendBars = trend
    .map(
      (t) =>
        `<div class="bar" title="${escapeHtml(t.day)}：${t.count} 条"><span style="height:${Math.round((t.count / maxTrend) * 100)}%"></span><em>${escapeHtml(t.day.slice(8))}</em></div>`,
    )
    .join('');

  const sourceBars = bySource
    .map(
      (s) =>
        `<div class="src"><span class="src-name">${escapeHtml(s.sourceName)}</span><span class="src-bar"><i style="width:${Math.round((s.count / maxSource) * 100)}%"></i></span><b>${s.count}</b></div>`,
    )
    .join('');

  const chips = [
    `<button class="chip active" data-source="all">全部 <b>${history.items.length}</b></button>`,
    ...bySource.map(
      (s) => `<button class="chip" data-source="${escapeHtml(s.sourceId)}">${escapeHtml(s.sourceName)} <b>${s.count}</b></button>`,
    ),
  ].join('');

  const sections = [...groups.entries()]
    .map(([day, list]) => {
      const rows = list
        .map((item) => {
          const tag = item.tag ? `<span class="tag" style="--c:${tagColor(item.tag)}">${escapeHtml(item.tag)}</span>` : '';
          const text = `${item.title} ${item.tag ?? ''} ${item.sourceName}`.toLowerCase();
          return `<li class="item" data-source="${escapeHtml(item.sourceId)}" data-text="${escapeHtml(text)}">
  <div class="meta"><span class="from">${escapeHtml(item.sourceName)}</span><span class="host">${escapeHtml(hostOf(item.url))}</span></div>
  <a class="title" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${tag}${escapeHtml(item.title)}</a>
</li>`;
        })
        .join('\n');
      return `<section class="group"><h2>${escapeHtml(day)}<span class="n">${list.length} 条</span></h2><ul>${rows}</ul></section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · 通知归档</title>
<meta name="description" content="高校官网通知的自动归档与检索：由 notice-radar 定时抓取生成。">
<style>
  :root { --ink:#1f2a3d; --muted:#868e96; --line:#eef0f4; --accent:#1c7ed6; }
  * { box-sizing: border-box; }
  body { margin:0; background:#eef1f6; color:var(--ink);
    font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif; }
  .wrap { max-width:1000px; margin:0 auto; padding:28px 20px 60px; }
  header.hero { background:linear-gradient(135deg,#2b3a55,#1f2a3d); color:#fff; border-radius:16px;
    padding:26px 28px; box-shadow:0 10px 30px rgba(16,24,40,.10); }
  header.hero h1 { margin:0 0 6px; font-size:24px; }
  header.hero p { margin:0; opacity:.78; font-size:13.5px; line-height:1.7; }
  header.hero code { background:rgba(255,255,255,.14); padding:1px 6px; border-radius:4px; }
  .stats { display:flex; flex-wrap:wrap; gap:26px; margin-top:18px; font-size:13px; }
  .stats b { display:block; font-size:20px; margin-top:2px; }
  .card { background:#fff; border-radius:14px; padding:18px 22px; margin-top:16px;
    box-shadow:0 6px 18px rgba(16,24,40,.06); }
  .card h3 { margin:0 0 14px; font-size:14px; color:var(--muted); font-weight:600; letter-spacing:.4px; }
  .trend { display:flex; align-items:flex-end; gap:6px; height:74px; }
  .trend .bar { flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; }
  .trend .bar span { width:100%; background:linear-gradient(180deg,#4dabf7,#1c7ed6); border-radius:4px 4px 0 0; min-height:2px; }
  .trend .bar em { font-style:normal; font-size:10.5px; color:var(--muted); margin-top:4px; }
  .src { display:flex; align-items:center; gap:10px; margin:7px 0; font-size:13px; }
  .src-name { flex:0 0 168px; color:#495057; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .src-bar { flex:1; background:#f1f3f5; border-radius:999px; height:9px; overflow:hidden; }
  .src-bar i { display:block; height:100%; background:linear-gradient(90deg,#74c0fc,#1c7ed6); }
  .src b { flex:0 0 34px; text-align:right; font-variant-numeric:tabular-nums; }
  .controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin:18px 0 6px; }
  #q { flex:1; min-width:190px; padding:9px 12px; border:1px solid #dee2e6; border-radius:9px; font-size:14px; }
  #q:focus { outline:2px solid #a5d8ff; border-color:#74c0fc; }
  .chip { border:1px solid #dee2e6; background:#fff; color:#495057; border-radius:999px;
    padding:6px 12px; font-size:12.5px; cursor:pointer; }
  .chip b { color:var(--muted); font-weight:400; }
  .chip.active { background:var(--ink); border-color:var(--ink); color:#fff; }
  .chip.active b { color:#ced4da; }
  .hint { font-size:12.5px; color:var(--muted); margin:6px 2px 0; }
  section.group h2 { font-size:14px; margin:20px 0 8px; color:#343a40; display:flex; align-items:center; gap:10px; }
  section.group h2 .n { font-size:11.5px; font-weight:400; color:var(--muted); background:#f1f3f5; padding:1px 8px; border-radius:999px; }
  ul { list-style:none; margin:0; padding:0; }
  li.item { background:#fff; border-radius:12px; padding:12px 16px; margin-bottom:8px;
    box-shadow:0 3px 10px rgba(16,24,40,.05); display:flex; flex-direction:column; gap:5px; }
  .meta { font-size:11.5px; color:var(--muted); display:flex; gap:10px; }
  .title { color:#212529; text-decoration:none; font-size:14.5px; line-height:1.55; }
  .title:hover { color:var(--accent); text-decoration:underline; }
  .tag { display:inline-block; font-size:11.5px; padding:1px 7px; margin-right:7px; border-radius:4px;
    color:#fff; background:var(--c); vertical-align:1px; }
  footer { margin-top:26px; font-size:12px; color:var(--muted); line-height:1.8; }
  footer a { color:var(--accent); }
</style>
</head><body><div class="wrap">

<header class="hero">
  <h1>${escapeHtml(title)} · 通知归档</h1>
  <p>把高校官网的通知自动抓下来、按关键词过滤、归档成可检索的列表。数据由 <code>notice-radar</code> 定时抓取，只抓公开页面，不登录、不存储个人信息。</p>
  <div class="stats">
    <div>累计归档<b>${history.items.length}</b></div>
    <div>覆盖源<b>${bySource.length}</b></div>
    <div>本页展示<b>${items.length}</b></div>
    <div>最近更新<b style="font-size:14px;line-height:1.9">${escapeHtml(generatedAt.replace('T', ' ').slice(0, 16))} UTC</b></div>
  </div>
</header>

<div class="card">
  <h3>最近 14 天发现量</h3>
  <div class="trend">${trendBars}</div>
</div>

<div class="card">
  <h3>按来源统计</h3>
  ${sourceBars}
</div>

<div class="controls">
  <input id="q" type="search" placeholder="搜索标题关键词，例如：退课 / 四六级 / 推免">
  ${chips}
</div>
<p class="hint">当前显示 <b id="count">${items.length}</b> 条（共 ${history.items.length} 条在归档里）</p>

${sections || '<p class="hint">还没有归档数据。等第一次抓到新通知后就会出现在这里。</p>'}

<footer>
  由 <a href="${escapeHtml(repoUrl)}">notice-radar</a> 自动生成 ·
  只抓公开页面 · 不登录 · 不存储个人信息 ·
  站点结构变更可能导致漏抓，请以学校官网原文为准
</footer>

</div>
<script>
  const input = document.getElementById('q');
  const chips = Array.from(document.querySelectorAll('.chip'));
  let activeSource = 'all';
  function apply() {
    const text = (input.value || '').trim().toLowerCase();
    let shown = 0;
    for (const li of document.querySelectorAll('li.item')) {
      const okSource = activeSource === 'all' || li.dataset.source === activeSource;
      const okText = !text || (li.dataset.text || '').includes(text);
      const show = okSource && okText;
      li.hidden = !show;
      if (show) shown++;
    }
    document.getElementById('count').textContent = String(shown);
    for (const group of document.querySelectorAll('section.group')) {
      const any = Array.from(group.querySelectorAll('li.item')).some((li) => !li.hidden);
      group.hidden = !any;
    }
  }
  input.addEventListener('input', apply);
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      activeSource = chip.dataset.source;
      for (const c of chips) c.classList.toggle('active', c === chip);
      apply();
    });
  }
</script>
</body></html>
`;
}
