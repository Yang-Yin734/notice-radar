import type { NotifyConfig } from '../core/config.ts';

export interface NotifyOutcome {
  channel: string;
  ok: boolean;
  detail: string;
}

/**
 * 推送通道。目标是"消息能到手机上，且失败时看得懂为什么"。
 *
 * 通道：
 *   · serverchan —— Server酱，转发到微信（本项目主用通道）
 *   · webhook    —— 通用 JSON POST（飞书/钉钉/自建服务）
 *   · email      —— SMTP（需要可选依赖 nodemailer）
 *   · stdout     —— 只打印，本地调试用
 *
 * 环境变量（放进 GitHub Actions secrets 或本机 .env 即可）：
 *   SERVERCHAN_KEY                                  Server酱 SendKey（SCT…）
 *   SMTP_URL 或 SMTP_HOST + SMTP_USER + SMTP_PASS / MAIL_TO / MAIL_FROM
 *   NOTICE_RADAR_WEBHOOK（或配置里的 urlEnv）
 */

const RETRYABLE = /timeout|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket|network|HTTP 5\d\d|fetch failed|aborted/i;

/** 带退避的重试：推送失败大多是一瞬间的网络抖动，重试两次比丢掉一条通知划算。 */
async function withRetry<T>(run: () => Promise<T>, isOk: (value: T) => boolean, attempts = 3): Promise<T> {
  let last: T | null = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const value = await run();
      last = value;
      if (isOk(value)) return value;
      if (i === attempts || !RETRYABLE.test(JSON.stringify(value))) return value;
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      if (i === attempts || !RETRYABLE.test(message)) throw e;
    }
    await new Promise((r) => setTimeout(r, 800 * i));
  }
  return last as T;
}

/** 这类接口失败时都会给"人话"，尽量把它挖出来，而不是把整坨 JSON 甩给用户。 */
function reasonOf(text: string): string {
  try {
    const json = JSON.parse(text) as { errmsg?: string; message?: string; msg?: string };
    const message = json.errmsg ?? json.message ?? json.msg;
    if (message) return String(message);
  } catch {
    /* 不是 JSON 就用原文 */
  }
  return text.replace(/\s+/g, ' ').slice(0, 160);
}

/** 配额类错误单独提示：它属于"配置没问题但发不出去"，最容易让人困惑。 */
function quotaHint(text: string): string {
  if (/quota|余额|限制|超限|上限|limit|too many|今日.*条/i.test(text)) {
    return '（像是配额用尽：Server酱免费版每天有条数上限）';
  }
  return '';
}

async function postJson(url: string, body: unknown, timeoutMs = 12000): Promise<{ status: number; text: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, text: await res.text() };
}

// ---------------------------------------------------------------- Server酱

async function sendServerChan(key: string, title: string, markdown: string): Promise<NotifyOutcome> {
  const channel = 'serverchan';
  if (!key) return { channel, ok: false, detail: '缺少密钥（设置环境变量 SERVERCHAN_KEY，或在配置里改 keyEnv）' };
  try {
    const body = new URLSearchParams({ title: title.slice(0, 32), desp: markdown });
    const result = await withRetry(
      async () => {
        const res = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(12000),
        });
        return { status: res.status, text: await res.text() };
      },
      (r) => r.status < 500 && /"code"\s*:\s*0/.test(r.text),
    );
    const ok = result.status < 500 && /"code"\s*:\s*0/.test(result.text);
    if (ok) return { channel, ok: true, detail: `HTTP ${result.status} 已投递` };
    return { channel, ok: false, detail: `HTTP ${result.status} ${reasonOf(result.text)}${quotaHint(result.text)}` };
  } catch (e) {
    return { channel, ok: false, detail: (e as Error).message };
  }
}

// ---------------------------------------------------------------- 通用

async function sendWebhook(url: string, title: string, markdown: string): Promise<NotifyOutcome> {
  const channel = 'webhook';
  if (!url) return { channel, ok: false, detail: '缺少 url（配置里的 url 或 urlEnv 环境变量）' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, markdown, source: 'notice-radar' }),
      signal: AbortSignal.timeout(12000),
    });
    return { channel, ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { channel, ok: false, detail: (e as Error).message };
  }
}

