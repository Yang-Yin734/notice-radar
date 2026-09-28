# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## v0.5.0 — 2026-09-28

应用变成**能自己管推送、能自己提示升级**的样子，并补上 iOS 的安装路径。

### 新增

- **微信推送开关（应用内）**：设置页一个开关，写的是仓库变量 `PUSH_ENABLED`；
  两个抓取工作流都在 job 级读它（`if: vars.PUSH_ENABLED != 'false'`）——**关掉后云端连抓取都跳过**。
  应用改仓库变量需要令牌（**Fine-grained、只授本仓库的 `Variables: Read and write`**），
  令牌只存本机 `localStorage`；不想给令牌也能在 GitHub 网页上手动改
- **应用内更新提示**：
  - 新增 `docs/version.json` 版本清单（构建时写入，`sw.js` 对它走网络优先）
  - Service Worker 检测到新外壳 → 顶部横幅「有新版本，点右侧立即生效」→ 点一下 `skipWaiting` + 刷新
  - APK 版（`display-mode: standalone`）检测到线上版本更高 → 提示下载新安装包（同密钥签名，可覆盖安装）
  - 设置页有「检查更新」，显示当前版本 / 最新版本 / 检查时间
- **iOS 路径**：应用识别 UA —— Android 提示下载 APK，**iOS 提示「添加到主屏幕」**（Safari → 分享 → 添加到主屏幕）；
  新增 [docs/ios.md](docs/ios.md) 讲清三条路（PWA 安装 / App Store / 侧载未签名 IPA）各自要什么条件
- 设置页还多了「本机数据」：一键清除已读标记 / 收藏

### 说明（关于"苹果安装包"）

- **做不出可安装的 iOS 包，也不做假的**：Apple 要求所有可安装应用必须用其签发的证书签名，
  本项目没有 Apple 开发者账号（$99/年）与 Mac。**iOS 上等价且体验更好的做法是 PWA**：
  Safari「添加到主屏幕」→ 独立图标、全屏、可离线、永不过期、零成本
- 侧载未签名 IPA 理论可行（Sideloadly + 自己的 Apple ID），但 **7 天过期要重签**；
  项目暂不提供 IPA，需要的话可以补 macOS runner 构建流程

### 变更

- 标签栏「关于」并入「设置」，4 个标签：通知 / 收藏 / 统计 / 设置
- `sw.js` 缓存版本升到 v2；`version.json` 与 `dashboard-data.json` 走网络优先
- 测试 34 → 37（新增：推送开关读写变量、版本检测与更新横幅、iOS 引导）

## v0.4.0 — 2026-09-28

**有了手机安装包（APK）**：一条固定链接下载安装，不用再教用户"添加到主屏幕"。

### 新增

- **Android APK（TWA 套壳）**，固定下载地址：
  <https://github.com/Yang-Yin734/notice-radar/releases/download/android-latest/notice-radar.apk>
  - [`.github/workflows/android.yml`](.github/workflows/android.yml)：在 runner 上（自带 JDK 17 + Android SDK）
    用 Bubblewrap 构建并用固定密钥签名，发布到滚动 Release 标签 `android-latest`，同时保留构建产物
  - `android/`：Bubblewrap 生成的 TWA 工程。**本地 `init` 一次后提交**，CI 只做构建
    （`init` 全是交互式提问，CI 里没有 TTY 会直接崩）
  - `tools/make-android-keystore.mjs`：本机没有 JDK/keytool 也能生成 PKCS#12 签名密钥（纯 JS），并输出 SHA-256 指纹；
    `tools/gh-set-secrets.mjs`：只写 secrets，不触发任何"仓库装修"
  - 应用内下载入口：Android 用户打开时**列表顶部出现安装横幅**（可关闭，记在本机），"关于"标签里也有大按钮
  - `docs/.well-known/assetlinks.json`：记下签名指纹

### 说明（诚实交代）

- 因为没有 Firebase 配置，APK 内**关闭了通知**（推送仍走 Server酱 → 微信，不依赖应用内通知）
- **没有做 Digital Asset Links 校验**：Android 只会在**域名根**找 `assetlinks.json`
  （`https://yang-yin734.github.io/.well-known/assetlinks.json`），而本项目位于 `github.io` 的子路径下，无法提供根路径文件。
  所以 APK 打开后顶部会显示地址栏（Custom Tabs 模式）。想全屏需要另建 `Yang-Yin734.github.io` 仓库把该文件放到根路径，或换自定义域名
- 本机没有 Android 设备，**无法真机安装验证**；能验证的是：构建成功、APK 结构合法、签名指纹与本机密钥一致

### 踩坑记录（给后来者省点时间）

在 CI 里用 Bubblewrap 打 TWA，这几处都会让人卡住，全部已修：

1. **它会交互式问"要不要由它安装 JDK"** → 没有 TTY 直接崩。写 `~/.bubblewrap/config.json`（`jdkPath`/`androidSdkPath`）即可跳过
2. **它只认 `$SDK/tools` 或 `$SDK/bin`**，而现代 Android SDK 布局里两者都没有 → 一直报 `The provided androidSdk isn't correct.`。
   补一条软链 `$SDK/bin → cmdline-tools/latest/bin` 即可（它也从 `bin/` 找 sdkmanager）。它还硬编码要 `build-tools;36.1.0`
3. **`init` 全是交互式提问**（Domain/URL path/图标…），CI 里跑不了 → 本地 `init` 一次，把工程提交，CI 只 `build`
4. **它比对 `manifest-checksum.txt` 与 `twa-manifest.json` 的 sha1**，不一致（或文件缺失）就弹"要不要应用变更" → 改了 manifest 必须顺手重算校验和（算法就是 sha1(文件字节)）
5. **包名/版本不在 twa-manifest.json 里生效**：`init` 会把配置**内联**进 `app/build.gradle` 的 `twaManifest` 映射，
   且 `defaultConfig.applicationId` 才最终决定 APK 包名 → 只改 manifest 会让 APK 还是旧包名/旧版本号
6. **AGP 8+ 不允许源码 `AndroidManifest.xml` 里再有 `package` 属性** → 与 `namespace` 冲突，构建直接失败，要删掉该属性
7. **它签名时给密码自带双引号**（`pass:"密码"`）→ apksigner 报 `Failed PKCS12 integrity checking`。
   本项目改为 `--skipSigning` + 自己调 `apksigner`（密码走 `env:`，不进命令行）
8. **node-forge 导出的 PKCS#12 必须设 `friendlyName`**，否则私钥条目没有别名，apksigner 报 `entry does not contain a key`
9. **Windows 检出会丢 `gradlew` 的可执行位** → `git update-index --chmod=+x`，CI 里也补一次 `chmod +x`
10. **GitHub Pages 默认不发布点号目录** → `docs/.well-known/assetlinks.json` 404，加 `docs/.nojekyll` 才会发布

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
