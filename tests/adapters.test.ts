import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { htmlListAdapter } from '../src/adapters/html-list.ts';
import { jwcAdapter } from '../src/adapters/uestc/jwc.ts';
import { grAdapter } from '../src/adapters/uestc/gr.ts';
import type { SourceConfig } from '../src/core/config.ts';

/**
 * 这些测试跑在**真实页面的快照**上（tests/fixtures/），不碰网络。
 * 网站改版时：先 npm run capture uestc 重抓，再 npm test，
 * 如果这里红了，说明是解析逻辑要改，而不是"网络抽风"，定位成本从半天降到一分钟。
 */

const fixture = (name: string) => fs.readFileSync(path.join('tests', 'fixtures', 'uestc', name), 'utf8');
const swufeFixture = (name: string) => fs.readFileSync(path.join('tests', 'fixtures', 'swufe', name), 'utf8');

const source = (over: Partial<SourceConfig>): SourceConfig =>
  ({ id: 'test', name: '测试源', url: 'https://example.edu.cn/list.htm', adapter: 'html-list', enabled: true, include: [], exclude: [], ...over }) as SourceConfig;

test('教务处适配器：从真实快照解析出带日期和详情链接的通知', () => {
  const html = fixture('jwc-student.html');
  const items = jwcAdapter.parse({ source: source({ id: 'jwc-student', adapter: 'uestc/jwc' }), school: 'uestc', html });

  assert.ok(items.length >= 5, `条目太少：${items.length}`);
  assert.ok(
    items.every((n) => n.title.length > 0 && n.url.startsWith('https://www.jwc.uestc.edu.cn/info/')),
    '每条都该有标题和 /info/ 详情链接',
  );
  assert.ok(items.some((n) => n.date !== null), '至少有一条解析出日期');
  assert.ok(
    items.every((n) => n.date === null || /^\d{4}-\d{2}-\d{2}$/.test(n.date)),
    '日期必须是 ISO 格式',
  );
  assert.ok(items.some((n) => n.tag !== null), '至少有一条带【分类】标签');
  // 同一次解析里不该出现重复 ID，否则去重会失效
  assert.equal(new Set(items.map((n) => n.id)).size, items.length, 'ID 必须唯一');
});

test('教务处适配器：ID 稳定（同一页面解析两次结果一致）', () => {
  const html = fixture('jwc-student.html');
  const ctx = { source: source({ id: 'jwc-student', adapter: 'uestc/jwc' }), school: 'uestc', html };
  const a = jwcAdapter.parse(ctx).map((n) => n.id);
  const b = jwcAdapter.parse(ctx).map((n) => n.id);
  assert.deepEqual(a, b);
});

test('通用 html-list 适配器：新闻网的配置能解析出条目', () => {
  const html = fixture('news-notice.html');
  const items = htmlListAdapter.parse({
    school: 'uestc',
    html,
    source: source({
      id: 'news-notice',
      name: '新闻网·公告',
      baseUrl: 'https://news.uestc.edu.cn',
      selectors: {
        item: 'div.notice_item',
        title: 'a.title',
        link: 'a.title@href',
        date: 'span.date',
        tag: 'span.category',
      },
    }),
  });

  assert.ok(items.length >= 3, `条目太少：${items.length}`);
  assert.ok(
    items.every((n) => n.url.startsWith('https://news.uestc.edu.cn/')),
    '相对链接必须被 baseUrl 补全',
  );
  assert.ok(items.some((n) => n.date !== null), '至少有一条解析出日期');
  assert.ok(
    items.some((n) => n.tag === '学术' || n.tag === '公告'),
    `分类标签要去掉汉字间的排版空格，实际拿到：${items.map((n) => n.tag).join('/')}`,
  );
});