/** 邮件通道：SMTP_URL 或 SMTP_HOST(+SMTP_USER/SMTP_PASS)。nodemailer 是可选依赖。 */
async function sendEmail(title: string, markdown: string): Promise<NotifyOutcome> {
  const channel = 'email';
  const to = process.env.MAIL_TO ?? '';
  const from = process.env.MAIL_FROM ?? process.env.MAIL_TO ?? '';
  const smtpUrl = process.env.SMTP_URL ?? buildSmtpUrl();
  if (!smtpUrl) {
    return {
      channel,
      ok: false,
      detail: '缺少 SMTP_URL（形如 smtps://user:pass@smtp.example.com:465）或 SMTP_HOST + SMTP_USER + SMTP_PASS',
    };
  }
  if (!to) return { channel, ok: false, detail: '缺少 MAIL_TO（收件人地址）' };

  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const nodemailer = require('nodemailer');
    const transport = nodemailer.createTransport(smtpUrl);
    // 同时给纯文本与 HTML：Markdown 里的链接要 HTML 才可点（issue #5）
    const info = await transport.sendMail({
      from,
      to,
      subject: title,
      text: markdown,
      html: markdownToHtml(markdown),
    });
    return { channel, ok: true, detail: `已发送（${info?.messageId ?? 'ok'}）` };
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    if (/Cannot find module|MODULE_NOT_FOUND/.test(message)) {
      return { channel, ok: false, detail: '需要先装可选依赖：npm i nodemailer' };
    }
    return { channel, ok: false, detail: message.slice(0, 200) };
  }
}

/** 兼容 issue #5 提到的 SMTP_HOST / SMTP_USER / SMTP_PASS 写法。 */
function buildSmtpUrl(): string {
  const host = process.env.SMTP_HOST ?? '';
  if (!host) return '';
  const user = process.env.SMTP_USER ?? '';
  const pass = process.env.SMTP_PASS ?? '';
  const port = process.env.SMTP_PORT ?? '465';
  const scheme = port === '465' ? 'smtps' : 'smtp';
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : '';
  return `${scheme}://${auth}${host}:${port}`;
}

/** 极简 Markdown → HTML（够日报用：标题、粗体、链接、列表、引用、分隔线）。 */
export function markdownToHtml(markdown: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) {
      closeList();
      out.push(`<h2>${inline(line.replace(/^#\s+/, ''))}</h2>`);
    } else if (/^##\s+/.test(line)) {
      closeList();
      out.push(`<h3>${inline(line.replace(/^##\s+/, ''))}</h3>`);
    } else if (/^-\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inline(line.replace(/^-\s+/, ''))}</li>`);
    } else if (/^>\s?/.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.replace(/^>\s?/, ''))}</blockquote>`);
    } else if (/^---+$/.test(line)) {
      closeList();
      out.push('<hr>');
    } else if (line === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  const style = "font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;line-height:1.7";
  return `<div style="${style}">${out.join('\n')}</div>`;
}

/** 把通知发到所有启用通道。 */
export async function notifyAll(channels: NotifyConfig[], title: string, markdown: string): Promise<NotifyOutcome[]> {
  const outcomes: NotifyOutcome[] = [];
  for (const cfg of channels) {
    if (!cfg.enabled) continue;
    if (cfg.type === 'stdout') {
      outcomes.push({ channel: 'stdout', ok: true, detail: '已打印到终端' });
      continue;
    }
    if (cfg.type === 'serverchan') {
      const key = process.env[cfg.keyEnv ?? 'SERVERCHAN_KEY'] ?? '';
      outcomes.push(await sendServerChan(key, title, markdown));
      continue;
    }
    if (cfg.type === 'email') {
      outcomes.push(await sendEmail(title, markdown));
      continue;
    }
    if (cfg.type === 'webhook') {
      const url = cfg.url ?? process.env[cfg.urlEnv ?? 'NOTICE_RADAR_WEBHOOK'] ?? '';
      outcomes.push(await sendWebhook(url, title, markdown));
    }
  }
  return outcomes;
}
