# 5 分钟接入你自己的学校

## 第 0 步：先判断这个源能不能接

打开目标页面按 F12 → Network → 刷新，看这个请求：

| 现象 | 结论 |
|---|---|
| `200`，响应体几十 KB，里面有通知标题 | ✅ 能接，走通用适配器 |
| `202` / 响应体只有 2–4 KB，或有一大段看不懂的 JS | ❌ 瑞数类 WAF 挑战页。**本项目不绕过**，请换栏目或换源 |
| 需要登录才看得到 | ❌ 不属于本项目范围 |

```bash
# 也可以直接用本项目的探测脚本判断
node tools/capture-fixtures.mjs <学校ID>   # 加好 targets 后运行，状态码和体积会告诉你答案
```

判断标准很简单：**用 `curl`/Node 直接抓能拿到标题，就能接；拿不到，就别接。**

## 第 1 步：抄选择器

在页面上右键一条通知 → 检查，找到包住"标题 + 日期"的那个容器：

```html
<ul class="news-list">
  <li>
    <a href="/2026/0902/c1234a5678/page.htm" title="关于2026-2027-1学期本科生退课及补选课的通知">
      关于2026-2027-1学期本科生退课及补选课的通知
    </a>
    <span class="date">2026-09-02</span>
  </li>
</ul>
```

对应的配置：

```yaml
selectors:
  item: ul.news-list li     # 容器
  title: a@title            # 优先取 title 属性（比正文干净）
  link: a@href              # 相对链接会自动用 baseUrl 补全
  date: span.date
```

选择器语法就两条：
- `a` —— 取文本
- `a@title` / `a@href` —— 取属性（`@` 后面写属性名）

## 第 2 步：写进配置

```yaml
school: myschool
name: 某某大学

notify:
  - type: serverchan
    keyEnv: SERVERCHAN_KEY

sources:
  - id: jwc-notice
    name: 教务处·通知公告
    url: https://jwc.myschool.edu.cn/tzgg.htm
    adapter: html-list
    baseUrl: https://jwc.myschool.edu.cn
    selectors: { item: ul.news-list li, title: a@title, link: a@href, date: span.date }
    include: [选课, 考试, 报名, 奖学金, 推免]
    exclude: [招标, 采购, 中标]
```

## 第 3 步：自检

```bash
node src/cli.ts doctor --config=config/schools/myschool.yaml
```

三种结果：

| 输出 | 含义 | 怎么办 |
|---|---|---|
| `✓ 正常` + 条目数 > 0 | 成了 | 继续第 4 步 |
| `⚠ 抓到了但没解析出条目` | 选择器不对 | 回第 1 步，容器 class 抄准；注意空格（`div.a.b`） |
| `✗ HTTP 4xx/5xx` 或超时 | 站点拒绝或不可达 | 先判断是不是 WAF（第 0 步） |

## 第 4 步：存快照 + 写测试（**这一步别省**）

```bash
# 在 tools/capture-fixtures.mjs 的 targets 里加上你的源，然后：
node tools/capture-fixtures.mjs myschool
```

再往 `tests/adapters.test.ts` 抄一组断言。为什么必须做：

- 测试跑在**快照**上，不碰网络 → CI 稳定，不因对方站点抽风变红
- 站点改版时，重抓快照 + 跑测试，**立刻知道是解析坏了还是站点变了**
- 别人 review 你的 PR 时，能离线复现你的解析结果

## 第 5 步：提 PR

一个 PR 只加一个学校，带上 fixture 和测试。见 [CONTRIBUTING.md](../CONTRIBUTING.md)。

## 第 5 步（遇到 WAF 时才看）：站点需要执行 JS 怎么办

有些站点（国内常见的是瑞数 RiverSecurity）会给非浏览器请求返回 `202` + 一个几 KB 的挑战页，要求执行混淆 JS 拿令牌。本项目**不做指纹伪装**去骗过它，但提供一条正当路径：**用真实浏览器渲染**。

```bash
# 先看渲染后的真实 DOM（--window 会弹一个可见窗口，只有无头被拒时才需要）
node src/cli.ts fetch https://jwc.example.edu.cn/tzgg.htm --out=/tmp/probe.html
node src/cli.ts fetch https://jwc.example.edu.cn/tzgg.htm --window --out=/tmp/probe.html
```

判断标准：

| 结果 | 说明 |
|---|---|
| 无头渲染就拿到了内容 | 配置里写 `requiresBrowser: true` 即可（默认 `browserHeadless: true`） |
| 无头被回 `400` / 内容为空，加 `--window` 才行 | 站点识别无头浏览器。写 `browserHeadless: false`，并记住：**这个源只能在你自己机器上跑**，云端会跳过 |

对应的配置：

```yaml
  - id: my-waf-source
    name: 某某栏目（需浏览器）
    url: https://jwc.example.edu.cn/tzgg.htm
    adapter: html-list
    requiresBrowser: true
    browserHeadless: false      # 无头被拒时才写
    browserExpect: 通知          # 页面出现这个字符串就认为挑战已过
    baseUrl: https://jwc.example.edu.cn/tzgg.htm   # 注意：相对链接要按“页面地址”解析
    selectors:
      item: div.ArticleList table tr
      title: td.fw_t a@title
      link: td.fw_t a@href
      date: td.fw_s
```

两条硬规矩（PR 会按这个 review）：
1. **必须低频**：这类源只适合每天几次，不要在 Actions 里高频打学校站点。
2. **fixture 也要放进来**：把 `radr fetch` 导出的渲染后 DOM 存成 `tests/fixtures/<学校>/xxx.html` 并补测试 —— 否则别人没法离线复现你的解析结果。

## 选择器不肯合作的常见情况

| 症状 | 原因 | 解法 |
|---|---|---|
| 标题带一堆空白 | 页面里有换行缩进 | 本项目已自动归一空白，不用管 |
| 链接是 `href="#"`，真链接靠 JS 拼 | 站点用 JS 跳转 | 写专属适配器，从别的属性（如 `newsId`）拼出详情 URL，参考 `src/adapters/uestc/jwc.ts` |
| 日期只在详情页 | 列表页不给日期 | 让 `date: null`（配置里不写 date 即可），别为了日期多抓一次 |
| 抓到的中文是乱码 | 站点是 gbk/gb2312 | 本项目已自动嗅探编码，若仍乱码请提 issue 附页面地址 |
| 条目里混进导航链接 | 容器选择器太宽 | 收紧到最内层的列表项；或在 `exclude` 里加导航词 |
