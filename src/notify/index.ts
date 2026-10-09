import type { NotifyConfig } from '../core/config.ts';

export interface NotifyOutcome {
  channel: string;
  ok: boolean;
  detail: string;
}

/**
 * 推送通道。目标是"消息能到自己的设备上，且失败时看得懂为什么"。
 *
 * 通道（**都是可选的通用通道，默认一个都不开**；项目本身不绑定任何第三方推送服务）：
 *   · webhook    —— 通用 JSON POST（飞书/钉钉/自建服务）
 *   · email      —— SMTP（需要可选依赖 nodemailer）
 *   · stdout     —— 只打印，本地调试用
 *
 * 环境变量（放进 GitHub Actions secrets 或本机 .env 即可）：
 *   SMTP_URL 或 SMTP_HOST + SMTP_USER + SMTP_PASS / MAIL_TO / MAIL_FROM
 *   NOTICE_RADAR_WEBHOOK（或配置里的 urlEnv）
 *
 * 想自己加通道，就在这里写一个 sendXxx 并接到 notifyAll 的 switch 上。
 */

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
