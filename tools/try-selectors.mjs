// 判断一个列表页能不能用**通用适配器**（html-list）接：自动试几组常见容器/选择器组合，
// 报告哪组能拿到「完整标题 + 日期」。接入新学校时先跑这个，比手抄选择器快得多。
//
// 用法：node tools/try-selectors.mjs <列表页URL>
//
// 特别要看两件事：
//   · 标题有没有被 ... 截断 —— 截断的页面直接接会让"急事关键词/截止日"分级失效
//   · 日期命中了多少条 —— 一条都没有说明日期在详情页（配置里就别写 date）
import { load } from 'cheerio';

const url = process.argv[2];
if (!url) throw new Error('用法：node tools/try-selectors.mjs <列表页URL>');

const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (notice-radar probe)' }, redirect: 'follow' });
const buf = Buffer.from(await r.arrayBuffer());
let html = buf.toString('utf8');
if (/charset=["']?(gb2312|gbk)/i.test(html.slice(0, 2000))) {
  html = new TextDecoder('gbk').decode(buf);
  console.log('（按 GBK 解码）');
}
console.log(`${r.status} ${(buf.length / 1024).toFixed(0)} KB | ${url}`);

const $ = load(html);

const containers = [
  'ul.news-list li', '.news-list li', '.list li', '.tz-list li', '.list-item', '.news_item',
  'ul li', '.article-list li', 'table tr', '.wp_article_list li', '.list_main li', '.item', 'div.item',
  '.news li', '.notice-list li', '.main-list li',
];
const titleSels = ['a@title', 'a', 'p', 'h3 a@title', 'h3', 'span.title', '.title a@title', 'td a@title', 'td a', '.text p'];
const dateSels = ['span.date', '.date', 'td:last-child', '.time', 'span', 'em', '.date span'];

function textOf($el, sel) {
  if (sel.endsWith('@title')) return ($el.find(sel.slice(0, -6)).attr('title') ?? '').trim();
  return $el.find(sel).first().text().replace(/\s+/g, ' ').trim();
}

let best = null;
for (const c of containers) {
  const nodes = $(c);
  if (nodes.length < 3) continue;
  for (const t of titleSels) {
    const titles = nodes.toArray().map((el) => textOf($(el), t));
    const good = titles.filter((x) => /[\u4e00-\u9fa5]{6,}/.test(x));
    if (good.length < 3) continue;
    const truncated = good.filter((x) => /(\.\.\.|…)/.test(x)).length;
    for (const d of dateSels) {
      const dates = nodes.toArray().map((el) => textOf($(el), d));
      const dateHits = dates.filter((x) => /\d{1,4}[-/.月]\d{1,2}/.test(x)).length;
      const score = good.length * 2 + dateHits - truncated * 6;
      if (!best || score > best.score) {
        best = { selector: c, t, d, count: good.length, truncated, dateHits, titles: good, dates, score };
      }
    }
  }
}

if (!best) {
  console.log('✗ 没找到可用的容器/选择器组合（可能整页是 JS 渲染，或结构太特殊）');
  process.exit(0);
}
console.log(`\n最佳组合：item = ${best.selector} | title = ${best.t} | date = ${best.d}`);
console.log(`  中文标题 ${best.count} 条 · 被截断 ${best.truncated} 条 · 日期命中 ${best.dateHits} 条`);
for (let i = 0; i < Math.min(5, best.titles.length); i++) {
  console.log(`   · ${best.titles[i].slice(0, 60)}`);
  console.log(`       日期: ${(best.dates[i] ?? '').slice(0, 30)}`);
}
if (best.truncated > 0) {
  console.log('\n⚠ 有标题带 ... —— 这种页面直接接会让关键词分级失效（标题不完整）');
}
