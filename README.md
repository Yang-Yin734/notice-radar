<div align="center">

# 校园通知雷达 · notice-radar

**把"没有 RSS、还被 WAF 挡着"的高校官网通知，变成可订阅、可关键词过滤、能推到手机的信息流。**

配置驱动 · 零服务器 · 不登录 · 任何学校 5 分钟接入

[![ci](https://github.com/Yang-Yin734/notice-radar/actions/workflows/ci.yml/badge.svg)](https://github.com/Yang-Yin734/notice-radar/actions/workflows/ci.yml)
[![android-apk](https://github.com/Yang-Yin734/notice-radar/actions/workflows/android.yml/badge.svg)](https://github.com/Yang-Yin734/notice-radar/actions/workflows/android.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-339933.svg)](package.json)
[![version](https://img.shields.io/badge/version-v0.4.0-4d6bfe.svg)](CHANGELOG.md)

### 📲 [**下载 Android 安装包（APK）**](https://github.com/Yang-Yin734/notice-radar/releases/download/android-latest/notice-radar.apk)

装到手机上就是独立应用；也可以直接用网页版 → **<https://yang-yin734.github.io/notice-radar/>**

</div>

---

## 两种用法，选一个

| | 怎么用 | 适合 |
|---|---|---|
| **下载 APK** | [点这里下载](https://github.com/Yang-Yin734/notice-radar/releases/download/android-latest/notice-radar.apk) → 手机上安装。首次会提示"允许安装未知来源应用" | 想把它当成一个正常 App（桌面图标、点开即用） |
| **直接用网页** | 打开 <https://yang-yin734.github.io/notice-radar/>，可"添加到主屏幕" | 不想装东西，或者用 iPhone |

> APK 是把网页套壳成原生应用（TWA，Trusted Web Activity）——打开的还是同一个网址，所以内容永远是最新的，
> 也不用为每次更新重新下载。它由 [android.yml](.github/workflows/android.yml) 在 GitHub 上自动构建并用固定密钥签名，
> 同一把密钥才能覆盖安装（密钥生成见 [`tools/make-android-keystore.mjs`](tools/make-android-keystore.mjs)）。

---

## 解决什么问题

学校通知散在教务处、学院、研究生院、新闻网十几个栏目里，而且：

1. **没有 RSS。** 想订阅只能自己写爬虫。
2. **有反爬。** 常见的是瑞数类 JS 挑战 WAF：非浏览器请求直接返回 `202` + 一个 2 KB 的挑战页。
3. **错过的代价很大。** 退课补选、重新学习报名、缓补考安排、推免名单、四六级报名——每条都有窗口期。

实测（2026-09-27，本机直连）：

| 源 | 结果 | 能否解析 |
|---|---|---|
| 教务处（重要公告 / 学生事务） | 200 / 25–29 KB | ✅ |
| 新闻网（公告 / 学术） | 200 / 86 KB | ✅ |
| 研究生院（通知） | 200 / 32 KB，含 JS 挑战脚本 | ⚠️ 时好时坏 |
| 学院官网（数学科学学院等） | **202 / 2.4 KB 挑战页**（无头浏览器会被回 400） | 🖥 用可见浏览器渲染，见「已支持」 |
| 公共 RSSHub | 10.5 s 超时 | ❌ 境内基本不可用 |

## 日报长什么样

`radr run` 的输出就是一条可以直接推到微信的 Markdown 消息（下面这张图由真实抓取结果渲染，生成脚本见 `tools/render-preview.mjs`）：

![日报预览](docs/preview.png)

## 30 秒上手

需要 Node ≥ 22.18（利用 Node 原生的 TypeScript 支持，仓库里跑无需编译步骤）。

**只想试试看**（不用 clone，直接跑 npm 包）：

```bash
npx notice-radar list       # 看内置的学校预设
npx notice-radar schools    # 适配器市场：谁维护哪个学校
npx notice-radar doctor     # 体检：每个源能不能抓、解析出几条
npx notice-radar stats      # 归档频次统计（来源/标签/周/星期分布）
```

> 包发的是编译后的 JS：Node 不允许对 `node_modules` 里的文件做类型剥离，细节见 [docs/publish.md](docs/publish.md)。

**要改配置、加自己学校**（推荐 clone）：

```bash
git clone https://github.com/Yang-Yin734/notice-radar.git
cd notice-radar
npm install

npm run doctor          # 先体检：每个源能不能抓、解析出几条
npm run run -- --dry    # 干跑：打印日报，不写状态、不推送

# 真推送到微信（Server酱 SendKey 从 https://sct.ftqq.com 拿）
SERVERCHAN_KEY=SCTxxxxxxxx npm run run
```

Linux/macOS 用 `SERVERCHAN_KEY=... npm run run`，Windows PowerShell 用 `$env:SERVERCHAN_KEY="..."; npm run run`；也可以复制 `.env.example` 为 `.env` 填好 —— CLI 会自动加载它（用 Node 原生能力，不依赖 dotenv）。

## 命令

| 命令 | 作用 |
|---|---|
| `radr doctor` | 体检：逐源显示状态码、体积、耗时、解析条目数，一眼看出是"站点变了"还是"选择器过时了" |
| `radr run` | 抓取 → 解析 → 关键词过滤 → 去重 → 出日报 → 推送 → 更新状态 |
| `radr list` | 列出配置里的源与关键词数量 |
| `radr --version` | 打印版本 |
| `radr run --dry` | 不写状态、不推送（调试用） |
| `radr run --no-notify` | 只出日报不推送 |
| `radr run --json=data/latest.json` | 同时导出结构化 JSON，方便二次开发 |
| `radr run --write-always` | 即使没有新通知也写状态与产物（默认只在有新通知时写） |
| `radr run --allow-browser` | 允许抓「需要浏览器渲染」的源（学院站点会短暂弹出浏览器窗口，几秒后自动关闭） |
| `radr fetch <url> [--window] [--out=文件]` | 用浏览器渲染任意页面并导出 DOM —— 给 WAF 站点写选择器时用它 |
| `radr dashboard` | 把历史归档渲染成静态仪表盘（`docs/index.html`，GitHub Pages 用） |
| `radr test-notify` | 只发一条测试消息，验证推送密钥配好没有 |
| `radr stats [--json=文件]` | 通知频次统计：来源/标签/最近 12 周/星期分布/单日最多 |
| `radr schools [--json=文件]` | 适配器市场：列出已知学校预设与维护者 |

## 已支持

| 学校 | 源 | 适配器 | 状态 |
|---|---|---|---|
| 电子科技大学 | 教务处·重要公告 | `uestc/jwc` | ✅ 实测可解析 |
| 电子科技大学 | 教务处·学生事务公告 | `uestc/jwc` | ✅ 实测可解析 |
| 电子科技大学 | 新闻网·公告 | `html-list`（通用） | ✅ 实测可解析 |
| 电子科技大学 | 研究生院·通知 | `uestc/gr` | ⚠️ 站点带 WAF，偶发失败 |
| 电子科技大学 | 数学科学学院·教务公告 | `html-list` + 浏览器 | ✅ 云端每天 08:00 + 本机兜底 |
| 电子科技大学 | 数学科学学院·学生工作 | `html-list` + 浏览器 | ✅ 云端每天 08:00 + 本机兜底 |

想加自己学校？看 **[docs/add-your-school.md](docs/add-your-school.md)** —— 大多数站点只要写一段 YAML。

### 🖥 学院级站点：为什么要"真实浏览器"

数学科学学院官网部署了瑞数（RiverSecurity）类 JS 机器人挑战，实测：

| 访问方式 | 结果 |
|---|---|
| 普通 HTTP 请求（Node fetch） | `202` + 2.4 KB 挑战页 |
| 带上挑战页下发的 Cookie 重放 | 仍是 `202` |
| **无头浏览器（headless Chrome/Edge）** | **`400 Bad Request`** —— 它认得出无头 |
| **真实浏览器窗口** | ✅ 正常渲染，拿到完整通知列表 |

所以这两个源用 `browserHeadless: false` 渲染，**两处都能跑**：

| 运行位置 | 怎么跑 | 时间 |
|---|---|---|
| GitHub Actions | `poll-math.yml`：给 runner 挂虚拟显示器（Xvfb）跑真实（非无头）Chrome | **每天北京 08:00** |
| 你的电脑 | `tools/run-daily.ps1`（计划任务）| **每天 09:00**，兜底补漏 |

**为什么云端能跑**：不是伪造 UA、也没有隐藏 `navigator.webdriver`——就是启动一个**真的、非无头的** Chrome，只不过它的"屏幕"是 Xvfb 提供的虚拟显示器。站点拒绝的是"无头"这个特征，而这里根本没有无头。

**为什么一天只跑一次**：这类站点部署机器人挑战是为了挡爬虫。我们每天只去看一次最新通知，且单源串行、带间隔；不跟着 `poll` 每 20 分钟打。这也是为什么它单独一个 workflow 而不是塞进 `poll`。

> 如果你的学校站点连真实浏览器都不放行（换了更强的检测），那就只能靠本机跑 + 班级群兜底了 —— 本项目不接受为了让脚本通过而去逆向挑战算法或伪造指纹的 PR。

## 本机每天自动跑（云端之外的兜底）

学院通知云端已经在 08:00 抓了，本机这个任务排在 **09:00**，作用是**兜底**：云端那轮挂了（网络抖动、或没配 secret）时，它补上。

| 文件 | 作用 |
|---|---|
| `tools/run-daily.ps1` | 计划任务入口：同步状态 → 抓取 → 写日志 → 提交状态 |
| `config/schools/uestc.yaml` | 全量预设（6 个源，含学院）—— 同步成功时用它 |
| `config/schools/uestc-math.yaml` | 只含学院两个源 —— 同步失败时的降级预设 |

**它每天怎么决策**（这一步是关键，直接决定你会不会收到重复推送）：

```
git pull 同步云端状态 ──成功──► 跑全部 6 个源（本地状态与云端一致，不会重复推）
        │
        └──失败（代理没开）──► 只跑学院 2 个源（仍不会与云端重复推）
```

本地和云端各记一份"已见通知"状态，所以**不同步就跑全量 = 同一条通知推两次**。降级成"只跑学院"就避开了这个陷阱。

> 如果你根本不想开电脑也照收通知，那这个任务可以删掉（云端 08:00 已经覆盖学院）：
> `Unregister-ScheduledTask -TaskName 'notice-radar-daily' -Confirm:$false`
> 想让它也能跑全量，把脚本里的 `$startProxy` 改成 `$true`（自动拉起代理再同步）。

注册计划任务（每天 09:00）：

```powershell
$repo = 'D:\Y\Documents\ds\notice-radar'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $repo 'tools\run-daily.ps1')) `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'notice-radar-daily' -Action $action -Trigger $trigger `
  -Settings $settings -Force
```

几个已经踩过的坑，写在这里省得你再撞：

- **必须"仅在用户登录时运行"**（不加 `-User`/`-Password` 就是这种）。学院站点会拒绝无头浏览器，抓取时要弹一个可见浏览器窗口，会话 0 里没有桌面，任务会失败。
- **`-StartWhenAvailable` 别省**：08:00 电脑没开（或睡眠），开机后会自动补跑，通知照收。
- **脚本必须存成 UTF-8 with BOM**。Windows PowerShell 5.1 读无 BOM 的 UTF-8 脚本会按 GBK 解码，中文注释直接让解析报错——这个坑我们撞过。检查：`[System.IO.File]::ReadAllBytes('tools\run-daily.ps1')[0..2]` 应该是 `239 187 191`。
- 抓取时会短暂弹出浏览器窗口（几秒自动关），所以别把这个时间点设在你开会/演示的时间。

查状态、看日志、删任务：

```powershell
Get-ScheduledTaskInfo -TaskName 'notice-radar-daily' | Select NextRunTime, LastTaskResult
Get-Content 'D:\Y\Documents\ds\notice-radar\logs\daily.log' -Tail 30 -Encoding UTF8
Unregister-ScheduledTask -TaskName 'notice-radar-daily' -Confirm:$false   # 不想要了就删
```

> 脚本每次会把 `data/state.json` 的变更**提交到本地仓库（不推送）**，这样工作区保持干净，
> 下次 `git pull --rebase` 不会被"本地已修改的状态文件"挡住。

## 接自己学校：两条路

**A. 通用适配器（推荐，5 分钟，不写代码）**

```yaml
sources:
  - id: jwc-notice
    name: 教务处·通知公告
    url: https://jwc.example.edu.cn/tzgg.htm
    adapter: html-list
    baseUrl: https://jwc.example.edu.cn
    selectors:
      item: ul.news-list li      # 列表项容器（F12 抄 class）
      title: a@title             # a 取文本，a@title / a@href 取属性
      link: a@href
      date: span.date
    include: [选课, 考试, 报名, 奖学金]
    exclude: [招标, 采购, 中标]
```

**B. 专属适配器（结构特殊时，如"链接靠 JS 拼、分类藏在锚文本里"）**

照 `src/adapters/uestc/jwc.ts` 抄一个，然后在 `src/adapters/index.ts` 注册。

## 零服务器：挂在 GitHub Actions 上

1. Fork 或用这个模板建仓库
2. Settings → Secrets and variables → Actions 里加 `SERVERCHAN_KEY`
3. 完事。`.github/workflows/poll.yml` 每 20 分钟跑一次

它靠把"见过哪些通知 ID"提交回 `data/state.json` 实现增量推送——**不需要服务器、不需要数据库**。

只在**真有新通知**时才写状态与产物，所以不会每 20 分钟空转出一个提交（否则一天 72 个，提交历史会被淹掉）。也正因如此：**本地要推之前先 `git pull --rebase`**，不然容易撞上机器人刚提交的状态。

两个必须知道的限制：
- GitHub 的 cron 用 UTC，最小间隔 5 分钟，且**实际执行会延迟几分钟**；仓库 60 天无提交时定时任务会被自动停用。
- 想更实时就把 workflow 的 cron 改密一点，或在本机用系统计划任务跑同一条命令（`radr run`）。

### 境外 runner 抓不到怎么办：故障判定是分级的

宿主机在境外时，抓境内学校站点会**偶发整体不可达**（实测约每 3 次有 1 次）。如果每次都让 CI 变红，你的邮箱会被 GitHub 的失败通知淹没；但一律放过又会让真故障（站点改版、解析全废）没人发现。

所以判定是分级的（`tools/health.ts`，有单元测试）：

| 连续"所有源都抓不到" | 结果 |
|---|---|
| 1–2 次 | 只记 `::warning::`，CI 仍是绿的 —— 当作网络天气 |
| **第 3 次** | 判为真故障，CI 变红（`::error::`），这次会发邮件 |
| 第 4 次及以后 | 静默（同一个故障期只打扰你一次） |
| 任意一次成功 | 计数清零，下个故障期重新报 |

失败不会导致**漏报**：失败的那次不写状态，下一次成功运行时会把期间所有新通知一起推给你。

关于状态提交的权限：`poll` 需要把"见过哪些通知"提交回仓库，工作流里已经声明了 `permissions: contents: write`，**实测开箱可用，不用改仓库设置**。

> 只有在公司/组织策略限制过、或你把那段 `permissions` 删掉的情况下，才会在最后"提交状态"那步失败（失败时会直接告诉你点哪里：Settings → Actions → General → Workflow permissions → Read and write）。

## 项目结构

```
src/
  cli.ts                  run / doctor / list / dashboard / test-notify / fetch
  dashboard.ts            把归档渲染成 PWA 应用（内联 CSS + 原生 JS，零依赖）
  core/
    fetch.ts              限速、退避重试、编码嗅探（gbk 也能吃）
    browser.ts            浏览器渲染抓取（CDP 驱动本机 Chrome/Edge，不引 puppeteer）
    config.ts             YAML + zod 校验，配错立刻报错
    normalize.ts          稳定 ID、宽松日期解析、相对链接补全
    dedupe.ts             状态：只记"见过哪些 ID"（两级去重）
    history.ts            归档：留下内容，供应用展示与检索
    filter.ts             关键词包含/排除
    report.ts             Markdown 日报 / JSON / 体检表
  adapters/
    html-list.ts          通用列表页适配器（选择器写在 YAML）
    uestc/jwc.ts          教务处专属适配器
    uestc/gr.ts           研究生院专属适配器
  notify/index.ts         Server酱 / webhook / 邮件 / stdout
docs/                     GitHub Pages 根目录
  index.html              应用（构建产物，由 npm run dashboard 生成）
  dashboard-data.json     应用的数据源（点"刷新"时拉它）
  manifest.webmanifest    PWA 清单（名称/图标/主题色）
  sw.js                   Service Worker（外壳缓存 + 离线回落）
  icon-source.html        图标源文件（改完用无头浏览器导出 png）
tests/
  fixtures/uestc/*.html   真实页面快照（测试不依赖网络）
tools/
  run-tests.mjs           跨 Node 版本稳定的测试入口
  capture-fixtures.mjs    重抓快照
  run-daily.ps1           本机计划任务入口（云端之外的兜底）
config/
  schools/uestc.yaml      学校预设（全量）
  schools/uestc-math.yaml 只含学院源（本机兜底用）
  sources.example.yaml    新学校模板
```

## 工程上的三个关键选择

1. **测试跑在真实页面快照上。** 网站改版时，`npm run capture` 重抓一次、`npm test`，就能区分"解析逻辑坏了"还是"网络抽风"——定位成本从半天降到一分钟。这也是本仓库最值得你抄走的东西。
2. **通用适配器优先。** 90% 的学校只写 YAML，贡献门槛从"会写爬虫"降到"会填表格"。有门槛的地方就没有社区。
3. **状态只存通知 ID。** 不存正文、不存个人信息、不碰任何账号——所以这个仓库可以放心公开。

## 合规与边界

本项目**明确不做**以下事情，也**不接受**相关 PR：

- 不抓取需要登录的页面（教务系统、成绩、课表、个人信息）
- **不做指纹伪装**：不伪造 UA、不隐藏 `navigator.webdriver`、不逆向 JS 挑战算法去骗过 WAF。
  对需要执行 JS 的公开页面，本项目只走"**真实浏览器渲染**"这一条路（本地默认关闭，需 `--allow-browser` 显式同意；
  云端用 Xvfb 虚拟显示器跑非无头 Chrome）。这条路的边界很清楚：**浏览器是真的，屏幕是假的**；
  一旦站点升级到连真浏览器都拦，本项目的态度是"不支持"，而不是去研究它的检测算法。
- 不收集任何用户数据：没有服务端、没有埋点，密钥只在你自己仓库的 Secrets 里
- 不提供任何形式的"代刷""代签"

同时请遵守：只抓公开页面、单源串行且带间隔（默认 1.2 s）、尊重站点 `robots.txt`、站点异常时退避重试而不是狂刷。
浏览器渲染的源请**低频**运行（每天几次足够），不要在云端对着学校站点高频打。

站点结构变更导致失效、以及因使用本项目产生的任何后果，由使用者自行承担。

## 已知限制

- **只看第一页**：通知雷达不追求历史回溯，第一页足够。
- **学院级源要在本机跑**：见上面「为什么需要可见浏览器」，云端会跳过这类源。
- **Actions 时效**：cron 最小 5 分钟且会延迟，重要窗口期请自己盯一眼。

## 路线图

- [x] **M0** 骨架 + 教务处/新闻网/研究生院适配器 + fixture 测试 + Actions 定时 + Server酱推送
- [x] **M1** 跨源去重、日报预览图、Release v0.1.0、[good first issue 清单](docs/good-first-issues.md)
- [x] **M2** 通知归档仪表盘（GitHub Pages，可搜索/按来源筛选）+ 邮件通道 + 归档原始数据 + [Release v0.2.0](../../releases)
- [x] **M2.5** 升级为**手机/电脑都能用的 PWA 应用**：底部标签栏、收藏与已读、深色模式、可添加到主屏幕、离线可用（[Release v0.3.0](../../releases)）
- [x] **M3** 发布到 npm（`npx notice-radar`）+ 通知频次统计（`radr stats`）+ 适配器市场（[registry.json](config/schools/registry.json)，CI 校验"不许有野生预设"）
- [ ] **M4** 多校聚合（一个订阅里混多所学校）+ 主题订阅（按关键词而不是按学校）+ iOS Web Push

## 应用：手机、电脑都能用

推送只告诉你"有什么新的"，想翻旧通知就得靠归档。每次抓到新通知都会追加进 `data/history.json`，
并自动重建一个**可以直接当应用用的网页**（两个抓取工作流都会在提交状态时顺带重建）：

| 手机（390px，深色） | 电脑（1280px） |
|---|---|
| ![手机版](docs/app-mobile.png) | ![电脑版](docs/app-desktop.png) |

- **在线打开**：[yang-yin734.github.io/notice-radar](https://yang-yin734.github.io/notice-radar/)
- **装到手机上**（PWA，可离线）：
  - Android：Chrome 菜单 → **安装应用 / 添加到主屏幕**
  - iPhone：Safari → 分享 → **添加到主屏幕**
- 手机上是**底部标签栏**（通知 / 收藏 / 统计 / 关于）+ 大点击区 + 刘海屏安全区适配；
  电脑上自动变成**顶部胶囊标签栏 + 居中窄栏**（通知流每天一两条，宽栏反而难读长标题）
- **搜索**标题关键词（退课 / 四六级 / 推免）、**按来源筛选**、按日期分组
- **收藏**与**已读**：点卡片右下角 ☆ 收藏；点标题会自动标记已读，标签栏上有未读数
  —— 这两样只存本机 `localStorage`，不上传
- **跟随系统的深色模式**，右上角 ◐ 可手动切换（选择记在本机）
- 顶栏 **刷新** 会去拉 `docs/dashboard-data.json` 取最新（不必等页面重新构建）
- 零依赖：内联 CSS + 原生 JS，不引任何 CDN；`sw.js` 只做外壳缓存 + 数据"网络优先、离线回落"
- 原始数据也放了一份：`docs/dashboard-data.json`，自己做图表、接别的工具随便用

本地重建：`npm run dashboard`（产物是 `docs/index.html` + `docs/dashboard-data.json` + `docs/version.json`）。

## 在应用里控制推送与更新

![设置页](docs/app-settings.png)

**微信推送开关**：设置 → 微信推送。开关写的是仓库变量 `PUSH_ENABLED`，两个抓取工作流都读它
（`if: vars.PUSH_ENABLED != 'false'`）——**关掉后云端连抓取都跳过**，不会有任何推送。

- 应用要改仓库变量，所以需要一次性令牌：GitHub → Settings → Developer settings → Personal access tokens →
  **Fine-grained tokens** → 只授权本仓库、权限勾 `Variables: Read and write`，粘贴到设置页即可。
  令牌**只写进你这台设备的 localStorage**，不上传、不进仓库；用完点「清除」。
- 不想给令牌也行：到仓库 Settings → Secrets and variables → Actions → Variables 手动改 `PUSH_ENABLED`。

**应用内更新提示**：`docs/version.json` 是版本清单（构建时写入，`sw.js` 对它走"网络优先"，所以永远是最新的）。
应用每次打开、以及点「设置 → 检查更新」时会比对版本：

- **网页/PWA 版**：Service Worker 检测到新版外壳 → 顶部出现「有新版本，点右侧立即生效」→ 点一下 `skipWaiting` + 刷新
- **APK 版**：检测到线上版本更高 → 顶部提示「有新版本 → 下载新安装包」（APK 用同一把密钥签名，可直接覆盖安装）
- 通知**内容**本身始终实时（每次打开都拉 `dashboard-data.json`），不必为此重装

## 通知频次统计

![统计页](docs/app-stats.png)

应用「统计」页与命令行 `radr stats` 用同一份归档算：总览（累计 / 最近 7 天 / 最近 30 天 / 有新增天数 / 单日最多 / 覆盖来源）、
最近 14 天与 12 周趋势、按来源、**按标签**、**星期分布**（学校习惯哪天发通知）。

```bash
npm run stats                                  # 终端报告（带条形图）
node src/cli.ts stats --json=stats.json        # 同时导出 JSON
```

## 适配器市场：谁维护哪个学校

`config/schools/registry.json` 登记每个学校预设的**维护者**、状态（`verified` / `community` / `broken`）
与最后验证日期：

```bash
npx notice-radar schools
```

CI 会拦住三种让"市场"和现实脱节的情况：登记的预设文件不存在、`config/schools/` 下有**没登记的野生预设**、
`sources` 数量与主预设对不上。字段说明、接手失效学校的流程见 [docs/adapters.md](docs/adapters.md)。

## iOS（iPhone / iPad）

iOS **没有**"下载安装包直接装"这回事，Apple 只允许两条路，详见 [docs/ios.md](docs/ios.md)：

| 方式 | 需要什么 | 现在能用吗 |
|---|---|---|
| **Safari → 分享 → 添加到主屏幕**（推荐） | 什么都不用 | ✅ 立即可用：独立图标、全屏、可离线、永不过期 |
| App Store / TestFlight | Apple 开发者账号（$99/年）+ Mac + 签名证书 | ❌ 本项目没有账号，无法签名 |
| 侧载未签名 IPA（AltStore/Sideloadly） | 一台 Mac 或 Windows + 你自己的 Apple ID | ⚠️ 可行但每 7 天要重新签名，体验远不如上面那条 |

应用里会认 UA：**Android 提示下载 APK，iOS 提示"添加到主屏幕"**，文案与步骤都不同。

## 推送通道

| 通道 | 配置 | 说明 |
|---|---|---|
| Server酱 | `type: serverchan`，密钥放 `SERVERCHAN_KEY` | 推到微信，国内最省事 |
| 邮件 | `type: email` | 读环境变量 `SMTP_URL`（形如 `smtps://user:pass@smtp.example.com:465`）、`MAIL_TO`、`MAIL_FROM`；需要 `npm i nodemailer` |
| 通用 webhook | `type: webhook` | 飞书/钉钉/自建服务都行 |
| stdout | `type: stdout` | 只打印到终端（本地调试用；它永远"成功"，所以不算真正的通道） |

想确认密钥配好没有：`npm run run -- --no-notify` 不推送；直接跑 **`node src/cli.ts test-notify`** 会发一条测试消息，
结果同时写进 `data/last-notify.json`（已脱敏），可以从提交记录里查证——这比翻 Actions 日志方便得多。

## 许可

[MIT](LICENSE)
