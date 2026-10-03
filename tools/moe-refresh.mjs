// 全国高校名单刷新工具（**本地跑**，CI 不需要；产物是提交进仓库的 config/schools/directory.tsv）
//
// 为什么要它：应用里的「选学校」需要一份全国名单（3167 所），而唯一可靠的来源是教育部
// 「全国高等学校名单」页面上的两个 .xls 附件。教育部每年更新一次，届时就重跑这个脚本。
//
// 步骤：
//   1) 抓页面，按顺序取两个附件（附件1 普通高校 / 附件2 成人高校）
//   2) 用随 DSH 捆绑的 LibreOffice Kit 把 .xls 转成 CSV（本机沙箱里这一步要升权执行）
//   3) 解析 CSV：省份来自分组标题「北京市（92所）」，城市来自「所在地」列
//   4) 与页面公布的总数逐项对账（对不上就报错退出，避免把错的名单写进仓库）
//   5) 写出 TSV：code / name / province / city / level / authority / note
//
// 用法：
//   node tools/moe-refresh.mjs --kit="D:\DSH desktop new\resources\app.asar.unpacked\dsh\node_modules\@deepseek-ai\libreoffice-kit\lib\cli.js"
//   可选：--node=<node.exe> --page=<URL> --out=config/schools/directory.tsv --work=.moe-work
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const PAGE =
  arg('page') ?? 'https://hudong.moe.gov.cn/jyb_xxgk/s5743/s5744/202506/t20250627_1195683.html';
const OUT = path.resolve(arg('out') ?? path.join('config', 'schools', 'directory.tsv'));
const WORK = path.resolve(arg('work') ?? '.moe-work');
const KIT = arg('kit') ?? process.env.LIBREOFFICE_KIT_CLI ?? '';
const KIT_NODE = arg('node') ?? process.env.LIBREOFFICE_KIT_NODE ?? process.execPath;
const UA = { 'user-agent': 'Mozilla/5.0 (notice-radar school directory refresh)' };

fs.mkdirSync(WORK, { recursive: true });

// ---------------------------------------------------------------- 1) 抓页面与附件

const pageRes = await fetch(PAGE, { headers: UA });
if (!pageRes.ok) throw new Error(`页面抓取失败：HTTP ${pageRes.status}`);
const html = await pageRes.text();
const pageText = html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const declared = {
  total: Number(/全国高等学校共计\s*(\d+)\s*所/.exec(pageText)?.[1] ?? 0),
  general: Number(/普通高等学校\s*(\d+)\s*所/.exec(pageText)?.[1] ?? 0),
  bachelor: Number(/本科学校\s*(\d+)\s*所/.exec(pageText)?.[1] ?? 0),
  vocational: Number(/高职（专科）学校\s*(\d+)\s*所/.exec(pageText)?.[1] ?? 0),
  adult: Number(/成人高等学校\s*(\d+)\s*所/.exec(pageText)?.[1] ?? 0),
};
console.log('页面公布：', declared);

const links = [...new Set([...html.matchAll(/href=["']([^"']+\.xls)["']/gi)].map((m) => m[1]))];
if (links.length < 2) throw new Error(`页面上只找到 ${links.length} 个 .xls 附件，预期 2 个`);

const files = [];
for (const [i, link] of links.entries()) {
  const url = new URL(link, PAGE).href;
  const name = decodeURIComponent(url.split('/').pop().split('?')[0]);
  const file = path.join(WORK, name);
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`附件下载失败：${url} → HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(`附件${i + 1}：${name} ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
  files.push(file);
}

// ---------------------------------------------------------------- 2) xls → csv

if (!KIT || !fs.existsSync(KIT)) {
  throw new Error(
    '找不到 LibreOffice Kit：请用 --kit=<.../libreoffice-kit/lib/cli.js>，或设环境变量 LIBREOFFICE_KIT_CLI。\n' +
      '（沙箱里这一步会 spawn EPERM，需要在放开沙箱的终端里跑）',
  );
}

function toCsv(xls) {
  const csv = xls.replace(/\.xls$/i, '.csv');
  if (!fs.existsSync(csv)) {
    const r = spawnSync(KIT_NODE, [KIT, 'convert', '--input', xls, '--output', csv], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`转换失败：${xls}`);
  }
  return csv;
}

