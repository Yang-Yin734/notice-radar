/**
 * 生成「学校目录」与「按校拆分的数据文件」。
 *
 * 为什么要它：网页版和应用要在设置里让用户**选学校、搜学校**，并且选中后立刻换成那所学校的通知。
 * 这要求数据按学校分开、且有一个可搜索的目录 —— 但**不碰抓取与推送链路**：
 * 本脚本只是把已发布的 docs/dashboard-data.json 重新组织一遍（数据从哪来不变）。
 *
 * 数据来源（两份都是提交进仓库的，构建时可复现、不联网）：
 *   config/schools/directory.tsv  全国高等学校名单（教育部官方，3167 所），
 *                                 用 `node tools/moe-refresh.mjs` 刷新，见 config/schools/README.md
 *   config/schools/curated.json   人工维护：重点高校的短 id 与拼音/简称（其余学校 id = 学校标识码）
 *
 * 产出：
 *   docs/data/schools/index.json      全部 3167 所的目录（网页/应用选校读它）
 *   docs/data/schools/<学校id>.json   已接入学校的通知（按学院/栏目分组）
 *
 * 状态只有两种，且**不撒谎**：
 *   active  = 真抓过、能出通知（目前只有电子科技大学）
 *   pending = 只是目录条目，选中会明确提示"尚未接入"并给出接入指引
 *
 * 用法：node tools/build-schools.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataFile = path.join(repo, 'docs', 'dashboard-data.json');
const outDir = path.join(repo, 'docs', 'data', 'schools');
const directoryFile = path.join(repo, 'config', 'schools', 'directory.tsv');
const curatedFile = path.join(repo, 'config', 'schools', 'curated.json');
const tagsFile = path.join(repo, 'config', 'schools', 'tags.json');

// ---------------------------------------------------------------- 读两份来源

/** 全国高等学校名单（TSV：code/name/province/city/level/authority/note） */
function loadDirectory() {
  if (!fs.existsSync(directoryFile)) {
    throw new Error(`找不到 ${directoryFile}，先跑 node tools/moe-refresh.mjs（见 config/schools/README.md）`);
  }
  const lines = fs.readFileSync(directoryFile, 'utf8').trim().split('\n');
  const header = lines[0].split('\t');
  const need = ['code', 'name', 'province', 'city', 'level', 'authority', 'note'];
  for (const k of need) if (!header.includes(k)) throw new Error(`${directoryFile} 表头缺列 ${k}`);
  return lines.slice(1).map((line, i) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, j) => (row[h] = (cells[j] ?? '').trim()));
    if (!row.code || !row.name) throw new Error(`${directoryFile} 第 ${i + 2} 行缺 code/name`);
    return row;
  });
}

/** 人工维护的重点高校（短 id + 拼音/简称） */
function loadCurated() {
  if (!fs.existsSync(curatedFile)) return { schools: {} };
  const parsed = JSON.parse(fs.readFileSync(curatedFile, 'utf8'));
  return { schools: parsed.schools ?? {}, excluded: parsed._excluded ?? {} };
}

/**
 * 外部来源的标签（目前只有「双一流」，见 config/schools/tags.json）。
 * 返回 标签名 → 学校标识码集合。
 */
function loadTags() {
  if (!fs.existsSync(tagsFile)) return {};
  const parsed = JSON.parse(fs.readFileSync(tagsFile, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k.startsWith('_') || !Array.isArray(v)) continue;
    out[k] = new Set(v);
  }
  return out;
}

// ---------------------------------------------------------------- 拼出完整目录

const directory = loadDirectory();
const curated = loadCurated().schools;
const externalTags = loadTags();
const doubleFirst = externalTags['双一流'] ?? new Set();

const curatedByCode = new Map();
for (const [id, c] of Object.entries(curated)) {
  if (!c?.code) throw new Error(`curated.json 里 ${id} 缺 code`);
  curatedByCode.set(c.code, { id, ...c });
}

const knownCodes = new Set(directory.map((r) => r.code));
for (const [, c] of curatedByCode) {
  if (!knownCodes.has(c.code)) {
    throw new Error(`curated.json 里的 ${c.name}（${c.code}）不在官方名单里 —— 学校可能改名了，重跑 moe-refresh 后修正`);
  }
}
for (const code of doubleFirst) {
  if (!knownCodes.has(code)) throw new Error(`tags.json 里的学校标识码 ${code} 不在官方名单里`);
}

/** id 规则：人工给了短 id 就用它，否则用学校标识码 */
function idOf(code) {
  return curatedByCode.get(code)?.id ?? code;
}

/**
 * 一所学校的标签。
 * 「双一流」来自外部名单（config/schools/tags.json，教育部 2022 年公布）；
 * 其余两个直接从官方名单的字段推出来，没有引入第二个数据源：
 *   主管部门 = 教育部 → 教育部直属；备注 = 民办 → 民办；备注以「中外合作办学」开头 → 中外合作办学
 */
