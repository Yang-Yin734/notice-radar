import { load } from 'cheerio';
import type { Adapter, AdapterContext } from '../index.ts';
import { makeId, normalizeTitle, parseDateLoose } from '../../core/normalize.ts';
import type { Notice } from '../../types.ts';

/**
 * 电子科技大学研究生院专属适配器。
 *
 * 特点：列表页只给标题 + 站内相对链接（`/tongzhi/133/14381`），日期要进详情页才有，
 * 所以这里 date 允许为 null —— 宁可没有日期，也不发一次多余的请求。
 * 另外该站点带 JS 挑战型 WAF（瑞数类），偶发抓不到属正常，已在配置里标注 reliability。
 */
const BASE = 'https://gr.uestc.edu.cn';
const DETAIL_PATH = /^\/(tongzhi|jiaoxue|xuewei|xuesheng|zhuanye|peiyang)\/\d+\/\d+\/?$/;

export const grAdapter: Adapter = {
  name: 'uestc/gr',
  parse({ source, school, html }: AdapterContext): Notice[] {
    const $ = load(html);
    const out: Notice[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') ?? '').trim();
      if (!DETAIL_PATH.test(href)) return;

      const title = normalizeTitle($(el).text());
      if (title.length < 6) return;

      const url = `${BASE}${href}`;
      if (seen.has(url)) return;
      seen.add(url);

      // 列表页没有日期字段时，尝试从同一行的文本里碰运气
      const rowText = normalizeTitle($(el).parent().text());
      const date = parseDateLoose(rowText);

      out.push({
        id: makeId(source.id, title, date),
        sourceId: source.id,
        sourceName: source.name,
        school,
        title,
        url,
        date,
        tag: null,
      });
    });

    return out;
  },
};
