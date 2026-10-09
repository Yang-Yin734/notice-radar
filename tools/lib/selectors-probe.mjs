// 列表页选择器探测：给一个列表页 URL，试几组常见容器/选择器，返回最优组合。
// 被 tools/try-selectors.mjs、tools/probe-school.mjs、tools/probe-batch.mjs 共用。
//
// 抓取**复用生产抓取层**（src/core/fetch.ts）：同样的 UA、同样的 IPv4 优先、同样的超时与重试。
// 一开始这里用的是裸 fetch，结果一批学校（西北工业、武汉理工、中南、中科大、山大…）在本地
// 全是 "fetch failed"，而生产链路抓得到 —— 探测工具的结论必须和生产一致，否则就是白筛。
import { load } from 'cheerio';
import { fetchHtml } from '../../src/core/fetch.ts';

const CONTAINERS = [
  // 博达（Boda）CMS 是高校用得最多的一套：标准列表容器是 `.news_list li` / `.news_list li`（**下划线**）。
  // 一开始只写了连字符的 `.news-list`，于是博达站（南京大学、同济…）全都"试不出选择器"。
  'ul.news_list li', '.news_list li', '.news_list_box li', '.newslist li', 'ul.newslist li',
  'ul.news-list li', '.news-list li', '.list li', '.tz-list li', '.list-item', '.news_item',
  'div.list ul li', '.list ul li', 'ul.list li', '.list_box ul li', '.listbox ul li',
  'ul li', '.article-list li', 'table tr', '.wp_article_list li', '.list_main li', '.item', 'div.item',
  '.news li', '.notice-list li', '.main-list li', '.list_box li', '.listbox li',
];
const TITLES = [
  'a@title', 'a', 'p', 'h2 a@title', 'h2', 'h3 a@title', 'h3', 'h4 a@title', 'h4',
  'span.title', '.title a@title', '.title a', '.tit a', '.bt a@title', 'td a@title', 'td a', '.text p',
];
const DATES = ['span.date', '.date', 'td:last-child', '.time', 'span', 'em', '.date span', '.rq', 'i'];

/** 选择器是不是"带类名的具体容器"（裸 `ul li` / `table tr` 容易把导航也捞进来） */
const specific = (sel) => /[.#][\w-]/.test(sel);

/**
 * 标题像不像"通知"。
 *
 * 为什么必须有这一层：光看"标题数 + 日期数"会把**导航菜单**（"教学技能提升""教学组织机构"）
 * 和**学院新闻**（"…团队荣获…一等奖"）也当成通知列表 —— 天津大学、东南大学、武汉大学
 * 三所都被这样误判过。接错的后果是应用里出现一堆根本不是通知的"通知"。
 */
const NOTICE_WORDS =
  /通知|公告|公示|报名|选拔|评审|认定|名单|申报|立项|安排|事宜|申请|选课|退课|补选|重修|考试|缓考|补考|答辩|毕业|学位|奖学金|助学金|评优|成绩|学籍|培养|课程|实习|实践|讲座|招生|调剂|录取|报到|注册|缴费|评教|调课|放假|选导师|开题|中期|结题/;
const noticeRatio = (titles) => (titles.length ? titles.filter((t) => NOTICE_WORDS.test(t)).length / titles.length : 0);

/** 标题长度中位数：通知标题一般 12 字以上，导航项大多 4–8 字 */
const medianLen = (titles) => {
  const sorted = [...titles].sort((a, b) => a.length - b.length);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)].length : 0;
};

function textOf($el, sel) {
  if (sel.endsWith('@title')) return ($el.find(sel.slice(0, -6)).attr('title') ?? '').trim();
  return $el.find(sel).first().text().replace(/\s+/g, ' ').trim();
}

