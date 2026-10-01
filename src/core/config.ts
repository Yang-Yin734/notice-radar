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
  /**
   * 抓几页（issue #7）。默认 1 页。
   * URL 里可写 `{page}` 占位符；没写就改写/追加 `page` 查询参数（教务处列表是 `?page=2` 这种）。
   * 页与页之间会保持 --delay 的间隔，不连续猛击学校站点。
   */
  pages: z.number().int().positive().max(20).default(1),
  /** 给未来的自己/贡献者留的备注 */
  note: z.string().optional(),
  /** 覆盖全局 alerts.silenceDays：这个源多久没动静就该怀疑（例如假期本来就不发） */
  silenceDays: z.number().int().positive().optional(),
});

const notifySchema = z.object({
  type: z.enum(['serverchan', 'webhook', 'stdout', 'email']),
  enabled: z.boolean().default(true),
  /** 密钥从哪个环境变量读（默认 SERVERCHAN_KEY） */
  keyEnv: z.string().optional(),
  url: z.string().optional(),
  urlEnv: z.string().optional(),
});

/**
 * 默认「抢时间」关键词：命中就立刻推微信。
 *
 * 为什么要有这一层：通知分两种——「退课/选课/缓补考/推免」这类错过就麻烦的，
 * 和「讲座/公示」这类晚一天看也没关系的。以前全都即时推，期中期末手机上很吵；
 * 现在命中这些词的立刻推，其余的进每天早上 8 点的日报。
 *
 * 想改直接在自己的 YAML 里写 push.urgent（整个列表替换），或把 digestRest 设成 false
 * 恢复「全都即时推」的老行为。
 */
export const DEFAULT_URGENT_KEYWORDS = [
  // 只放「错过就真麻烦」的：报名/办理类必须带时间词，否则会误伤
  // （实测教训：只写「公示」「报名」「毕业」会把"奖励名单公示""毕业生问卷调查"也判成急事）
  '考试', '缓考', '补考', '重考', '重修', '调课', '停课', '四六级', '成绩查询',
  '退课', '补选', '选课',
  '推免', '保研', '奖学金', '国奖', '助学金', '评优',
  '报名截止', '报名时间', '截止', '缴费', '选导师', '开题',
  '学籍', '答辩', '学位', '开学', '报到',
];

const pushSchema = z.object({
  /** 命中任一关键词（标题或标签）→ 立刻推送 */
  urgent: z.array(z.string().min(1)).default(DEFAULT_URGENT_KEYWORDS),
  /** 命中任一关键词 → 既不时推、也不进日报（彻底静音，比如纯宣传类栏目） */
  mute: z.array(z.string().min(1)).default([]),
  /** 其余通知交给日报。设 false = 恢复「所有新通知都即时推」的老行为 */
  digestRest: z.boolean().default(true),
  /** 日报里每个来源最多列几条 */
  digestMaxPerSource: z.number().int().positive().default(8),
  /** 日报里最多列几条（超出提示「另有 N 条」） */
  digestMaxItems: z.number().int().positive().default(40),
});

const alertsSchema = z.object({
  /** 源抓取失败、或抓到了却解析不出条目时，推一条微信告警 */
  failureNotify: z.boolean().default(true),
  /**
   * 同一个源**连续**失败多少次才告警（默认 3）。
   * 为什么必须连续：GitHub runner 抓国内站点本来就约每 3 次有 1 次整体不通，
   * 只看单次失败会把"网络天气"当成故障 —— 实测真的误报过（4 个源同时告警，下一轮就恢复正常）。
   */
  failureStreak: z.number().int().positive().default(3),
  /**
   * 「网络天气」的门槛：当**所有**源都以网络层错误一起失败（fetch failed / 超时 / DNS）时，
   * 说明是 runner 到国内站点整体不通 —— 这事用户处理不了，也不该反复打扰，
   * 所以只在远高于普通阈值时才提醒。默认 12（20 分钟一轮 ≈ 4 小时持续不通）。
   */
  weatherStreak: z.number().int().positive().default(12),
  /** 同一个源的告警最短间隔（小时）—— 别每 20 分钟吵一次 */
  throttleHours: z.number().positive().default(12),
  /** 某源连续这么多天没有新通知，就怀疑它挂了（只在日报顶部提示，不当急事推） */
  silenceDays: z.number().int().positive().default(14),
  /** 归档观察期不足这么多天时，不下「从未抓到过条目」的判断 */
  warmupDays: z.number().int().positive().default(3),
});

const configSchema = z.object({
  school: z.string().min(1),
  name: z.string().min(1),
  notify: z.array(notifySchema).default([]),
  push: pushSchema.default({}),
  alerts: alertsSchema.default({}),
  sources: z.array(sourceSchema).min(1),
});

