// 接入助手：给一所学校的**教务处/研究生院首页**，自动找通知列表页并试出可用的选择器，
// 最后直接打印可以粘进 config/schools/*.yaml 的片段。
//
// 用法：node tools/probe-school.mjs <首页URL> [学校id] [--max=4]
//   例：node tools/probe-school.mjs https://jwc.cqu.edu.cn/ cqu
//
// 它只做几件事：抓 1 个首页 + 最多 4 个候选列表页（跟人手动点几次一样），不爬站、不高频。
import { findListCandidates, probeListPage, suggestYaml } from './lib/selectors-probe.mjs';

const url = process.argv[2];
if (!url) throw new Error('用法：node tools/probe-school.mjs <首页URL> [学校id] [--max=4]');
const schoolId = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'school';
const maxArg = process.argv.find((a) => a.startsWith('--max='));
const max = Number(maxArg ? maxArg.slice(6) : 4);
const origin = new URL(url).origin;

const res = await fetch(url, {
  headers: { 'user-agent': 'Mozilla/5.0 (notice-radar probe)', accept: 'text/html' },
  redirect: 'follow',
  signal: AbortSignal.timeout(15000),
});
const buf = Buffer.from(await res.arrayBuffer());
let html = buf.toString('utf8');
if (/charset=["']?(gb2312|gbk)/i.test(html.slice(0, 2000))) html = new TextDecoder('gbk').decode(buf);
const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? '';
console.log(`首页 ${res.status} ${(buf.length / 1024).toFixed(0)} KB | ${title} | ${url}`);

const candidates = findListCandidates(html, url, origin);
if (!candidates.length) {
  console.log('✗ 首页里没找到像"通知公告列表页"的入口 —— 手动看一眼，或直接给列表页 URL 跑 try-selectors');
  process.exit(0);
}
console.log(`候选入口 ${candidates.length} 个：`);
for (const c of candidates) console.log(`   ${c.text.padEnd(12)} ${c.url}`);

let best = null;
for (const c of candidates.slice(0, max)) {
  const probe = await probeListPage(c.url);
  const tag = probe.best ? `${probe.best.count} 条 / 日期 ${probe.best.dateHits} 条` : (probe.note || '没结果');
  console.log(`\n▸ 试 ${c.url}\n  ${probe.status} ${(probe.bytes / 1024).toFixed(0)} KB → ${tag}`);
  if (probe.note) console.log(`  ⚠ ${probe.note}`);
  if (probe.best) {
    for (const t of probe.best.titles.slice(0, 3)) console.log(`   · ${t.slice(0, 58)}`);
    // 打分：条目多、日期齐、不截断
    const score = probe.best.score;
    if (!best || score > best.score) best = { ...probe.best, url: c.url, score };
  }
}

if (!best) {
  console.log('\n✗ 这些候选都没试出可用的选择器 —— 这所学校先不接（或需要专属适配器）');
  process.exit(0);
}

console.log(`\n=== 最佳：${best.url} ===`);
console.log(`item=${best.item} | title=${best.title} | date=${best.date} | ${best.count} 条`);
if (best.truncated) console.log('⚠ 有标题被截断，接之前要确认（截断标题会让关键词分级失效）');
console.log('\n建议的 config/schools 片段：\n');
console.log(suggestYaml({ id: 'jwc-tzgg', name: '教务处·通知公告', url: best.url, best }));