/** 条目里第一个链接的绝对地址（用来判断"日期是不是藏在链接里"） */
function resolveHref($el, base) {
  const href = ($el.find('a[href]').first().attr('href') ?? '').trim();
  if (!href) return '';
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

/** 链接里带日期的比例（博达等 CMS 的地址形如 /2026/0930/xxx/page.htm） */
const URL_DATE_RE = /\/(\d{4})\/(\d{2})(\d{2})(?:\/|$)/;
const urlDateRatio = (hrefs) => (hrefs.length ? hrefs.filter((h) => URL_DATE_RE.test(h)).length / hrefs.length : 0);

/** 抓一个列表页并推断最优选择器；网络/结构问题都不抛错，返回 note 说明原因。 */
export async function probeListPage(url, { timeoutMs = 30000 } = {}) {
  let res;
  try {
    // 用生产抓取层：IPv4 优先 + 与线上一致的重试（详见文件头注释）
    res = await fetchHtml(url, { timeoutMs, retries: 1 });
  } catch (e) {
    return { url, status: 0, bytes: 0, best: null, note: `抓取失败：${e.message}` };
  }
  // 拿到 HTML 之后的推断逻辑与"HTML 怎么来的"无关 —— 抽成 analyzeListHtml，
  // 好让需要真浏览器的站点（瑞数类 WAF，普通 fetch 只回 202）复用同一套打分与判据。
  return { url, status: res.status, bytes: res.bytes, html: res.html, ...analyzeListHtml(res.html, url) };
}

/**
 * 纯函数：给一段已经拿到的列表页 HTML + 它的地址，推断最优选择器组合。
 * 返回 { best, note, all }——字段含义见 probeListPage 的文件头注释。
 */
export function analyzeListHtml(html, url) {
  const $ = load(html);

  let best = null;
  const all = []; // 调试用：连被拒的候选一起记下来
  for (const c of CONTAINERS) {
    const nodes = $(c);
    if (nodes.length < 3) {
      all.push({ item: c, reason: `节点太少（${nodes.length}）` });
      continue;
    }
    // 通知列表条目基本都带链接：没有 <a href> 的容器多半是导航或日期块
    const withLink = nodes.toArray().filter((el) => $(el).find('a[href]').length > 0).length;
    if (withLink < nodes.length * 0.5) {
      all.push({ item: c, reason: `带链接的条目太少（${withLink}/${nodes.length}）` });
      continue;
    }
    for (const t of TITLES) {
      const rows = nodes.toArray().map((el) => ({ title: textOf($(el), t) }));
      const good = rows.map((r) => r.title).filter((x) => /[\u4e00-\u9fa5]{6,}/.test(x));
      if (good.length < 3) continue;
      const truncated = good.filter((x) => /(\.\.\.|…)/.test(x)).length;
      // 标题得**像通知**：导航项（"教学组织机构"）和学院新闻（"…团队荣获…"）都不像。
      // 阈值必须够高（0.55）：导航菜单里往往就有一项叫"通知公告"，低了会被它蒙混过关。
      const like = noticeRatio(good);
      const medLen = medianLen(good);
      if (like < 0.55 || medLen < 10) {
        all.push({ item: `${c} / ${t}`, count: good.length, like, medLen, reason: `标题不像通知（像通知率 ${(like * 100).toFixed(0)}%，中位长度 ${medLen}）` });
        continue;
      }
      for (const d of DATES) {
        // 标题与日期**成对**收集：只用"标题通过筛选"的节点，避免预览时日期错位
        // （曾出现"日期命中 20 条"但预览里日期全空 —— 就是拿未过滤数组硬对齐造成的）
        const cleaned = rows
          .map((r, i) => ({
            title: r.title,
            dateText: textOf($(nodes.toArray()[i]), d),
            href: resolveHref($(nodes.toArray()[i]), url),
          }))
          .filter((r) => /[\u4e00-\u9fa5]{6,}/.test(r.title));
        const dateHits = cleaned.filter((r) => /\d{1,4}[-/.月]\d{1,2}/.test(r.dateText)).length;
        const titles = cleaned.map((r) => r.title);
        const dateTexts = cleaned.map((r) => r.dateText);
        const hrefs = cleaned.map((r) => r.href);
        const urlDates = urlDateRatio(hrefs);
        // 打分要点（踩过的坑）：
        //   · **日期覆盖率**最重要 —— 导航菜单/侧栏热点没有日期，覆盖率高的才是真列表
        //   · 光看条目数会把"主列表 + 导航"一起选中（西电就是这样：裸 ul li 30 条，其中 11 条是菜单）
        //   · 标题像不像通知（上面那层）；带类名的具体容器加分；标题被 ... 截断的重罚
        //   · 链接里带 /2026/0930/ 时给点分：说明日期能拿到（只是得从链接里抠）
        const ratio = titles.length ? dateHits / titles.length : 0;
        const score =
          Math.round(ratio * 40) + Math.round(like * 30) + Math.min(dateHits, 20) + Math.min(titles.length, 15) +
          (specific(c) ? 5 : 0) - truncated * 6 + (dateHits === 0 && urlDates > 0.6 ? 8 : 0);
        const cand = {
          item: `${c} / ${t} / ${d}`, count: titles.length, truncated, dateHits,
          noticeLike: like, medLen, ratio, score, titles, dates: dateTexts, urlDates,
        };
        all.push(cand); // 调试用：接受的组合也记下来
        if (!best || score > best.score) {
          best = {
            item: c, title: t, date: d, count: titles.length, truncated, dateHits,
            noticeLike: like, titles, dates: dateTexts, score, ratio, urlDates,
          };
        }
      }
    }
  }

  let note = '';
  if (!best) note = '没找到可用的选择器组合（可能整页 JS 渲染，或这页根本不是通知列表）';
  else if (best.truncated > 0) note = '标题带 ...（截断）：直接接会让关键词分级失效，先别接';
  else if (best.dateHits === 0 && best.urlDates > 0.6) {
    note = '列表页没有日期，但链接里带着日期（/2026/0930/）—— 配置里写 dateFromLink 就能取到';
  } else if (best.dateHits === 0) note = '日期一条都没命中：日期可能在详情页，配置里就别写 date';
  else if (best.noticeLike < 0.6) {
    note = `只有 ${Math.round(best.noticeLike * 100)}% 的标题像通知 —— 可能选错了栏目，接入前先看内容`;
  }

  return { best, note, all };
}

/**
 * 从首页里挑出可能是"通知公告列表页"的入口，**按可信度排序**。
 *
 * 为什么必须排序：一开始是"文档顺序取前 6 个"，结果 8 所候选里 7 所选错了入口
 * （中南选了"图片新闻"、南大选了"机构简介"、同济选了无关栏目）——
 * 首页里"更多/MORE"这种链接满地都是，先撞上哪个全看排版。
 *
 * 评分依据：链接文字是强信号（"通知公告/通知通告/工作通知"比"更多"可信得多），
 * 其次是 href 里的栏目名（tzgg/notice/gonggao），最后排掉详情页。
 */
export function findListCandidates(html, baseUrl, baseOrigin, limit = 6) {
  const $ = load(html);
  const scored = [];
  const seen = new Set();
  $('a').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
    let abs;
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      return;
    }
    if (!abs.startsWith(baseOrigin)) return;
    // 详情页/附件直接排掉（含博达的 c<列>a<文>/page.htm 详情页写法）
    if (/\/info\/\d|content\.jsp|detail-v2\.jsp|\/c\d+a\d+\/page\.htm|\/\d{4}\/\d{2}\/|\.pdf$|\.docx?$/i.test(abs)) return;
    if (seen.has(abs)) return;

    const strongText = /通知公告|通知通告|公告通知|公示公告|工作通知|通知|公告|公示/.test(text);
    const hrefLike = /(tzgg|notice|gonggao|ggtz|announce|tzgg1)/i.test(href);
    const genericMore = /^(更多|more|more\+|查看更多|全部|list)$/i.test(text.replace(/\s/g, ''));
    const listHref = /(list|index|column|category)/i.test(href);
    if (!strongText && !hrefLike && !(genericMore && listHref)) return;

    let score = 0;
    if (strongText) score += 10;
    if (hrefLike) score += 6;
    if (genericMore) score -= 2;
    if (listHref) score += 2;
    // 文字越短越像栏目名（"通知公告"），越长越可能是一句话导语
    if (text.length <= 8) score += 2;
    if (/通知公告|通知通告/.test(href + text)) score += 3;

    seen.add(abs);
    scored.push({ text: text.slice(0, 20), url: abs, score });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ text, url }) => ({ text, url }));
}

/** 生成可以直接粘进 config/schools/*.yaml 的源配置片段。 */
export function suggestYaml({ id, name, url, best }) {
  const lines = [
    `  - id: ${id}`,
    `    name: ${name}`,
    `    url: ${url}`,
    '    adapter: html-list',
    `    baseUrl: ${url}`,
    '    collectOnly: true        # 新接入先只采集，确认抓稳再摘',
    '    selectors:',
    `      item: ${best.item}`,
    `      title: ${best.title}`,
    `      link: a@href`,
  ];
  // 列表页没有日期是常见情况（日期只在详情页）—— 项目本来就支持不写 date 这一行，
  // 这时**别硬套一个选择器**：套错会把标题或正文当成日期。
  if (best.dateHits > 0) lines.push(`      date: ${best.date}`);
  else if (best.urlDates > 0.6) {
    // 博达等 CMS：日期拆成两块显示，但链接里带着 /2026/0930/ —— 从链接取（v0.10.19 起支持）
    lines.push(`      dateFromLink: '/(\\d{4})/(\\d{2})(\\d{2})/'`);
  } else lines.push('      # date: 列表页没有日期（日期在详情页），按项目约定不写这一行');
  return lines.join('\n');
}
