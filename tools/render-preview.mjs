// 把真实抓取结果渲染成一张日报预览图（README 首屏用）。
//
// 用法：
//   node src/cli.ts run --dry --json=docs/sample-digest.json   # 先产出真实数据
//   node tools/render-preview.mjs                              # 生成 docs/preview.html
//   msedge --headless=new --screenshot=docs/preview.png --window-size=900,1500 docs/preview.html
//
// 为什么这么做：README 需要一张"长什么样"的图，但手机推送截图只能真机拍。
// 这张图是**真实数据渲染**的，不含任何伪造的对话或数字。
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2] ?? path.join('docs', 'sample-digest.json');
const output = process.argv[3] ?? path.join('docs', 'preview.html');

if (!fs.existsSync(input)) {
  console.error(`找不到 ${input}。先运行：node src/cli.ts run --dry --json=${input}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(input, 'utf8'));
const fresh = data.fresh ?? [];
const results = data.results ?? [];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const pad = (n) => String(n).padStart(2, '0');
const when = new Date(data.generatedAt ?? Date.now());
const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())}`;

const tagColor = (tag) => {
  if (!tag) return null;
  if (/考试|补考|缓考/.test(tag)) return '#e8590c';
  if (/教管|教学/.test(tag)) return '#1c7ed6';
  if (/学生事务/.test(tag)) return '#2f9e44';
  if (/实践/.test(tag)) return '#7048e8';
  return '#495057';
};

const bySource = new Map();
for (const n of fresh) {
  const list = bySource.get(n.sourceName) ?? [];
  list.push(n);
  bySource.set(n.sourceName, list);
}

const sections = [...bySource.entries()]
  .map(([name, items]) => {
    const rows = items
      .map((n) => {
        const tag = n.tag
          ? `<span class="tag" style="--c:${tagColor(n.tag)}">${esc(n.tag)}</span>`
          : '';
        const also = n.alsoIn?.length ? `<div class="also">另见：${esc(n.alsoIn.join('、'))}</div>` : '';
        return `<li>
          <div class="date">${esc(n.date ?? '日期未知')}</div>
          <div class="body">
            <div class="title">${tag}${esc(n.title)}</div>
            <div class="url">${esc(new URL(n.url).host)}</div>
            ${also}
          </div>
        </li>`;
      })
      .join('\n');
    return `<section><h2>${esc(name)}<span class="count">${items.length} 条新</span></h2><ul>${rows}</ul></section>`;
  })
  .join('\n');

const okCount = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>notice-radar 日报预览</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; background: #eef1f6; font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif; }
  .phone { max-width: 820px; margin: 0 auto; }
  .card { background: #fff; border-radius: 18px; box-shadow: 0 10px 30px rgba(16,24,40,.10); overflow: hidden; }
  .head { padding: 20px 28px; background: linear-gradient(135deg,#2b3a55,#1f2a3d); color: #fff; }
  .head .app { font-size: 15px; letter-spacing: .5px; opacity: .85; }
  .head h1 { margin: 8px 0 4px; font-size: 22px; }
  .head .meta { font-size: 13px; opacity: .72; }
  .stats { display: flex; gap: 22px; padding: 14px 28px; border-bottom: 1px solid #eef0f4; font-size: 13px; color: #495057; background: #fbfcfe; }
  .stats b { color: #1c3faa; }
  section { padding: 18px 28px 6px; }
  h2 { font-size: 15px; margin: 0 0 10px; color: #1f2a3d; display: flex; align-items: center; gap: 10px; }
  h2 .count { font-size: 12px; font-weight: 400; color: #868e96; background: #f1f3f5; padding: 2px 8px; border-radius: 999px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; gap: 14px; padding: 10px 0; border-top: 1px dashed #edeff3; }
  li:first-child { border-top: none; }
  .date { flex: 0 0 88px; font-size: 12.5px; color: #868e96; padding-top: 2px; font-variant-numeric: tabular-nums; }
  .title { font-size: 14.5px; color: #212529; line-height: 1.5; }
  .url { font-size: 12px; color: #adb5bd; margin-top: 3px; }
  .also { font-size: 12px; color: #868e96; margin-top: 3px; }
  .tag { display: inline-block; font-size: 11.5px; padding: 1px 7px; margin-right: 7px; border-radius: 4px; color: #fff; background: var(--c); vertical-align: 1px; }
  .foot { padding: 14px 28px 22px; font-size: 12px; color: #868e96; border-top: 1px solid #eef0f4; }
</style></head>
<body><div class="phone"><div class="card">
  <div class="head">
    <div class="app">校园通知雷达 · notice-radar</div>
    <h1>新增 ${fresh.length} 条通知</h1>
    <div class="meta">${stamp}　|　电子科技大学</div>
  </div>
  <div class="stats">
    <div>检查源 <b>${results.length}</b></div>
    <div>成功 <b>${okCount}</b></div>
    <div>失败 <b>${failed.length}</b></div>
    <div>命中关键词 <b>${fresh.length}</b></div>
  </div>
  ${sections || '<section><p style="color:#868e96;font-size:14px">本次没有新通知。</p></section>'}
  <div class="foot">只抓公开页面 · 不登录 · 不存储个人信息　|　数据来源：各校官网列表页</div>
</div></div></body></html>
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, html, 'utf8');
console.log(`✓ 已生成 ${output}（${fresh.length} 条通知，来自 ${bySource.size} 个源）`);
