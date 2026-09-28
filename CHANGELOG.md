# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 未发布

- **不再空转提交**：默认只在真有新通知时才写 `data/state.json` 与 JSON 产物（`--write-always` 可强制）。
  之前每 20 分钟都会因 `lastRun` 变化产生一次提交，一天 72 个，会把提交历史淹掉
- `poll` 的 push 触发限定在 `config/**` 与自身，改文档/代码不再顺带触发抓取
- 两个 workflow 加 `timeout-minutes: 10`，避免某个源卡住白占 runner
- `poll` 对"全部源不可达"（境外 runner 到境内站点的跨境抖动）自动重试 3 次，失败时额外打印 `doctor` 体检表便于定位
- 测试入口改为 `tools/run-tests.mjs`：显式发现 `*.test.ts` 再交给 `node --test`，
  修掉"本地 Node 26 能跑、CI Node 24 找不到测试文件"的版本差异
- 新增 `tools/gh-setup.mjs`：一条命令配好仓库描述/topics/labels/good first issues/Release（可选 Pages 与 Actions secret）

## v0.1.0 — 2026-09-28

第一个可用版本：**每天真的能收到学校通知**。

### 新增

- **三个源开箱可用**（电子科技大学）：教务处·重要公告、教务处·学生事务公告、新闻网·公告、研究生院·通知
- **通用 `html-list` 适配器**：选择器写在 YAML 里，接新学校不用写代码
- **专属适配器**：`uestc/jwc`（链接靠 `newsId` 拼、分类藏在锚文本里）、`uestc/gr`
- **推送通道**：Server酱 / 通用 webhook / stdout，密钥只从环境变量或 `.env` 读，永不进仓库
- **命令行**：`radr run`（`--dry` / `--no-notify` / `--json` / `--delay` / `--max`）、`radr doctor`、`radr list`、`radr --version`
- **关键词过滤**：包含/排除（排除优先），按源独立配置
- **两级去重**：源内按稳定 ID（标题+日期哈希）、跨源按归一标题+日期合并，并在日报里标注「另见」
- **状态增量**：只记"见过哪些通知 ID"，不含正文与个人信息
- **健壮性**：串行抓取 + 间隔、5xx 退避重试、编码嗅探（gbk/gb2312 也能吃）、中文逐字排版归一
- **CI/CD**：`poll.yml` 每 20 分钟抓取并把状态提交回仓库（零服务器）；`ci.yml` 跑测试与类型检查
- **11 个测试用例**，全部跑在真实页面快照上（`tests/fixtures/`），不依赖网络

### 已知限制

- 只抓列表首页，不做历史回溯
- 带 JS 挑战 WAF 的站点（如学院官网）**明确不支持**，不绕过
- GitHub Actions 的 cron 最小 5 分钟且会延迟，重要窗口期请自己盯一眼