function tagsOf(row) {
  const out = [];
  if (doubleFirst.has(row.code)) out.push('双一流');
  if (row.authority === '教育部') out.push('教育部直属');
  if (row.note === '民办') out.push('民办');
  else if (String(row.note).startsWith('中外合作办学')) out.push('中外合作办学');
  return out;
}

/** 目录条目（客户端选校读的字段；authority/note 留在 TSV 里，不进 index.json 省体积） */
function schoolEntry(row) {
  const c = curatedByCode.get(row.code);
  const tags = tagsOf(row);
  return {
    id: idOf(row.code),
    code: row.code,
    name: row.name,
    province: row.province,
    city: row.city,
    level: row.level,
    ...(c ? { pinyin: c.pinyin, abbr: c.abbr } : {}),
    // 「值得优先看」= 官方双一流 ∪ 人工挑选的重点高校（后者含几所非双一流但很知名的学校）
    ...(c || tags.includes('双一流') ? { featured: true } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

const entries = directory.map(schoolEntry);
const byId = new Map(entries.map((e) => [e.id, e]));

/**
 * 写进 index.json 的精简形态。
 *
 * 这个文件会被手机在打开「选校」时下载，所以省字段 —— 但**不省语义**：
 * id / name / province / level / status 一个不少，省掉的都是"客户端本来就会当空值"的：
 *   · id 就是学校标识码时不再重复写一遍 code
 *   · 空的 city 不写（直辖市与成人高校没有城市）
 *   · pending 的学校不写 file / units / total / updatedAt（解析端对这几个字段都有兜底）
 *   · 所有条目都不写 updatedAt：它是"数据生成时间"，poll 每 10 分钟就换一次，
 *     写进来会让这个 500 KB 的文件每轮都进一次 git 历史（客户端也用不到它）
 */
function compactEntry(e) {
  const o = { id: e.id, name: e.name, province: e.province };
  if (e.city) o.city = e.city;
  o.level = e.level;
  if (e.code !== e.id) o.code = e.code;
  if (e.pinyin) o.pinyin = e.pinyin;
  if (e.abbr) o.abbr = e.abbr;
  if (e.featured) o.featured = true;
  if (e.tags?.length) o.tags = e.tags;
  o.status = e.status;
  if (e.status === 'active') {
    o.file = e.file;
    o.units = e.units;
    o.total = e.total;
  }
  return o;
}

// ---------------------------------------------------------------- 已接入的学校

/** 学院/栏目：配置里的源名是「教务处·重要公告」这种，取 `·` 前那段作为归属单位 */
function unitOf(sourceName) {
  const head = String(sourceName ?? '').split('·')[0]?.trim();
  return head || '其它';
}

/**
 * 从配置里取该校**全部**学院/栏目。
 * 为什么必须这么做：学院列表如果只从"已有条目"里推，那么某个栏目当前 0 条（很常见，
 * 比如研究生院近期没发通知）就会从选择列表里消失 —— 用户就选不到它了。
 * 所以以配置为准：配置里有这个源，就必须能选。
 */
function unitsFromConfig(schoolId) {
  const file = path.join(repo, 'config', 'schools', `${schoolId}.yaml`);
  if (!fs.existsSync(file)) return [];
  const cfg = parseYaml(fs.readFileSync(file, 'utf8'));
  const names = [];
  for (const s of cfg.sources ?? []) {
    const unit = unitOf(s.name ?? s.id);
    if (!names.includes(unit)) names.push(unit);
  }
  return names;
}

function build() {
  if (!fs.existsSync(dataFile)) throw new Error(`找不到 ${dataFile}，先跑 node src/cli.ts dashboard`);
  const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  fs.mkdirSync(outDir, { recursive: true });

  // ---- 已接入的学校：按 school 分组，再按学院/栏目分组 ----
  const bySchool = new Map();
  for (const item of data.items ?? []) {
    const sid = item.school || 'unknown';
    if (!bySchool.has(sid)) bySchool.set(sid, []);
    bySchool.get(sid).push(item);
  }

  const activeEntries = [];
  const written = [];
  for (const [sid, items] of bySchool) {
    // 抓取配置里的 school 可能就是短 id，也可能是学校标识码
    const meta = byId.get(sid) ?? entries.find((e) => e.code === sid) ?? { id: sid, code: sid, name: sid, province: '', city: '', level: '' };
    const id = meta.id;

    const units = [];
    for (const name of unitsFromConfig(id)) units.push({ id: name, name, sources: [], count: 0 });
    for (const item of items) {
      const unitName = unitOf(item.sourceName);
      let unit = units.find((u) => u.name === unitName);
      if (!unit) {
        unit = { id: unitName, name: unitName, sources: [], count: 0 };
        units.push(unit);
      }
      if (item.sourceName && !unit.sources.includes(item.sourceName)) unit.sources.push(item.sourceName);
      unit.count += 1;
    }
    units.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'));

    const file = `${id}.json`;
    // bySource 与 dashboard-data.json 保持一致：应用端解析快照时用它渲染"渠道 chips"，
    // 缺了不会崩（解析器对空数组有兜底），但界面上会少一排筛选按钮
    const bySource = [];
    for (const it of items) {
      let s = bySource.find((x) => x.sourceId === it.sourceId);
      if (!s) {
        s = { sourceId: it.sourceId, sourceName: it.sourceName, count: 0 };
        bySource.push(s);
      }
      s.count += 1;
    }
    const schoolName = meta.name || sid;
    fs.writeFileSync(
      path.join(outDir, file),
      `${JSON.stringify(
        {
          school: id,
          name: schoolName,
          province: meta.province ?? '',
          city: meta.city ?? '',
          generatedAt: data.generatedAt,
          total: items.length,
          bySource,
          units,
          items: items.map((it) => ({ ...it, unit: unitOf(it.sourceName) })),
        },
        null,
        1,
      )}\n`,
    );
    written.push({ id, name: schoolName, file, total: items.length, units: units.length });

    activeEntries.push({
      ...meta,
      id,
      name: schoolName,
      status: 'active',
      file,
      units: units.map((u) => ({ id: u.id, name: u.name, count: u.count })),
      total: items.length,
      updatedAt: data.generatedAt,
    });
  }

  // ---- 合并成一份目录：active 的覆盖统计，其余保持 pending ----
  const activeById = new Map(activeEntries.map((e) => [e.id, e]));
  const schools = entries.map((e) => {
    const active = activeById.get(e.id);
    if (active) return active;
    return { ...e, status: 'pending', file: null, units: [], total: 0, updatedAt: null };
  });
  // 抓取数据里有、但官方名单里没有的（理论上不该出现）也要列出来，否则数据文件成了孤儿
  for (const [id, e] of activeById) {
    if (!schools.some((s) => s.id === id)) schools.push(e);
  }

  const counts = {
    total: schools.length,
    active: activeEntries.length,
    pending: schools.length - activeEntries.length,
    featured: schools.filter((s) => s.featured).length,
    doubleFirst: doubleFirst.size,
    bachelor: schools.filter((s) => s.level === '本科').length,
    vocational: schools.filter((s) => s.level === '专科').length,
    adult: schools.filter((s) => s.level === '成人').length,
  };

  const header = {
    generatedAt: data.generatedAt,
    source: '教育部《全国高等学校名单》（config/schools/directory.tsv，见 config/schools/README.md）',
    note:
      'status=active 表示真抓过、能出通知；pending 只是目录条目，选中会提示尚未接入。' +
      '接入方法见 docs/add-your-school.md',
    counts,
  };

  const indexFile = path.join(outDir, 'index.json');
  const full = { ...header, schools: schools.map(compactEntry) };
  // 只在"内容真的变了"时才写：这个文件 3167 条、几百 KB，而 poll 每 10 分钟就重建一次数据，
  // 若每轮都因为 generatedAt 变化重写，仓库历史会被它撑爆
  const cmp = (o) => {
    const c = { ...o };
    delete c.generatedAt;
    return JSON.stringify(c, null, 1);
  };
  let previous = '';
  try {
    previous = cmp(JSON.parse(fs.readFileSync(indexFile, 'utf8')));
  } catch {
    previous = '';
  }
  const wroteIndex = previous !== cmp(full);
  if (wroteIndex) fs.writeFileSync(indexFile, `${JSON.stringify(full, null, 1)}\n`);

  return { schools: full.schools, activeEntries, counts, wroteIndex };
}

const { activeEntries, counts, wroteIndex } = build();
const stat = fs.statSync(path.join(outDir, 'index.json'));
console.log(
  `✓ docs/data/schools/index.json（${counts.total} 所：已接入 ${counts.active}、` +
    `重点 ${counts.featured}、本科 ${counts.bachelor} / 专科 ${counts.vocational} / 成人 ${counts.adult}，` +
    `${(stat.size / 1024).toFixed(0)} KB${wroteIndex ? '' : '，内容未变未重写'}）`,
);
for (const s of activeEntries) {
  const unitText = s.units.map((u) => `${u.name}(${u.count})`).join('、');
  console.log(`  · ${s.name}（${s.id}）：${s.total} 条，学院/栏目 ${s.units.length} 个 → ${unitText}`);
}
console.log(`  · 其余 ${counts.pending} 所标为 pending（灰显 + 接入指引）`);
