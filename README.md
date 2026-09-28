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
| 学院官网（数学科学学院等） | **202 / 2.4 KB 挑战页** | ❌ 本项目不绕过 |
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

## 已支持

| 学校 | 源 | 适配器 | 状态 |
|---|---|---|---|
| 电子科技大学 | 教务处·重要公告 | `uestc/jwc` | ✅ 实测可解析 |
| 电子科技大学 | 教务处·学生事务公告 | `uestc/jwc` | ✅ 实测可解析 |
| 电子科技大学 | 新闻网·公告 | `html-list`（通用） | ✅ 实测可解析 |
| 电子科技大学 | 研究生院·通知 | `uestc/gr` | ⚠️ 站点带 WAF，偶发失败 |

想加自己学校？看 **[docs/add-your-school.md](docs/add-your-school.md)** —— 大多数站点只要写一段 YAML。

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

两个必须知道的限制：
- GitHub 的 cron 用 UTC，最小间隔 5 分钟，且**实际执行会延迟几分钟**；仓库 60 天无提交时定时任务会被自动停用。
- 想更实时就把 workflow 的 cron 改密一点，或在本机用系统计划任务跑同一条命令（`radr run`）。

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
- 不绕过验证码、JS 挑战、WAF 或任何反爬机制。学院官网返回 202 挑战页，本项目的答案就是"不支持"
- 不收集任何用户数据：没有服务端、没有埋点，密钥只在你自己仓库的 Secrets 里
- 不提供任何形式的"代刷""代签"

同时请遵守：只抓公开页面、单源串行且带间隔（默认 1.2 s）、尊重站点 `robots.txt`、站点异常时退避重试而不是狂刷。

站点结构变更导致失效、以及因使用本项目产生的任何后果，由使用者自行承担。

## 已知限制

- **只看第一页**：通知雷达不追求历史回溯，第一页足够。
- **WAF 站点不接**：见「合规与边界」。
- **Actions 时效**：cron 最小 5 分钟且会延迟，重要窗口期请自己盯一眼。

## 路线图

- [x] **M0** 骨架 + 教务处/新闻网/研究生院适配器 + fixture 测试 + Actions 定时 + Server酱推送
- [x] **M1** 跨源去重、日报预览图、Release v0.1.0、[good first issue 清单](docs/good-first-issues.md)
- [ ] **M2** GitHub Pages 仪表盘（历史日报可视化）+ 邮件通道 + 更多学校预设
- [ ] **M3** 发布到 npm（`npx notice-radar`）+ 通知频次统计 + 适配器市场（谁维护哪个学校）

## 许可

[MIT](LICENSE)
