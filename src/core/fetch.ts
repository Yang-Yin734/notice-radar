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
  /**
   * 单个响应体的字节上限（默认 8 MiB）。
   *
   * 为什么需要：列表页正常也就几十 KB，但站点可能被挂马、被塞了一个巨大的
   * 内联 base64 资源，或者干脆返回一个超大的错误页 —— 直接 `arrayBuffer()`
   * 会把整坨读进内存，在 128MB 的 CI runner 或 512MB 的函数实例上就是 OOM。
   * 超过上限直接中断下载并抛错，不重试（重试还是一样大）。
   */
  maxBytes?: number;
}

/** 不该重试的错误（例如「响应体过大」）——重试只会再浪费一次流量。 */
export class FatalFetchError extends Error {}

export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

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

/**
 * 流式读响应体，边读边计数，超上限立刻中断。
 *
 * 不用 `res.arrayBuffer()` 是因为它没有中间态：要么全读进内存，要么失败。
 * 一个 200MB 的错误页在 OOM 之前不会给任何机会。
 */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  if (!res.body) return Buffer.from(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FatalFetchError(`响应体超过上限 ${maxBytes} 字节，已中断下载（已读 ${total} 字节）`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function fetchHtml(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  preferIPv4First();
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 2,
    retryDelayMs = 800,
    userAgent = DEFAULT_UA,
    maxBytes = DEFAULT_MAX_BYTES,
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

      // 有些站点会老实报 content-length：先看这个，能省掉整条下载
      const declared = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new FatalFetchError(`响应体声明 ${declared} 字节，超过上限 ${maxBytes}，未开始下载`);
      }

      const buf = await readCapped(res, maxBytes);
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
      // 响应体过大是确定性结果，重试只会再浪费一次流量
      if (e instanceof FatalFetchError) throw e;
      if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
    }
  }
  throw lastError;
}
