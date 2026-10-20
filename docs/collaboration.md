# 一起开发：改动怎么进 `main`

这个仓库的 `main` 是**受保护分支**：除了仓库所有者和定时抓取机器人，谁都不能直接往里推。
这不是不信任，而是让"谁能改线上"这件事始终只由一个人拍板——网页版、APK 和抓取状态都从这里发布。

## 谁能做什么

| 角色 | 权限 | 能做的事 |
|---|---|---|
| 所有者 `@Yang-Yin734` | Admin | 合并 PR、改仓库设置、发版、紧急直接推送 |
| 共同开发者 | **Write** | 在自己的分支上随便推、开 PR、跑 CI；**不能**推 `main`、不能合并自己的 PR |
| 定时机器人 | GitHub Actions | 只提交 `data/`、`docs/` 下的状态文件（带 `[skip ci]`），不在保护范围内 |

## 日常流程

```bash
git switch main && git pull                 # 1. 先同步
git switch -c feat/school-zzu-college       # 2. 开分支（feat/ fix/ docs/ chore/ 前缀）
# 3. 改代码，跑本地校验
npx tsc --noEmit
npm test                                     # 全量测试（161 项）
node src/cli.ts dashboard                    # 改了 src/dashboard.ts 时
git add -A && git commit -m "feat(zzu): 接入计算机学院通知"
git push -u origin feat/school-zzu-college    # 4. 推到自己的分支（不是 main）
```

5. 在 GitHub 上开 Pull Request，标题写清"改了什么、为什么"，描述里贴一条 `radr doctor --show=3` 的输出（改了适配器时）。
6. 等 CI：`test` 这个检查必须绿。
7. 所有者审阅并 **Squash and merge**。合并后分支自动删除。

## `main` 上的硬性条件

- **至少 1 个批准**，且必须来自 CODEOWNERS（也就是所有者）；
- 新提交会**作废旧批准**（dismiss stale approvals）——改完再审，不能拿旧批准蒙过去；
- 必须解决所有 review 讨论；
- `test` 状态检查必须通过；
- 禁止强推、禁止删除分支。

## 哪些提交不需要人审

定时抓取（`poll` / `poll-math`）每轮会把状态写回 `data/runs.json`、`data/state.json`、`data/history.json`
和重建后的 `docs/`，提交信息形如 `chore(state): 2026-10-20T00:45Z [skip ci]`。
这些由 GitHub Actions 身份提交，走白名单，不占用你的审阅。**不要手动改这些文件**——下一轮会被覆盖。

## 改 `.github/workflows/` 要特别说明

工作流里能写 `permissions: contents: write`，也能读仓库 Secret。所以动工作流的 PR，请在描述里单独写一段
"为什么要改、会不会拿到新的权限"。所有者对这类 PR 会逐行看。

## 发版

版本号（`package.json`）、`CHANGELOG.md`、`docs/version.json` 由所有者在合并后统一 bump，
避免两个 PR 各自改版本号产生冲突。功能 PR 只需要在 `CHANGELOG.md` 的 `## 未发布` 段落里加一行。

## 回滚

线上出问题时，所有者可以直接 `git revert <sha>` 后推送（管理员豁免），或用 GitHub 的 Revert 按钮生成 PR 再快速合并。
机器人提交造成的数据异常，直接改回来即可——它们不承载逻辑。

## 如果不想给 Write 权限

也可以让共同开发者 **fork** 本仓库再提 PR：这样他完全碰不到原仓库的分支和 Secret，代价是每次同步上游要
`git remote add upstream ... && git fetch upstream`。适合"只偶尔提一两个学校适配器"的贡献者；
长期一起开发还是 Write + 本文件的流程更顺。
