// 给构建产物补上 shebang。
// 为什么需要：Node 不允许对 node_modules 里的文件做类型剥离，所以 npm 包必须发编译后的 JS；
// 而 tsc 生成的 dist/cli.js 不带 shebang，bin 直接执行会失败。
import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('dist/cli.js');
if (!fs.existsSync(file)) {
  console.error(`找不到 ${file}，先跑 tsc -p tsconfig.build.json`);
  process.exit(1);
}
const text = fs.readFileSync(file, 'utf8');
const withShebang = text.startsWith('#!') ? text : `#!/usr/bin/env node\n${text}`;
if (withShebang !== text) {
  fs.writeFileSync(file, withShebang, 'utf8');
  console.log(`✓ 已补 shebang：${path.relative(process.cwd(), file)}`);
} else {
  console.log(`✓ shebang 已存在：${path.relative(process.cwd(), file)}`);
}

// 顺带自检：产物里不该残留 .ts 后缀的 import（否则装到 node_modules 里会解析失败）
const jsFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
};
walk(path.resolve('dist'));
const bad = jsFiles.filter((f) => /from\s+['"][^'"]+\.ts['"]/.test(fs.readFileSync(f, 'utf8')));
if (bad.length) {
  console.error(`这些产物仍 import 了 .ts（会被 Node 拒绝）：${bad.map((f) => path.relative(process.cwd(), f)).join(', ')}`);
  process.exit(1);
}
console.log(`✓ ${jsFiles.length} 个产物文件里的相对 import 都已是 .js`);
