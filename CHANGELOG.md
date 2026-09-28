# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 未发布

- **学院通知也能在云端抓了（电脑关机照样推）**：新增 `.github/workflows/poll-math.yml`，
  每天 UTC 00:00（北京 08:00）在 runner 上挂虚拟显示器（Xvfb）跑**真实、非无头**的 Chrome
  —— 学院站点识别并拒绝无头浏览器（实测回 400），但不拒绝真浏览器窗口。
  这是"用真浏览器访问公开页面"，**没有伪造 UA、也没有隐藏 `navigator.webdriver`**；
  因为性质敏感，刻意低频：**一天只跑一次**，不跟着 `poll` 每 20 分钟打。
  - `src/core/browser.ts`：Linux 上自动加 `--disable-dev-shm-usage`，CI 里加 `--no-sandbox`
- 本机计划任务降级为**兜底**，时间从 08:00 改到 **09:00**（云端先跑，本地补漏；避免同时抓）
  - `run-daily.ps1` 的同步改用 `git pull --rebase --autostash`：工作区有未提交改动时也能同步
    （之前会直接失败并退化成只跑学院源）
- **故障判定分级**：`poll` 不再因偶发网络抖动就报红——连续"所有源都抓不到"1–2 次只记 warning，
  **第 3 次**才判真故障并报一次，之后静默到恢复（`tools/health.ts` + 4 个单元测试）
- **本机每日任务改为"能同步就跑全量"**：`tools/run-daily.ps1` 先 `git pull` 同步云端状态，
  成功则跑全部 6 个源；同步失败（代理没开）则降级为只跑学院 2 个源 —— 两种情况都不会与云端重复推送
  （本地与云端各记一份"已见"状态，不同步就跑全量会推两次）。计划任务名相应改为 `notice-radar-daily`
  - 新增可选开关 `$startProxy`：需要每天自动拉起代理客户端时打开
- 测试 15 → 19

- **新增浏览器渲染抓取**（零依赖：走 CDP，用本机已装的 Chrome/Edge，不引入 puppeteer）
  - 新增命令 `radr fetch <url> [--window] [--out=文件]`：渲染任意页面并导出 DOM，用于给"必须执行 JS"的站点摸结构、写选择器
  - 源配置新增 `requiresBrowser` / `browserHeadless` / `browserExpect`；这类源默认**跳过**，需显式 `--allow-browser`
- **接入数学科学学院两个栏目**（教务公告、学生工作）。实测该站点的瑞数类挑战会识别无头浏览器并回 `400`，
  普通窗口则正常 —— 因此学院源用可见窗口渲染，**只在本地有意义**；README 写明"不做指纹伪装"的边界与 Windows 计划任务用法
- 测试 14 → 15：新增学院页面的**渲染后快照** fixture
- `doctor` 与日报会区分「失败」与「跳过」，跳过的源不再算失败
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
