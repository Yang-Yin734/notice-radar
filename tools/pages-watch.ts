// 网页版看门狗：GitHub Pages 站点有没有又悄悄消失。
//
// 为什么需要它：这个仓库的网页版靠 GitHub 内置的 branch builder 发布（source = main 的 /docs，
// build_type = legacy），没有自己的发布工作流。这种站点有个安静的死法 —— 被停用后
//   https://yang-yin734.github.io/notice-radar/
// 直接 404，而**本机因为 Service Worker 缓存了外壳照样打得开**，于是只有"别人的电脑"会发现打不开。
// 2026-10-11 就是这么踩到的：Pages 站点被停用（API 里 has_pages=false），本机正常、别的电脑 404。
//
// 判定（纯函数 evaluateHealth，测试直接调它）：站点根必须 200、必须是应用外壳、版本要和
// 仓库 docs/version.json 一致（Pages 重建要几十秒，所以 CLI 默认带重试，避免"刚推完就被判红"）。
//
// 用法：node tools/pages-watch.ts [--url=网址] [--expect=0.11.2] [--retry=6] [--wait=30000]
// 退出码：0 = 正常；1 = 有问题（Workflow 里就靠这个变红）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UA = 'Mozilla/5.0 (notice-radar pages-watch)';

/** 应用外壳一定会带的字样（由 src/dashboard.ts 渲染）。找不到就说明拿到的不是我们的页面。 */
const MARKER = '当前页面 v';

export interface HealthSample {
  status?: number;
  body?: string;
  url?: string;
  /** 期望的版本号；不传就只查"站点在不在"，不查版本 */
  expectVersion?: string | null;
  error?: string;
}

export interface HealthVerdict {
  ok: boolean;
  version: string | null;
  problems: string[];
}

/** 判定一次采样是否健康。 */
export function evaluateHealth(sample: HealthSample): HealthVerdict {
  const problems: string[] = [];
  const body = typeof sample.body === 'string' ? sample.body : '';

  if (sample.error) problems.push(`连不上：${sample.error}`);
  const status = sample.status ?? 0;
  if (!sample.error && status !== 200) problems.push(`HTTP ${status || '(无响应)'}`);

  const m = body.match(new RegExp(`${MARKER}([0-9][0-9A-Za-z.+-]*)`));
  const version = m ? m[1] : null;
  if (!sample.error && status === 200) {
    if (!m) {
      problems.push(`返回 200 但内容不是应用外壳（找不到「${MARKER}」）——可能被挡、被替换或被裸 404 页顶掉`);
    } else if (sample.expectVersion && version !== sample.expectVersion) {
      problems.push(`线上是 v${version}，仓库已是 v${sample.expectVersion} —— 站点在，但 Pages 没跟上最新构建`);
    }
  }

  return { ok: problems.length === 0, version, problems };
}

/** 从仓库里读出我们期望的版本号。 */
export function repoVersion(versionFile = path.join('docs', 'version.json')): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(versionFile, 'utf8')) as { version?: string };
    return parsed.version ?? null;
  } catch {
    return null;
  }
}

/** 默认网址：package.json 的 homepage（改域名时两处一起改，别在脚本里写死）。 */
export function defaultUrl(pkgFile = 'package.json'): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { homepage?: string };
    return parsed.homepage ?? '';
  } catch {
    return '';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sample(url: string): Promise<HealthSample> {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
    return { status: r.status, body: await r.text(), url };
  } catch (e) {
    return { status: 0, body: '', url, error: e instanceof Error ? e.message : String(e) };
  }
}

async function cli(): Promise<number> {
  const arg = (name: string, dflt: string): string => {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : dflt;
  };
  const url = arg('url', '') || defaultUrl();
  const expect = arg('expect', '') || repoVersion();
  const retry = Number(arg('retry', '6'));
  const wait = Number(arg('wait', '30000'));

  if (!url) {
    console.error('✗ 没拿到网址（package.json 里没有 homepage），用 --url= 指定');
    return 1;
  }
  console.log(`检查 ${url}（期望 v${expect ?? '?'}，最多试 ${retry} 次，间隔 ${wait / 1000}s）`);

  let last: HealthVerdict = { ok: false, version: null, problems: ['未执行'] };
  for (let i = 1; i <= retry; i++) {
    last = evaluateHealth(await sample(url));
    console.log(`  第 ${i} 次：${last.ok ? '正常' : `有问题（${last.problems.join('；')}）`}`);
    if (last.ok) break;
    if (i < retry) await sleep(wait);
  }

  if (last.ok) {
    console.log(`✓ 网页版正常：v${last.version}，站点在跑且是最新构建`);
    return 0;
  }
  console.log('');
  console.log('✗ 网页版不可用：');
  for (const p of last.problems) console.log(`  · ${p}`);
  console.log('');
  console.log('常见原因与恢复：');
  console.log('  1) 站点被停用（最常见，表现为整站 404）→ 重新打开：node tools/enable-pages.ts');
  console.log('  2) Pages 没跟上 → 等一两分钟，或到 Actions 里看 pages build and deployment');
  console.log('  3) 只是本机网络问题 → 换个网络再试（github.io 在国内经常打不开）');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await cli());
}
