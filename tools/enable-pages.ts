// 一键把网页版（GitHub Pages）重新打开。
//
// 背景：本仓库的网页版由 GitHub 内置 branch builder 发布（source = main 的 /docs，
// build_type = legacy），没有自己的发布工作流。站一旦被停用，`https://<用户>.github.io/<仓>/`
// 直接 404，而**本机因为 Service Worker 缓存了外壳照样打得开** —— 2026-10-11 就是这么踩到的。
// 官方 API 一句话能修，但很少有人记得住，所以包成脚本。
//
// 用法：node tools/enable-pages.ts [--branch=main] [--path=/docs] [--who=Yang-Yin734/notice-radar]
//                                [--token=...] [--dry-run]
// token 取用顺序：--token → 环境变量 GITHUB_TOKEN / GH_TOKEN → `git credential fill`（本机凭据）。
// 需要 classic `repo` 权限（或 fine-grained 的 Pages: read and write + Administration: read）。
import { execFileSync } from 'node:child_process';

const API = 'https://api.github.com';

interface ApiReply {
  status: number;
  json: any;
  text: string;
}

function arg(name: string, dflt = ''): string {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
}
const hasFlag = (name: string) => process.argv.slice(2).includes(`--${name}`);

/** 从 git remote 里认出 owner/repo，省得手填。 */
function repoFromGit(): string {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    return m ? `${m[1]}/${m[2]}` : '';
  } catch {
    return '';
  }
}

/** 本机凭据（git credential fill）里拿 token。 */
function tokenFromGit(): string {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      encoding: 'utf8',
      input: 'protocol=https\nhost=github.com\n\n',
    });
    return out.match(/^password=(.+)$/m)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(token: string, method: string, route: string, body?: unknown): Promise<ApiReply> {
  const r = await fetch(`${API}${route}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'notice-radar-enable-pages',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 就当纯文本看 */
  }
  return { status: r.status, json, text };
}

async function main(): Promise<number> {
  const who = arg('who', '') || repoFromGit();
  const branch = arg('branch', 'main');
  const dir = arg('path', '/docs');
  const token = arg('token', '') || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || tokenFromGit();
  const dry = hasFlag('dry-run');

  if (!who) {
    console.error('✗ 认不出仓库，用 --who=owner/repo 指定');
    return 1;
  }
  if (!token) {
    console.error('✗ 没拿到 token：用 --token=、或设 GITHUB_TOKEN、或先 git 登录一次（git credential fill）');
    return 1;
  }

  if (dry) {
    console.log('将要执行（等价 curl）：');
    console.log(
      `curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \\\n` +
        `  ${API}/repos/${who}/pages -d '{"source":{"branch":"${branch}","path":"${dir}"}}'`,
    );
    return 0;
  }

  console.log(`目标仓库：${who}（token 长度 ${token.length}）`);
  const before = await api(token, 'GET', `/repos/${who}/pages`);
  console.log(
    before.status === 200
      ? `当前状态：已启用（${before.json?.status}，source ${before.json?.source?.branch}${before.json?.source?.path}）`
      : `当前状态：未启用 / 查不到（HTTP ${before.status}）→ 这正是"网页版打不开"的典型原因`,
  );

  const [owner, repo] = who.split('/');
  const site = `https://${owner.toLowerCase()}.github.io/${repo}/`;
  const created = await api(token, 'POST', `/repos/${who}/pages`, { source: { branch, path: dir } });
  if (created.status === 201 || created.status === 200) {
    console.log(
      `✓ 已重新打开 Pages：build_type=${created.json?.build_type}、source=${branch} ${dir}、${created.json?.html_url ?? site}`,
    );
  } else if (created.status === 409) {
    console.log('· 站点本来就存在（HTTP 409），改为更新发布源');
    const updated = await api(token, 'PUT', `/repos/${who}/pages`, { source: { branch, path: dir } });
    console.log(
      updated.status < 300 ? '✓ 发布源已更新' : `✗ 更新失败：HTTP ${updated.status} ${updated.text.slice(0, 200)}`,
    );
  } else {
    console.error(`✗ 打开失败：HTTP ${created.status} ${created.text.slice(0, 300)}`);
    console.error('  403 通常是 token 权限不够（需要 classic repo，或 fine-grained：Pages 读写 + Administration 读）');
    return 1;
  }

  // 等这次构建跑完（首次发布要几十秒）。
  let last: any = null;
  for (let i = 0; i < 30; i++) {
    const b = await api(token, 'GET', `/repos/${who}/pages/builds/latest`);
    last = b.json;
    console.log(`  构建：${last?.status ?? `HTTP ${b.status}`}${last?.duration ? `（${(last.duration / 1000).toFixed(1)}s）` : ''}`);
    if (last?.status === 'built' || last?.status === 'errored') break;
    await sleep(10000);
  }
  if (last?.status === 'errored') {
    console.error(`✗ 构建失败：${last.error?.message ?? '（无详情）'}`);
    return 1;
  }

  // 最后自己访问一次，别只看 API 说"成功"。
  try {
    const r = await fetch(site, { headers: { 'user-agent': 'notice-radar-enable-pages' }, redirect: 'follow' });
    const body = await r.text();
    const m = body.match(/当前页面 v([0-9][0-9A-Za-z.+-]*)/);
    console.log(`${r.status === 200 && m ? '✓' : '✗'} 访问 ${site} → HTTP ${r.status}，${m ? `页面 v${m[1]}` : '但没看到应用外壳字样'}`);
    if (r.status !== 200 || !m) {
      console.log('  刚发布时可能还在生效，等一两分钟再试；仍不行就跑 node tools/pages-watch.ts 看具体哪一项不对');
      return 1;
    }
  } catch (e) {
    console.log(`· 本站访问验证跳过（${e instanceof Error ? e.message : e}）—— 国内网络访问 github.io 本来就可能不通，以 API 结果为准`);
  }

  console.log('✓ 网页版已恢复。别人的电脑现在可以打开了（自己电脑如果还看到旧页面，硬刷新一次）');
  return 0;
}

process.exit(await main());
