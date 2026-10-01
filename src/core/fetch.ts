/**
 * 抓取层：只管把 HTML 拿回来，不解析。
 * 设计要点：串行 + 退避重试 + 编码嗅探，尽量避免给学校站点添麻烦。
 */
import dns from 'node:dns';

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 notice-radar/0.0.1';

/**
 * 默认抓取超时。
 *
 * 为什么是 40 秒：境外 runner 到国内教育网站点要跨境，握手本身就慢，
 * 20 秒会把"能成功但慢"的请求误杀成失败（实测云端成功率只有四成）。
 */
export const DEFAULT_TIMEOUT_MS = 40000;

let dnsOrdered = false;

/**
 * 让 DNS 结果里 IPv4 优先。
 *
 * 为什么需要：这些学校域名同时有 A 和 **AAAA（教育网 CERNET2，如 2001:250:…）**，
 * 而 Node 从 v17 起默认按解析器返回顺序（常把 AAAA 排前）。教育网 IPv6 **基本只在境内可达**，
 * 境外 runner 走这条路的结局就是超时 —— 表现正是我们看到的"约每 3 次有 1 次整体失败"。
 *
 * 想回到系统默认（排查用）：设 NOTICE_RADAR_DNS_ORDER=verbatim。
 */
export function preferIPv4First(): void {
  if (dnsOrdered) return;
  dnsOrdered = true;
  const want = (process.env.NOTICE_RADAR_DNS_ORDER ?? 'ipv4first').toLowerCase();
  if (want !== 'ipv4first' && want !== 'ipv6first' && want !== 'verbatim') return;
  try {
    dns.setDefaultResultOrder(want as 'ipv4first' | 'ipv6first' | 'verbatim');
  } catch {
    /* 老版本 Node 不支持就忽略，不影响抓取 */
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  userAgent?: string;
}

export interface FetchResult {
  html: string;
  status: number;
  bytes: number;
  tookMs: number;
  charset: string;
}

/** 从 HTML 头部嗅探编码：不少国内高校站点还是 gb2312/gbk。 */
export function sniffCharset(buf: Buffer): string {
  const head = buf.subarray(0, 2048).toString('latin1');
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return (m?.[1] ?? 'utf-8').toLowerCase();
}

export function decodeBody(buf: Buffer, charset: string): string {
  const normalized = charset === 'gb2312' || charset === 'gbk' ? 'gbk' : charset;
  if (normalized === 'utf-8' || normalized === 'utf8') return buf.toString('utf8');
  try {
    return new TextDecoder(normalized).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  preferIPv4First();
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
    retryDelayMs = 800,
    userAgent = DEFAULT_UA,
  } = options;
  let lastError: Error = new Error('未知错误');

  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,*/*' },
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timer);
      const buf = Buffer.from(await res.arrayBuffer());
      const charset = sniffCharset(buf);

      // 5xx 值得重试；4xx 是明确的拒绝，重试只会更糟
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(retryDelayMs * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      return { html: decodeBody(buf, charset), status: res.status, bytes: buf.length, tookMs: Date.now() - t0, charset };
    } catch (e) {
      lastError = e as Error;
      if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}
