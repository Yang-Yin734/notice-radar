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
  const nodes = $(`${tag}.${cls}`);
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