// ---------------------------------------------------------------- 3) CSV 解析

/** RFC4180：支持引号包裹、字段内逗号与换行、双引号转义 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const GROUP = /^(.+?)（\s*(\d+)\s*所）\s*$/;

function extract(csvPath, fallbackLevel) {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const headerIdx = rows.findIndex((r) => (r[0] ?? '').trim() === '序号');
  if (headerIdx < 0) throw new Error(`${csvPath}：找不到表头行`);
  const header = rows[headerIdx].map((h) => h.trim());
  const at = (row, name) => {
    const j = header.indexOf(name);
    return j >= 0 && row[j] !== undefined ? String(row[j]).trim() : '';
  };

  let province = '';
  let groupSum = 0;
  const out = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const first = (row[0] ?? '').trim();
    const g = GROUP.exec(first);
    if (g) {
      province = g[1];
      groupSum += Number(g[2]);
      continue;
    }
    if (!/^\d+$/.test(first)) continue; // 小计/说明行
    const loc = at(row, '所在地');
    out.push({
      code: at(row, '学校标识码'),
      name: at(row, '学校名称'),
      province,
      city: loc === province ? '' : loc,
      level: at(row, '办学层次') || fallbackLevel,
      authority: at(row, '主管部门'),
      note: at(row, '备注'),
    });
  }
  return { rows: out, groupSum };
}

const general = extract(toCsv(files[0]), '本科');
const adult = extract(toCsv(files[1]), '成人');
for (const r of adult.rows) if (!r.level) r.level = '成人';

// 附件顺序偶尔会换：靠标题确认哪份是普通高校、哪份是成人高校
const looksGeneral = general.rows.length > adult.rows.length;
const all = looksGeneral ? [...general.rows, ...adult.rows] : [...adult.rows, ...general.rows];

// ---------------------------------------------------------------- 4) 对账

const count = (list, pred) => list.filter(pred).length;
const actual = {
  total: all.length,
  general: count(all, (r) => r.level !== '成人'),
  bachelor: count(all, (r) => r.level === '本科'),
  vocational: count(all, (r) => r.level === '专科'),
  adult: count(all, (r) => r.level === '成人'),
};
console.log('实际解析：', actual);

const problems = [];
for (const key of Object.keys(declared)) {
  if (declared[key] && declared[key] !== actual[key]) {
    problems.push(`${key}: 页面公布 ${declared[key]}，实际解析 ${actual[key]}`);
  }
}
const dupCodes = all.length - new Set(all.map((r) => r.code)).size;
if (dupCodes) problems.push(`学校标识码重复 ${dupCodes} 条`);
const missing = all.filter((r) => !r.code || !r.name || !r.province || !r.level);
if (missing.length) problems.push(`必填字段缺失 ${missing.length} 条：${missing.slice(0, 3).map((r) => r.name).join('、')}`);
if (all.length < 3000) problems.push(`总条数只有 ${all.length}，明显偏少，疑似解析失败`);

const provinceHist = new Map();
for (const r of all) provinceHist.set(r.province, (provinceHist.get(r.province) ?? 0) + 1);
if (provinceHist.size < 30) problems.push(`省份只有 ${provinceHist.size} 个，疑似分组标题没解析对`);

if (problems.length) {
  console.error('\n✗ 对账失败，未写文件：');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

// ---------------------------------------------------------------- 5) 写出 TSV

const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
const lines = ['code\tname\tprovince\tcity\tlevel\tauthority\tnote'];
for (const r of all) {
  lines.push([r.code, r.name, r.province, r.city, r.level, r.authority, r.note].map(clean).join('\t'));
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join('\n') + '\n', 'utf8');

console.log(`\n✓ 已写出 ${OUT}`);
console.log(`  ${all.length} 所（本科 ${actual.bachelor} / 专科 ${actual.vocational} / 成人 ${actual.adult}），覆盖 ${provinceHist.size} 个省份`);
console.log(
  '  各省份：' +
    [...provinceHist.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · '),
);
console.log('  来源：' + PAGE);
