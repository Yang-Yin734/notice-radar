/**
 * 云函数部署前的本地自检：用**打包产物**真抓一遍、真跑一次摘要生成，但不发送。
 *
 * 用法：npm run build:serverless && node tools/verify-serverless.mjs
 * 为什么要它：云函数里出问题排查起来很麻烦（看日志要开控制台、冷启动还慢），
 * 在本地先把"能不能跑、能不能解析、摘要对不对"验一遍，能省掉大部分来回。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(repo, 'deploy', 'serverless', 'build');

if (!fs.existsSync(path.join(buildDir, 'dist-serverless', 'cli.js'))) {
  console.error('✗ 还没有打包产物。先跑：npm run build:serverless');
  process.exit(1);
}

process.env.DRY_RUN = '1';
process.env.MODE = process.env.MODE ?? 'digest';
process.env.APP_DIR = buildDir;
// 自检时不需要密钥（DRY_RUN 不发送），但配置一个占位值更贴近真实环境
process.env.SERVERCHAN_KEY = process.env.SERVERCHAN_KEY ?? 'SCT-dry-run-placeholder';

const started = Date.now();
// Windows 上 import() 不认 D:\... 这种绝对路径，必须转成 file:// URL
const { handler } = await import(pathToFileURL(path.join(buildDir, 'handler.mjs')).href);
const result = await handler({});

console.log('');
console.log(`模式：${result.mode}（dryRun=${result.dryRun}，窗口 ${result.windowHours} 小时）`);
console.log(`耗时：${((Date.now() - started) / 1000).toFixed(1)} 秒`);
console.log('');
for (const block of result.log ?? []) console.log(`${block}\n`);

const allLog = (result.log ?? []).join('\n');
// 判断标准刻意做得宽一点：这里要证明的是"打包产物能在这个环境里跑通全流程"，
// 而不是"这次一定抓到了新通知"（同一窗口重跑本来就会是 0 条）。
const crawlOk = /\[抓取\] exit=0/.test(allLog);
const digestRan = /\[推送\] exit=0/.test(allLog) && /共 \d+ 条|没有新通知|预览模式|演练模式/.test(allLog);

if (!result.ok || !crawlOk || !digestRan) {
  console.error(`✗ 自检未通过：${result.error ?? '抓取或摘要生成没有跑通'}（若你确实在国内，先确认云函数地域也选了国内）`);
  console.error('  完整输出见上面各段日志。');
  process.exit(1);
}
if (result.pushedToWechat) {
  console.error('✗ 异常：DRY_RUN 下不该真的推送，请检查 digest 的 --dry 是否失效');
  process.exit(1);
}
console.log('✓ 自检通过：打包产物在"只有 Node、没有源码"的环境里跑通了「抓取 → 生成摘要」，且未发送。');
console.log('  下一步：按 deploy/serverless/README.md 上传 zip、配环境变量与定时触发器。');
