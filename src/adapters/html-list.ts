import { load } from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import type { Adapter, AdapterContext } from './index.ts';
import { makeId, normalizeTitle, parseDateLoose, resolveUrl } from '../core/normalize.ts';
import type { Notice } from '../types.ts';

/**
 * 通用列表页适配器：90% 的学校用这个就够了，选择器写在 YAML 里。
 * 选择器语法：`a` 取文本，`a@title` / `a@href` 取属性。
 */
export function pick($: CheerioAPI, el: unknown, spec: string | undefined): string {
  if (!spec) return '';
  const at = spec.lastIndexOf('@');
  const selector = at > 0 ? spec.slice(0, at) : spec;
  const attr = at > 0 ? spec.slice(at + 1) : '';
  const node = selector ? $(el as never).find(selector).first() : $(el as never);
  if (node.length === 0) return '';
  const value = attr ? (node.attr(attr) ?? '') : node.text();
  return normalizeTitle(value);
}

export const htmlListAdapter: Adapter = {
  name: 'html-list',
  parse({ source, school, html }: AdapterContext): Notice[] {
    const selectors = source.selectors;
    if (!selectors) throw new Error(`源 ${source.id} 缺少 selectors`);
    const $ = load(html);
    const base = source.baseUrl ?? source.url;
    const out: Notice[] = [];
    const seen = new Set<string>();

    $(selectors.item).each((_, el) => {
      const title = pick($, el, selectors.title);
      if (!title) return;
      const href = selectors.link ? pick($, el, selectors.link) : '';
      const url = resolveUrl(href, base, source.url);
      // 页面上的日期优先；解析不出来时再从链接里抠（博达 CMS 的链接形如 /2026/0930/xxx/page.htm）
      let date = selectors.date ? parseDateLoose(pick($, el, selectors.date)) : null;
      if (!date && selectors.dateFromLink) {
        const m = new RegExp(selectors.dateFromLink).exec(url);
        if (m && m[1] && m[2] && m[3]) date = `${m[1]}-${m[2]}-${m[3]}`;
      }
      const tag = selectors.tag ? pick($, el, selectors.tag) || null : null;
      const id = makeId(source.id, title, date);
      if (seen.has(id)) return;
      seen.add(id);
      out.push({ id, sourceId: source.id, sourceName: source.name, school, title, url, date, tag });
    });

    return out;
  },
};
