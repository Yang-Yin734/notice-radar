// 更新 TWA 工程的版本号，并同步 manifest-checksum.txt。
//
// 为什么需要这个脚本：
//   `bubblewrap build` 会比对 twa-manifest.json 的 sha1 与工程目录里的 manifest-checksum.txt，
//   不一致（或文件缺失）时会**交互式提问**"要不要把变更应用到工程" —— CI 里没有 TTY 会直接崩。
//   所以只要改了 manifest，就必须顺手把校验和重算一遍（算法就是 sha1(文件原始字节) hex）。
//
// 用法：
//   node tools/twa-version.mjs [--dir=android] [--version=0.4.0] [--version-code=12]
//   缺省的 version 取自 package.json；version-code 缺省则保持原值。
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const valueOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const dir = path.resolve(valueOf('dir', 'android'));
const manifestFile = path.join(dir, 'twa-manifest.json');
const checksumFile = path.join(dir, 'manifest-checksum.txt');

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const version = valueOf('version', pkg.version);
const versionCode = Number(valueOf('version-code', process.env.RUN_NUMBER ?? '0'));

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
manifest.appVersionName = version;
manifest.appVersion = version;
if (Number.isFinite(versionCode) && versionCode > 0) manifest.appVersionCode = versionCode;

// 写回：格式必须与 bubblewrap 生成时一致（2 空格缩进 + 末尾换行），否则每次都会"看起来变了"
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// ---- 同步 app/build.gradle ----
// bubblewrap 在 init 时会把 twa-manifest.json 的内容**内联**成 build.gradle 里的 twaManifest 映射，
// 构建时真正用的是这份内联配置 —— 只改 twa-manifest.json 不会影响 APK 的包名/版本。
const gradleFile = path.join(dir, 'app', 'build.gradle');
let gradle = fs.readFileSync(gradleFile, 'utf8');

const mapBlock = `def twaManifest = [
    applicationId: '${manifest.packageId}', // 包名（Android 应用的唯一标识）
    hostName: '${manifest.host}', // The domain being opened in the TWA.
    launchUrl: '${manifest.startUrl}', // The start path for the TWA. Must be relative to the domain.
    name: '${manifest.name}', // The application name.
    launcherName: '${manifest.launcherName}', // The name shown on the Android Launcher.
    themeColor: '${manifest.themeColor}', // The color used for the status bar.
    themeColorDark: '${manifest.themeColorDark}', // The color used for the dark status bar.
    navigationColor: '${manifest.navigationColor}', // The color used for the navigation bar.
    navigationColorDark: '${manifest.navigationColorDark}', // The color used for the dark navbar.
    navigationDividerColor: '${manifest.navigationDividerColor}', // The navbar divider color.
    navigationDividerColorDark: '${manifest.navigationDividerColorDark}', // The dark navbar divider color.
    backgroundColor: '${manifest.backgroundColor}', // The color used for the splash screen background.
    enableNotifications: ${Boolean(manifest.enableNotifications)}, // 通知（没有 Firebase 配置时关掉）
    shortcuts: [],
    splashScreenFadeOutDuration: ${manifest.splashScreenFadeOutDuration},
    generatorApp: 'bubblewrap-cli', // Application that generated the Android Project
    fallbackType: '${manifest.fallbackType}',
    enableSiteSettingsShortcut: '${Boolean(manifest.enableSiteSettingsShortcut)}',
    orientation: '${manifest.orientation}',
]`;

const replaced = gradle.replace(/def twaManifest = \[[\s\S]*?\n\]/, mapBlock);
if (replaced === gradle && !gradle.includes(`applicationId: '${manifest.packageId}'`)) {
  console.error('没找到 app/build.gradle 里的 twaManifest 映射，无法同步配置');
  process.exit(1);
}
gradle = replaced;

// 版本号在 android.defaultConfig 里（不在上面的映射里）
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${Number(manifest.appVersionCode)}`);
gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
// namespace 也要跟着包名走
gradle = gradle.replace(/namespace\s+"[^"]*"/, `namespace "${manifest.packageId}"`);

fs.writeFileSync(gradleFile, gradle, 'utf8');

// 自检：确认关键字段真的写进去了
const check = fs.readFileSync(gradleFile, 'utf8');
const problems = [];
if (!check.includes(`applicationId: '${manifest.packageId}'`)) problems.push('applicationId');
if (!check.includes(`namespace "${manifest.packageId}"`)) problems.push('namespace');
if (!check.includes(`versionCode ${Number(manifest.appVersionCode)}`)) problems.push('versionCode');
if (!check.includes(`versionName "${version}"`)) problems.push('versionName');
if (problems.length) {
  console.error(`自检失败，这些字段没写进 build.gradle：${problems.join(', ')}`);
  process.exit(1);
}

const sum = crypto.createHash('sha1').update(fs.readFileSync(manifestFile)).digest('hex');
fs.writeFileSync(checksumFile, sum, 'utf8');

console.log(`✓ ${path.relative(process.cwd(), manifestFile)}：版本 ${manifest.appVersionName}（code ${manifest.appVersionCode}）`);
console.log(`✓ ${path.relative(process.cwd(), gradleFile)}：applicationId=${manifest.packageId} versionCode=${manifest.appVersionCode} versionName=${version}`);
console.log(`✓ ${path.relative(process.cwd(), checksumFile)}：${sum}`);
