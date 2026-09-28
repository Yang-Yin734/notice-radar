import { load } from 'cheerio';
import type { Adapter, AdapterContext } from '../index.ts';
import { makeId, normalizeTitle, parseDateLoose } from '../../core/normalize.ts';
import type { Notice } from '../../types.ts';

/**
 * 电子科技大学教务处专属适配器。
 *
 * 为什么需要专属适配器（而不是 html-list）：
 * 它的列表项 `<a href="#" newsId="<32位哈希>" title="...">【教管】标题</a>` ，
 * 链接不是 href，而是靠 JS 拼 `/info/<newsId>`；分类标签混在锚文本的【】里。
 * 这类"结构不走寻常路"的站点，就是专属适配器的用武之地。
 *
 * 验证过的真实页面（见 tests/fixtures/uestc/jwc-student.html）：
 *   <div class=" textAreo clearfix">
 *     <span><a href="#" newsId="..." title="关于...的通知">【教管】关于...的通知</a></span>
 *     <i>2026/09/02</i>
 *   </div>
 */
const DETAIL_BASE = 'https://www.jwc.uestc.edu.cn/info/';

export const jwcAdapter: Adapter = {
  name: 'uestc/jwc',
  parse({ source, school, html }: AdapterContext): Notice[] {
    const $ = load(html);
    const out: Notice[] = [];
    const seen = new Set<string>();

    $('div.textAreo.clearfix').each((_, el) => {
      const anchor = $(el).find('a').first();
      const anchorText = normalizeTitle(anchor.text());
      const title = normalizeTitle(anchor.attr('title') ?? anchorText);
      if (!title) return;

      const newsId = anchor.attr('newsid') ?? anchor.attr('newsId') ?? '';
      const url = newsId ? `${DETAIL_BASE}${newsId}` : source.url;
      const date = parseDateLoose($(el).find('i').first().text());
      const tag = /^【(.+?)】/.exec(anchorText)?.[1] ?? null;

      const id = makeId(source.id, title, date);
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, sourceId: source.id, sourceName: source.name, school, title, url, date, tag });
    });

    return out;
  },
};
