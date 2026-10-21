import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { loadConfig } from '../src/core/config.ts';
import { htmlListAdapter } from '../src/adapters/html-list.ts';
import { appendHistory, emptyHistory } from '../src/core/history.ts';
import { buildDigest, renderDigestMarkdown, renderDigestText, rollingRange } from '../src/core/digest.ts';
import type { Notice } from '../src/types.ts';

/**
 * 源级分类（`category`）：配置里显式声明、与站点自带 `tag` 分开。
 *
 * 为什么要这个字段：郑大这类学校一个部门一个栏目，光靠 `sourceName`（「研究生院·公告」）
 * 在日报里堆一长串，读者分不清哪条是教务、哪条是研究生、哪条跟学生无关。
 * `category` 就是给推送/日报加一个稳定的前缀（`[教务]`），不随栏目改版而变。
 *
 * 这里钉死四件事：配置能读出来、适配器能带出去、渲染能显出来、老归档没这个字段也别崩。
 */

const notice = (over: Partial<Notice>): Notice => ({
  id: 'id1',
  sourceId: 'gs-gg',
  sourceName: '研究生院·公告',
  school: 'zzu',
  title: '关于开题的通知',
  url: 'https://gs.zzu.edu.cn/info/1071/1.htm',
  date: '2026-10-21',
  tag: null,
  ...over,
});

function historyWith(rows: { id: string; at: string; over?: Partial<Notice> }[]) {
  const history = emptyHistory();
  for (const row of rows) {
    appendHistory(history, [notice({ id: row.id, ...(row.over ?? {}) })], { at: row.at });
  }
  return history;
}

test('category：郑州大学预设里每个源都标了分类', () => {
  const cfg = loadConfig(path.join('config', 'schools', 'zzu.yaml'));
  assert.ok(cfg.sources.length >= 5, `郑大应有 5 个以上源，实际 ${cfg.sources.length}`);
  for (const s of cfg.sources) {
    assert.ok(s.category, `源「${s.name}」（${s.id}）没写 category`);
  }
  // 分类要收敛成少数几个，别每个源一个分类（那样等于没分类）
  const cats = new Set(cfg.sources.map((s) => s.category));
  assert.ok(cats.size <= 4, `分类过多（${[...cats].join('、')}），应归并到 4 类以内`);
  assert.ok(cats.has('教务'), '教务类缺失');
  assert.ok(cats.has('研究生'), '研究生类缺失');
});

test('category：html-list 适配器把源的分类带进条目', () => {
  const html = `
    <ul class="list">
      <li><h3>关于2026年微专业招生报名的通知</h3><span>2026-10-19</span><a href="/info/1.htm">x</a></li>
    </ul>`;
  const items = htmlListAdapter.parse({
    source: {
      id: 'jwc-tzgg',
      name: '教务部·通知公告',
      url: 'https://www5.zzu.edu.cn/jwc/index/tzgg.htm',
      adapter: 'html-list',
      category: '教务',
      selectors: { item: '.list li', title: 'h3', link: 'a@href', date: 'span' },
    },
    school: 'zzu',
    html,
  } as never);
  assert.equal(items.length, 1);
  assert.equal(items[0].category, '教务');
});

test('category：没写分类时是 null，不会把 undefined 漏进归档', () => {
  const html = `<ul><li><a href="/1.htm">关于考试的通知</a><span>2026-10-20</span></li></ul>`;
  const items = htmlListAdapter.parse({
    source: {
      id: 'plain',
      name: '无分类源',
      url: 'https://x.edu.cn/',
      adapter: 'html-list',
      selectors: { item: 'li', title: 'a', link: 'a@href', date: 'span' },
    },
    school: 'zzu',
    html,
  } as never);
  assert.equal(items.length, 1);
  assert.equal(items[0].category, null);
});

test('category：日报按分类加前缀，Markdown 与纯文本一致', () => {
  const history = historyWith([
    { id: 'a1', at: '2026-10-20T02:00:00.000Z', over: { category: '研究生', id: 'a1' } },
  ]);
  const digest = buildDigest(history, rollingRange(48, new Date('2026-10-21T02:00:00Z')));

  const md = renderDigestMarkdown(digest);
  assert.match(md, /## \[研究生\] 研究生院·公告（1 条）/, `Markdown 标题应带分类前缀：\n${md}`);

  const text = renderDigestText(digest);
  assert.match(text, /【研究生·研究生院·公告】1 条/, `纯文本标题应带分类前缀：\n${text}`);
});

test('category：老归档没有该字段，渲染照旧不带前缀', () => {
  // 模拟 category 引入之前写进去的历史条目（JSON 里根本没这个键）
  const history = historyWith([{ id: 'b1', at: '2026-10-20T02:00:00.000Z' }]);
  for (const it of history.items) delete (it as { category?: unknown }).category;
  const digest = buildDigest(history, rollingRange(48, new Date('2026-10-21T02:00:00Z')));

  const md = renderDigestMarkdown(digest);
  assert.match(md, /## 研究生院·公告（1 条）/, `无分类时不应出现空方括号：\n${md}`);
  assert.doesNotMatch(md, /## \[/);
  assert.match(renderDigestText(digest), /【研究生院·公告】1 条/);
});
