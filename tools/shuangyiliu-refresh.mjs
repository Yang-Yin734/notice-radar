// 抓「第二轮双一流建设高校及建设学科名单」（教育部 2022-02-14 公布，共 147 所），
// 与 config/schools/directory.tsv 按校名对齐，写出 config/schools/tags.json。
//
// 为什么这么绕：教育部那个页面（下面 PAGE 变量）只给 PDF 附件，机器不好读。
// 所以名单正文取自**转载页**，并用三重校验保证没抄错：
//   1. 每个来源都必须正好 147 条（官方公布的数字）
//   2. **多个来源的学校名集合必须完全一致**（互相独立，抄错会立刻暴露）
//   3. 每个名字都要能在教育部《全国高等学校名单》里对上；对不上的（军校等）单独列出来，
//      绝不硬塞进目录 —— 目录里的学校标识码是官方身份，编不得
//
// 用法：node tools/shuangyiliu-refresh.mjs
import fs from 'node:fs';
import path from 'node:path';

const PAGE = 'http://www.moe.gov.cn/srcsite/A22/s7065/202202/t20220211_598710.html';
const MIRRORS = [
  'http://jky.sneducloud.com/webArticleAction/toNewsInformPage.jhtml?uuid=aa41bef81f764ece93d2',
  'https://www.163.com/dy/article/H06OLATB05148VUD.html',
  'http://www.rmzxw.com.cn/c/2022-02-15/3049258.shtml',
];
const DIRECTORY = path.resolve('config/schools/directory.tsv');
const OUT = path.resolve('config/schools/tags.json');
const UA = { 'user-agent': 'Mozilla/5.0 (notice-radar tags refresh)' };
const EXPECTED = 147;

function textLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 「北京大学：（自主确定建设学科并自行公布）」→ 北京大学 */
function schoolNames(html) {
  const out = [];
  for (const line of textLines(html)) {
    const m = /^([\u4e00-\u9fa5（）()·]{3,30})[：:]/.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    if (!/大学|学院|学校/.test(name)) continue;
    if (out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

// 1) 官方页面：确认是那份通知（只用来证明来源，正文读 PDF 太脆）
const pageRes = await fetch(PAGE, { headers: UA, redirect: 'follow' });
const pageHtml = await pageRes.text();
const pageTitle = /<title>([^<]*)<\/title>/.exec(pageHtml)?.[1]?.trim() ?? '';
const pdfs = [...new Set([...pageHtml.matchAll(/href=["']([^"']+\.pdf)["']/gi)].map((m) => new URL(m[1], PAGE).href))];
if (!/双一流/.test(pageTitle)) throw new Error(`官方页面标题不对：${pageTitle}`);
console.log(`官方页面：${pageTitle}`);
console.log(`  附件 PDF：${pdfs.length} 个`);

// 2) 多个转载页
const sources = [];
for (const url of MIRRORS) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow' });
    const names = schoolNames(await r.text());
    console.log(`转载页 HTTP ${r.status}：${names.length} 条 ← ${url}`);
    if (names.length) sources.push({ url, names });
  } catch (e) {
    console.log(`转载页失败（跳过）：${url} — ${e.message}`);
  }
}
if (!sources.length) throw new Error('没有任何转载页可用');

const exact = sources.filter((s) => s.names.length === EXPECTED);
if (!exact.length) throw new Error(`没有来源给出正好 ${EXPECTED} 条：${sources.map((s) => s.names.length).join(' / ')}`);

const [first, ...rest] = exact;
for (const other of rest) {
  const a = new Set(first.names);
  const b = new Set(other.names);
  const onlyA = first.names.filter((n) => !b.has(n));
  const onlyB = other.names.filter((n) => !a.has(n));
  if (onlyA.length || onlyB.length) {
    throw new Error(`两个来源不一致：仅前者有 ${onlyA.slice(0, 5)}；仅后者有 ${onlyB.slice(0, 5)}`);
  }
  console.log(`✓ 与另一个来源完全一致（各 ${first.names.length} 条）`);
}
const names = first.names;

// 3) 与教育部全国名单对齐
const rows = fs
  .readFileSync(DIRECTORY, 'utf8')
  .trim()
  .split('\n')
  .slice(1)
  .map((l) => {
    const [code, name, province, city, level, authority, note] = l.split('\t');
    return { code, name, province, city, level, authority, note };
  });
const byName = new Map(rows.map((r) => [r.name, r]));

// 名单是 2022 年的，之后有的学校改了名。这里逐个确认过：
//   上海体育学院 → 上海体育大学（2023 年更名）
const RENAMED = { 上海体育学院: '上海体育大学' };

// 明确知道「教育部《全国高等学校名单》里没有」的：军队院校（那份名单不收军校）。
// 写死是有意的：将来出现**新的**对不上的名字时，脚本必须失败，逼人查清楚（可能又改名了）。
const KNOWN_ABSENT = ['国防科技大学', '海军军医大学', '空军军医大学'];

const matched = [];
const renamed = [];
const unmatched = [];
for (const n of names) {
  const official = RENAMED[n];
  const hit = byName.get(official ?? n);
  if (hit) {
    matched.push({ name: n, code: hit.code });
    if (official) renamed.push(`${n} → ${official}`);
  } else {
    unmatched.push(n);
  }
}

console.log(`\n对齐结果：命中 ${matched.length} 所，对不上 ${unmatched.length} 所`);
for (const r of renamed) console.log(`  ↻ ${r}`);
for (const n of unmatched) console.log(`  ✗ ${n}（教育部《全国高等学校名单》里没有）`);
const unexpected = unmatched.filter((n) => !KNOWN_ABSENT.includes(n));
if (unexpected.length) {
  throw new Error(`有对不上的名字不在已知军校名单里：${unexpected.join('、')} —— 先查清楚（改名了？）再写文件`);
}
if (matched.length !== EXPECTED - KNOWN_ABSENT.length) {
  throw new Error(`命中 ${matched.length} 所，预期 ${EXPECTED - KNOWN_ABSENT.length} 所（${EXPECTED} − 军校 ${KNOWN_ABSENT.length}）`);
}

const out = {
  _readme:
    '机器生成（node tools/shuangyiliu-refresh.mjs）：教育部 2022-02-14 公布的「第二轮双一流建设高校及建设学科名单」，' +
    '按学校标识码对齐到 directory.tsv。以校名为准对齐；改过名的记在 _renamed，' +
    '军队院校不在教育部《全国高等学校名单》里，记在 _unmatched（不硬塞进目录）。',
  source: PAGE,
  publishedAt: '2022-02-14',
  expected: EXPECTED,
  matched: matched.length,
  _renamed: renamed,
  _unmatched: unmatched,
  '双一流': matched.map((m) => m.code),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log(`✓ 已写出 ${OUT}（双一流 ${matched.length} 所）`);
