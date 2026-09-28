import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * 配置即接口：别人接入自己学校，理论上只改 YAML，不写代码。
 * 这里只对外暴露稳定的字段，内部实现随便改。
 */

const selectorsSchema = z.object({
  /** 每条通知的容器选择器，例如 `div.notice-item.clearfix` */
  item: z.string().min(1),
  /** 标题：`a` 取文本、`a@title` 取属性 */
  title: z.string().min(1),
  /** 链接：`a@href`；留空则用列表页地址 */
  link: z.string().optional(),
  /** 日期：`div.date-box-sm`；留空则 date=null */
  date: z.string().optional(),
  /** 分类标签 */
  tag: z.string().optional(),
});

const sourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  url: z.string().min(1),
  /** 适配器名：`html-list` 通用；`uestc/jwc` 这类是学校专属 */
  adapter: z.string().default('html-list'),
  enabled: z.boolean().default(true),
  /** 站内相对链接的拼接前缀，默认取 url 的 origin */
  baseUrl: z.string().optional(),
  selectors: selectorsSchema.optional(),
  /** 适配器私有参数，透传给适配器 */
  params: z.unknown().optional(),
  /**
   * 这个源必须用真浏览器渲染才能拿到内容（站点部署了 JS 机器人挑战）。
   * 默认不启用：只有显式加 --allow-browser 才会跑，见 README「合规与边界」。
   */
  requiresBrowser: z.boolean().default(false),
  /** 用浏览器渲染时，页面里出现这个字符串就认为挑战已通过（默认「通知」） */
  browserExpect: z.string().optional(),
  /**
   * 用无头浏览器（默认 true）。置 false 会弹出可见窗口 ——
   * 只有被站点识别并拒绝无头浏览器时才需要，因此只适合本机低频运行。
   */
  browserHeadless: z.boolean().default(true),
  /** 命中任一关键词才推送（留空表示不过滤） */
  include: z.array(z.string()).default([]),
  /** 命中任一关键词就丢弃 */
  exclude: z.array(z.string()).default([]),
  /** 给未来的自己/贡献者留的备注 */
  note: z.string().optional(),
});

const notifySchema = z.object({
  type: z.enum(['serverchan', 'webhook', 'stdout']),
  enabled: z.boolean().default(true),
  /** 密钥从哪个环境变量读（默认 SERVERCHAN_KEY） */
  keyEnv: z.string().optional(),
  url: z.string().optional(),
  urlEnv: z.string().optional(),
});

const configSchema = z.object({
  school: z.string().min(1),
  name: z.string().min(1),
  notify: z.array(notifySchema).default([]),
  sources: z.array(sourceSchema).min(1),
});

export type SourceConfig = z.infer<typeof sourceSchema>;
export type NotifyConfig = z.infer<typeof notifySchema>;
export type RadarConfig = z.infer<typeof configSchema>;

function checkUrl(value: string, where: string): void {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http/https');
  } catch (e) {
    throw new Error(`${where} 不是合法 URL：${value}（${(e as Error).message}）`);
  }
}

export function loadConfig(file: string): RadarConfig {
  if (!fs.existsSync(file)) {
    throw new Error(`配置文件不存在：${file}\n提示：可以从 config/schools/uestc.yaml 复制一份改。`);
  }
  const raw = parseYaml(fs.readFileSync(file, 'utf8'));
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(根)'}：${i.message}`);
    throw new Error(`配置文件校验失败：${file}\n${lines.join('\n')}`);
  }
  const cfg = parsed.data;
  for (const s of cfg.sources) {
    checkUrl(s.url, `sources[${s.id}].url`);
    if (s.baseUrl) checkUrl(s.baseUrl, `sources[${s.id}].baseUrl`);
    if (s.adapter === 'html-list' && !s.selectors) {
      throw new Error(`sources[${s.id}] 用了 html-list 适配器，但没写 selectors（至少要有 item 和 title）。`);
    }
  }
  return cfg;
}
