import type { NotifyConfig } from '../core/config.ts';

export interface NotifyOutcome {
  channel: string;
  ok: boolean;
  detail: string;
}

/**
 * 推送通道。目标：让消息真正落到**微信**里，而且失败时能看懂为什么。
 *
 * 关于"微信授权"必须先说清现实（个人项目拿不到微信官方推送）：
 *   · 微信服务号的模板消息 / 订阅通知：需要**已认证的服务号**（企业主体 + 300 元/年认证），
 *     还要自建服务器做 OAuth 拿 openid —— 个人主体申请不到模板消息，这条路走不通。
 *   · 所以"推到微信"实际有三条个人可行的路，本项目全部支持：
 *       1. wxpusher   —— 微信扫码登录 → 创建应用 → 关注「WxPusher」公众号完成授权，
 *                        之后消息由公众号直达你的微信（最接近"微信授权"的形态）
 *       2. wecom-bot  —— 企业微信群机器人：建个群加机器人即可；开启"微信插件"后微信也能收到
 *       3. wecom-app  —— 企业微信自建应用消息：能发给指定人，同样可经微信插件落到微信
 *   · Server酱（原有通道）本质是第三方中转，免费版每天有条数上限。
 *
 * 环境变量（放进 GitHub Actions secrets 或本机 .env 即可）：
 *   SERVERCHAN_KEY                                  Server酱 SendKey（SCT…）
 *   WECOM_BOT_WEBHOOK                               企业微信群机器人完整 webhook
 *   WECOM_CORP_ID / WECOM_SECRET / WECOM_AGENT_ID / WECOM_TOUSER
 *   WXPUSHER_APP_TOKEN / WXPUSHER_UIDS（逗号分隔）/ WXPUSHER_TOPIC_IDS
 *   SMTP_URL 或 SMTP_HOST + SMTP_USER + SMTP_PASS / MAIL_TO / MAIL_FROM
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
    return '（像是配额用尽：Server酱免费版每天有条数上限，建议再加企业微信或 WxPusher 通道，见 docs/wechat.md）';
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

// ---------------------------------------------------------------- 企业微信

/** 企业微信群机器人：免费、无需审核；开"微信插件"后能在微信里收到。 */
async function sendWecomBot(webhook: string, title: string, markdown: string): Promise<NotifyOutcome> {
  const channel = 'wecom-bot';
  if (!webhook) {
    return { channel, ok: false, detail: '缺少 webhook（设置环境变量 WECOM_BOT_WEBHOOK，或在配置里改 urlEnv）' };
  }
  if (!/^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=/.test(webhook)) {
    return { channel, ok: false, detail: 'webhook 格式不对：应是 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…' };
  }
  // 群机器人没有独立标题字段，把标题并进正文首行
  const content = `**${title}**\n${markdown}`.slice(0, 4000);
  try {
    const result = await withRetry(
      () => postJson(webhook, { msgtype: 'markdown', markdown: { content } }),
      (r) => r.status < 500 && /"errcode"\s*:\s*0/.test(r.text),
    );
    const ok = result.status < 500 && /"errcode"\s*:\s*0/.test(result.text);
    return ok
      ? { channel, ok: true, detail: `HTTP ${result.status} 已投递（企业微信群）` }
      : { channel, ok: false, detail: `HTTP ${result.status} ${reasonOf(result.text)}` };
  } catch (e) {
    return { channel, ok: false, detail: (e as Error).message };
  }
}

/** 企业微信自建应用：能发给指定人（touser）。 */
async function sendWecomApp(title: string, markdown: string): Promise<NotifyOutcome> {
  const channel = 'wecom-app';
  const corpId = process.env.WECOM_CORP_ID ?? '';
  const secret = process.env.WECOM_SECRET ?? '';
  const agentId = process.env.WECOM_AGENT_ID ?? '';
  const toUser = process.env.WECOM_TOUSER ?? '@all';
  if (!corpId || !secret || !agentId) {
    return { channel, ok: false, detail: '缺少 WECOM_CORP_ID / WECOM_SECRET / WECOM_AGENT_ID（见 docs/wechat.md）' };
  }
  try {
    const tokenRes = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
      { signal: AbortSignal.timeout(12000) },
    );
    const tokenText = await tokenRes.text();
    const token = (JSON.parse(tokenText) as { access_token?: string }).access_token;
    if (!token) return { channel, ok: false, detail: `取 access_token 失败：${reasonOf(tokenText)}` };

    const content = `**${title}**\n${markdown}`.slice(0, 4000);
    const result = await withRetry(
      () =>
        postJson(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
          touser: toUser,
          msgtype: 'markdown',
          agentid: Number(agentId),
          markdown: { content },
        }),
      (r) => r.status < 500 && /"errcode"\s*:\s*0/.test(r.text),
    );
    const ok = result.status < 500 && /"errcode"\s*:\s*0/.test(result.text);
    return ok
      ? { channel, ok: true, detail: `HTTP ${result.status} 已投递（应用消息 → ${toUser}）` }
      : { channel, ok: false, detail: `HTTP ${result.status} ${reasonOf(result.text)}` };
  } catch (e) {
    return { channel, ok: false, detail: (e as Error).message };
  }
}

// ---------------------------------------------------------------- WxPusher

/** WxPusher：微信扫码关注公众号即完成授权，之后消息由公众号直达微信。 */
async function sendWxPusher(title: string, markdown: string, url?: string): Promise<NotifyOutcome> {
  const channel = 'wxpusher';
  const appToken = process.env.WXPUSHER_APP_TOKEN ?? '';
  const uids = (process.env.WXPUSHER_UIDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const topicIds = (process.env.WXPUSHER_TOPIC_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  if (!appToken) return { channel, ok: false, detail: '缺少 WXPUSHER_APP_TOKEN（见 docs/wechat.md）' };
  if (uids.length === 0 && topicIds.length === 0) {
    return { channel, ok: false, detail: '缺少 WXPUSHER_UIDS（你在 WxPusher 后台的 UID）或 WXPUSHER_TOPIC_IDS' };
  }
  try {
    const result = await withRetry(
      () =>
        postJson('https://wxpusher.zjiecode.com/api/send/message', {
          appToken,
          content: markdown,
          summary: title.slice(0, 20),
          contentType: 3, // 3 = markdown
          uids,
          topicIds,
          ...(url ? { url } : {}),
        }),
      (r) => r.status < 500 && /"code"\s*:\s*1000/.test(r.text),
    );
    const ok = result.status < 500 && /"code"\s*:\s*1000/.test(result.text);
    return ok
      ? { channel, ok: true, detail: `HTTP ${result.status} 已投递 → ${uids.length || topicIds.length} 个接收方` }
      : { channel, ok: false, detail: `HTTP ${result.status} ${reasonOf(result.text)}` };
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
    if (cfg.type === 'wecom-bot') {
      const url = cfg.url ?? process.env[cfg.urlEnv ?? 'WECOM_BOT_WEBHOOK'] ?? '';
      outcomes.push(await sendWecomBot(url, title, markdown));
      continue;
    }
    if (cfg.type === 'wecom-app') {
      outcomes.push(await sendWecomApp(title, markdown));
      continue;
    }
    if (cfg.type === 'wxpusher') {
      outcomes.push(await sendWxPusher(title, markdown, cfg.url));
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
