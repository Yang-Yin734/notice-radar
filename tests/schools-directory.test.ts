import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/**
 * 全国高校名单的不变量测试。
 *
 * 背景：选校列表从 153 所扩到全国 3167 所，数据来自教育部两个 .xls 附件（用
 * tools/moe-refresh.mjs 转成 config/schools/directory.tsv）。这份数据一旦出错，
 * 用户会「搜不到自己学校」或者「搜到一所根本不存在的学校」——
 * 而这两种错都不会报错，只会静默地让人找不到学校。所以这里把关键不变量钉死。
 */

const DIRECTORY = 'config/schools/directory.tsv';
const CURATED = 'config/schools/curated.json';
const INDEX = 'docs/data/schools/index.json';

function readDirectory() {
  const text = fs.readFileSync(DIRECTORY, 'utf8').trim();
  const lines = text.split('\n');
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
  return { header, rows };
}

test('全国高校名单：字段齐全、学校标识码唯一、层次只有三种', () => {
  const { header, rows } = readDirectory();
  for (const col of ['code', 'name', 'province', 'city', 'level', 'authority', 'note']) {
    assert.ok(header.includes(col), `表头缺列 ${col}`);
  }

  // 教育部 2025 版是 3167 所（本科 1365 + 高职专科 1554 + 成人 248）。给下限而不是等值，
  // 免得明年名单一更新就得改测试；但明显偏少（比如解析失败只剩几十条）必须拦住。
  assert.ok(rows.length >= 3000, `名单只有 ${rows.length} 所，远少于全国高校数量`);

  const codes = new Set();
  for (const r of rows) {
    assert.match(r.code, /^\d{10}$/, `${r.name} 的学校标识码不是 10 位数字：${r.code}`);
    assert.ok(!codes.has(r.code), `学校标识码重复：${r.code}`);
    codes.add(r.code);
    assert.ok(r.name.length >= 2, `校名异常：${r.name}`);
    assert.ok(r.province.length >= 2, `${r.name} 缺少省份`);
    assert.ok(['本科', '专科', '成人'].includes(r.level), `${r.name} 层次异常：${r.level}`);
  }

  const levels = rows.reduce((acc, r) => ((acc[r.level] = (acc[r.level] ?? 0) + 1), acc), {});
  assert.equal(levels['本科'], 1365, '本科数量与教育部公布的不一致');
  assert.equal(levels['专科'], 1554, '高职（专科）数量与教育部公布的不一致');
  assert.equal(levels['成人'], 248, '成人高校数量与教育部公布的不一致');

  const provinces = new Set(rows.map((r) => r.province));
  assert.ok(provinces.size >= 30, `只解析出 ${provinces.size} 个省份，疑似分组标题没解析对`);
});

test('人工维护的重点高校：都必须在官方名单里，且 id 唯一', () => {
  const { rows } = readDirectory();
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const curated = JSON.parse(fs.readFileSync(CURATED, 'utf8'));

  const ids = Object.keys(curated.schools);
  assert.ok(ids.length >= 100, `重点高校只有 ${ids.length} 所，像是被误删了`);

  for (const [id, s] of Object.entries(curated.schools)) {
    const official = byCode.get(s.code);
    assert.ok(official, `${id}（${s.name}）的学校标识码 ${s.code} 不在官方名单里`);
    assert.equal(
      official.name,
      s.name,
      `${id} 的校名与官方名单不一致（官方是 ${official.name}）—— 学校改名了？重跑 moe-refresh 后同步`,
    );
    assert.ok(s.pinyin && /^[a-z]+$/.test(s.pinyin), `${id} 的拼音不合法：${s.pinyin}`);
  }

  // 短 id 不能和别人的学校标识码撞车（否则目录里两条记录的 id 会重复）
  const allIds = [...ids];
  assert.equal(new Set(allIds).size, allIds.length, '重点高校的 id 有重复');
});

test('选校目录：包含全部学校，已接入的必须带数据文件与学院列表', () => {
  const { rows } = readDirectory();
  const curated = JSON.parse(fs.readFileSync(CURATED, 'utf8'));
  const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));

  assert.equal(index.schools.length, rows.length, 'index.json 的学校数与官方名单不一致');
  assert.equal(index.counts.total, rows.length);
  assert.equal(index.counts.featured, Object.keys(curated.schools).length, '重点高校数量与 curated.json 对不上');
  assert.equal(index.counts.bachelor, 1365);
  assert.equal(index.counts.vocational, 1554);
  assert.equal(index.counts.adult, 248);

  const ids = new Set();
  for (const s of index.schools) {
    assert.ok(s.id && s.name && s.province && s.level, `目录条目缺字段：${JSON.stringify(s).slice(0, 120)}`);
    assert.ok(!ids.has(s.id), `目录里 id 重复：${s.id}`);
    ids.add(s.id);
    if (s.status !== 'active') {
      assert.equal(s.file, undefined, `${s.name} 不是已接入，却带了数据文件`);
      continue;
    }
    assert.ok(s.file && s.file.endsWith('.json'), `${s.name} 缺数据文件名`);
    assert.ok(Array.isArray(s.units) && s.units.length > 0, `${s.name} 应有学院/栏目列表`);
    assert.ok(s.total > 0, `${s.name} 的条目数应为正`);
  }

  const active = index.schools.filter((s) => s.status === 'active');
  assert.equal(active.length, index.counts.active, 'active 计数与实际条目不一致');
  assert.ok(active.length >= 1, '至少要有一所已接入的学校（否则应用里什么都看不到）');

  // 每所已接入的学校都要真的有数据文件，否则应用按目录去拉会 404
  for (const s of active) {
    const file = `docs/data/schools/${s.file}`;
    assert.ok(fs.existsSync(file), `缺少数据文件 ${file}`);
  }
});
