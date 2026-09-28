import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyHealth, loadHealth, saveHealth, updateHealth } from '../tools/health.ts';

/** 故障判定：偶发网络抖动不该让 CI 变红，连续失败才报。 */

test('health：连续失败达到阈值才判故障，且一个故障期只报一次', () => {
  let state = emptyHealth();

  const first = updateHealth('fail', state);
  assert.equal(first.fail, false, '第 1 次失败只记 warning');
  assert.equal(first.level, 'warning');
  state = first.state;

  const second = updateHealth('fail', state);
  assert.equal(second.fail, false, '第 2 次失败仍然只记 warning');
  state = second.state;

  const third = updateHealth('fail', state);
  assert.equal(third.fail, true, '第 3 次连续失败判为真故障');
  assert.equal(third.level, 'error');
  state = third.state;

  const fourth = updateHealth('fail', state);
  assert.equal(fourth.fail, false, '同一个故障期不重复报红（否则每 20 分钟一封邮件）');
  assert.equal(fourth.state.consecutiveAllFail, 4, '计数继续累加，但不再报红');
});

test('health：成功一次就清零，下一次故障可以重新报', () => {
  let state = updateHealth('fail', emptyHealth()).state;
  state = updateHealth('fail', state).state;
  state = updateHealth('fail', state).state;
  assert.equal(state.reported, true);

  const recovered = updateHealth('ok', state);
  assert.equal(recovered.state.consecutiveAllFail, 0);
  assert.equal(recovered.state.reported, false);
  assert.equal(recovered.changed, true, '从故障恢复算状态变化，需要写文件');
  assert.match(recovered.message, /恢复正常/);

  state = recovered.state;
  const again = [updateHealth('fail', state), updateHealth('fail', updateHealth('fail', state).state)];
  assert.equal(again[1].state.consecutiveAllFail, 2);
  const thirdFail = updateHealth('fail', again[1].state);
  assert.equal(thirdFail.fail, true, '恢复后重新计数，第 3 次仍会报');
});

test('health：一直正常时不产生状态变化（避免每轮都提交）', () => {
  const verdict = updateHealth('ok', emptyHealth());
  assert.equal(verdict.changed, false);
  assert.equal(verdict.state.consecutiveAllFail, 0);
});

test('health：阈值可配置；读写文件能往返', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notice-radar-health-'));
  const file = path.join(dir, 'health.json');

  const v1 = updateHealth('fail', loadHealth(file), { threshold: 2 });
  assert.equal(v1.fail, false);
  saveHealth(v1.state, file);
  const v2 = updateHealth('fail', loadHealth(file), { threshold: 2 });
  assert.equal(v2.fail, true, '阈值设为 2 时第 2 次就报');
  assert.equal(loadHealth(file).consecutiveAllFail, 1, '文件里存的是写入时的计数');

  fs.rmSync(dir, { recursive: true, force: true });
});
