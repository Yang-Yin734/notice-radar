// 测试入口：自己发现 *.test.ts 再显式交给 node --test。
//
// 为什么不直接写 `node --test tests/`：
// 各 Node 版本对「默认匹配哪些测试文件后缀」的行为不一致 —— 本地 Node 26 能匹配到 .ts，
// CI 上的 Node 24 匹配不到，于是 job 直接失败（我们踩过这个坑）。显式传路径则任何版本都稳。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.mjs')) out.push(full);
  }
  return out;
}

const files = walk('tests').sort();
if (files.length === 0) {
  console.error('没有找到任何测试文件（tests/**/*.test.ts）');
  process.exit(1);
}

console.log(`▸ 发现 ${files.length} 个测试文件：${files.join(', ')}\n`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
