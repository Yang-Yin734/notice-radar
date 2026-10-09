// 一键完成仓库的"装修"：描述、topics、labels、good first issues、Release（可选 Pages / Actions secret）。
//
// 用法（token 只从环境变量读，永不落盘、不需要发给任何人）：
//   $env:GH_TOKEN = 'github_pat_xxx'      # PowerShell
//   node tools/gh-setup.mjs
//   node tools/gh-setup.mjs --pages        # 顺带开启 GitHub Pages（从 /docs 提供）
//   node tools/gh-setup.mjs --secret=NOTICE_RADAR_WEBHOOK=https://...   # 设置 Actions secret（需要 libsodium-wrappers）
//
// 需要的 fine-grained PAT 权限：
//   Contents: Read and write（建 Release）
//   Issues:   Read and write（建 labels 与 issues）
//   Administration: Read and write（改描述/topics、Actions 权限、开 Pages）
//   Actions: Read（可选，读日志用）
// 幂等：重复运行不会重复建 label/issue/Release。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
const [owner, repo] = (valueOf('repo') ?? 'Yang-Yin734/notice-radar').split('/');
const wantPages = has('--pages');
const secretSpec = valueOf('secret'); // 形如 NOTICE_RADAR_WEBHOOK=https://...

if (!token) {
  console.error('缺少 token。先设置环境变量 GH_TOKEN，再运行。\n  PowerShell:  $env:GH_TOKEN = "github_pat_xxx"');
  process.exit(2);
}

const API = 'https://api.github.com';
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'notice-radar-setup',
  'content-type': 'application/json',
};

async function call(method, url, body) {
  const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应 */
  }
  return { ok: res.ok, status: res.status, json, text };
}

const step = (msg) => console.log(`\n▸ ${msg}`);
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.log(`  ! ${msg}`);

// ---------- 1. 描述与 topics ----------
step('设置仓库描述与 topics');
const DESCRIPTION = '把高校官网通知变成可订阅、可关键词过滤、能推到手机的信息流｜配置驱动 · 零服务器 · 不登录 · 任何学校 5 分钟接入';
const TOPICS = ['campus', 'notice', 'university', 'uestc', 'github-actions', 'typescript', 'rss-alternative', 'crawler'];

const patch = await call('PATCH', `/repos/${owner}/${repo}`, { description: DESCRIPTION, has_wiki: false, has_projects: false });
patch.ok ? ok('描述已更新') : warn(`描述更新失败：HTTP ${patch.status} ${patch.text.slice(0, 120)}`);

const topic = await call('PUT', `/repos/${owner}/${repo}/topics`, { names: TOPICS });
topic.ok ? ok(`topics: ${(topic.json?.names ?? TOPICS).join(', ')}`) : warn(`topics 更新失败：HTTP ${topic.status} ${topic.text.slice(0, 120)}`);

// ---------- 2. Actions 默认权限（工作流里已声明，这里只是把默认值也设对） ----------
step('把 Actions 默认工作流权限设为可写（poll 要回提交状态）');
const perm = await call('PUT', `/repos/${owner}/${repo}/actions/permissions/workflow`, { default_workflow_permissions: 'write' });
perm.ok ? ok('已设为 write（工作流内的 permissions: contents: write 本来也够用）') : warn(`设置失败：HTTP ${perm.status}（多为 token 缺 Administration 权限）`);

// ---------- 3. labels ----------
step('创建 labels');
const LABELS = [
  { name: 'good first issue', color: '7057ff', description: '适合第一次贡献：有明确验收标准' },
  { name: 'adapter request', color: '0e8a16', description: '求适配某个学校/栏目' },
  { name: 'bug', color: 'd73a4a', description: '抓取失败或解析出错' },
  { name: 'help wanted', color: '008672', description: '欢迎帮忙' },
  { name: 'documentation', color: '0075ca', description: '文档改进' },
  { name: 'new adapter', color: '1d76db', description: '新增学校适配器' },
];
for (const label of LABELS) {
  const res = await call('POST', `/repos/${owner}/${repo}/labels`, label);
  if (res.ok) ok(`+ ${label.name}`);
  else if (res.status === 422) warn(`${label.name} 已存在，跳过`);
  else warn(`${label.name} 失败：HTTP ${res.status}`);
}