export type SourceConfig = z.infer<typeof sourceSchema>;
export type NotifyConfig = z.infer<typeof notifySchema>;
export type PushConfig = z.infer<typeof pushSchema>;
export type AlertsConfig = z.infer<typeof alertsSchema>;
export type RadarConfig = z.infer<typeof configSchema>;

function checkUrl(value: string, where: string): void {
  try {
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol)) throw new Error('只支持 http/https');
  } catch (e) {
    throw new Error(`${where} 不是合法 URL：${value}（${(e as Error).message}）`);
  }
}

const DOC_HINT = 'docs/add-your-school.md';

/** --only=a,b：只抓指定源（issue #2，调试单个源时不用等其它源的间隔）。 */
export function selectSources(sources: SourceConfig[], only?: string | null): SourceConfig[] {
  if (!only) return sources;
  const wanted = new Set(
    only
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return sources.filter((s) => wanted.has(s.id));
}

/**
 * 翻页 URL（issue #7）。
 * URL 里写了 `{page}` 就替换占位符；否则改写/追加 `page` 查询参数（教务处列表是 `?page=N` 这种）。
 */
export function pageUrls(url: string, pages = 1): string[] {
  const count = Math.max(1, Math.floor(pages));
  if (count === 1) return [url];
  return Array.from({ length: count }, (_, i) => {
    const page = String(i + 1);
    if (url.includes('{page}')) return url.replace(/\{page\}/g, page);
    try {
      const u = new URL(url);
      u.searchParams.set('page', page);
      return u.toString();
    } catch {
      return url;
    }
  });
}

function sourceAt(raw: unknown, index: number): { id?: string; name?: string; adapter?: string } | null {
  const sources = (raw as { sources?: unknown } | null)?.sources;
  if (!Array.isArray(sources)) return null;
  const item = sources[index];
  return item && typeof item === 'object' ? (item as { id?: string; name?: string; adapter?: string }) : null;
}

function hintFor(field: string, adapter?: string): string {
  if (field === 'selectors.item') return 'html-list 适配器必须写 item（每条通知的容器选择器），例如 div.notice-item.clearfix';
  if (field === 'selectors.title') return '要写 title（标题选择器），例如 a 取文本、a@title 取属性';
  if (field === 'selectors') return `adapter=${adapter ?? 'html-list'} 需要 selectors，至少要有 item 与 title`;
  if (field === 'url') return '要写完整的 http/https 地址';
  if (field === 'id') return '每个源要有唯一 id，例如 jwc-important';
  if (field === 'name') return '写给人看的名字，例如 教务处·重要公告';
  if (field === 'pages') return 'pages 是正整数（抓几页），默认 1';
  if (field === 'adapter') return '适配器名写错了？跑 `radr list` 看可用的有哪些';
  return '检查这一项的取值';
}

/** 把 zod 的报错翻译成人话：带上源名字、说清缺什么、给出文档（issue #3）。 */
function explainIssue(issue: z.ZodIssue, raw: unknown): string {
  const path = issue.path;
  if (path[0] === 'sources' && typeof path[1] === 'number') {
    const s = sourceAt(raw, path[1]);
    const who = s?.name ?? s?.id;
    const label = `第 ${path[1] + 1} 个源${who ? `（${who}）` : ''}`;
    const field = path.slice(2).join('.') || '（源本身）';
    return `  ✗ ${label}的 ${field} 有问题：${issue.message}\n    提示：${hintFor(field, s?.adapter)}，见 ${DOC_HINT}`;
  }
  if (path[0] === 'push' || path[0] === 'alerts' || path[0] === 'notify') {
    return `  ✗ ${path.join('.')}：${issue.message}\n    提示：见 README 的「推送分级与每日日报」与「抓取健康告警」两节`;
  }
  return `  ✗ ${path.join('.') || '(根)'}：${issue.message}`;
}

export function loadConfig(file: string): RadarConfig {
  if (!fs.existsSync(file)) {
    throw new Error(`配置文件不存在：${file}\n提示：可以从 config/schools/uestc.yaml 复制一份改。`);
  }
  const raw = parseYaml(fs.readFileSync(file, 'utf8'));
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => explainIssue(i, raw));
    throw new Error(`配置文件校验失败：${file}\n${lines.join('\n')}`);
  }
  const cfg = parsed.data;
  for (const s of cfg.sources) {
    checkUrl(s.url, `sources[${s.id}].url`);
    if (s.baseUrl) checkUrl(s.baseUrl, `sources[${s.id}].baseUrl`);
    if (s.adapter === 'html-list' && !s.selectors) {
      throw new Error(
        `配置文件校验失败：${file}\n  ✗ 源「${s.name}」（${s.id}）用了 html-list 适配器，但没写 selectors\n` +
          `    提示：至少要有 item 与 title，见 ${DOC_HINT}`,
      );
    }
  }
  return cfg;
}
