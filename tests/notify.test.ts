import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyAll } from '../src/notify/index.ts';
import type { NotifyConfig } from '../src/core/config.ts';

const email = (over: Partial<NotifyConfig> = {}): NotifyConfig =>
  ({ type: 'email', enabled: true, ...over }) as NotifyConfig;

test('email 通道：缺 SMTP_URL 时给出可操作的提示（不是静默失败）', async () => {
  delete process.env.SMTP_URL;
  process.env.MAIL_TO = 'me@example.com';

  const [outcome] = await notifyAll([email()], '标题', '正文');
  assert.equal(outcome.channel, 'email');
  assert.equal(outcome.ok, false);
  assert.match(outcome.detail, /SMTP_URL/);
});

test('email 通道：有 SMTP_URL 但缺 MAIL_TO 时也明确报错', async () => {
  process.env.SMTP_URL = 'smtps://user:pass@smtp.example.com:465';
  delete process.env.MAIL_TO;

  const [outcome] = await notifyAll([email()], '标题', '正文');
  assert.equal(outcome.ok, false);
  assert.match(outcome.detail, /MAIL_TO/);
});

test('email 通道：没装 nodemailer 时提示装可选依赖，而不是抛异常', async () => {
  process.env.SMTP_URL = 'smtps://user:pass@smtp.example.com:465';
  process.env.MAIL_TO = 'me@example.com';

  const [outcome] = await notifyAll([email()], '标题', '正文');
  assert.equal(outcome.ok, false);
  // 本仓库不把 nodemailer 列为依赖，所以这里应命中"没装"的分支
  assert.match(outcome.detail, /nodemailer/);
});

test('email 通道：未知通道类型不会让整批推送崩掉', async () => {
  const outcomes = await notifyAll([{ type: 'stdout', enabled: true } as NotifyConfig], '标题', '正文');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].ok, true);
});
