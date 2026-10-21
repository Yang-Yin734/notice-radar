'use strict';

/**
 * 阿里云函数计算入口：把 radr 的一次抓取跑成无状态任务。
 *
 * 状态不在本地累积 —— 每次执行：
 *   1. 从 OSS 拉 state.json（首次为空则跳过）
 *   2. 跑 dist/cli.js run
 *   3. 把更新后的 state.json / latest.json 推回 OSS
 *
 * 这样连跑一年也不会因为实例重建而丢已见记录。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import OSS from 'ali-oss';

const DATA_DIR = '/tmp/data';
const DEFAULT_STATE_KEY = 'notice-radar/state.json';
const DEFAULT_LATEST_KEY = 'notice-radar/latest.json';
const DEFAULT_LOCK_KEY = 'notice-radar/lock.json';
const DEFAULT_HEARTBEAT_KEY = 'notice-radar/heartbeat.json';
const LOCK_TTL_MS = 10 * 60 * 1000;

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function bool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function buildClient() {
  const bucket = env('OSS_BUCKET');
  if (!bucket) {
    throw new Error('缺少环境变量 OSS_BUCKET；请在函数配置里填好 OSS 桶名');
  }
  const region = env('OSS_REGION', 'oss-cn-beijing');
  const options = {
    region,
    accessKeyId: env('OSS_AK_ID'),
    accessKeySecret: env('OSS_AK_SECRET'),
    bucket,
    secure: true,
  };
  // 函数与桶同地域时走内网 endpoint：不走公网、不产生外网流量费。
  let endpoint = env('OSS_ENDPOINT');
  if (!endpoint && bool('OSS_INTERNAL', true)) {
    endpoint = `${region}-internal.aliyuncs.com`;
  }
  if (endpoint) options.endpoint = endpoint;
  return new OSS(options);
}

async function pullObject(client, key, localPath) {
  try {
    const result = await client.get(key);
    fs.writeFileSync(localPath, result.content);
    return result.content.length;
  } catch (error) {
    if (error && (error.code === 'NoSuchKey' || error.status === 404)) return 0;
    throw error;
  }
}

async function pushObject(client, key, localPath, headers) {
  if (!fs.existsSync(localPath)) return 0;
  const body = fs.readFileSync(localPath);
  await client.put(key, body, { headers });
  return body.length;
}

async function acquireLock(client, lockKey) {
  const now = Date.now();
  try {
    const existing = await client.get(lockKey);
    const parsed = JSON.parse(existing.content.toString('utf8'));
    if (parsed && typeof parsed.at === 'number' && now - parsed.at < LOCK_TTL_MS) {
      return false;
    }
  } catch (error) {
    if (!(error && (error.code === 'NoSuchKey' || error.status === 404))) throw error;
  }
  // ali-oss 的 put 收到 string 时会当成"本地文件路径"，必须显式转成 Buffer。
  await client.put(lockKey, Buffer.from(JSON.stringify({ at: now })), {
    headers: { 'Content-Type': 'application/json' },
  });
  return true;
}

async function releaseLock(client, lockKey) {
  try {
    await client.delete(lockKey);
  } catch {
    // 锁过期后自然失效，删除失败不影响正确性。
  }
}

function runCli(args, options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code) => {
      resolve({ code: code === null ? -1 : code, stdout, stderr });
    });
  });
}

function tail(text, limit) {
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

export const handler = async (event, context) => {
  const startedAt = Date.now();
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const client = buildClient();
  const stateLocal = path.join(DATA_DIR, 'state.json');
  const latestLocal = path.join(DATA_DIR, 'latest.json');
  const stateKey = env('OSS_STATE_KEY', DEFAULT_STATE_KEY);
  const latestKey = env('OSS_LATEST_KEY', DEFAULT_LATEST_KEY);
  const lockKey = env('OSS_LOCK_KEY', DEFAULT_LOCK_KEY);
  const heartbeatKey = env('OSS_HEARTBEAT_KEY', DEFAULT_HEARTBEAT_KEY);
  const configPath = env('RADR_CONFIG', 'config/schools/uestc.yaml');
  const delay = env('RADR_DELAY', '1200');
  const allowBrowser = bool('RADR_ALLOW_BROWSER', false);

  const locked = await acquireLock(client, lockKey);
  if (!locked) {
    return {
      ok: true,
      skipped: '上一轮还没跑完（锁未释放），本轮跳过',
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const stateBytes = await pullObject(client, stateKey, stateLocal);

    const args = [
      'dist/cli.js',
      'run',
      `--config=${configPath}`,
      `--state=${stateLocal}`,
      `--json=${latestLocal}`,
      `--delay=${delay}`,
    ];
    if (allowBrowser) args.push('--allow-browser');
    if (bool('RADR_NO_NOTIFY', false)) args.push('--no-notify');

    const result = await runCli(args, { cwd: process.cwd() });

    const uploadedState = await pushObject(client, stateKey, stateLocal, {
      'Content-Type': 'application/json',
    });
    const uploadedLatest = await pushObject(client, latestKey, latestLocal, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    });

    // 每次执行都写心跳：即使本轮没有新通知（不写 state/latest），
    // 也能从 OSS 上看出定时触发器还在正常跑。
    await client
      .put(
        heartbeatKey,
        Buffer.from(
          JSON.stringify({
            at: new Date().toISOString(),
            ok: result.code === 0,
            exitCode: result.code,
            pulledStateBytes: stateBytes,
            durationMs: Date.now() - startedAt,
          }),
        ),
        { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
      )
      .catch(() => {
        // 心跳失败不影响主流程
      });

    const summary = {
      ok: result.code === 0,
      exitCode: result.code,
      pulledStateBytes: stateBytes,
      uploadedStateBytes: uploadedState,
      uploadedLatestBytes: uploadedLatest,
      config: configPath,
      allowBrowser,
      durationMs: Date.now() - startedAt,
      stdoutTail: tail(result.stdout, 4000),
      stderrTail: tail(result.stderr, 2000),
    };
    if (result.code !== 0) {
      // 非零退出交给函数计算标记失败，方便在控制台/告警里看到。
      const error = new Error(`radr run 失败（exit ${result.code}）`);
      error.summary = summary;
      throw error;
    }
    return summary;
  } finally {
    await releaseLock(client, lockKey);
  }
};
