// 批量设置 Actions secrets —— 只干这一件事，不做任何"仓库装修"。
//
// 为什么单独一个脚本：gh-setup.mjs 会顺带改描述/topics/labels/issues/Release，
// 只想更新密钥时不该触发那些副作用。
//
// 用法：
//   node tools/gh-set-secrets.mjs --file=secrets.json
//   secrets.json 形如 { "ANDROID_KEYSTORE_BASE64": "...", "ANDROID_KEY_PASSWORD": "..." }
//   （用文件传值，避免密钥出现在命令行/进程列表里）
//
// token 来源：环境变量 GH_TOKEN，缺省则用 git 凭据管理器里的 github.com 凭据。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const valueOf = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [owner, repo] = (valueOf('repo') ?? 'Yang-Yin734/notice-radar').split('/');

const file = valueOf('file');
if (!file) {
  console.error('用法：node tools/gh-set-secrets.mjs --file=secrets.json');
  process.exit(2);
}
// 去掉可能的 UTF-8 BOM：Windows 上 PowerShell 的 Set-Content -Encoding UTF8 会带 BOM，
// 直接 JSON.parse 会报 "Unexpected token '﻿'"
const wanted = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
if (!wanted || typeof wanted !== 'object' || Object.keys(wanted).length === 0) {
  console.error('secrets 文件里没有内容');
  process.exit(2);
}

let token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
if (!token) {
  try {
    const out = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8' });
    token = /^password=(.+)$/m.exec(out)?.[1]?.trim() ?? '';
  } catch {
    /* 下面统一报错 */
  }
}
if (!token) {
  console.error('没有 token：设置 GH_TOKEN，或先让 git 记住 github.com 凭据');
  process.exit(2);
}

const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'notice-radar-secrets',
  'content-type': 'application/json',
};
const call = async (method, url, body) => {
  const res = await fetch(`https://api.github.com${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: res.ok, status: res.status, json, text };
};

const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers');
await sodium.ready;

const keyRes = await call('GET', `/repos/${owner}/${repo}/actions/secrets/public-key`);
if (!keyRes.ok) {
  console.error(`取公钥失败：HTTP ${keyRes.status}（token 需要 Secrets 写权限）`);
  process.exit(1);
}
const { key, key_id } = keyRes.json;

let failed = 0;
for (const [name, value] of Object.entries(wanted)) {
  const sealed = sodium.crypto_box_seal(Buffer.from(String(value), 'utf8'), Buffer.from(key, 'base64'));
  const put = await call('PUT', `/repos/${owner}/${repo}/actions/secrets/${name}`, {
    encrypted_value: Buffer.from(sealed).toString('base64'),
    key_id,
  });
  if (!put.ok) {
    console.log(`  ✗ ${name}：HTTP ${put.status} ${put.text.slice(0, 140)}`);
    failed++;
  } else {
    console.log(`  ✓ ${name} 已设置（值不回显）`);
  }
}

// 回读确认（列表接口只给名字）
const check = await call('GET', `/repos/${owner}/${repo}/actions/secrets?per_page=100`);
const names = (check.json?.secrets ?? []).map((s) => s.name);
console.log(`\n仓库现有 secret（${names.length} 个）：${names.join(', ')}`);
for (const name of Object.keys(wanted)) {
  if (!names.includes(name)) {
    console.log(`  ! 回读没看到 ${name}，请到网页确认`);
    failed++;
  }
}

console.log(failed === 0 ? '\n✓ 全部设置成功' : `\n✗ 有 ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
