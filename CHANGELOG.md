# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## v0.3.0 — 2026-09-28

把归档页升级成**手机、电脑都能用的应用**（PWA）：能装到主屏幕、能离线翻、收藏和已读只存本机。

### 新增

- **PWA 应用**（`src/dashboard.ts` 重写为移动优先的应用外壳）
  - 手机：底部标签栏（通知 / 收藏 / 统计 / 关于）、大点击区、`env(safe-area-inset-*)` 刘海屏适配
  - 电脑：顶部胶囊标签栏 + 居中窄栏。**刻意不做两列** —— 通知流每天一两条，两列会浪费一半宽度，
    也不利于读长标题（实测：1280px 下单列 720px 阅读宽度）
  - **收藏 / 已读**：卡片右下角 ☆ 收藏、点标题标记已读，标签栏带未读与收藏角标；
    状态只写 `localStorage`，换设备不跟随、也不上传
  - **深色模式**：跟随系统，右上角 ◐ 可手动切换（选择记在本机）
  - **刷新**按钮直接拉 `docs/dashboard-data.json`，不必等页面重新构建
  - **未读标识**：未读卡片左侧有强调色竖条，已读变淡
- **离线可用**：`docs/sw.js`（外壳缓存优先、数据"网络优先 + 离线回落"）+ `docs/manifest.webmanifest`
  + `docs/icon-192.png` / `icon-512.png`（图标由 `docs/icon-source.html` 经无头浏览器导出，可重新生成）
- **安装入口**：Android/桌面 Chrome 支持 `beforeinstallprompt` 时顶栏直接出现"安装"按钮；
  iOS 的安装步骤写在"关于"标签里

### 变更

- 数据改为内嵌 JSON + 前端渲染（此前是服务端预渲染整页）。**代价**：关掉 JS 看不到列表
  （README 里原先那句"关掉 JS 也能读"已删除）；**换来的**是标签栏、收藏、已读、刷新这些应用能力
- 测试 32 → 33：`tests/app.test.ts` 断言 PWA 要素（manifest / 图标 / 视口 / SW 注册 / 标签栏 / 断点）、
  内嵌数据、XSS 转义、`maxItems` 截断

### 修复

- **线上页面一度被冲突标记搞坏**（重要教训）：`docs/` 下是构建产物，本地与云端都会重建，两边一撞必冲突。
  之前给工作流加的 `git pull --rebase --autostash || echo warning` 在冲突后会继续 `git add -A`，
  于是 `<<<<<<<` 标记被提交并部署到了线上。现在改为：
  - 两个抓取工作流**开工前先同步远端**；提交时用 `git merge -X ours`（产物以本次构建为准），
    合并失败就报错退出，绝不提交
  - CI 新增守卫：`docs/`、`data/` 里出现冲突标记直接失败
  - `CONTRIBUTING.md` 写明：产物文件不做文本合并，冲突就重新生成
- 手机端横向溢出：flex 子项默认 `min-width:auto` 会被输入框固有宽度撑破布局，补 `min-width:0`
  （用 CDP 实测确认：`innerWidth` 与 `document.scrollWidth` 都是 390，不再溢出）
- 窄屏（≤440px）顶栏不再折行：品牌名可省略号收缩、按钮不换行、统计药丸收起（未读数标签栏上仍有）

## v0.2.0 — 2026-09-28
M2：**有了归档和仪表盘**——推送解决"新通知"，仪表盘解决"我想找上个月那条"。

### 新增

- **通知归档 + GitHub Pages 仪表盘**
  - 新增 `src/core/history.ts`：`state.json` 只记 ID（去重），`history.json` 才留内容；
    按 id 去重、按日期倒序、上限 3000 条，仓库不会无限膨胀（7 个单元测试）
  - 新增 `src/dashboard.ts` + `radr dashboard`：渲染**自包含**的静态页（内联 CSS + 原生 JS，无 CDN），
    支持标题搜索、按来源筛选、按日期分组、最近 14 天趋势、按来源统计；
    同时导出 `docs/dashboard-data.json` 供二次利用（7 个单元测试，含 XSS 转义断言）
  - 两个抓取工作流在提交状态时顺带重建仪表盘并提交
  - 在线地址：https://yang-yin734.github.io/notice-radar/
- **邮件推送通道**（`type: email`）：读 `SMTP_URL` / `MAIL_TO` / `MAIL_FROM`；
  `nodemailer` 是**可选依赖**（核心保持零额外依赖），没装时给出安装提示而不是静默失败
- **`radr test-notify`**：只发一条测试消息，用来确认推送密钥配好了没有；
  结果写进 `data/last-notify.json`（脱敏 `readkey`），可从提交记录查证，不必翻 Actions 日志
- **`data/last-notify.json`**：每次真实推送的结果都留档，排查"云端到底推出去没有"时很有用

### 修复

- `test-notify` 的判定忽略 `stdout` 通道：它永远"成功"，会让自检永远显示通过
- `tools/gh-setup.mjs` 设置 Actions secret 改用 **libsodium** 官方实现
  （曾用 tweetnacl 原语手写 sealed box，GitHub 回 `422 improperly encrypted secret`）——密码学不自己写

### 变更

- 测试 19 → 33（新增 history / dashboard / notify 三组）
- CI 增加"仪表盘能构建"一步：构建产物坏了不必等到部署才发现

## v0.1.0 之后、v0.2.0 之前

- **学院通知也能在云端抓了（电脑关机照样推）**：新增 `.github/workflows/poll-math.yml`，
  每天 UTC 00:00（北京 08:00）在 runner 上挂虚拟显示器（Xvfb）跑**真实、非无头**的 Chrome
  —— 学院站点识别并拒绝无头浏览器（实测回 400），但不拒绝真浏览器窗口。
  这是"用真浏览器访问公开页面"，**没有伪造 UA、也没有隐藏 `navigator.webdriver`**；
  因为性质敏感，刻意低频：**一天只跑一次**，不跟着 `poll` 每 20 分钟打。
  - `src/core/browser.ts`：Linux 上自动加 `--disable-dev-shm-usage`，CI 里加 `--no-sandbox`
- **故障判定分级**：`poll` 不再因偶发网络抖动就报红——连续"所有源都抓不到"1–2 次只记 warning，
  **第 3 次**才判真故障并报一次，之后静默到恢复（`tools/health.ts` + 4 个单元测试）
- 本机计划任务改为"能同步就跑全量"、时间 09:00、可选 `$startProxy`；
  `run-daily.ps1` 的同步改用 `git pull --rebase --autostash`
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
