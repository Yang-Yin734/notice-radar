// 把构建好的网页应用（docs/）拷进 Android 工程的 assets/www，
// 这样 APK 自带界面：打开不需要网络，也不会有任何浏览器痕迹。
//
// 用法：node tools/prepare-android-assets.mjs [--docs=docs] [--assets=android/app/src/main/assets/www]
import fs from 'node:fs';
import path from 'node:path';

const valueOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const docsDir = path.resolve(valueOf('docs', 'docs'));
const assetsDir = path.resolve(valueOf('assets', 'android/app/src/main/assets/www'));

// 只带应用运行必需的文件；截图、构建脚本产物不进 APK
const INCLUDE = ['index.html', 'dashboard-data.json', 'version.json', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'sw.js'];
const MAX_BYTES = 8 * 1024 * 1024;

if (!fs.existsSync(docsDir)) {
  console.error(`找不到 ${docsDir}，先跑 npm run dashboard`);
  process.exit(1);
}

fs.rmSync(assetsDir, { recursive: true, force: true });
fs.mkdirSync(assetsDir, { recursive: true });

let copied = 0;
let bytes = 0;
for (const name of INCLUDE) {
  const src = path.join(docsDir, name);
  if (!fs.existsSync(src)) {
    console.error(`缺少 ${name}（先跑 npm run dashboard）`);
    process.exit(1);
  }
  const dest = path.join(assetsDir, name);
  fs.copyFileSync(src, dest);
  const size = fs.statSync(dest).size;
  bytes += size;
  copied++;
  console.log(`  ${name.padEnd(22)} ${(size / 1024).toFixed(0)} KB`);
}

// 自检：界面与数据必须都在包里，否则装出来会白屏
const indexHtml = fs.readFileSync(path.join(assetsDir, 'index.html'), 'utf8');
const data = JSON.parse(fs.readFileSync(path.join(assetsDir, 'dashboard-data.json'), 'utf8'));
if (!indexHtml.includes('id="tabbar"')) {
  console.error('index.html 看起来不是应用页面（缺底部标签栏），检查 docs/ 是不是最新构建');
  process.exit(1);
}
if (!Array.isArray(data.items) || data.items.length === 0) {
  console.error('dashboard-data.json 里没有通知条目，装出来会是空列表');
  process.exit(1);
}
if (!indexHtml.includes('jsdelivr')) {
  console.error('index.html 里没有镜像数据源列表，数据将无法在国内刷新');
  process.exit(1);
}
if (bytes > MAX_BYTES) {
  console.error(`资源太大（${(bytes / 1024 / 1024).toFixed(1)} MB），APK 会臃肿`);
  process.exit(1);
}

console.log(`✓ 已准备 ${copied} 个文件（${(bytes / 1024).toFixed(0)} KB）→ ${path.relative(process.cwd(), assetsDir)}`);
console.log(`  内置数据：${data.items.length} 条，生成于 ${data.generatedAt}`);
