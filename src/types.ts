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
   * 同一条通知还出现在哪些源里（跨源去重后填充）。
   * 教务处常把同一条通知同时挂到「重要公告」和「学生事务公告」，这里记下来但不重复推送。
   */
  alsoIn?: string[];
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
