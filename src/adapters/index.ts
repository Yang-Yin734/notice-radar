import type { Notice } from '../types.ts';
import type { SourceConfig } from '../core/config.ts';
import { htmlListAdapter } from './html-list.ts';
import { jwcAdapter } from './uestc/jwc.ts';
import { grAdapter } from './uestc/gr.ts';

/** 适配器拿到的一切：源配置 + 学校 ID + 已抓到的 HTML。 */
export interface AdapterContext {
  source: SourceConfig;
  school: string;
  html: string;
}

/** 适配器契约：输入 HTML，输出标准 Notice[]。加了新学校就注册进来。 */
export interface Adapter {
  name: string;
  parse(ctx: AdapterContext): Notice[];
}

export const adapters: Record<string, Adapter> = {
  'html-list': htmlListAdapter,
  'uestc/jwc': jwcAdapter,
  'uestc/gr': grAdapter,
};

export function getAdapter(name: string): Adapter | undefined {
  return adapters[name];
}

export function listAdapters(): string[] {
  return Object.keys(adapters).sort();
}
