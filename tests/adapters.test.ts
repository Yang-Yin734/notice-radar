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

/**
 * 全国名单扩到 3167 所之后陆续接入的学校的公共断言。
 *
 * 这些站点的列表页模板各不相同（有的把正文摘要塞进 `a`、有的标题被 `...` 截断、
 * 有的日期只在 `time@datetime` 里），所以每条都钉住四件事：
 * 标题完整（不被截断、不是导航项）、链接能补全、日期是 ISO、ID 唯一。
 */
function checkListFixture(
  school: string,
  file: string,
  over: Partial<SourceConfig>,
  opts: { min: number; urlOk: RegExp; maxTruncated?: number; allowNoDates?: boolean },
) {
  const html = fs.readFileSync(path.join('tests', 'fixtures', school, file), 'utf8');
  const items = htmlListAdapter.parse({
    school,
    html,
    source: source({ id: `${school}-src`, name: '测试源', ...over }),
  });

  assert.ok(items.length >= opts.min, `${school} 条目太少：${items.length}`);
  assert.ok(
    items.every((n) => opts.urlOk.test(n.url)),
    `${school} 链接不对：${items.slice(0, 2).map((n) => n.url).join(', ')}`,
  );
  // 列表页没有日期是正常情况（日期在详情页），配置里就不写 date —— 这类用 allowNoDates 说明
  if (!opts.allowNoDates) assert.ok(items.some((n) => n.date !== null), `${school} 一条日期都没解析出来`);
  assert.ok(
    items.every((n) => n.date === null || /^\d{4}-\d{2}-\d{2}$/.test(n.date)),
    `${school} 日期没归一成 ISO`,
  );
  assert.ok(items.every((n) => n.title.length >= 6), `${school} 有标题像导航项（太短）`);
  // 少数站点自己对超长标题截断（HUST 实测 20 条里 1 条），这种照原样收、不猜全文；
  // 但如果大面积截断（模板换了），这里必须红 —— 截断标题会让关键词分级失效。
  const truncated = items.filter((n) => /(\.\.\.|…)\s*$/.test(n.title));
  const allowed = Math.floor(items.length * (opts.maxTruncated ?? 0));
  assert.ok(
    truncated.length <= allowed,
    `${school} 被截断的标题太多（${truncated.length}/${items.length}）：${truncated[0]?.title.slice(0, 60)}`,
  );
  assert.equal(new Set(items.map((n) => n.id)).size, items.length, `${school} 的 ID 必须唯一`);
  return items;
}

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
  const html = fs.readFileSync(path.join('tests', 'fixtures', 'swufe', 'jwc-tzgg.html'), 'utf8');
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

