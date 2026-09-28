import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/core/config.ts';

/**
 * 适配器市场的完整性校验：
 * registry.json 里登记的预设必须真实存在，反过来每个 config/schools/*.yaml 也必须被登记，
 * 否则"市场"会逐渐和现实脱节（有人加了学校却没人知道由谁维护）。
 */
const registryFile = 'config/schools/registry.json';
const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8')) as {
  version: number;
  schools: {
    id: string;
    name: string;
    presets: string[];
    sources?: number;
    maintainers: string[];
    status: string;
    lastVerified: string;
    notes?: string;
  }[];
};

test('适配器市场：registry.json 结构合法', () => {
  assert.equal(registry.version, 1);
  assert.ok(Array.isArray(registry.schools) && registry.schools.length > 0, '至少登记一个学校');

  const ids = registry.schools.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, '学校 id 不能重复');

  for (const school of registry.schools) {
    assert.match(school.id, /^[a-z0-9-]+$/, `${school.id} 应是小写字母数字与连字符`);
    assert.ok(school.name.length > 0, `${school.id} 缺名字`);
    assert.ok(school.presets.length > 0, `${school.id} 至少一个预设`);
    assert.ok(school.maintainers.length > 0, `${school.id} 必须有人负责（维护者不能为空）`);
    assert.ok(['verified', 'community', 'broken'].includes(school.status), `${school.id} 状态取值不合法`);
    assert.match(school.lastVerified, /^\d{4}-\d{2}-\d{2}$/, `${school.id} 最后验证日期格式应为 YYYY-MM-DD`);
  }
});

test('适配器市场：登记的预设文件都真实存在', () => {
  for (const school of registry.schools) {
    for (const preset of school.presets) {
      assert.ok(fs.existsSync(preset), `${school.id} 的预设不存在：${preset}`);
    }
    if (school.sources !== undefined) {
      // sources 记的是"主预设"的源数量，对不上说明有人改了配置忘了更新登记
      const main = loadConfig(school.presets[0]);
      assert.equal(
        school.sources,
        main.sources.length,
        `${school.id} 登记 ${school.sources} 个源，但 ${school.presets[0]} 里是 ${main.sources.length} 个`,
      );
    }
  }
});

test('适配器市场：每个学校预设都被登记过（不许有"野生"预设）', () => {
  const registered = new Set(registry.schools.flatMap((s) => s.presets.map((p) => path.normalize(p))));
  const files = fs
    .readdirSync('config/schools')
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => path.normalize(path.join('config/schools', f)));

  assert.ok(files.length > 0, 'config/schools 下应该有预设');
  for (const file of files) {
    assert.ok(registered.has(file), `${file} 没有登记进 registry.json（谁会维护它？）`);
  }
});
