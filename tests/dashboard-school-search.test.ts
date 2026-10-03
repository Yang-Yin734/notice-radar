import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/**
 * 网页版选校搜索的行为测试。
 *
 * 为什么这么测：选校那段 JS 写在 src/dashboard.ts 的 HTML 模板字符串里，tsc 检查不到它 ——
 * 字段名打错、排序写反都不会有人发现，直到用户点开设置搜不到自己学校。
 * 所以这里把三个纯函数**从源码里抽出来**（不是抄一份），配真实的 index.json 跑一遍。
 *
 * 抽源码的方式确实有点脆（靠花括号配平），所以抽不到时会**断言失败**而不是静默跳过 ——
 * 改动那几个函数时，这个测试会强制你确认行为没变。
 */
const src = fs.readFileSync('src/dashboard.ts', 'utf8');

function extract(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `在 dashboard.ts 里找不到 ${name}()，是不是改名了？改了就同步这个测试`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`${name}() 的括号不配平`);
}

const injected = [extract('schoolRank'), extract('schoolSort'), extract('schoolMatches')].join('\n');
const { schoolSort, schoolMatches } = new Function(`${injected}\nreturn { schoolSort, schoolMatches };`)() as {
  schoolSort: (a: any, b: any) => number;
  schoolMatches: (s: any, q: string) => boolean;
};

const index = JSON.parse(fs.readFileSync('docs/data/schools/index.json', 'utf8'));
const all = index.schools as any[];
const search = (q: string) => all.filter((s) => schoolMatches(s, q)).sort(schoolSort);

test('网页版：名单规模与官方一致，且每条都有省份与层次', () => {
  assert.ok(all.length >= 3000, `目录只有 ${all.length} 所`);
  assert.equal(all.length, index.counts.total);
  for (const s of all.slice(0, 200)) {
    assert.ok(s.id && s.name && s.province && s.level, `条目缺字段：${JSON.stringify(s)}`);
  }
});

test('网页版：搜「电子科技」能搜到电子科技大学，且已接入的排第一', () => {
  const hit = search('电子科技');
  assert.ok(hit.length >= 3, `只搜到 ${hit.length} 所，明显偏少`);
  assert.equal(hit[0].id, 'uestc', '已接入的学校必须排第一');
});

test('网页版：省份、城市、拼音、简称、学校标识码都能搜', () => {
  assert.ok(search('成都').length >= 20, '按城市搜：成都应有 20 所以上高校');
  assert.ok(search('浙江').length >= 100, '按省份搜：浙江应有 100 所以上');
  assert.equal(search('dianzi')[0].id, 'uestc', '按拼音搜');
  assert.equal(search('hzdzkjdx')[0].id, 'hdu', '按简称搜');
  assert.equal(search('4151010614')[0].id, 'uestc', '按学校标识码搜');
  assert.equal(search('不存在的学校').length, 0);
});

test('网页版：不输关键词时只列「已接入 + 重点高校」，本科排在专科前面', () => {
  const browse = all.filter((s) => s.status === 'active' || s.featured).sort(schoolSort);
  assert.equal(browse.length, index.counts.featured, '默认浏览列表 = 已接入 + 重点（双一流 ∪ 人工挑选）');
  assert.equal(browse[0].id, 'uestc', '已接入的排第一');
  assert.ok(browse.every((s) => s.status === 'active' || s.featured));
  // 双一流的学校必须在默认列表里，否则用户会觉得"这么有名的学校怎么找不到"
  const doubleFirst = all.filter((s) => (s.tags ?? []).includes('双一流'));
  assert.ok(doubleFirst.length >= 140, `双一流只有 ${doubleFirst.length} 所，标签像是丢了`);
  assert.ok(doubleFirst.every((s) => s.featured), '双一流学校都该在默认浏览列表里');

  const zhejiang = search('浙江');
  const levels = zhejiang.map((s) => s.level);
  const firstBachelor = levels.indexOf('本科');
  const firstVocational = levels.indexOf('专科');
  assert.ok(firstBachelor >= 0 && firstVocational >= 0, '浙江应该同时有本科与专科');
  assert.ok(firstBachelor < firstVocational, '本科要排在专科前面');
});
