<div align="center">

# 校园通知雷达 · notice-radar

**把"没有 RSS、还被 WAF 挡着"的高校官网通知，变成可订阅、可关键词过滤、能推到手机的信息流。**

配置驱动 · 零服务器 · 不登录 · 任何学校 5 分钟接入

[![ci](https://github.com/Yang-Yin734/notice-radar/actions/workflows/ci.yml/badge.svg)](https://github.com/Yang-Yin734/notice-radar/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22.18-339933.svg)](package.json)
[![version](https://img.shields.io/badge/version-v0.1.0-4d6bfe.svg)](CHANGELOG.md)

</div>

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

需要 Node ≥ 22.18（利用 Node 原生的 TypeScript 支持，无需编译步骤）。

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

## 已支持

| 学校 | 源 | 适配器 | 状态 |
|---|---|---|---|
| 电子科技大学 | 教务处·重要公告 | `uestc/jwc` | ✅ 实测可解析 |
| 电子科技大学 | 教务处·学生事务公告 | `uestc/jwc` | ✅ 实测可解析 |
| 电子科技大学 | 新闻网·公告 | `html-list`（通用） | ✅ 实测可解析 |
| 电子科技大学 | 研究生院·通知 | `uestc/gr` | ⚠️ 站点带 WAF，偶发失败 |
| 电子科技大学 | 数学科学学院·教务公告 | `html-list` + 浏览器 | 🖥 需本机可见浏览器（见下） |
| 电子科技大学 | 数学科学学院·学生工作 | `html-list` + 浏览器 | 🖥 需本机可见浏览器（见下） |

想加自己学校？看 **[docs/add-your-school.md](docs/add-your-school.md)** —— 大多数站点只要写一段 YAML。

### 🖥 学院级站点：为什么需要"可见浏览器"

数学科学学院官网部署了瑞数（RiverSecurity）类 JS 机器人挑战，实测：

| 访问方式 | 结果 |
|---|---|
| 普通 HTTP 请求（Node fetch） | `202` + 2.4 KB 挑战页 |
| 带上挑战页下发的 Cookie 重放 | 仍是 `202` |
| **无头浏览器（Edge headless）** | **`400 Bad Request`** —— 它认得出无头 |
| **普通浏览器窗口** | ✅ 正常渲染，拿到完整通知列表 |

所以这两个源用 `browserHeadless: false`（真实窗口）渲染。这意味着：

- 只有**你自己机器上**跑才有意义：`node src/cli.ts run --allow-browser`
- `poll` 工作流**不会**抓这类源（无头环境过不去，而本项目**不做指纹伪装**去骗过它），日报里会显示「跳过」
- 想每天自动收学院通知，就在本机挂个计划任务（见下）

## 本机每天自动跑（含学院通知）

仓库里已经带好了这套东西，不用自己拼命令：

| 文件 | 作用 |
|---|---|
| `config/schools/uestc-math.yaml` | **只含学院两个源**的预设 |
| `tools/run-math-daily.ps1` | 计划任务入口：抓取 + 写日志 + 提交状态 |

**为什么单独一个"只有学院源"的预设**：教务处/新闻网/研究生院云端已经在抓了。本地再抓一遍，同一条通知会推两次（本地状态与云端状态各记一份）。所以分工是——**云端抓 4 个源，本机抓云端抓不到的那 2 个**。

注册计划任务（每天 08:00）：

```powershell
$repo = 'D:\Y\Documents\ds\notice-radar'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -File "{0}"' -f (Join-Path $repo 'tools\run-math-daily.ps1')) `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
Register-ScheduledTask -TaskName 'notice-radar-math-daily' -Action $action -Trigger $trigger `
  -Settings $settings -Force
```

几个已经踩过的坑，写在这里省得你再撞：

- **必须"仅在用户登录时运行"**（不加 `-User`/`-Password` 就是这种）。学院站点会拒绝无头浏览器，抓取时要弹一个可见浏览器窗口，会话 0 里没有桌面，任务会失败。
- **`-StartWhenAvailable` 别省**：08:00 电脑没开（或睡眠），开机后会自动补跑，通知照收。
- **脚本必须存成 UTF-8 with BOM**。Windows PowerShell 5.1 读无 BOM 的 UTF-8 脚本会按 GBK 解码，中文注释直接让解析报错——这个坑我们撞过。检查：`[System.IO.File]::ReadAllBytes('tools\run-math-daily.ps1')[0..2]` 应该是 `239 187 191`。
- 抓取时会短暂弹出浏览器窗口（几秒自动关），所以别把这个时间点设在你开会/演示的时间。

查状态、看日志、删任务：

```powershell
Get-ScheduledTaskInfo -TaskName 'notice-radar-math-daily' | Select NextRunTime, LastTaskResult
Get-Content 'D:\Y\Documents\ds\notice-radar\logs\math-daily.log' -Tail 30 -Encoding UTF8
Unregister-ScheduledTask -TaskName 'notice-radar-math-daily' -Confirm:$false   # 不想要了就删
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

关于状态提交的权限：`poll` 需要把"见过哪些通知"提交回仓库，工作流里已经声明了 `permissions: contents: write`，**实测开箱可用，不用改仓库设置**。

> 只有在公司/组织策略限制过、或你把那段 `permissions` 删掉的情况下，才会在最后"提交状态"那步失败（失败时会直接告诉你点哪里：Settings → Actions → General → Workflow permissions → Read and write）。

## 项目结构

```
src/
  cli.ts                  run / doctor / list
  core/
    fetch.ts              限速、退避重试、编码嗅探（gbk 也能吃）
    config.ts             YAML + zod 校验，配错立刻报错
    normalize.ts          稳定 ID、宽松日期解析、相对链接补全
    dedupe.ts             状态：只记"见过哪些 ID"
    filter.ts             关键词包含/排除
    report.ts             Markdown 日报 / JSON / 体检表
  adapters/
    html-list.ts          通用列表页适配器（选择器写在 YAML）
    uestc/jwc.ts          教务处专属适配器
    uestc/gr.ts           研究生院专属适配器
  notify/index.ts         Server酱 / webhook / stdout
tests/
  fixtures/uestc/*.html   真实页面快照（测试不依赖网络）
tools/
  capture-fixtures.mjs    重抓快照
config/
  schools/uestc.yaml      学校预设
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
  对需要执行 JS 的公开页面，本项目用"真实浏览器渲染"这一条路，并且默认关闭、需要 `--allow-browser` 显式同意。
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
- [ ] **M2** GitHub Pages 仪表盘（历史日报可视化）+ 邮件通道 + 更多学校预设
- [ ] **M3** 发布到 npm（`npx notice-radar`）+ 通知频次统计 + 适配器市场（谁维护哪个学校）

## 许可

[MIT](LICENSE)
