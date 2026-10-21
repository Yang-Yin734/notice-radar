#!/usr/bin/env node
/**
 * 打包函数计算的代码包：deploy/fc/code/
 *
 *   node deploy/fc/build.mjs          # 只生成 code/ 目录
 *   node deploy/fc/build.mjs --zip    # 额外生成 notice-radar-fc.zip
 *
 * 产出目录结构与仓库保持一致（dist/ + config/ + index.js），这样 dist/cli.js
 * 里所有相对路径（config/schools/*.yaml）都不用改。
 */

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const codeDir = path.join(here, 'code');
const wantZip = process.argv.includes('--zip');

function step(message) {
  process.stdout.write(`\u25B8 ${message}\n`);
}

function run(command, args, cwd) {
  if (process.platform === 'win32') {
    // 走 cmd.exe 调用 npm.cmd，避免 execFileSync + shell:true 的 DEP0190。
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/c', command, ...args], { cwd, stdio: 'inherit' });
  } else {
    execFileSync(command, args, { cwd, stdio: 'inherit' });
  }
}

function copyInto(from, to) {
  if (!existsSync(from)) throw new Error(`缺少 ${from}`);
  cpSync(from, to, { recursive: true });
}

step('构建 dist（tsc + postbuild）');
run('npm', ['run', 'build'], root);

if (!existsSync(path.join(root, 'dist', 'cli.js'))) {
  throw new Error('dist/cli.js 不存在，构建失败');
}

step('清理 deploy/fc/code');
rmSync(codeDir, { recursive: true, force: true });
mkdirSync(codeDir, { recursive: true });

step('复制 dist / config / 入口文件');
copyInto(path.join(root, 'dist'), path.join(codeDir, 'dist'));
copyInto(path.join(root, 'config'), path.join(codeDir, 'config'));
copyInto(path.join(here, 'index.js'), path.join(codeDir, 'index.js'));

const rootPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const fcPkg = JSON.parse(readFileSync(path.join(here, 'package.json'), 'utf8'));
// 函数里既要跑 CLI 的生产依赖，也要 ali-oss。
const mergedPackage = {
  name: 'notice-radar-fc',
  version: rootPkg.version,
  private: true,
  // dist/cli.js 是 ESM，函数入口 index.js 也是 ESM（import OSS from 'ali-oss'）。
  type: 'module',
  main: 'index.js',
  dependencies: { ...rootPkg.dependencies, ...fcPkg.dependencies },
};
writeFileSync(path.join(codeDir, 'package.json'), `${JSON.stringify(mergedPackage, null, 2)}\n`, 'utf8');

step(`安装生产依赖（${Object.keys(mergedPackage.dependencies).join(', ')}）`);
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], codeDir);

if (wantZip) {
  const zipPath = path.join(here, 'notice-radar-fc.zip');
  rmSync(zipPath, { force: true });
  step('打包 zip');
  if (process.platform === 'win32') {
    run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${codeDir}\\*' -DestinationPath '${zipPath}' -Force`], here);
  } else {
    run('zip', ['-qr', zipPath, '.'], codeDir);
  }
  process.stdout.write(`\u2713 完成：${zipPath}\n`);
} else {
  process.stdout.write(`\u2713 完成：${codeDir}\n`);
}
