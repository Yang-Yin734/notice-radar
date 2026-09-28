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

const sum = crypto.createHash('sha1').update(fs.readFileSync(manifestFile)).digest('hex');
fs.writeFileSync(checksumFile, sum, 'utf8');

console.log(`✓ ${path.relative(process.cwd(), manifestFile)}：版本 ${manifest.appVersionName}（code ${manifest.appVersionCode}）`);
console.log(`✓ ${path.relative(process.cwd(), checksumFile)}：${sum}`);
