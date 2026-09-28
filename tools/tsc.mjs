// 用 Node 显式调用 tsc，不依赖 node_modules/.bin 是否在 PATH 上。
//
// 为什么需要：npm 从 git 安装依赖时会在临时克隆里跑 prepare → npm run build，
// 那种环境下 `tsc` 常常不在 PATH（"tsc is not recognized"），构建就失败。
// 这里用 require.resolve 拿到 typescript 真正的入口，再用当前 node 执行。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let tsc;
try {
  tsc = require.resolve('typescript/bin/tsc');
} catch {
  console.error('找不到 typescript。若是从 git 安装，请确认 devDependencies 已装上（npm install --include=dev）');
  process.exit(1);
}

const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' });
if (result.error) {
  console.error(`调用 tsc 失败：${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
