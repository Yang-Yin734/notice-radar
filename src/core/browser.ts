import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

/**
 * 浏览器渲染抓取：给"必须执行 JS 才放行"的站点用（例如学院官网的瑞数类 WAF）。
 *
 * 实现方式：启动本机已安装的 Chrome/Edge 无头模式，用 CDP（Chrome DevTools 协议）拿渲染后的 DOM。
 * 零运行时依赖 —— CDP 走 Node 自带的 WebSocket，不引入 puppeteer。
 *
 * 注意：这类站点部署了机器人挑战，用真浏览器渲染等于"用真浏览器访问公开页面"。
 * 因此本模块默认不启用，必须显式加 --allow-browser；详见 README「合规与边界」。
 */

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ],
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
};

export function findBrowser(explicit?: string): string | null {
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const candidate of CANDIDATES[process.platform] ?? CANDIDATES.linux) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

interface CdpSession {
  send(method: string, params?: Record<string, unknown>): Promise<any>;
  close(): void;
}

async function openSession(wsUrl: string): Promise<CdpSession> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
  });

  let nextId = 0;
  const pending = new Map<number, (value: any) => void>();
  ws.addEventListener('message', (event) => {
    let msg: any;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (typeof msg.id === 'number' && pending.has(msg.id)) {
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });

  return {
    send(method, params) {
      const id = ++nextId;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params: params ?? {} }));
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    },
  };
}

export interface RenderOptions {
  /** 等 JS 挑战跑完的最长时间 */
  timeoutMs?: number;
  /** 认为"页面已经稳定"的额外等待 */
  quietMs?: number;
  executablePath?: string;
  /** 页面内容出现这个字符串就认为挑战已通过 */
  expect?: string;
  /**
   * 是否用无头模式。默认 true。
   * 有些站点（如瑞数类 WAF）会识别并拒绝无头浏览器（直接回 400），
   * 此时只能置 false —— 会弹出一个可见浏览器窗口，因此只适合本机低频运行。
   */
  headless?: boolean;
  onLog?: (msg: string) => void;
}

export interface RenderResult {
  html: string;
  title: string;
  tookMs: number;
  browser: string;
}

export async function renderHtml(url: string, options: RenderOptions = {}): Promise<RenderResult> {
  const { timeoutMs = 40000, quietMs = 2500, expect, headless = true, onLog } = options;
  const executablePath = findBrowser(options.executablePath);
  if (!executablePath) {
    throw new Error('找不到 Chrome/Edge，无法做浏览器渲染。可设置 NOTICE_RADAR_BROWSER 指定可执行文件路径。');
  }

  const port = await freePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-radar-browser-'));
  const t0 = Date.now();

  const child = spawn(
    executablePath,
    [
      ...(headless ? ['--headless=new', '--disable-gpu'] : []),
      // Linux 上 /dev/shm 常常很小（容器/CI 尤其），不加这个 Chrome 会莫名崩
      ...(process.platform === 'linux' ? ['--disable-dev-shm-usage'] : []),
      // CI 里跑 Chrome 的常规做法；本地保留沙箱
      ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: headless },
  );

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* 忽略 */
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  };

  try {
    // 等 CDP 端口就绪
    const deadline = Date.now() + timeoutMs;
    let version: { webSocketDebuggerUrl?: string } | null = null;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          version = (await res.json()) as { webSocketDebuggerUrl?: string };
          break;
        }
      } catch {
        /* 还没起来 */
      }
      await sleep(250);
    }
    if (!version) throw new Error('浏览器调试端口未就绪（可能被杀软/策略拦截）');

    // 找一个页面 target
    const listRes = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = (await listRes.json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('浏览器没有可用的页面 target');

    const session = await openSession(page.webSocketDebuggerUrl);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Page.navigate', { url });

    // 轮询 DOM：等"页面稳定"或出现预期关键字（JS 挑战通常会自动重载一次）
    let html = '';
    let lastLength = -1;
    let stableCount = 0;
    while (Date.now() < deadline) {
      await sleep(500);
      const res = await session.send('Runtime.evaluate', {
        expression: 'document.documentElement ? document.documentElement.outerHTML : ""',
        returnByValue: true,
      });
      html = String(res?.result?.result?.value ?? '');
      const satisfied = !expect || html.includes(expect);
      const stable = html.length > 0 && html.length === lastLength;
      stableCount = stable ? stableCount + 1 : 0;
      lastLength = html.length;
      if (satisfied && stableCount >= Math.ceil(quietMs / 500)) break;
      if (satisfied && expect && html.length > 20000 && stableCount >= 1) break;
    }

    const titleRes = await session.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    session.close();

    if (!html) throw new Error('渲染后拿不到 DOM');
    onLog?.(`浏览器渲染完成：${html.length} 字节，用时 ${Date.now() - t0}ms`);
    return { html, title: String(titleRes?.result?.result?.value ?? ''), tookMs: Date.now() - t0, browser: executablePath };
  } finally {
    cleanup();
  }
}