// ---------- 4. good first issues ----------
step('创建 good first issue');
const ISSUES = [
  {
    title: '[adapter] 新闻网·学术栏目（CatId=66）',
    labels: ['good first issue', 'new adapter'],
    body: '现在只配了 `CatId=68`（信息公告），学术栏目 `CatId=66` 只差一段 YAML。\n\n**做法**\n1. 复制 `config/schools/uestc.yaml` 里的 `news-notice` 源，改 `id`/`name`/`url`/`include`\n2. `node src/cli.ts doctor` 确认有条目\n3. fixture 已在 `tools/capture-fixtures.mjs` 里，重抓后补一组断言\n\n**验收**：`radr doctor` 多出一行 ✓ 正常。',
  },
  {
    title: '加一个 `--only=<sourceId>` 参数',
    labels: ['good first issue'],
    body: '调试单个源时不必等其它源的 1.2 秒间隔。\n\n改 `src/cli.ts` 的 `parseFlags` 与 `collect`。\n\n**验收**：`node src/cli.ts run --only=jwc-student --dry` 只抓这一个源。',
  },
  {
    title: '配置校验给出"人话"报错',
    labels: ['good first issue'],
    body: '现在 zod 的报错是 `sources.0.selectors.item: Required`，对第一次接入的人不友好。\n\n期望：\n```\n✗ 第 1 个源（教务处·重要公告）缺少 selectors.item\n  提示：html-list 适配器必须写 item 和 title，见 docs/add-your-school.md\n```\n\n改 `src/core/config.ts` 的 `loadConfig`。**验收**：故意删掉一行 selectors，报错里出现源名字与文档链接。',
  },
  {
    title: '日报里标注"距截止还有几天"',
    labels: ['good first issue'],
    body: '有些通知标题自带截止日（如"9月30日前提交"）。用 `parseDateLoose` 已有的能力抽出来，在日报里标 `⏰ 剩 3 天`。\n\n改 `src/core/report.ts`，加纯函数 + 单元测试。**验收**：`npm test` 通过且日报里出现剩余天数。',
  },
  {
    title: '支持邮件推送通道（SMTP）',
    labels: ['good first issue', 'help wanted'],
    body: '`src/notify/index.ts` 现在有 serverchan / webhook / stdout，缺 SMTP。\n\n用 `nodemailer`，密钥走环境变量 `SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`。\n\n**验收**：配置写 `type: email` 能收到 HTML 日报；补一个不联网的单元测试。',
  },
  {
    title: '记录每个源最近 N 次成功率',
    labels: ['good first issue'],
    body: '`radr doctor` 只看当下。把每次抓取结果追加到 `data/health.json`，doctor 表格里显示"最近 20 次成功 18 次"。\n\n涉及 `src/cli.ts`、`src/core/report.ts`、新增 `src/core/health.ts`。',
  },
  {
    title: '支持抓取第二页（翻页）',
    labels: ['good first issue', 'help wanted'],
    body: '现在只看列表第一页。教务处列表是 `?page=2` 形式。\n\n在 source 配置里加 `pages: 2`，适配器负责翻页去重，**翻页之间也要保持间隔**。\n\n**验收**：`pages: 2` 时条目数明显增加且不重复。',
  },
  {
    title: '接一个你自己的学校（最欢迎）',
    labels: ['good first issue', 'new adapter'],
    body: '参照 `config/sources.example.yaml` 接你学校的源，**必须带 fixture 测试**（见 CONTRIBUTING.md）。\n\n**验收**：`config/schools/<学校>.yaml` + `tests/fixtures/<学校>/*.html` + 一组断言；加分：在 README「已支持」表格里加上你学校。',
  },
];

const existing = await call('GET', `/repos/${owner}/${repo}/issues?state=all&per_page=100`);
const existingTitles = new Set((existing.json ?? []).map((i) => i.title));
for (const issue of ISSUES) {
  if (existingTitles.has(issue.title)) {
    warn(`已存在：${issue.title}`);
    continue;
  }
  const res = await call('POST', `/repos/${owner}/${repo}/issues`, issue);
  res.ok ? ok(`#${res.json.number} ${issue.title}`) : warn(`失败：${issue.title} HTTP ${res.status} ${res.text.slice(0, 100)}`);
}

