// 生成「日报长什么样」的预览页：手机通知栏样式 + 各来源分组（发送前先肉眼过一遍）。
// 用法：node tools/digest-preview.mjs [--date=YYYY-MM-DD | --hours=24] [--out=预览.html]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const date = argOf('date');
const hours = argOf('hours');
const outFile = path.resolve(argOf('out') ?? path.join(repo, '..', 'preview', 'digest-preview.html'));
const tmpJson = path.join(repo, 'data', '.digest-preview.json');
const tmpMd = path.join(repo, 'data', '.digest-preview.md');

const cliArgs = ['src/cli.ts', 'digest', `--json=${tmpJson}`, `--out=${tmpMd}`];
if (date) cliArgs.push(`--date=${date}`);
if (hours) cliArgs.push(`--hours=${hours}`);
const run = spawnSync('node', cliArgs, { cwd: repo, stdio: 'inherit' });
if (run.status !== 0) process.exit(run.status ?? 1);

const digest = JSON.parse(fs.readFileSync(tmpJson, 'utf8'));
const markdown = fs.readFileSync(tmpMd, 'utf8');

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const tagChip = (tag) =>
  tag ? `<span class="tag" style="background:${tagColor(tag)}">${esc(tag)}</span> ` : '';

function tagColor(tag) {
  if (/考试|补考|缓考/.test(tag)) return '#e8590c';
  if (/教管|教学/.test(tag)) return '#1c7ed6';
  if (/学生事务/.test(tag)) return '#2f9e44';
  if (/实践/.test(tag)) return '#7048e8';
  if (/学术|讲座/.test(tag)) return '#0b7285';
  return '#6b7280';
}

const groupsHtml = digest.groups
  .map(
    (g) => `
      <div class="group">
        <div class="group-title">${esc(g.sourceName)}<span class="count">${g.total} 条</span></div>
        <ul>
          ${g.items
            .map(
              (n) =>
                `<li><b>${esc(n.date ?? '日期未知')}</b> ${tagChip(n.tag)}<a href="${esc(n.url)}">${esc(n.title)}</a></li>`,
            )
            .join('\n          ')}
          ${g.total > g.items.length ? `<li class="more">…另有 ${g.total - g.items.length} 条</li>` : ''}
        </ul>
      </div>`,
  )
  .join('\n');

const tagsHtml = digest.tagCounts.length
  ? `<div class="tags">标签：${digest.tagCounts
      .slice(0, 6)
      .map((t) => `${esc(t.tag)} ${t.count}`)
      .join(' · ')}</div>`
  : '';

const title = digest.empty
  ? `${digest.shortLabel} 无新通知`
  : `${digest.shortLabel} 新增 ${digest.total} 条`;

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>日报预览</title>
<style>
  :root { --ink:#1f2a3d; --muted:#6b7280; --line:#e9ecf1; --accent:#1c7ed6; }
  * { box-sizing:border-box; }
  body { margin:0; background:#eef1f6; color:var(--ink);
    font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif; }
  .phone { max-width:420px; margin:0 auto; background:#f5f6f8; min-height:100vh; }
  .wxbar { background:#1f2a3d; color:#fff; padding:14px 16px; font-size:15px; font-weight:600; }
  .wxbar span { opacity:.6; font-weight:400; font-size:12px; margin-left:6px; }
  .wrap { padding:12px; }
  .bubble { background:#fff; border-radius:10px; padding:14px; box-shadow:0 1px 3px rgba(16,24,40,.08); }
  .msg-title { font-size:16px; font-weight:700; margin:0 0 6px; }
  .summary { font-size:13px; color:var(--muted); margin:6px 0 2px; }
  .tags { font-size:12px; color:var(--muted); margin:4px 0 10px; }
  .group { margin-top:14px; border-top:1px solid var(--line); padding-top:10px; }
  .group-title { font-size:14px; font-weight:700; margin-bottom:6px; }
  .group-title .count { font-weight:400; font-size:11.5px; color:var(--muted); margin-left:6px; }
  ul { margin:0; padding-left:16px; }
  li { font-size:13.5px; line-height:1.7; margin-bottom:5px; }
  li b { font-weight:600; color:var(--muted); font-size:12.5px; margin-right:4px; }
  a { color:var(--accent); text-decoration:none; }
  .tag { color:#fff; font-size:10.5px; border-radius:4px; padding:1px 5px; margin-right:2px; }
  .more { color:var(--muted); }
  .footer { font-size:11.5px; color:var(--muted); margin-top:12px; border-top:1px solid var(--line); padding-top:8px; }
  .meta { font-size:11.5px; color:var(--muted); margin-top:10px; line-height:1.6; }
</style></head>
<body><div class="phone">
  <div class="wxbar">服务通知 <span>notice-radar 日报</span></div>
  <div class="wrap"><div class="bubble">
    <p class="msg-title">${esc(title)}</p>
    <div class="summary">${esc(digest.label)} · 共 ${digest.total} 条新通知，来自 ${digest.groups.length} 个来源</div>
    ${tagsHtml}
    ${groupsHtml}
    <div class="footer">由 notice-radar 自动汇总：只抓公开页面，不登录、不存储个人信息。</div>
    <div class="meta">窗口：${esc(digest.sinceIso)} → ${esc(digest.untilIso)}<br>
      实际列出 ${digest.shown}/${digest.total} 条 · 这是预览，没有发送任何消息</div>
  </div></div>
</div></body></html>`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html, 'utf8');
fs.rmSync(tmpJson, { force: true });
fs.rmSync(tmpMd, { force: true });

console.log(`✓ 预览页：${outFile}`);
console.log(`  窗口 ${digest.label} · 共 ${digest.total} 条 · 列出 ${digest.shown} 条 · 标题「${title}」`);
console.log(`  纯文本版（webhook/终端）长度：${markdown.length} 字符`);
