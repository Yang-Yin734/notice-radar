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

// ---- 选校数据：学校目录 + 每所已接入学校的数据 ----
//
// 为什么要打进 APK：应用设置里的「学校 / 学院」在没有网络时也要能用。
// 只放 dashboard-data.json 的话，冷启动/断网时 bundledSchoolIndex() 直接抛异常 →
// 界面提示"学校目录取不到"，用户以为选校功能坏了（数据其实早就发布了）。
const schoolsSrc = path.join(docsDir, 'data', 'schools');
const indexSrc = path.join(schoolsSrc, 'index.json');

if (!fs.existsSync(indexSrc)) {
  console.error(`缺少 ${path.relative(process.cwd(), indexSrc)}（先跑 node tools/build-schools.mjs）`);
  process.exit(1);
}

const schoolIndex = JSON.parse(fs.readFileSync(indexSrc, 'utf8'));
const allSchools = Array.isArray(schoolIndex.schools) ? schoolIndex.schools : [];
const activeSchools = allSchools.filter((s) => s.status === 'active' && s.file);
if (allSchools.length === 0) {
  console.error('学校目录里没有任何学校');
  process.exit(1);
}
// 全国名单是 3167 所（2025 版）。这里卡一个下限，防止"目录被截断/生成失败"却照常出包，
// 装出来变成"只有十几所学校可选"还查不出原因。教育部名单只会缓慢增长，2500 是安全下限。
if (allSchools.length < 2500) {
  console.error(`学校目录只有 ${allSchools.length} 所，远少于全国名单（约 3167 所），先查 tools/build-schools.mjs`);
  process.exit(1);
}
if (activeSchools.length === 0) {
  console.error('学校目录里没有已接入（status=active）的学校，应用里选校会全是"待接入"');
  process.exit(1);
}

const schoolsOut = path.join(assetsDir, 'schools');
fs.mkdirSync(schoolsOut, { recursive: true });
fs.copyFileSync(indexSrc, path.join(schoolsOut, 'index.json'));
let bytes2 = fs.statSync(indexSrc).size;
const copied = [];

for (const s of activeSchools) {
  const src = path.join(schoolsSrc, s.file);
  if (!fs.existsSync(src)) {
    console.error(`目录里 ${s.name} 是 active，但缺少数据文件 ${s.file}（数据不一致，先重跑 build-schools）`);
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    console.error(`${s.file} 里没有通知条目，选中该校会是空列表`);
    process.exit(1);
  }
  if (!payload.items.every((n) => n.id && n.title && n.url && n.unit !== undefined)) {
    console.error(`${s.file} 的条目缺字段（id/title/url/unit），按学院过滤会漏通知`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(schoolsOut, s.file));
  bytes2 += fs.statSync(src).size;
  copied.push(s);
}

console.log(`✓ 已准备选校数据（${(bytes2 / 1024).toFixed(0)} KB）→ ${path.relative(process.cwd(), schoolsOut)}`);
console.log(`  学校目录 ${allSchools.length} 所（已接入 ${activeSchools.length} 所，待接入 ${allSchools.length - activeSchools.length} 所）`);
for (const s of copied) {
  console.log(`  · ${s.name}（${s.file}）：${s.total} 条，学院/栏目 ${(s.units ?? []).length} 个`);
}