test('通用 html-list 适配器：选择器语法 `a@attr` 与纯文本都支持', () => {
  const html = `<ul><li><a href="/a.htm" title="属性标题">正文标题</a><span class="d">2026-09-02</span></li></ul>`;
  const items = htmlListAdapter.parse({
    school: 'x',
    html,
    source: source({
      baseUrl: 'https://x.edu.cn',
      selectors: { item: 'li', title: 'a@title', link: 'a@href', date: 'span.d' },
    }),
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, '属性标题');
  assert.equal(items[0].url, 'https://x.edu.cn/a.htm');
  assert.equal(items[0].date, '2026-09-02');
});

test('通用 html-list：西南财经大学教务处列表页（全国名单里新接入的学校）', () => {
  const html = swufeFixture('jwc-tzgg.html');
  const items = htmlListAdapter.parse({
    school: 'swufe',
    html,
    source: source({
      id: 'jwc-tzgg',
      name: '教务处·通知公告',
      baseUrl: 'https://jwc.swufe.edu.cn/tzgg/60.htm',
      selectors: { item: 'ul li', title: 'a@title', link: 'a@href', date: 'span' },
    }),
  });

  assert.ok(items.length >= 5, `条目太少：${items.length}`);
  assert.ok(
    items.every((n) => n.url.startsWith('https://jwc.swufe.edu.cn/')),
    `相对链接必须被 baseUrl 补全：${items.slice(0, 2).map((n) => n.url).join(', ')}`,
  );
  assert.ok(items.every((n) => n.date === null || /^\d{4}-\d{2}-\d{2}$/.test(n.date)), '日期要归一成 ISO');
  assert.ok(items.some((n) => n.date !== null), '至少有一条解析出日期（原始形如 [2026年06月05日]）');
  assert.ok(items.every((n) => n.title.length >= 6), '标题不该是导航项那种短文本');
  // 列表页把标题写成「...」截断的站点不能直接接：关键词分级与标题展示都会失真
  assert.ok(items.every((n) => !/(\.\.\.|…)\s*$/.test(n.title)), '标题不该以 ... 结尾');
  assert.equal(new Set(items.map((n) => n.id)).size, items.length, 'ID 必须唯一');
});

test('研究生院适配器：只认详情页链接，避免把导航项当成通知', () => {
  const html = fixture('gr-notice.html');
  const items = grAdapter.parse({ source: source({ id: 'gr-notice', adapter: 'uestc/gr' }), school: 'uestc', html });

  assert.ok(items.length >= 3, `条目太少：${items.length}`);
  assert.ok(
    items.every((n) => /^https:\/\/gr\.uestc\.edu\.cn\/[a-z]+\/\d+\/\d+$/.test(n.url)),
    '每条都该是 /栏目/分类/ID 形式的详情链接',
  );
  assert.equal(new Set(items.map((n) => n.url)).size, items.length, '同一页里链接不该重复');
});

test('数学科学学院：渲染后的真实 DOM 能解析出带日期和详情链接的通知', () => {
  // 这个 fixture 是用真浏览器（可见窗口）渲染后保存的 —— 学院站点拦无头浏览器，
  // 所以它的快照只能这样抓，见 README「合规与边界」。
  const html = fixture('math-jwgg.html');
  const items = htmlListAdapter.parse({
    school: 'uestc',
    html,
    source: source({
      id: 'math-jwgg',
      name: '数学科学学院·教务公告',
      baseUrl: 'https://www.math.uestc.edu.cn/tzgg1/jwgg.htm',
      selectors: { item: 'div.ArticleList table tr', title: 'td.fw_t a@title', link: 'td.fw_t a@href', date: 'td.fw_s' },
    }),
  });

  assert.ok(items.length >= 8, `条目太少：${items.length}`);
  // ../info/1043/10200.htm 这种相对链接必须按页面地址解析成绝对链接
  assert.ok(
    items.every((n) => n.url.startsWith('https://www.math.uestc.edu.cn/info/')),
    `链接解析错误：${items.slice(0, 2).map((n) => n.url).join(', ')}`,
  );
  assert.ok(
    items.every((n) => n.date === null || /^\d{4}-\d{2}-\d{2}$/.test(n.date)),
    '日期必须被归一成 ISO 格式（原始形如 [2026-09-03 09:23:37]）',
  );
  assert.ok(items.some((n) => n.date !== null), '至少有一条解析出日期');
  assert.ok(items.some((n) => n.title.includes('推免')), '应包含推免相关通知');
  assert.equal(new Set(items.map((n) => n.id)).size, items.length, 'ID 必须唯一');
});
