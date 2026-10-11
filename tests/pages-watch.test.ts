import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHealth, repoVersion } from '../tools/pages-watch.ts';

// 网页版外壳的真实样子（src/dashboard.ts 里那行「当前页面 v…」）
const shell = (v: string) => `<!doctype html><html><head><title>校园通知雷达</title></head><body><b id="ver-state">当前页面 v${v}</b></body></html>`;

test('evaluateHealth：站点在跑且是当前版本 → 正常', () => {
  const h = evaluateHealth({ status: 200, body: shell('0.11.2'), expectVersion: '0.11.2' });
  assert.equal(h.ok, true);
  assert.deepEqual(h.problems, []);
  assert.equal(h.version, '0.11.2');
});

test('evaluateHealth：整站 404 → 报 HTTP 404（Pages 被停用的典型表现）', () => {
  const h = evaluateHealth({ status: 404, body: '<html>404 Not Found</html>', expectVersion: '0.11.2' });
  assert.equal(h.ok, false);
  assert.equal(h.version, null);
  assert.match(h.problems.join(' '), /HTTP 404/);
});

test('evaluateHealth：200 但不是应用外壳 → 判失败', () => {
  // 比如被 WAF 挡了、或 Pages 返回了一个非本站页面
  const h = evaluateHealth({ status: 200, body: '<html><body>请稍候…正在验证</body></html>', expectVersion: '0.11.2' });
  assert.equal(h.ok, false);
  assert.match(h.problems.join(' '), /不是应用外壳/);
});

test('evaluateHealth：站点在但版本没跟上 → 判失败并说清差在哪', () => {
  const h = evaluateHealth({ status: 200, body: shell('0.11.1'), expectVersion: '0.11.2' });
  assert.equal(h.ok, false);
  assert.equal(h.version, '0.11.1');
  assert.match(h.problems.join(' '), /线上是 v0\.11\.1，仓库已是 v0\.11\.2/);
});

test('evaluateHealth：不传期望版本时只查"站点在不在"，不查版本', () => {
  const h = evaluateHealth({ status: 200, body: shell('0.10.0'), expectVersion: null });
  assert.equal(h.ok, true);
  assert.equal(h.version, '0.10.0');
});

test('evaluateHealth：网络错误 → 报连不上而不是 0 状态码', () => {
  const h = evaluateHealth({ status: 0, body: '', error: 'fetch failed (ENOTFOUND)' });
  assert.equal(h.ok, false);
  assert.match(h.problems.join(' '), /连不上：fetch failed \(ENOTFOUND\)/);
});

test('repoVersion：读仓库里的 docs/version.json', () => {
  const v = repoVersion();
  assert.match(String(v), /^\d+\.\d+\.\d+/);
});
