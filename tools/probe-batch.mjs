// 批量筛选候选学校：给一份「学校id 教务处首页]」列表，逐个走 probe-school 的流程，
// 最后打一张汇总表 + 每所可用学校的 config 片段。用来一次筛十几所学校。
//
// 用法：node tools/probe-batch.mjs <列表文件>
//   列表文件每行：`id<空格>首页URL`（# 开头是注释，空行忽略）
//   例：
//     tju   https://oaa.tju.edu.cn/
//     dlut  https://teach.dlut.edu.cn/
//
// 输出建议片段到 .probe-out/<id>.yaml（不进仓库，见 .gitignore），汇总表打在屏幕上。
import fs from 'node:fs';
import path from 'node:path';
import { findListCandidates, probeListPage, suggestYaml } from './lib/selectors-probe.mjs';

const listFile = process.argv[2];
if (!listFile) throw new Error('用法：node tools/probe-batch.mjs <列表文件>');
const maxPerSchool = Number((process.argv.find((a) => a.startsWith('--max=')) ?? '--max=3').slice(6));

const entries = fs
  .readFileSync(listFile, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => {
    const [id, url] = l.split(/\s+/);
    return { id, url };
  });
console.log(`▸ 候选 ${entries.length} 所，每所最多试 ${maxPerSchool} 个列表页\n`);

const outDir = path.resolve('.probe-out');
fs.mkdirSync(outDir, { recursive: true });

const results = [];
for (const { id, url } of entries) {
  const line = (msg) => console.log(`[${id}] ${msg}`);
  let html;
  let status = 0;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (notice-radar probe)', accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    status = res.status;
    const buf = Buffer.from(await res.arrayBuffer());
    html = buf.toString('utf8');
    if (/charset=["']?(gb2312|gbk)/i.test(html.slice(0, 2000))) html = new TextDecoder('gbk').decode(buf);
  } catch (e) {
    line(`✗ 首页抓不到：${e.message}`);
    results.push({ id, url, ok: false, reason: `首页抓不到：${e.message}` });
    continue;
  }
  if (status === 412 || status === 403 || status === 202) {
    line(`✗ 首页 HTTP ${status}（像是反爬/WAF）—— 本项目不绕过，跳过`);
    results.push({ id, url, ok: false, reason: `首页 HTTP ${status}` });
    continue;
  }

  const candidates = findListCandidates(html, url, new URL(url).origin, 6);
  if (!candidates.length) {
    line('✗ 首页里没找到"通知公告列表页"入口');
    results.push({ id, url, ok: false, reason: '没找到列表页入口' });
    continue;
  }

  let best = null;
  for (const c of candidates.slice(0, maxPerSchool)) {
    const probe = await probeListPage(c.url);
    const desc = probe.best
      ? `${probe.best.count} 条 / 日期 ${probe.best.dateHits} / 截断 ${probe.best.truncated}`
      : probe.note || '无结果';
    line(`  ${c.url} → ${desc}`);
    if (probe.best && (!best || probe.best.score > best.score)) best = { ...probe.best, url: c.url };
  }

  if (!best) {
    results.push({ id, url, ok: false, reason: '候选页都试不出可用选择器' });
    continue;
  }
  const usable = best.truncated === 0 && best.dateHits > 0 && best.count >= 5;
  const yaml = suggestYaml({ id: 'jwc-tzgg', name: '教务处·通知公告', url: best.url, best });
  fs.writeFileSync(path.join(outDir, `${id}.yaml`), yaml + '\n', 'utf8');
  line(
    `${usable ? '✓' : '⚠'} ${best.url} | item=${best.item} title=${best.title} date=${best.date} | ` +
      `${best.count} 条，日期 ${best.dateHits}，截断 ${best.truncated}`,
  );
  results.push({ id, url: best.url, ok: usable, reason: best.truncated ? '有标题被截断' : best.dateHits === 0 ? '日期都没解析出来' : '', best });
}

console.log('\n=== 汇总 ===');
for (const r of results) {
  const good = r.ok ? '✓ 可接' : '✗ 跳过';
  const extra = r.best ? `${r.best.count} 条/日期 ${r.best.dateHits}/截断 ${r.best.truncated}` : '';
  console.log(`${good}  ${r.id.padEnd(8)} ${(r.url ?? '').padEnd(48)} ${extra} ${r.reason}`);
}
const okCount = results.filter((r) => r.ok).length;
console.log(`\n可接 ${okCount} 所，跳过 ${results.length - okCount} 所。片段在 .probe-out/`);
