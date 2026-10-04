// 自动探测把导航项也算进选择器时，用这个看清真实结构：抓一个页面存下来，
// 打印容器类名直方图与"含中文标题最多的那个容器"的第一条 HTML。
//
// 用法：node tools/dump-page.mjs <URL> [输出名]
//   输出落到 .probe-pages/（已在 .gitignore 里？没有就自己删，别提交）
import fs from 'node:fs';
import path from 'node:path';
import { load } from 'cheerio';

const url = process.argv[2];
const label = (process.argv[3] ?? new URL(url).host + new URL(url).pathname).replace(/[^a-z0-9.-]/gi, '_');
if (!url) throw new Error('用法：node tools/dump-page.mjs <URL> [输出名]');

const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (notice-radar probe)' }, redirect: 'follow' });
const buf = Buffer.from(await r.arrayBuffer());
let html = buf.toString('utf8');
const gbk = /charset=["']?(gb2312|gbk)/i.test(html.slice(0, 2000));
if (gbk) html = new TextDecoder('gbk').decode(buf);

const outDir = path.resolve('.probe-pages');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${label}.html`), html, 'utf8');
console.log(`${r.status} ${(buf.length / 1024).toFixed(0)} KB${gbk ? '（GBK）' : ''} → .probe-pages/${label}.html`);

const $ = load(html);
const hist = new Map();
$('[class]').each((_, el) => {
  const tag = el.tagName ?? 'x';
  for (const c of String($(el).attr('class')).split(/\s+/).filter(Boolean)) {
    const key = `${tag.toLowerCase()}.${c}`;
    hist.set(key, (hist.get(key) ?? 0) + 1);
  }
});
console.log(
  '容器类名（前 16）：',
  [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => `${k}×${v}`).join(' · '),
);

const sel = '[class]';
let bestKey = '';
let bestCount = 0;
for (const [key] of hist) {
  if (!/li|tr|item|list|news|title|con/i.test(key)) continue;
  const [tag, cls] = key.split('.');
  // 有的站点把模板占位符写进了 class（实测南京农业大学有 class="{级别样式}"），
  // 直接当选择器用会让 cheerio 抛 "Unmatched selector" —— 跳过这类怪名字。
  if (!/^[A-Za-z][\w-]*$/.test(cls)) continue;
  let nodes;
  try {
    nodes = $(`${tag}.${cls}`);
  } catch {
    continue;
  }
  const n = nodes.toArray().filter((el) => /[\u4e00-\u9fa5]{6,}/.test($(el).text())).length;
  if (n > bestCount) {
    bestCount = n;
    bestKey = `${tag}.${cls}`;
  }
}
console.log(`\n含中文标题最多的容器：${bestKey}（${bestCount} 个节点）`);
if (bestKey) {
  console.log('第一条 HTML：\n' + ($(bestKey).first().html()?.replace(/\s+/g, ' ').slice(0, 600) ?? '(空)'));
}

// 顺带把所有"像通知栏目的链接"列出来：自动探测找不到入口时（首页是 JS 导航、栏目名特殊），
// 这是最快的手动定位方式。
const links = [];
$('a').each((_, el) => {
  const text = $(el).text().replace(/\s+/g, ' ').trim();
  const href = ($(el).attr('href') ?? '').trim();
  if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
  if (!/通知|公告|公示|更多|more/i.test(`${text} ${href}`)) return;
  let abs = href;
  try {
    abs = new URL(href, url).href;
  } catch {
    /* 保留原样 */
  }
  if (links.some((l) => l.abs === abs)) return;
  links.push({ text: text.slice(0, 22), abs });
});
console.log(`\n像"通知公告"的链接 ${links.length} 个：`);
for (const l of links.slice(0, 25)) console.log(`   ${l.text.padEnd(22)} ${l.abs}`);
