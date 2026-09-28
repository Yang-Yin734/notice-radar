import type { NotifyConfig } from '../core/config.ts';

export interface NotifyOutcome {
  channel: string;
  ok: boolean;
  detail: string;
}

/** Server酱：把 Markdown 推到微信。密钥只从环境变量读，永不落盘。 */
async function sendServerChan(key: string, title: string, markdown: string): Promise<NotifyOutcome> {
  const channel = 'serverchan';
  if (!key) return { channel, ok: false, detail: '缺少密钥（设置环境变量 SERVERCHAN_KEY，或在配置里改 keyEnv）' };
  try {
    const body = new URLSearchParams({ title: title.slice(0, 32), desp: markdown });
    const res = await fetch(`https://sctapi.ftqq.com/${encodeURIComponent(key)}.send`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const text = await res.text();
    const ok = res.ok && /"code"\s*:\s*0/.test(text);
    return { channel, ok, detail: `HTTP ${res.status} ${text.slice(0, 160)}` };
  } catch (e) {
    return { channel, ok: false, detail: (e as Error).message };
  }
}

/** 通用 webhook：想接飞书/钉钉/自建服务时用这个。 */
async function sendWebhook(url: string, title: string, markdown: string): Promise<NotifyOutcome> {
  const channel = 'webhook';
  if (!url) return { channel, ok: false, detail: '缺少 url（配置里的 url 或 urlEnv 环境变量）' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, markdown, source: 'notice-radar' }),
    });
    return { channel, ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { channel, ok: false, detail: (e as Error).message };
  }
}

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
    if (cfg.type === 'webhook') {
      const url = cfg.url ?? process.env[cfg.urlEnv ?? 'NOTICE_RADAR_WEBHOOK'] ?? '';
      outcomes.push(await sendWebhook(url, title, markdown));
    }
  }
  return outcomes;
}
