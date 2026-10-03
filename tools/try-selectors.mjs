// 判断一个列表页能不能用**通用适配器**（html-list）接：自动试几组常见容器/选择器组合，
// 报告哪组能拿到「完整标题 + 日期」。接入新学校时先跑这个，比手抄选择器快得多。
//
// 用法：node tools/try-selectors.mjs <列表页URL>
//   想从教务处首页一步到位：node tools/probe-school.mjs <首页URL> <学校id>
//
// 特别要看两件事：
//   · 标题有没有被 ... 截断 —— 截断的页面直接接会让"急事关键词/截止日"分级失效
//   · 日期命中了多少条 —— 一条都没有说明日期在详情页（配置里就别写 date）
import { probeListPage, suggestYaml } from './lib/selectors-probe.mjs';

const url = process.argv[2];
if (!url) throw new Error('用法：node tools/try-selectors.mjs <列表页URL>');

const probe = await probeListPage(url);
if (!probe.status) {
  console.log(`✗ ${probe.note}`);
  process.exit(0);
}
console.log(`${probe.status} ${(probe.bytes / 1024).toFixed(0)} KB | ${url}`);

if (!probe.best) {
  console.log(`✗ ${probe.note}`);
  process.exit(0);
}
const best = probe.best;
console.log(`\n最佳组合：item = ${best.item} | title = ${best.title} | date = ${best.date}`);
console.log(`  中文标题 ${best.count} 条 · 被截断 ${best.truncated} 条 · 日期命中 ${best.dateHits} 条`);
for (let i = 0; i < Math.min(5, best.titles.length); i++) {
  console.log(`   · ${best.titles[i].slice(0, 60)}`);
  console.log(`       日期: ${(best.dates[i] ?? '').slice(0, 30)}`);
}
if (probe.note) console.log(`\n⚠ ${probe.note}`);
console.log('\n建议的 config/schools 片段：\n');
console.log(suggestYaml({ id: 'jwc-tzgg', name: '教务处·通知公告', url, best }));
