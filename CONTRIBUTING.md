# 贡献指南

欢迎！这个项目的目标不是"支持尽可能多的学校"，而是**把接入成本降到别人愿意动手的程度**。

> 推送前先 `git pull --rebase origin main`：`poll` 工作流会把抓取状态提交回 main，
> 你本地落后时 `git push` 会被拒（这是正常现象，不是权限问题）。
>
> **`docs/` 与 `data/` 里是构建产物/状态文件，别做文本合并。** 它们由你本地和云端各自重建，
> 一撞必冲突。冲突时不要手工合并，直接重新生成再提交：
>
> ```bash
> git fetch origin main
> git merge -X ours --no-edit origin/main   # 产物以你刚重建的为准
> npm run dashboard                          # 基于合并后的数据重新生成
> git add -A && git commit -m "chore: 重建产物" && git push
> ```
>
> 提交 `<<<<<<<` 冲突标记进 `docs/` 会把线上页面搞坏（真发生过），CI 现在会拦住它。

## 首次跑起来

```bash
npm install
npm run doctor        # 看看内置的电子科大源通不通
npm test              # 测试跑在真实页面快照上，不需要网络
```

## 加一个学校（YAML，大多数情况）

1. 复制 `config/sources.example.yaml` 到 `config/schools/<学校ID>.yaml`
2. 打开目标页面，F12 抄下列表项容器的选择器，填进 `selectors`
3. `node src/cli.ts doctor --config=config/schools/<学校ID>.yaml` 看能不能解析出来
4. 在 `tools/capture-fixtures.mjs` 的 `targets` 里加上该校的源，跑 `node tools/capture-fixtures.mjs <学校ID>` 抓快照
5. 在 `tests/adapters.test.ts` 里加一组断言
6. 提 PR

## 加一个适配器（结构特殊时）

适用场景：链接靠 JS 拼、标题/分类混在锚文本里、需要进详情页才有日期。

1. 照 `src/adapters/uestc/jwc.ts` 新建 `src/adapters/<学校>/<栏目>.ts`，实现 `Adapter` 接口
2. 在 `src/adapters/index.ts` 的 `adapters` 里注册
3. 补 fixture 测试

## PR 约定

- **一个 PR 只加一个学校或一个源**，方便回滚
- **必须带 fixture 测试**：没有测试的解析器，站点一改版就静默失效
- 不要提交任何密钥、Cookie、个人信息
- 不要提交"绕过反爬"的实现——见 README「合规与边界」

## 提交前自查

```bash
npm test            # 测试入口是 tools/run-tests.mjs（自动发现 tests/**/*.test.ts）
npx tsc --noEmit
npm run doctor
```

> 为什么测试入口要多一层脚本：`node --test tests/` 在不同 Node 版本里对 `.ts` 文件的默认匹配行为不一致（本地 Node 26 能匹配、CI 的 Node 24 匹配不到，job 直接失败）。显式传路径则任何版本都稳。

## 行为准则

对事不对人。提 issue 时说清"哪个源、什么现象、`doctor` 输出是什么"。