// ---------- 5. Release ----------
step('创建 Release v0.1.0');
let releaseBody = '第一个可用版本：每天真的能收到学校通知。详见 CHANGELOG.md。';
try {
  const changelog = fs.readFileSync(path.join('CHANGELOG.md'), 'utf8');
  const section = changelog.split(/^## /m).find((s) => s.startsWith('v0.1.0'));
  if (section) releaseBody = `## ${section.trim()}`;
} catch {
  warn('没读到 CHANGELOG.md，用默认说明');
}
const releasePayload = { tag_name: 'v0.1.0', name: 'v0.1.0 —— 第一个可用版本', body: releaseBody, draft: false, prerelease: false };
const rel = await call('POST', `/repos/${owner}/${repo}/releases`, releasePayload);
if (rel.ok) ok(`Release 已创建：${rel.json.html_url}`);
else if (rel.status === 422) {
  const existingRel = await call('GET', `/repos/${owner}/${repo}/releases/tags/v0.1.0`);
  if (existingRel.ok) {
    const upd = await call('PATCH', `/repos/${owner}/${repo}/releases/${existingRel.json.id}`, releasePayload);
    upd.ok ? ok(`Release 已更新：${upd.json.html_url}`) : warn(`Release 更新失败：HTTP ${upd.status}`);
  } else warn('Release 已存在但取不到详情');
} else warn(`Release 失败：HTTP ${rel.status} ${rel.text.slice(0, 120)}`);

// ---------- 6. 可选：Pages ----------
if (wantPages) {
  step('开启 GitHub Pages（从 /docs 目录）');
  const pages = await call('POST', `/repos/${owner}/${repo}/pages`, { source: { branch: 'main', path: '/docs' } });
  if (pages.ok) ok(`Pages 已开启：https://${owner.toLowerCase()}.github.io/${repo}/`);
  else if (pages.status === 409) warn('Pages 已经开启过了');
  else warn(`开启失败：HTTP ${pages.status} ${pages.text.slice(0, 160)}（token 需要 Administration 或 Pages 权限）`);
  console.log('  提示：M2 的仪表盘会替换掉现在这个静态预览页。');
}

// ---------- 7. 可选：Actions secret ----------
if (secretSpec) {
  step('设置 Actions secret');
  const eq = secretSpec.indexOf('=');
  const name = secretSpec.slice(0, eq);
  const value = secretSpec.slice(eq + 1);
  let failed = false;
  try {
    // 用 libsodium 官方实现加密（GitHub 文档推荐的做法）。
    // 曾经想省依赖、拿 tweetnacl 原语自己拼 crypto_box_seal，结果 GitHub 回
    // 422 "improperly encrypted secret" —— 密码学这块不自己写。
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const sodium = require('libsodium-wrappers');
    await sodium.ready;

    const keyRes = await call('GET', `/repos/${owner}/${repo}/actions/secrets/public-key`);
    if (!keyRes.ok) {
      failed = true;
      warn(`取公钥失败：HTTP ${keyRes.status}（token 需要 Secrets 或 Administration 权限）`);
    } else {
      const { key, key_id } = keyRes.json;
      const sealed = sodium.crypto_box_seal(Buffer.from(value, 'utf8'), Buffer.from(key, 'base64'));
      const encrypted_value = Buffer.from(sealed).toString('base64');
      const put = await call('PUT', `/repos/${owner}/${repo}/actions/secrets/${name}`, { encrypted_value, key_id });
      if (!put.ok) {
        failed = true;
        warn(`设置失败：HTTP ${put.status} ${put.text.slice(0, 160)}`);
      } else {
        // 回读确认真的写进去了（列表接口只给名字，不给值）
        const check = await call('GET', `/repos/${owner}/${repo}/actions/secrets?per_page=100`);
        const names = (check.json?.secrets ?? []).map((s) => s.name);
        if (names.includes(name)) ok(`secret ${name} 已设置并回读确认（仓库现有 ${names.length} 个：${names.join(', ')}）`);
        else {
          failed = true;
          warn(`已提交但回读没看到 ${name}，请到 Settings → Secrets and variables → Actions 人工确认`);
        }
      }
    }
  } catch (e) {
    failed = true;
    warn(`加密或调用失败：${e?.message ?? e}`);
    warn('需要 libsodium-wrappers 才能加密 secret。先在仓库里执行 `npm i -D libsodium-wrappers`，或直接在网页上添加：');
    console.log(`     Settings → Secrets and variables → Actions → New repository secret → ${name}`);
  }
  if (failed) process.exitCode = 1;
}

console.log('\n完成。仓库：https://github.com/' + owner + '/' + repo);
if (process.exitCode === 1) console.log('注意：有步骤失败（见上面的 ! 行），退出码为 1。');