test('通用 html-list：西安电子科技大学（别把左侧导航当通知）', () => {
  // 这页有两条列表：主列表 13 条（完整标题 + 日期），左侧导航/热点 20+ 条（没日期）。
  // 用裸 `ul li` 会把导航项一起抓进来（实测过），所以配置里写 `.list li` 并且标题取 a@title。
  checkListFixture(
    'xidian',
    'jwc-tzgg.html',
    {
      id: 'jwc-tzgg',
      baseUrl: 'https://jwc.xidian.edu.cn/tzgg.htm',
      selectors: { item: '.list li', title: 'a@title', link: 'a@href', date: 'span' },
    },
    { min: 8, urlOk: /^https:\/\/jwc\.xidian\.edu\.cn\// },
  );
});

test('通用 html-list：华中科技大学（标题取 h2，不能取 a 的文本）', () => {
  // 这页的 <a> 里除了 <h2> 标题还塞了一个隐藏的正文摘要 div.zhai；
  // 取 a 的文本会把摘要一起当标题（实测标题长到 100+ 字），所以标题必须取 h2。
  const items = (() => {
    const html = fs.readFileSync(path.join('tests', 'fixtures', 'hust', 'ugs-tzgg.html'), 'utf8');
    return htmlListAdapter.parse({
      school: 'hust',
      html,
      source: source({
        id: 'ugs-tzgg',
        baseUrl: 'https://ugs.hust.edu.cn/tzgg.htm',
        selectors: { item: '.list li', title: 'h2', link: 'a@href', date: 'span.fr' },
      }),
    });
  })();
  checkListFixture(
    'hust',
    'ugs-tzgg.html',
    {
      id: 'ugs-tzgg',
      baseUrl: 'https://ugs.hust.edu.cn/tzgg.htm',
      selectors: { item: '.list li', title: 'h2', link: 'a@href', date: 'span.fr' },
    },
    // HUST 的列表页自己会对超长标题截断（实测 20 条里 1 条），给它 15% 的容忍度
    { min: 8, urlOk: /^https:\/\/ugs\.hust\.edu\.cn\//, maxTruncated: 0.15 },
  );
  assert.ok(
    items.every((n) => n.title.length <= 60),
    `标题不该带正文摘要：${items[0]?.title.slice(0, 80)}`,
  );
});

test('通用 html-list：中山大学（日期在 time@datetime 属性里）', () => {
  checkListFixture(
    'sysu',
    'jwb-tzgg.html',
    {
      id: 'jwb-tzgg',
      baseUrl: 'https://jwb.sysu.edu.cn/taxonomy/term/105',
      selectors: { item: 'div.newslists', title: '.title a', link: 'a@href', date: 'time@datetime', tag: 'div.tags' },
    },
    // 通知多以公众号文章发布（mp.weixin.qq.com），也有站内详情页 —— 两种都接受
    { min: 8, urlOk: /^https:\/\/(mp\.weixin\.qq\.com|jwb\.sysu\.edu\.cn)\// },
  );
});

test('通用 html-list：天津大学（标题在 h2 里）', () => {
  // 这条同时钉住工具侧的一个坑：选择器探测器一开始只试了 h3、漏了 h2，
  // 于是这页被误判成"导航列表"（拿到的标题是"教学技能提升""教学组织机构"）。补上 h2 才识别对。
  checkListFixture(
    'tju',
    'oaa-tzgg.html',
    {
      id: 'oaa-tzgg',
      baseUrl: 'https://oaa.tju.edu.cn/bszy/tzgg.htm',
      selectors: { item: 'ul li', title: 'h2', link: 'a@href', date: 'span' },
    },
    { min: 8, urlOk: /^https:\/\/(mp\.weixin\.qq\.com|oaa\.tju\.edu\.cn)\// },
  );
});

test('通用 html-list：江南大学（标题取 a@title）', () => {
  checkListFixture(
    'jiangnan',
    'jwc-tzgg.html',
    {
      id: 'jwc-tzgg',
      baseUrl: 'https://jwc.jiangnan.edu.cn/jwgl/tzgg.htm',
      selectors: { item: '.main-list li', title: 'a@title', link: 'a@href', date: 'span' },
    },
    { min: 8, urlOk: /^https:\/\/jwc\.jiangnan\.edu\.cn\// },
  );
});

test('通用 html-list：西安交通大学（栏目页 jxtz2）', () => {
  const items = checkListFixture(
    'xjtu',
    'jwc-jxtz.html',
    {
      id: 'jwc-jxtz',
      baseUrl: 'https://jwc.xjtu.edu.cn/jxxx/jxtz2.htm',
      selectors: { item: '.list li', title: 'a', link: 'a@href', date: 'span' },
    },
    { min: 5, urlOk: /^https:\/\/jwc\.xjtu\.edu\.cn\// },
  );
  // 这页的标题带 [培养方案]/[考试安排] 这类前缀，是站点自己的分类，保留原样
  assert.ok(
    items.some((n) => /^\[[^\]]+\]/.test(n.title)),
    `标题里的栏目前缀应保留：${items[0]?.title.slice(0, 40)}`,
  );
});

test('通用 html-list：西北工业大学（教务部通知公告）', () => {
  checkListFixture(
    'nwpu',
    'jiaowu-tzgg.html',
    {
      id: 'jiaowu-tzgg',
      baseUrl: 'https://jiaowu.nwpu.edu.cn/jxxx1/tzgg.htm',
      selectors: { item: '.list li', title: 'a', link: 'a@href', date: 'span' },
    },
    { min: 8, urlOk: /^https:\/\/jiaowu\.nwpu\.edu\.cn\// },
  );
});

test('通用 html-list：南京大学（容器必须够精确，否则侧栏快捷入口会被当通知）', () => {
  const items = checkListFixture(
    'nju',
    'jw-ggtz.html',
    {
      id: 'jw-ggtz',
      baseUrl: 'https://jw.nju.edu.cn/ggtz/list.htm',
      selectors: { item: '.news_list li', title: '.news_title a@title', link: 'a@href', date: '.news_meta' },
    },
    { min: 8, urlOk: /^https?:\/\/jw\.nju\.edu\.cn\// },
  );
  // 用宽松的 `.list li` 会捞到侧栏"快捷入口"（拔尖计划/创新网站/创业教育）——
  // 这些不是通知，而且会让"这页有没有日期"判断出错（日期其实在 span.news_meta 里）。
  assert.ok(
    items.every((n) => !/^(拔尖计划|创新网站|创业教育)$/.test(n.title)),
    `不该出现侧栏快捷入口：${items.map((n) => n.title).filter((t) => t.length <= 5).join(', ')}`,
  );
  // 标题以【补采】【学生】【2026级新生】这类方括号前缀开头是站点自己的分类，保留原样
  assert.ok(items.some((n) => /^【[^】]+】/.test(n.title)), '标题里的方括号前缀应保留');
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
