# good first issue 清单

这些是**有明确验收标准、不需要读完整个项目**的任务。挑一个，开 issue 说"我要做这个"即可。

难度：🟢 一小时以内　🟡 半天　🔴 需要读几个模块

---

## 🟢 1. 给新闻网加「学术」栏目源

现在只配了 `CatId=68`（信息公告）。新闻网的学术栏目是 `CatId=66`，已经在 `tools/capture-fixtures.mjs` 的 targets 里了。

- 改 `config/schools/uestc.yaml`，复制 `news-notice` 那个源，换 url 和 include 关键词（讲座/报告/论坛/讲坛）
- 跑 `node src/cli.ts doctor` 确认有条目
- 验收：doctor 里多一行 ✓ 正常

## 🟢 2. 加一个 `--only=<sourceId>` 参数

调试单个源时不用每次跑全部 4 个（每个源之间还有 1.2 秒间隔）。

- 改 `src/cli.ts` 的 `parseFlags` 与 `collect`
- 验收：`node src/cli.ts run --only=jwc-student --dry` 只抓这一个源

## 🟢 3. 日报里显示"距截止还有几天"（针对带日期的通知）

有些通知标题自带截止日（如"9月30日前提交"）。用 `parseDateLoose` 已有的能力抽出来，在日报里标 `⏰ 剩 3 天`。

- 改 `src/core/report.ts`，加一个纯函数 + 单元测试
- 验收：`node --test tests/` 通过，且日报里出现剩余天数

## 🟡 4. 支持邮件通道

`notify/index.ts` 已经有 serverchan / webhook / stdout，缺一个 SMTP。

- 用 `nodemailer`（`dsh-rss-monitor` 也用这个，依赖成熟）
- 密钥同样走环境变量：`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`
- 验收：配置里写 `type: email` 能收到一封 HTML 日报；补一个不联网的单元测试

## 🟡 5. 配置校验给出"人话"报错

现在 zod 的错误是 `sources.0.selectors.item: Required`。改成：

```
✗ 第 1 个源（教务处·重要公告）缺少 selectors.item
  提示：html-list 适配器必须写 item 和 title，见 docs/add-your-school.md
```

- 改 `src/core/config.ts` 的 `loadConfig`
- 验收：故意删掉一行 selectors，报错信息里出现源名字和文档链接

## 🟡 6. 加一个源的"最近 N 次成功率"记录

`radr doctor` 只看当下。把每次抓取结果追加到 `data/health.json`，doctor 里显示"最近 20 次成功 18 次"。

- 涉及 `src/cli.ts`、`src/core/report.ts`、新的 `src/core/health.ts`
- 验收：连续跑几次 doctor / run 后，表格里出现成功率列

## 🔴 7. 抓取第二页（翻页支持）

现在只看列表第一页。教务处列表 URL 是 `?page=2` 这种形式。

- 在 source 配置里加 `pages: 2`，适配器负责翻页去重
- 注意：别把间隔去掉，翻页之间也要 sleep
- 验收：`pages: 2` 时条目数明显增加，且不重复

## 🔴 8. 换一个学校（最欢迎的贡献）

参照 `config/sources.example.yaml` 接你自己学校的源。**必须带 fixture 测试**（见 CONTRIBUTING.md）。

- 验收：`config/schools/<学校>.yaml` + `tests/fixtures/<学校>/*.html` + 一组断言
- 加分：在 README 的「已支持」表格里加上你学校

---

## 不适合新手的（维护者自己做）

- 适配器接口变更（会影响所有已接入的学校）
- 依赖升级
- GitHub Actions 的权限与并发策略
