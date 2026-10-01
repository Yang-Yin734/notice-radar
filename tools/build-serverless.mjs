/**
 * 打包成"可以直接上传到国内云函数"的产物。
 *
 * 用法：npm run build:serverless
 * 产物：
 *   dist-serverless/             tsc 编译出的 JS（tsconfig 已开启 rewriteRelativeImportExtensions，扩展名会被改写成 .js）
 *   deploy/serverless/build/     上传目录：handler + dist-serverless + config + 生产依赖
 *   deploy/serverless/notice-radar-serverless.zip   直接上传这个压缩包
 *
 * 为什么能直接跑：本项目源码用的是 .ts 后缀的相对导入，而 tsconfig 里开了
 * rewriteRelativeImportExtensions，tsc 会在产物里把 .ts 改写成 .js，
 * 所以在只有 Node 18/20（不支持原生跑 TypeScript）的云函数运行时上也能直接执行。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repo, 'dist-serverless');
const deployDir = path.join(repo, 'deploy', 'serverless');
const pkgDir = path.join(deployDir, 'build');
const zipPath = path.join(deployDir, 'notice-radar-serverless.zip');

const log = (msg) => console.log(`▸ ${msg}`);
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
/** Windows 上 npx/npm 是 .cmd，必须走 shell；其他平台不用，免得触发 DEP0190 告警 */
const isWin = process.platform === 'win32';
const bin = (name) => (isWin ? `${name}.cmd` : name);

log('清理旧产物');
rmrf(outDir);
rmrf(pkgDir);
rmrf(zipPath);

log('编译 TypeScript（tsc，扩展名自动改写为 .js）');
execFileSync(bin('npx'), ['tsc', '-p', 'tsconfig.serverless.json'], {
  cwd: repo,
  stdio: 'inherit',
  shell: isWin,
});
if (!fs.existsSync(path.join(outDir, 'cli.js'))) throw new Error('编译失败：没有生成 dist-serverless/cli.js');

log('组装上传目录');
fs.mkdirSync(pkgDir, { recursive: true });
fs.cpSync(outDir, path.join(pkgDir, 'dist-serverless'), { recursive: true });
fs.cpSync(path.join(repo, 'config'), path.join(pkgDir, 'config'), { recursive: true });
for (const f of ['handler.mjs', 'handler.cjs']) {
  fs.copyFileSync(path.join(deployDir, f), path.join(pkgDir, f));
}

// 云函数里只要有生产依赖即可；写一个最小的 package.json，避免把 devDependencies 也装进去
const repoPkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
fs.writeFileSync(
  path.join(pkgDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'notice-radar-serverless',
      private: true,
      type: 'module',
      // Node 18/20 上没有原生 TypeScript，产物已经是 JS，所以这里不需要任何脚本
      dependencies: repoPkg.dependencies ?? {},
    },
    null,
    2,
  )}\n`,
);

log('安装生产依赖（cheerio / yaml / zod）');
execFileSync(bin('npm'), ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], {
  cwd: pkgDir,
  stdio: 'inherit',
  shell: isWin,
});

log('压缩为 zip');
if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${pkgDir}\\*' -DestinationPath '${zipPath}' -Force`,
    ],
    { stdio: 'inherit' },
  );
} else {
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: pkgDir, stdio: 'inherit' });
}

const size = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log('');
console.log(`✓ 上传目录：${pkgDir}`);
console.log(`✓ 压缩包：${zipPath}（${size} MB）`);
console.log('');
console.log('接下来（详细步骤见 deploy/serverless/README.md）：');
console.log('  1. 阿里云函数计算 FC 或腾讯云云函数 SCF 里新建函数，运行时选 Node.js 18/20');
console.log('  2. 上传上面那个 zip');
console.log('  3. 环境变量填 SERVERCHAN_KEY=你的SendKey，先加 DRY_RUN=1 验证');
console.log('  4. 定时触发器：MODE=window + 每 10 分钟（近实时），或 MODE=digest + 每天一次（完整日报）');
