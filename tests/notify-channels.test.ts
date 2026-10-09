import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, pageUrls, selectSources } from '../src/core/config.ts';
import type { SourceConfig } from '../src/core/config.ts';
import { markdownToHtml, notifyAll } from '../src/notify/index.ts';

const source = (id: string): SourceConfig =>
  ({
    id,
    name: `源${id}`,
    url: 'https://x.edu.cn/',
    adapter: 'html-list',
    enabled: true,
    requiresBrowser: false,
    browserHeadless: true,
    include: [],
    exclude: [],
    pages: 1,
  }) as unknown as SourceConfig;

// ------------------------------------------------ issue #2：--only

test('config：--only 只留下指定源，逗号可多选；没传就全都要', () => {
  const sources = [source('a'), source('b'), source('c')];
  assert.deepEqual(selectSources(sources, 'b').map((s) => s.id), ['b']);
  assert.deepEqual(selectSources(sources, 'a,c').map((s) => s.id), ['a', 'c']);
  assert.deepEqual(selectSources(sources, ' a , c ').map((s) => s.id), ['a', 'c'], '容忍空格');
  assert.deepEqual(selectSources(sources, 'nope').map((s) => s.id), []);
  assert.deepEqual(selectSources(sources, null).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(selectSources(sources).length, 3);
});

// ------------------------------------------------ issue #7：翻页

test('config：pages=1 原样返回；pages>1 改写 page 参数', () => {
  const url = 'https://www.jwc.uestc.edu.cn/hard/?page=1';
  assert.deepEqual(pageUrls(url, 1), [url]);
  assert.deepEqual(pageUrls(url, 2), [
    'https://www.jwc.uestc.edu.cn/hard/?page=1',
    'https://www.jwc.uestc.edu.cn/hard/?page=2',
  ]);
  assert.deepEqual(pageUrls('https://x.edu.cn/list/', 3), [
    'https://x.edu.cn/list/?page=1',
    'https://x.edu.cn/list/?page=2',
    'https://x.edu.cn/list/?page=3',
  ]);
});

test('config：URL 里写了 {page} 就用占位符（站点参数名不是 page 时）', () => {
  assert.deepEqual(pageUrls('https://x.edu.cn/list/index_{page}.html', 2), [
    'https://x.edu.cn/list/index_1.html',
    'https://x.edu.cn/list/index_2.html',
  ]);
  assert.deepEqual(pageUrls('https://x.edu.cn/list/', 0), ['https://x.edu.cn/list/'], 'pages<=0 视为 1');
});

// ------------------------------------------------ issue #3：人话报错

test('config：缺 selectors.item 时，报错带源名字、缺什么、去哪看文档（issue #3）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config-'));
  const file = path.join(dir, 'broken.yaml');
  fs.writeFileSync(
    file,
    [
      'school: demo',
      'name: 演示大学',
      'sources:',
      '  - id: jwc',
      '    name: 教务处·重要公告',
      '    url: https://example.edu.cn/list/',
      '    adapter: html-list',
      '    selectors:',
      '      title: a',
      '',
    ].join('\n'),
    'utf8',
  );

  let message = '';
  try {
    loadConfig(file);
  } catch (e) {
    message = (e as Error).message;
  }
  assert.match(message, /第 1 个源（教务处·重要公告）/, '要说清是哪个源');
  assert.match(message, /selectors\.item/, '要说清缺哪个字段');
  assert.match(message, /必须写 item/, '要给出怎么写');
  assert.match(message, /docs\/add-your-school\.md/, '要有文档链接');
  assert.ok(!/Required$/.test(message.trim()), '不要只甩一句 zod 的 Required');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config：html-list 缺整个 selectors 也有人话提示', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-config2-'));
  const file = path.join(dir, 'broken.yaml');
  fs.writeFileSync(
    file,
    ['school: demo', 'name: 演示', 'sources:', '  - id: a', '    name: 某某源', '    url: https://e.cn/', '    adapter: html-list', ''].join('\n'),
    'utf8',
  );
  let message = '';
  try {
    loadConfig(file);
  } catch (e) {
    message = (e as Error).message;
  }
  assert.match(message, /某某源/);
  assert.match(message, /selectors/);
  assert.match(message, /docs\/add-your-school\.md/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------ 通用通道（HTML 邮件、webhook 等）

test('notify：Markdown 转 HTML，链接可点、标题成 h2/h3、列表成 ul', () => {
  const html = markdownToHtml('# 标题\n\n共 **2 条**\n\n## 教务处（1 条）\n\n- 2026-09-02 [退课通知](https://x.cn/a)\n- `教管` 另一条\n');
  assert.match(html, /<h2>标题<\/h2>/);
  assert.match(html, /<b>2 条<\/b>/);
  assert.match(html, /<h3>教务处（1 条）<\/h3>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<a href="https:\/\/x\.cn\/a">退课通知<\/a>/, '链接必须可点（邮件里最关键）');
  assert.match(html, /<code>教管<\/code>/);
  assert.ok(!html.includes('**'), '不该残留 Markdown 记号');
});

test('notify：HTML 里会转义尖括号，避免注入', () => {
  const html = markdownToHtml('- <script>alert(1)</script>');
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('notify：缺密钥时给出"缺哪个变量"的提示，且不发网络请求', async () => {
  const outcomes = await notifyAll(
    [
      { type: 'email', enabled: true },
      { type: 'webhook', enabled: true },
    ],
    '测试',
    '正文',
  );
  const byChannel = new Map(outcomes.map((o) => [o.channel, o.detail]));
  assert.match(byChannel.get('email') ?? '', /SMTP_URL|SMTP_HOST/);
  assert.match(byChannel.get('webhook') ?? '', /url/);
  assert.ok(outcomes.every((o) => !o.ok), '没配密钥就必须明确失败，不能假装成功');
});

test('notify：禁用的通道完全不参与；stdout 永远算成功（所以自检要忽略它）', async () => {
  const outcomes = await notifyAll(
    [
      { type: 'stdout', enabled: true },
      { type: 'email', enabled: false },
    ],
    '测试',
    '正文',
  );
  assert.deepEqual(outcomes.map((o) => o.channel), ['stdout']);
});

test('config：已移除的第三方推送通道会被配置校验挡下，并说清改用哪个', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-removed-'));
  // wxpusher 是 v0.10.4 移除的，serverchan（Server酱/微信）是 v0.11.0 移除的。
  // 两者都必须报"已移除 + 改用 webhook/email/stdout"，不能只说"枚举值不对"。
  for (const type of ['wxpusher', 'serverchan']) {
    const file = path.join(dir, `config-${type}.yaml`);
    fs.writeFileSync(
      file,
      [
        'school: demo',
        'name: 演示',
        'notify:',
        `  - type: ${type}`,
        'sources:',
        '  - id: a',
        '    name: 源',
        '    url: https://e.cn/',
        '    adapter: html-list',
        '    selectors:',
        '      item: div.i',
        '      title: a',
        '',
      ].join('\n'),
      'utf8',
    );
    let message = '';
    try {
      loadConfig(file);
    } catch (e) {
      message = (e as Error).message;
    }
    assert.match(message, /notify/, '校验要指出是 notify 段的问题');
    assert.ok(message.includes(type), `报错要带上具体通道名（${type}）`);
    assert.match(message, /webhook|email|stdout/, '要告诉用户改用什么');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
