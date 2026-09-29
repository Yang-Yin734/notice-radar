// 把构建好的数据放进 Android 工程的 assets/data，供纯原生应用读取。
//
// 为什么只需要数据：原生版界面是 Kotlin + Compose 写的，不再需要 HTML/CSS/JS。
// 打开应用不联网：先读这份内置数据，联网时再按镜像刷新。
//
// 用法：node tools/prepare-android-assets.mjs [--docs=docs] [--assets=android/app/src/main/assets/data]
import fs from 'node:fs';
import path from 'node:path';

const valueOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const docsDir = path.resolve(valueOf('docs', 'docs'));
const assetsDir = path.resolve(valueOf('assets', 'android/app/src/main/assets/data'));

const INCLUDE = ['dashboard-data.json', 'version.json'];

if (!fs.existsSync(docsDir)) {
  console.error(`找不到 ${docsDir}，先跑 npm run dashboard`);
  process.exit(1);
}

fs.rmSync(assetsDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });

let bytes = 0;
for (const name of INCLUDE) {
  const src = path.join(docsDir, name);
  if (!fs.existsSync(src)) {
    console.error(`缺少 ${name}（先跑 npm run dashboard）`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(assetsDir, name));
  const size = fs.statSync(src).size;
  bytes += size;
  console.log(`  ${name.padEnd(22)} ${(size / 1024).toFixed(0)} KB`);
}

// 自检：数据必须能用，否则装出来是空列表
const data = JSON.parse(fs.readFileSync(path.join(assetsDir, 'dashboard-data.json'), 'utf8'));
const version = JSON.parse(fs.readFileSync(path.join(assetsDir, 'version.json'), 'utf8'));
if (!Array.isArray(data.items) || data.items.length === 0) {
  console.error('dashboard-data.json 里没有通知条目，装出来会是空列表');
  process.exit(1);
}
if (!data.items.every((n) => n.id && n.title && n.url && n.sourceName !== undefined)) {
  console.error('通知条目缺字段（id/title/url/sourceName），原生列表会显示异常');
  process.exit(1);
}
if (!version.version) {
  console.error('version.json 里没有版本号');
  process.exit(1);
}

console.log(`✓ 已准备 ${INCLUDE.length} 个文件（${(bytes / 1024).toFixed(0)} KB）→ ${path.relative(process.cwd(), assetsDir)}`);
console.log(`  内置数据：${data.items.length} 条，生成于 ${data.generatedAt}；应用版本 v${version.version}`);
