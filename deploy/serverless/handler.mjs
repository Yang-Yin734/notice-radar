/**
 * 国内云函数入口（阿里云函数计算 FC / 腾讯云云函数 SCF 都能用）。
 *
 * 为什么要这个东西：GitHub 的 runner 在境外，抓国内教育网站点实测单轮成功率只有四成
 * （站点对境外 IP 更严，境外中转实测 20 秒超时）。放在国内云函数上跑，成功率接近 100%，
 * 而且阿里云 FC / 腾讯云 SCF 都有长期免费额度，不用买服务器、也不用一直开电脑。
 *
 * 工作方式：**完全无状态**（不依赖任何数据库/对象存储），每次调用做两件事：
 *   1) 抓一遍所有源，把结果写进 /tmp 的历史文件（这一步不推送）
 *   2) 按窗口生成摘要并推送到微信（窗口内没有新通知就什么都不推，不会打扰）
 *
 * 环境变量：
 *   SERVERCHAN_KEY   必填，Server酱 SendKey（sct.ftqq.com 扫码登录后拿，并关注它的服务号）
 *   MODE             digest（默认，一次推"近 24 小时"）| window（近 WINDOW_HOURS 小时，适合勤跑）
 *   WINDOW_HOURS     window 模式的窗口小时数，默认 0.25（15 分钟，配 10 分钟一次的定时器）
 *   HOURS            digest 模式的窗口小时数，默认 24
 *   SCHOOL           学校配置 id，默认 uestc（对应 config/schools/uestc.yaml）
 *   ALLOW_BROWSER    1 = 也抓需要真浏览器的 WAF 源（云函数一般没有浏览器，默认关）
 *   DRY_RUN          1 = 只预览不真推送（首次部署务必先用它验证）
 *   APP_DIR          代码目录，默认取当前目录
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function run(cmd, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        code: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  });
}

function tail(text, lines = 12) {
  const all = text.trim().split('\n');
  return all.slice(-lines).join('\n');
}

export async function handler(event) {
  const started = Date.now();
  const appDir = process.env.APP_DIR ?? process.cwd();
  const cli = path.join(appDir, 'dist-serverless', 'cli.js');
  const stateDir = path.join(os.tmpdir(), 'notice-radar');
  const state = path.join(stateDir, 'state.json');
  const mode = (process.env.MODE ?? 'digest').toLowerCase();
  const dry = process.env.DRY_RUN === '1';
  const allowBrowser = process.env.ALLOW_BROWSER === '1';

  fs.mkdirSync(stateDir, { recursive: true });

  const log = [];
  if (!fs.existsSync(cli)) {
    return { ok: false, error: `找不到 ${cli}，请把整个 zip 一起上传（含 dist-serverless 目录）`, log };
  }
  if (!process.env.SERVERCHAN_KEY && !dry) {
    return { ok: false, error: '没有配置 SERVERCHAN_KEY，无法推送到微信', log };
  }

  // 第 1 步：抓取（不推送）—— 目的是把"这次看到的新通知"写进历史
  const configPath = `config/schools/${process.env.SCHOOL ?? 'uestc'}.yaml`;
  const crawlArgs = [
    'run',
    `--config=${configPath}`,
    `--state=${state}`,
    '--no-notify',
    '--json=' + path.join(stateDir, 'latest.json'),
  ];
  if (allowBrowser) crawlArgs.push('--allow-browser');
  const crawl = await run('node', [cli, ...crawlArgs], appDir, 240000);
  log.push(`[抓取] exit=${crawl.code}\n${tail(crawl.stdout, 10)}`);

  // 第 2 步：按窗口推送摘要（窗口内没有新通知 → 项目自身就会"不打扰"，什么都不发）
  const hours = mode === 'window' ? Number(process.env.WINDOW_HOURS ?? '0.25') : Number(process.env.HOURS ?? '24');
  const digestArgs = ['digest', `--config=${configPath}`, `--state=${state}`, `--hours=${hours}`, '--notify'];
  if (dry) digestArgs.push('--dry');
  const digest = await run('node', [cli, ...digestArgs], appDir, 120000);
  log.push(`[推送] exit=${digest.code}（窗口 ${hours} 小时）\n${tail(digest.stdout, 14)}`);
  if (digest.stderr.trim()) log.push(`[推送 stderr]\n${tail(digest.stderr, 6)}`);

  const pushed = /serverchan：HTTP 200|已投递/.test(digest.stdout);
  return {
    ok: crawl.code === 0 || digest.code === 0,
    mode,
    dryRun: dry,
    windowHours: hours,
    pushedToWechat: pushed,
    tookMs: Date.now() - started,
    log,
  };
}

/** 阿里云 FC 3.0 的调用约定 */
export const fcHandler = handler;
/** 腾讯云 SCF 的调用约定（ESM 形式） */
export const main_handler = handler;
export default handler;
