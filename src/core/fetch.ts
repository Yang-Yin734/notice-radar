/**
 * 抓取层：只管把 HTML 拿回来，不解析。
 * 设计要点：串行 + 退避重试 + 编码嗅探，尽量避免给学校站点添麻烦。
 */

export const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 notice-radar/0.0.1';

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
  const { timeoutMs = 20000, retries = 2, retryDelayMs = 800, userAgent = DEFAULT_UA } = options;
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
