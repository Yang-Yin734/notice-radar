import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { DEFAULT_TIMEOUT_MS, preferIPv4First } from '../src/core/fetch.ts';

/**
 * 这两个默认值不是随手写的，都是"境外 runner 抓国内站点失败"的直接对策，
 * 所以要有测试钉住它们，避免以后被无意改回去。
 */
test('fetch：DNS 默认 IPv4 优先（这些域名都有教育网 AAAA，境外走 IPv6 只会超时）', () => {
  preferIPv4First();
  assert.equal(dns.getDefaultResultOrder(), 'ipv4first');
  preferIPv4First(); // 幂等，重复调用不该出问题
  assert.equal(dns.getDefaultResultOrder(), 'ipv4first');
});

test('fetch：跨境抓取超时不得小于 30 秒（20 秒会把"慢但能成功"的请求误杀）', () => {
  assert.ok(DEFAULT_TIMEOUT_MS >= 30000, `当前 ${DEFAULT_TIMEOUT_MS}ms 太短`);
});
