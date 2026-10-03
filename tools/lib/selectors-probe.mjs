// 列表页选择器探测：给一个列表页 URL，试几组常见容器/选择器，返回最优组合。
// 被 tools/try-selectors.mjs 与 tools/probe-school.mjs 共用。
import { load } from 'cheerio';

const CONTAINERS = [
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

/** 抓一个列表页并推断最优选择器；网络/结构问题都不抛错，返回 note 说明原因。 */
export async function probeListPage(url, { timeoutMs = 15000 } = {}) {
  let res;
  let buf;
  try {
    res = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (notice-radar probe)', accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return { url, status: 0, bytes: 0, best: null, note: `抓取失败：${e.message}` };
  }

  let html = buf.toString('utf8');
  if (/charset=["']?(gb2312|gbk)/i.test(html.slice(0, 2000))) html = new TextDecoder('gbk').decode(buf);
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
      const titles = nodes.toArray().map((el) => textOf($(el), t));
      const good = titles.filter((x) => /[\u4e00-\u9fa5]{6,}/.test(x));
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
        const dates = nodes.toArray().map((el) => textOf($(el), d));
        const dateHits = dates.filter((x) => /\d{1,4}[-/.月]\d{1,2}/.test(x)).length;
        // 打分要点（踩过的坑）：
        //   · **日期覆盖率**最重要 —— 导航菜单/侧栏热点没有日期，覆盖率高的才是真列表
        //   · 光看条目数会把"主列表 + 导航"一起选中（西电就是这样：裸 ul li 30 条，其中 11 条是菜单）
        //   · 标题像不像通知（上面那层）；带类名的具体容器加分；标题被 ... 截断的重罚
        const ratio = good.length ? dateHits / good.length : 0;
        const score =
          Math.round(ratio * 40) + Math.round(like * 30) + Math.min(dateHits, 20) + Math.min(good.length, 15) +
          (specific(c) ? 5 : 0) - truncated * 6;
        const cand = {
          item: `${c} / ${t} / ${d}`, count: good.length, truncated, dateHits,
          noticeLike: like, medLen, ratio, score, titles: good, dates,
        };
        all.push(cand); // 调试用：接受的组合也记下来
        if (!best || score > best.score) {
          best = { item: c, title: t, date: d, count: good.length, truncated, dateHits, noticeLike: like, titles: good, dates, score, ratio };
        }
      }
    }
  }

  let note = '';
  if (!best) note = '没找到可用的选择器组合（可能整页 JS 渲染，或这页根本不是通知列表）';
  else if (best.truncated > 0) note = '标题带 ...（截断）：直接接会让关键词分级失效，先别接';
  else if (best.dateHits === 0) note = '日期一条都没命中：日期可能在详情页，配置里就别写 date';
  else if (best.noticeLike < 0.6) {
    note = `只有 ${Math.round(best.noticeLike * 100)}% 的标题像通知 —— 可能选错了栏目，接入前先看内容`;
  }

  return { url, status: res.status, bytes: buf.length, best, note, html, all };
}

/** 从首页里挑出可能是"通知公告列表页"的入口。 */
export function findListCandidates(html, baseUrl, baseOrigin, limit = 6) {
  const $ = load(html);
  const out = [];
  const seen = new Set();
  $('a').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
    const looksText = /通知|公告|公示|更多|more|list/i.test(text) || text.length <= 12;
    const looksHref = /(tzgg|notice|gonggao|announce|news|list|index\/tzgg|ggtz|tzgg1)/i.test(href);
    if (!(/通知|公告|公示|更多/.test(text) || looksHref) || !looksText) return;
    let abs;
    try {
      abs = new URL(href, baseUrl).href;
    } catch {
      return;
    }
    // 只留在同一站点、且像是列表页的（排除详情页 /info/123.htm 这种纯数字页）
    if (!abs.startsWith(baseOrigin)) return;
    if (/\/info\/\d|\/\d{4}\/\d{2}\//.test(abs)) return;
    if (seen.has(abs)) return;
    seen.add(abs);
    out.push({ text: text.slice(0, 20), url: abs });
    return out.length >= limit;
  });
  return out;
}

/** 生成可以直接粘进 config/schools/*.yaml 的源配置片段。 */
export function suggestYaml({ id, name, url, best }) {
  return [
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
    `      date: ${best.date}`,
  ].join('\n');
}
