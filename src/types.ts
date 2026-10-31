/** 一条通知的标准形态：所有适配器的输出都必须长这样。 */
export interface Notice {
  /** 稳定 ID：由 源 + 标题 + 日期 归一后哈希得到，用于去重 */
  id: string;
  sourceId: string;
  sourceName: string;
  school: string;
  title: string;
  /** 指向原文的链接；拿不到详情链接时退回列表页 */
  url: string;
  /** ISO 日期（YYYY-MM-DD），拿不到就是 null */
  date: string | null;
  /** 列表里自带的分类标签，如「考试」「教管」 */
  tag: string | null;
  /**
   * 源级分类（写在 YAML 的 `category` 上），如「教务」「研究生」「人事」「就业」。
   * 和 `tag` 的区别：`tag` 是站点自己在列表页给的、随栏目变；`category` 是用户
   * 在配置里显式声明的、稳定可控 —— 用它在推送标题前加前缀、在仪表盘里分组。
   * 老归档里没有这个字段，所以是可选的。
   */
  category?: string | null;
  /**
   * 同一条通知还出现在哪些源里（跨源去重后填充）。
   * 教务处常把同一条通知同时挂到「重要公告」和「学生事务公告」，这里记下来但不重复推送。
   */
  alsoIn?: string[];
  /**
   * 从标题里抽出的截止日期（YYYY-MM-DD），抽不到就没有这个字段。
   * 只存日期不存"还剩几天"——后者是相对量，隔天就过期了，展示时现算。
   */
  deadline?: string;
}

/** 一个源本次抓取的结果（无论成功失败都返回，方便 doctor 展示） */
export interface SourceResult {
  sourceId: string;
  sourceName: string;
  url: string;
  adapter: string;
  ok: boolean;
  error: string | null;
  status: number | null;
  bytes: number;
  tookMs: number;
  /** 解析出的全部条目（已过滤前） */
  items: Notice[];
  /** 本次被跳过（例如源需要浏览器渲染但没加 --allow-browser），既不算成功也不算失败 */
  skipped?: boolean;
}
