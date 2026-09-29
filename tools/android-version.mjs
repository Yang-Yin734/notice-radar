// 把版本号写进 Android 工程（app/build.gradle）。
//
// 为什么不用 bubblewrap 了：这个应用不再是 TWA 套壳，而是自带界面的 WebView 应用，
// 直接 ./gradlew assembleRelease 构建即可 —— 少一层工具链，也就少一类坑。
//
// 用法：node tools/android-version.mjs [--dir=android] [--version=0.7.0] [--version-code=12]
import fs from 'node:fs';
import path from 'node:path';

const valueOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const dir = path.resolve(valueOf('dir', 'android'));
const gradleFile = path.join(dir, 'app', 'build.gradle');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = valueOf('version', pkg.version);
const versionCode = Number(valueOf('version-code', process.env.RUN_NUMBER ?? '1'));

let gradle = fs.readFileSync(gradleFile, 'utf8');
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${Number.isFinite(versionCode) && versionCode > 0 ? versionCode : 1}`);
gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
fs.writeFileSync(gradleFile, gradle, 'utf8');

// 自检：确认真的写进去了（否则会打出版本号不对的包）
const check = fs.readFileSync(gradleFile, 'utf8');
const problems = [];
if (!check.includes(`versionName "${version}"`)) problems.push('versionName');
if (!/versionCode \d+/.test(check)) problems.push('versionCode');
if (!check.includes('applicationId "io.github.yangyin734.noticeradar"')) problems.push('applicationId');
if (!check.includes('assets')) {
  // assets 目录由 tools/prepare-android-assets.mjs 准备，这里只提示
  console.log('  提示：apk 内的界面资源来自 android/app/src/main/assets/www（构建前会生成）');
}
if (problems.length) {
  console.error(`自检失败：${problems.join(', ')} 没写对`);
  process.exit(1);
}

console.log(`✓ ${path.relative(process.cwd(), gradleFile)}：versionName=${version} versionCode=${versionCode}`);
