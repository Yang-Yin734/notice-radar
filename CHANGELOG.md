# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## v0.10.13 — 2026-10-03

### 给全国名单补上标签（双一流 / 教育部直属 / 民办）

上一版只做了省份 / 城市 / 层次，还差「标签」。这版补上，**每一个标签都有出处**：

| 标签 | 来源 | 数量 |
|---|---|---|
| `双一流` | 教育部 2022-02-14 公布的[第二轮名单](http://www.moe.gov.cn/srcsite/A22/s7065/202202/t20220211_598710.html) | 144 所（名单共 147，3 所军校不在教育部《全国高等学校名单》里） |
| `教育部直属` | 官方名单的「主管部门」= 教育部 | 77 所 |
| `民办` | 官方名单的「备注」= 民办 | 831 所 |
| `中外合作办学` | 「备注」以「中外合作办学」开头 | 14 所 |

- 新工具 `tools/shuangyiliu-refresh.mjs`：教育部那个页面**只给 PDF 附件**，所以正文取自转载页，
  但用三重校验防抄错 —— ① 每个来源必须正好 147 条；② 多个独立来源的学校名集合必须**完全一致**；
  ③ 每个名字都要能按校名精确对上官方名单，**对不上的必须正好是那 3 所军校**（多一个新名字就报错退出，
  逼人查是不是又改名了）。144 + 3 = 147 这条等式写在测试里。
- 另外拿**官方 PDF 本身**做了抽样对照：把附件 1 的 9 页渲染成图，逐行核对第 1 页（开头）、
  第 5 页（中段）、第 9 页（结尾），与解析结果完全一致（含顺序）。
- 「默认浏览列表」跟着修正：**重点 = 官方双一流 ∪ 人工挑选的知名高校**（并集 196 所）。
  上一版只按人工那份列，中国政法大学、中央民族大学这类双一流反而看不到。
- 列表里显示标签：双一流（蓝）优先，其次民办（灰）。
- 测试：新增「147 → 144 + 3」与「每条标签必须是已知标签、双一流必须都在默认列表里」等断言（115 项全过）。

## v0.10.12 — 2026-10-03

### 全国高校名单：选校列表从 153 所扩到 3167 所

之前只有 153 所"重点高校"，用户搜不到自己学校就只能干看着。现在装的是**教育部《全国高等学校名单》**
（截至 2025-06-20，共 3167 所 = 本科 1365 + 高职专科 1554 + 成人 248）。
仍然**不编造**：没接入的一律标 `pending`，点它只会告诉你"还没接入"并给出申请入口。

- **数据可复现**：`tools/moe-refresh.mjs` 抓官方页面的两个 `.xls` 附件 → 用 LibreOffice 转 CSV →
  生成 `config/schools/directory.tsv`，并**与页面公布的总数逐项对账**（3167 / 2919 / 1365 / 1554 / 248
  任一项对不上就直接失败退出）。刷新命令与列含义见 [config/schools/README.md](config/schools/README.md)。
- **两条独立解析路径交叉验证**：Python + openpyxl 读 `.xlsx`、Node 读 `.csv`，
  3167 行 × 6 个字段**零差异**。
- **人工维护的部分单独放**：`config/schools/curated.json` 只管重点高校的短 id / 拼音 / 简称；
  其余学校的 id 就是**学校标识码**（10 位，官方唯一）。电子科技大学保留短 id `uestc`，
  老用户的本机偏好与数据文件名都不变。
- **搜索与排序**：校名 / 省份 / 城市 / 拼音 / 简称 / 学校标识码都能搜；结果按
  已接入 → 重点 → 本科 → 专科 → 成人 → 校名 排序，并显示「匹配 N 所 / 只显示前 40 所」。
  关键词为空时给「已接入 + 重点高校」，不再把 3167 所全倒出来。
- **还没接入的学校有一条出口**：点 `pending` 的学校会说明原因，并给出**带校名预填的「申请接入」issue 链接**
  （网页版与应用内都有）—— 这就是"后续一所所补齐"的入口。
- **体积**：目录 ≈ 500 KB。网页走浏览器 gzip；应用端给 `HttpURLConnection` 加了
  `Accept-Encoding: gzip`（只在响应确实带 `Content-Encoding: gzip` 时解压），否则手机会下全量。
  另外 `index.json` **只在内容真的变了才重写**：poll 每 10 分钟重建一次数据，
  这个 500 KB 的文件若每轮都进一次 git 历史会把仓库撑爆。
- **CI 守住不变量**：新增 `tests/schools-directory.test.ts` —— 标识码唯一且为 10 位、层次分布与
  教育部公布的数字逐项相等、省份 ≥ 30、每所 `active` 都必须有数据文件、重点高校必须在官方名单里
  （学校改名了就要同步，否则测试红）。Android 打包自检也加了"目录少于 2500 所就报错"。

> 已知不包含：**军队院校**（如国防科技大学）与**港澳台高校** —— 教育部这份名单本身就不收，
> 不做假数据；要用得另找来源。

## v0.10.11 — 2026-10-03

### 选学校 / 选学院（网页版 + Android 应用）

一个订阅终于能选"看哪所学校"了：设置里新增 **学校 / 学院** 卡片 —— 搜索学校（校名 / 城市 / 拼音 / 简称）
→ 选一所 → 勾选你关心的学院 / 栏目（可多选，**默认全不选**）→ 二次确认后立即切换。
偏好只存本机（网页 `localStorage`，应用 `SharedPreferences`），不上传。网页版支持深链 `#school` 直达。

- **目录不撒谎**：153 所里只有电子科技大学是 `active`（真抓过、能出通知），其余标 `pending`；
  点 `pending` 会明确说"还没接入"并给出 [接入方法](docs/add-your-school.md)，而不是假装能选、选完一片空白。
- **勾了学院才显示**：选过学校却一个学院都没勾 → 列表提示你先去勾（这是产品要求，不擅自"贴心"显示全部）；
  **没主动选过学校的老用户完全不受影响**。
- **学院列表以配置为准**，不从"已有条目"里推：某个栏目当前 0 条（研究生院近期没发通知）也照样选得到。
- **应用端是本机原生实现**（Compose，不是 WebView）：过滤规则与网页端同一套（`unitOf` / `filterNotices`
  是纯函数，有 JVM 单测钉住"选了学校却没勾学院 = 什么都不显示"），并且**断网也能选** ——
  学校目录与各校数据随 APK 一起打包，冷启动先恢复"上次那所学校"的缓存/内置数据，不会因为重启悄悄变回默认学校。
- 数据是两端**共用的同一份**，由 `node tools/build-schools.mjs` 从已发布的 `docs/dashboard-data.json`
  重新组织（**抓取与推送链路一行未动**）：`docs/data/schools/index.json`（目录）+
  `docs/data/schools/<学校id>.json`（该校通知，条目带 `unit`）。

### 修掉两个"装出来才发现"的问题

- **APK 里根本没有选校数据**：`tools/prepare-android-assets.mjs` 之前只打包 `dashboard-data.json` /
  `version.json`，而应用取学校目录读的是 `assets/data/schools/*` —— 断网冷启动时直接抛异常，
  界面提示"学校目录取不到"，用户以为功能坏了。现在目录 + 每所已接入学校的数据一起打进 APK，
  并加了打包自检（目录非空 / `active` 必须带数据文件 / 条目必须带 `unit` 字段）。
  `android-apk` 的产物校验同步加断言：包里没有学校目录、或少了某校数据 → 构建直接红。
- **CI 的"失败摘要"自己是坏的**：它靠 `grep` 抓错误行，而没匹配到就返回 1，被默认的 `set -e`
  判成步骤失败 —— 结果只剩"构建失败 + 没有任何日志"。现在 `set +e` 兜住，摘要里追加
  `gradle.log` / `prepare.log` / `verify.log` 末尾（`dashboard`、`build-schools` 的输出也 tee 到 `/tmp`），
  失败时按约定发成**提交评论**，拿不到 Actions 日志也能排查。

### 附：修掉应用端编译不过

`195c859` 只提交了 `SchoolPickerCard(...)` 的**调用点**，组合函数本身没写出来（Kotlin `Unresolved reference`），
`./gradlew test assembleRelease` 连编译都过不去。本版补齐实现（搜索 / 学院多选 / 全选与全不选 / 确认弹窗 /
待接入学校只解释不假装能切）。

### 顺带：修掉"跨境抖动期每 10 分钟红一次"的 CI 噪音

`tools/health.ts` 的设计是"连续 3 次全部源失败 → 报一次红，之后静默到恢复"。但报红时它 `exit 1`，
poll.yml 后面那步「提交状态」就**被跳过**了 —— `data/health.json` 里的 `consecutiveAllFail` / `reported`
永远存不下来，于是下一轮又从旧计数 +1 再红一次：设计里的"只报一次"在 CI 上从来没生效过
（2026-10-03 实测：仓库里一直是 `{consecutiveAllFail: 2, reported: false}`，每轮跑到 3 报红且不提交）。

- 提交步骤加 `if: always()`：报红那一轮也把计数与 `reported` 落盘，后续轮次自动静默到恢复；
  顺带把失败轮的 `data/runs.json` 也留下（按源自适应阈值要靠它算成功率）。
- 不动任何阈值、不动抓取与推送逻辑：抓取失败时 `data/state.json` 本来就不写，不会提交"半个状态"。
- 本地用同一个状态文件连跑三次验证过：`fail` → 报红且落盘 `reported: true`；再 `fail` → 只 warning、退出 0；
  `ok` → 计数清零。

## v0.10.10 — 2026-10-01

### 抓取成功率：把免费手段用到位

背景（实测，不是猜）：境外两个互不相关的中转去取这四个页面，**全部**在 ~20 秒后超时（HTTP 522）；
本机国内直连同样四个页面 **10/10 成功、75~260ms**。这些域名都指向**教育网**地址
（`222.197.166.2` / IPv6 `2001:250:…` = CERNET2），境外访问本身就差。

- **轮询间隔 20 → 10 分钟**：单轮成功率约四成、但通知**不会丢只会晚**（状态只在成功时写入，成功那轮补抓全量）。
  频率翻倍后，"一小时内至少成功一次"从 ≈78% 提到 ≈95%。公共仓库 Actions 分钟数不计费，所以这是零成本。
  （私有仓库会吃免费额度，文件里已写明请调回 20/30 分钟。）
- **DNS 改为 IPv4 优先**：这些域名同时有 AAAA（教育网 IPv6，基本只在境内可达），
  而 Node 从 v17 起按解析器顺序（常 AAAA 排前）→ 境外走 IPv6 就是超时的典型死法。
  可用 `NOTICE_RADAR_DNS_ORDER=verbatim` 回到系统默认（排查用）。
- **抓取超时 20 → 40 秒**：跨境握手慢，20 秒会把"慢但能成功"的请求误杀成失败。
- 新增 2 个单元测试钉住这两个默认值（107/107）。

### 顺带修掉一个真 bug

- `radr digest --dry` 之前**仍然会发送**（`--dry` 只影响了留痕，没拦住发送）。
  现在 `--dry` 与 `run` 的语义一致：演练模式，绝不发送。

## v0.10.9 — 2026-10-01

**修复"抓取异常"告警的最后一类误报**（用户反馈：研究生院又报异常）。

### 诊断（用真实数据，不是猜）

```
本机（国内）实测 gr-notice：200 / 34592 字节 / 20 条     ← 源没坏
云端 data/runs.json：gr-notice 近 20 次成功 7 次（35%）  ← 只有四成成功率
    jwc-important 40% · jwc-student 40% · news-notice 35% · news-academic 40%
配置注释里早就写了：站点带 JS 挑战 WAF
```

**结论**：站点对**境外 IP** 更严（本机能抓、GitHub runner 抓不到），而告警规则只覆盖了
"**所有**源一起挂"，没覆盖"**单个源本来就长期不稳**"——于是它以 60% 的失败率反复触发。

### 修复

- **阈值按源算**：`streakThreshold(全局阈值, 该源历史成功率, 源上显式配置)`
  —— 历史成功率 < 70% 的源自动放宽到**至少 6 次**（≈2 小时）；≥70% 的源仍按 3 次（保持敏感）
- 源上新增两个开关：`failureStreak`（单独定阈值，给 `gr-notice` 配了 8）与
  `alertOnFailure: false`（彻底不为它发故障告警，日报的静默提示仍兜底）
- **告警正文更可操作**：附上该源的"近 N 次成功 X 次"；单源失败时明确提示
  「多半是该站点对境外 IP 更严」+ 给出 `radr doctor --only=源id` 的验证方法 + 如何关掉
- 新增 3 个单元测试（阈值自适应、按源阈值互不影响、单源告警文案），测试 102 → **105**
- 抓取与推送链路仍**一行未动** ✓

### 实测效果（用线上 runs.json 跑）

```
jwc-important  40%  阈值 6（自适应）      news-notice  35%  阈值 6（自适应）
jwc-student    40%  阈值 6（自适应）      gr-notice    35%  阈值 8（配置覆盖）
news-academic  40%  阈值 6（自适应）      math-jwgg   100%  阈值 3（保持敏感）
```

### 根本解法（老实说）

境外 runner 到国内站点整体只有 ~40% 成功率，**再调阈值也只是减少打扰，不会让抓取变稳**。
真正解决：让抓取在能直连国内站点的地方跑 —— 见 README「完全不用 GitHub：在本机（或国内机器）跑」，
`powershell -File tools/install-local-task.ps1` 一条命令即可。

## v0.10.8 — 2026-10-01

### 新增

- **应用内更新**（用户需求：不想每次都自己去 GitHub 装）：
  发现新版本后点「应用内更新」→ 应用自己把 APK 下载到私有缓存 → **直接调起系统安装器** →
  点一次「安装」即完成覆盖升级（收藏与已读不丢）。通知列表顶部横幅与「设置 → 应用更新」都能用。
  - **如实说明**：Android 不允许应用静默安装自己的更新，**系统那一次「安装」确认绕不过去**
    （除非 root 或设备管理员），本项目也不会去绕。
  - 下载慢时保留「浏览器打开」兜底；下载完会**先校验是不是真 APK**（zip 头 `PK` + 体积下限），
    避免 GitHub 限流返回的 HTML 错误页被当成安装包 —— 那种情况用户只会看到"解析包时出现问题"，无从下手。
  - Android 8+ 若没允许"安装未知应用"，应用会**直接跳到该授权页**并说明原因，而不是静默失败。
- 新增 `UpdateInstaller`（下载 / 安装 / 清理旧包）与 `UpdateMath`（纯逻辑：进度、文件名、体积、APK 头校验）
- 新增 4 个 JVM 单元测试：进度边界（含总量未知与超额）、文件名安全（斜杠被替换）、体积文案、APK 头校验

### 说明

- 你手机上现在那个版本（低于 0.10.4）既**没有更新检测**、检测到也只会**打开浏览器**下载 ——
  所以需要**最后一次**去 GitHub 装 0.10.8；之后就是"应用内提示 + 应用内安装"了。
- 抓取与推送链路依旧**一行未动** ✓

## v0.10.7 — 2026-10-01

### 新增

- **应用设置里的「微信推送」变成一条可走通、可自查的绑定流程**：
  - ① **微信扫码授权 · 关注服务号** → 一步打开 Server酱（SendKey 在那里拿）
  - ② **把 SendKey 存成仓库 Secret** → 一步直达 GitHub 的「新建 Secret」页面（提示名字必须叫 `SERVERCHAN_KEY`）
  - ③ **测试推送**：应用直接触发仓库的 `notify-test` 工作流，再读回 `data/last-notify.json`，
    当场给出结论 —— `✓ 推送成功：serverchan（43 条）` 或 `✗ 推送失败：✗ serverchan`，
    并逐条列出各通道的返回详情（如"缺少密钥""配额用尽"），不用再靠猜
  - **查看最近结果**随时可读回上一次；打开设置时也会自动读一次
- 如实说明：微信没有对个人开放"应用内一键授权推送"（服务号模板消息需**企业认证服务号** + 自建 OAuth 服务器，
  个人主体申请不到），Server酱 也没有"用代码换 SendKey"的接口。所以这里做的是**引导 + 当场验证**，
  而不是一个假的"一键授权"按钮。

### 质量保障（要求是"别引起其他 bug"）

- **只新增代码，没有改动抓取与推送链路的任何一行** ✓
- 新增 `parseNotifyLog()` **纯函数** + 5 个 JVM 单元测试：包含
  「只有 stdout 不算推送成功」「远端通道失败必须报失败」「坏数据不崩」——
  解析结论错了会让用户看到"推送成功"而手机上什么都没有，比不做验证更糟
- 单元测试补上真实的 `org.json`（android.jar 里的是抛 `Stub!` 的桩）与 `isReturnDefaultValues`
- CI 的 `./gradlew test assembleRelease` 会跑这些测试；Node 侧 102/102 不变

## v0.10.6 — 2026-10-01

### 变更

- **深浅色切换改回「顶栏一键切换」**（用户反馈："怎么变成一个独立的在设置里的按钮了"）：
  Android 应用现在与**网页版完全一致** —— 顶栏一个 `◐` 按钮（在「刷新」左边），点一下就切，
  选择记在本机；设置页里原来那个「外观」开关已删除。
  两端的交互、符号（`◐`）、记忆方式现在统一。
  注：与网页版一样，手动切过之后就不再跟随系统；想恢复"跟随系统"可以清除应用数据，
  或者告诉我，我加个入口。

## v0.10.5 — 2026-10-01

### 新增

- **`radr digest --all`**：把**全部归档**合成一条消息推送（不分时间窗、不按来源截断），
  用来验证推送链路。实测 43 条 / 6 个来源，标题「电子科技大学 · 全部 43 条通知」，
  Server酱 返回 `HTTP 200 已投递` ✓
- **正文长度保护**：超过 28,000 字符会截断并**如实标注**（Server酱 的 `desp` 上限约 32KB），
  不会假装"发全了" —— `truncateForPush()` + 单元测试
- `digest` 发送时也写 `data/last-notify.json`（与 `run` / `test-notify` 一致，密钥脱敏），
  推送结果可从提交记录查证

### 验证

```bash
node src/cli.ts digest --all            # 预览：43 条（不发送）
node src/cli.ts digest --all --notify   # 真发：✓ serverchan HTTP 200 已投递
```

测试 102/102。注意：Server酱 免费版每天有条数上限，别频繁跑这种全量测试。

## v0.10.4 — 2026-10-01

### 移除

- **删除微信专属推送通道**（用户要求，**保留 Server酱**）：`wxpusher` / `wecom-bot` / `wecom-app`
  三个通道及其环境变量、说明文档 `docs/wechat.md` 一并移除；配置校验现在会拒绝这三个 type
  （有回归测试钉住，避免以后又被误加回来）。
  保留四种通用通道：`serverchan`（主用，转发到微信）/ `email` / `webhook` / `stdout`，
  以及推送重试与"说人话"的错误提示。

### 修复

- **应用内"检测更新"不管用**（用户反馈：有新版本却不提示）——
  `AppUi.kt` 里用的是**字符串比较** `remote > store.appVersion()`，
  于是 `"0.10.3" < "0.8.0"`（逐字符比到 `'1'` vs `'8'`），装了 0.8.0 的手机永远显示"已是最新"。
  现在改为按数字逐段比较的 `compareVersions()`：缺段当 0（`1.2` == `1.2.0`）、容忍 `v` 前缀与 `-beta` 后缀、
  `null`/非数字段不崩。并补了 **JVM 单元测试** `VersionTest.kt`（第一条用例就是钉死这个 bug），
  CI 里 `./gradlew test assembleRelease` 会跑。
- **新版本不再"只在设置里才看得到"**：打开应用时就检查一次版本，有新版则在列表顶部显示
  「发现新版本 vX → 下载」，可关掉（每个版本只提示一次；覆盖安装不会丢收藏与已读）。

## v0.10.3 — 2026-10-01

针对"微信又收到抓取异常（5 个源、fetch failed）"的**根因修复**（用户提供截图）。

### 诊断

截图里的关键信息：错误是 **`fetch failed`**（连都连不上，不是站点返回错误码，也不是解析不出条目）、
**5 个源同时失败**、推送来自 **runner 的出口 IP**。
本机（国内网络）实测这 5 个源：全部 `200`，解析 15 / 15 / 4 / 4 / 20 条；`data/health.json` 也显示 `consecutiveAllFail: 0`。

**根因仍是跨境的 runner ↔ 国内站点连通性问题**（GitHub runner 在境外，实测约 1/3 的运行受影响），
**不是源坏了、更不是选择器过时**。截图那条告警是 v0.10.1 重试计数 bug 的最后一次发作
（v0.10.1 于 17:47Z 部署 → poll 17:49Z 跑出重试风暴 → 告警；v0.10.2 于 17:54Z 才部署完成）。

### 修复（针对根因，不是继续调阈值）

1. **区分「网络天气」与「单源故障」**：如果**所有**参与的源都以网络层错误失败（`fetch failed`/超时/DNS），
   用户什么也做不了 → **不按故障告警**，只在连续 `alerts.weatherStreak` 次（默认 **12 ≈ 4 小时**）时才提醒一次。
   但只要**有源是好的**，就说明线路通 → 单源失败照常按 `failureStreak`（默认 3）告警。
   （这个边界很关键：早期实现只看"失败的源"，会把"5 个源只挂 1 个"也当成天气而永不提醒 —— 已修正并加测试）
2. **工作流重试 4 次 → 6 次**（间隔 30/60/90/120/150 秒）：尽量"抖过去"，让通知晚几分钟而不是等下一轮。

### 验证

```
单元测试 101/101（新增网络错误分类 + "部分源失败不算天气" 的边界测试）
node tools/alert-scenario-check.mjs（预置"已连续失败 2 轮"的锚点，跑一次即达阈值）：
  ✓ 所有源网络不通 → 判为网络天气 → 不告警（并打印"通知不会丢，下一轮成功会补发"）
  ✓ 单个源真坏（非网络错误）→ 正常告警
```

### 说明

- **通知不会丢**：全部源失败时状态文件不写，下一轮成功会把这段时间的新通知照常补发，只是晚到
- 想彻底摆脱跨境抖动：只能在**能直连国内站点**的地方跑（自建 runner / 国内小机器 / 本机定时任务），
  见 README「本机每天自动跑」一节 —— 这是取舍，不是必须

## v0.10.2 — 2026-10-01

**v0.10.1 的修复仍不够** —— 云端数据直接把它暴露了。

### 诊断（第二轮）

修复后云端 `data/runs.json` 长这样：

```
jwc-important: ["fail","fail","fail","fail","ok"]   ← 每个源都是这样
```

为什么一轮里会有 4 次失败？因为 poll 工作流为了扛跨境抖动，**一轮里最多重试 4 次**（间隔 30/50/70 秒）。
这些**尝试**被逐条记成失败 → 重试到第 3 次就顶到告警阈值，而工作流其实第 4 次成功了 —— **还是误报**。

### 修复

- **同一「失败期」内的重试合并为一次失败**：相隔小于 15 分钟（比 crontab 的 20 分钟间隔小）的连续失败不重复计数；
  失败期的锚点时间不被重试推后，所以"真正持续不通"仍然会累加、仍然会告警
- 连续成功不再重复记录（否则每 20 分钟一轮 = 72 次提交/天，把提交历史淹掉）
- `radr doctor` 的「近况」列文案改为 **`近 N 次记录：成功 X（Y%）`**，代码与 README 里写明口径：
  记录的是**状态变化**（首次失败 / 每个持续失败期 / 恢复成功），用来发现不稳定的源，
  **不是**精确可用率 —— v0.10.0 里写"最近 N 次成功率"是不准确的，已纠正
- 清掉 `data/runs.json` 里旧行为留下的重试痕迹
- 测试 97 → 100（重试合并、安静成功不记录、恢复清零、口径文案）

### 端到端验证（真实执行，非模拟）

```
尝试 1~4（间隔几秒，模拟工作流的重试循环，源一直不通）
  每次都显示：⚠ … fetch failed —— 本轮失败（第 1 次）→ ▸ 未达连续 3 次，暂不告警
落盘结果：{"always-broken": ["fail"]}          ← 四次尝试只算一次
```

跨 20 分钟的真实累加由单元测试覆盖：`at(0)` 一次失败 + 30/80/150 秒三次重试 = 仍为 `["fail"]`，
20 分钟后再失败才变成 `["fail","fail"]`，第 3 次才告警。

## v0.10.1 — 2026-10-01

**修复健康告警误报**（用户反馈："微信显示抓取异常，已经出现三次"）。

### 诊断

查 `data/alerts.json` 发现四个源在**同一秒**告警（`2026-09-30T16:06:57Z`：教务处两个 + 新闻网 + 研究生院），
而 `data/health.json` 显示 `consecutiveAllFail: 0 / lastOutcome: ok` —— 紧接着的一轮就恢复正常。
本机再实测四个源：全部 200、解析 15/15/4/20 条。**结论：源没问题，是告警误报。**

### 根因（我的设计缺陷）

v0.9.0 的故障告警只看**单次**失败就推送，把项目里早就区分好的"网络天气 vs 真故障"逻辑
（`tools/health.ts`：连续 3 次才判故障）丢掉了。而 GitHub runner 抓国内站点本来约每 3 次有 1 次整体不通，
于是"整轮网络抖动"被当成了"源抓挂了"，四个源一起报。

### 修复

- 新增 `alerts.failureStreak`（默认 **3**）：只有某源**连续失败**到阈值才告警
  （20 分钟一轮 ≈ 持续 1 小时都不通），单次失败只在日志里记一行
- 运行记录 `data/runs.json` 改为**在"最新结果发生变化"时落盘**（连续失败开始/结束），
  这样阈值判定有依据、又不会每天产生 72 次提交
- 告警正文重写：写清**连续几次**、**是否所有源一起挂**（提示多半是网络问题）、
  三步排查顺序（`radr doctor` → `radr health` → 改 selectors），以及**怎么关掉这类提醒**
- 清空 `data/alerts.json` 里误报留下的节流记录（否则会压住 12 小时内真正的故障提醒）
- 测试 95 → 97（连续计数、阈值判定、告警文案）

### 验证

故意造一个打不通的源连跑三轮（真实执行，非模拟）：

```
第 1 轮  ⚠ …、fetch failed —— 本轮失败（第 1 次）→ ▸ 未达连续 3 次，暂不告警
第 2 轮  ⚠ …、fetch failed —— 本轮失败（第 2 次）→ ▸ 未达连续 3 次，暂不告警
第 3 轮  ⚠ …、fetch failed —— 连续第 3 次      → ✓ 告警已发出
```

## v0.10.0 — 2026-10-01

两条线：**照着 GitHub 上的 issue 逐条改进** + **让消息真正落到微信（含扫码授权方案）**。

### 微信推送（用户诉求）

- 新增三条**能真正落到微信**的通道（配置见 [docs/wechat.md](docs/wechat.md)）：
  - `wxpusher`：微信扫码登录 → 建应用 → 关注公众号即完成授权，消息由公众号直达微信（最接近"微信授权"）
  - `wecom-bot`：企业微信群机器人，免费无月配额；开"微信插件"后微信也能收到
  - `wecom-app`：企业微信自建应用消息，可发给指定人，同样可进微信
- **如实说明**：微信服务号模板消息/订阅通知需要已认证服务号（企业主体 + 300 元/年）与自建 OAuth 服务，
  个人主体申请不到 —— 所以不存在"纯官方授权"的个人方案，docs/wechat.md 里写清了这一点与替代路径
- 推送健壮性：网络抖动/5xx 自动**退避重试**（最多 3 次）；错误翻译成人话
  （缺哪个环境变量、配额用尽、webhook 格式不对）；新增 `radr test-notify --channel=<通道>` 逐条验证
- 邮件通道补齐 issue #5 的诉求：**同时发 HTML**（链接可点）+ 支持 `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` 写法

### 按 issue 改进

| issue | 实现 |
|---|---|
| #2 `--only=<sourceId>` | `radr run/doctor --only=a,b` 只跑指定源；纯函数 `selectSources()` + 测试 |
| #3 配置校验说人话 | 报错变成「第 1 个源（教务处·重要公告）的 selectors.item 有问题…提示：…见 docs/add-your-school.md」 |
| #4 日报标注距截止天数 | 新增 `src/core/deadline.ts`：从标题抽截止日并显示 `⏰ 剩 3 天`／`今天截止`；**7 天内到期自动算急事**（接进分级） |
| #6 每个源最近 N 次成功率 | 新增 `data/runs.json` + `src/core/runs.ts`，`radr doctor` 多出「近况」列（如 `最近 20 次成功 18 次（90%）⚠`） |
| #7 支持翻页 | 源配置加 `pages: 2`，支持 `{page}` 占位符或 `page` 参数；翻页保持间隔、跨页按 id 去重、后页失败保留前页并明确告知 |
| #1 新闻网·学术栏目 | 新增 `news-academic` 源（CatId=66），实测 `--only=news-academic` → HTTP 200 / 4 条 |
| #5 SMTP 邮件 | 见上（已实现并补齐 HTML 与变量兼容） |
| #8 接你自己的学校 | 保持开放：需要真实第三方学校接入，文档已具备（不代劳、不编造） |

### 变更

- 测试 73 → 95（新增 7 个截止日、5 个成功率、8 个配置/通道、以及既有分档与健康测试）
- `config/schools/uestc.yaml` 里预留了三条微信通道（`enabled: false`，填好密钥改 true 即可）
- 登记表 `registry.json` 源数量 6 → 7（CI 的"预设必须真实存在"守卫正好抓到了这次改动）

## v0.9.0 — 2026-09-29

M4 三件事一起落地：**推送分级（降噪）**、**每日日报（汇总）**、**抓取健康告警（防静默失效）**。

### 新增

- **推送分级**（`push.urgent` / `push.mute` / `push.digestRest`）：
  命中急事关键词（选课/退课/缓考试/推免/奖学金…）**立刻推**，其余进日报，命中 mute 的彻底静音。
  想恢复「全都即时推」：`push.digestRest: false`。
  新增 `radr tiers [--days=N]` 可以**逐条核对**当前词表的分档结果（调词表必用）。
  实测归档 41 条：17 条急事 / 24 条进日报；词表刻意收紧过一轮——
  只写「公示」「报名」「毕业」会把"奖励名单公示""毕业生问卷调查"误判成急事。
- **每日日报** `radr digest`：把一天的新通知合成**一条**微信推送。
  时间窗支持「昨天（北京时间 UTC+8）」/`--date=`/`--hours=N`；空窗口默认不发（`--force` 强发）；
  标题裁到 Server酱 32 字上限；`--json` 结构化输出、`--out` 落盘。
  新增 [daily-digest.yml](.github/workflows/daily-digest.yml)：每天 00:05 UTC（08:05 北京）推送，
  受 `PUSH_ENABLED` 开关控制；手动触发默认**只预览**并把结果发成**提交评论**（Actions 日志在 Azure Blob，部分网络取不到）。
  配套 `tools/digest-preview.mjs` 生成「在微信里长什么样」的预览页。
- **抓取健康告警**（`alerts.*`，新增 `radr health`）：
  抓取失败 / 抓到了却解析出 0 条 → **立刻推微信告警**（同源 12 小时节流，记录在 `data/alerts.json`）；
  某源连续 14 天没新通知 → **日报顶部**提示；观察期内一条都没抓到过的源也会被点名。
  「需要浏览器渲染」被跳过的源不算故障，不会误报。

### 变更

- 测试 45 → 73（新增 9 个日报测试 + 9 个分级测试 + 10 个健康告警测试）
- README 增加「推送分级与每日日报」「抓取健康告警」两节

## v0.8.2 — 2026-09-29

### 修复

- **网页版点「更新」却下载 APK**（用户反馈）：`isStandalone()` 把「装到主屏幕的 PWA」和「原生 APK 应用」
  当成了同一件事 —— PWA 的 `display-mode: standalone` 成立后，更新方式被误判成「下载新安装包」。
  现在**网页版彻底没有更新提示**：删掉更新横幅与相关逻辑（`showUpdate`/`update-action`/`update-dismiss`），
  设置页的「应用更新」改成只读的「版本」说明（显示当前页面版本 + 可查看线上版本，**不提供任何下载**）。

### 变更

- **网页版保证永远是最新**：
  - `sw.js` 对页面外壳（`index.html`、`./`）改为**网络优先**（以前缓存优先，回访用户可能一直看到旧界面），
    离线时回落到缓存 —— 在线打开必然是最新构建
  - 新 Service Worker 装好即 `skipWaiting` + `clients.claim` 静默接管；页面**不弹任何提示**，
    只在页面不可见（用户切走了）时静默刷新，绝不打断阅读
  - 缓存版本升到 `notice-radar-v3`
- 已装到主屏幕（standalone）时不再显示「装成应用」横幅
- 测试 44 → 45（新增：网页版不弹更新提示、不含"下载 APK 当作更新"的逻辑）

## v0.8.1 — 2026-09-29

### 修复

- **网页版宽屏下底部导航要滚到最底才能点**（用户反馈）：≥700px 时标签栏被设成 `position: static`，
  而 `nav` 在 DOM 里位于 `main` 之后 —— 结果它掉到页面内容最底部。
  现在**所有宽度都固定在视口底部**：窄屏是通栏标签栏，宽屏是居中的悬浮胶囊（含阴影，并给内容留 84px 底部空间），
  一进来就能点「收藏 / 统计 / 设置」。
  实测（CDP 量 `getBoundingClientRect`）：390×844 与 1280×900 都是 `position: fixed`、`visibleNoScroll: true`。
- 顺手修掉宽屏下「通知」两个字被竖排的问题（标签加 `white-space: nowrap`）
- 新增回归测试：断言标签栏基础样式是 `fixed`，并**禁止**再出现 `position: static`

## v0.8.0 — 2026-09-29

**Android 改成纯原生界面**（Kotlin + Jetpack Compose），并处理了"应用里不该出现安装引导"和底部白条。

### 变更

- **界面重写为原生 Compose**（删掉 WebView 与 `assets/www`）：
  - 通知列表：按日期分组、未读左侧色条、已读变淡、标签色块、☆ 收藏、搜索、按来源筛选
  - 收藏页、统计页（总览卡片 / 14 天柱状图 / 按来源 / 按标签 / 星期分布）、设置页
  - 设置页：微信推送开关（读写仓库变量）、应用更新（检查 + 下载新 APK）、数据来源与时间、立即刷新、
    清除已读/收藏、深浅色切换、关于
  - 数据层用 `HttpURLConnection` + `org.json`（不引第三方网络库），镜像地址与版本检查逻辑搬进 Kotlin
- **应用内不再出现"安装到手机"引导**：原生设置页没有该区块；只有网页版访客才会看到安装横幅
- **底部白条修复**：根因是 WebView 不支持 `env(safe-area-inset-*)` 且窗口底色为浅色。
  现在用 `enableEdgeToEdge()` + Compose `Scaffold`/`NavigationBar` 正确消费系统栏内边距，
  并在 `themes.xml` 与 `values-night/colors.xml` 把 `windowBackground`、状态栏、导航栏颜色设为应用底色
- 随包资源只剩 `assets/data/{dashboard-data.json,version.json}`（18 KB）；APK 体积 2.4 MB → 6.4 MB（Compose 运行时）
- CI 断言改为：包名正确、内置数据在包里、**所有 `classes*.dex` 里能搜到镜像地址**（Compose 会触发 multidex）、
  不应再出现 `assets/www`
- 顺带：构建失败时把错误摘要**发成提交评论**——Actions 日志存在 Azure Blob，部分网络环境取不到，
  提交评论走 `api.github.com`，哪里都能查
- 包名与签名密钥不变，已安装的旧版可直接覆盖升级

### 说明

- 本机没有 Android 设备，**无法真机验证**；已核对：APK 内无 `assets/www`、有内置数据（41 条 / v0.8.0）、
  dex 里含镜像地址与推送开关常量、不含 TWA/WebView 资源加载器、签名指纹与密钥一致
- 底部白条是按标准做法修的（insets + 窗口底色）；如果真机上仍有异常，告诉我具体机型与现象

## v0.7.0 — 2026-09-29

**Android 端从"套壳网页"改成真正的独立应用**（用户反馈：点开是网页、不加载 GitHub 就进不去）。

### 修复

- **点开是网页 / 带地址栏** → 不再用 TWA（Custom Tabs 套壳），改成 **WebView 加载打包进 APK 的界面**：
  没有地址栏、没有浏览器痕迹，只有点外部链接才交给系统浏览器。
  界面资源走 `WebViewAssetLoader`，以 `https://appassets.androidplatform.net/` 提供，
  fetch 与 localStorage 都有正常的安全来源语义。
- **不加载 GitHub 就进不去** → 界面与数据全部内置（`assets/www`，约 240 KB）：
  打开零网络、断网可用；数据先读内置，再按**镜像顺序**刷新
  （jsDelivr → Statically → githack → GitHub Pages 垫底，因为 `github.io` 在国内经常不通），
  抓到的新数据缓存到本机；设置页显示"数据时间 / 来源"。
  版本检查也改走镜像（APK 内那份 `version.json` 永远等于自己，否则永远测不出新版本）。

### 变更

- Android 工程去掉 bubblewrap 那一整套（`twa-manifest.json`、`manifest-checksum.txt`、DelegationService…），
  改为**直接 `./gradlew assembleRelease` + `apksigner` 签名**；`tools/twa-version.mjs` → `tools/android-version.mjs`
- 新增 `tools/prepare-android-assets.mjs`：把 `docs/` 的应用与数据打进 `assets/www` 并自检
  （必须有底部标签栏、必须有数据条目、必须含镜像列表）
- CI 增加三条断言：包名正确、`assets/www` 关键文件都在包里、内置页面含镜像列表——
  否则 APK 会"装出来白屏"或"国内刷不动数据"
- 包名与签名密钥不变，已安装的旧版本可直接覆盖升级
- 测试 42 → 43

### 说明

- 本机没有 Android 设备，**无法真机验证**；已核对的是：APK 内确实含 7 个界面资源文件、
  含 `MainActivity`、不含 `androidbrowserhelper`、清单里无 TWA 痕迹、签名指纹与密钥一致
- iOS 仍是"Safari → 添加到主屏幕"（Apple 不允许侧载安装包），见 [docs/ios.md](docs/ios.md)

## v0.6.0 — 2026-09-28

M3：**能发布到 npm 了**，并且把"谁维护哪个学校"变成有 CI 兜底的事实，统计也从"看个趋势"升级成可分析的频次报告。

### 新增

- **发布到 npm**（[docs/publish.md](docs/publish.md)）
  - `npm run build`：`tsc -p tsconfig.build.json` → `dist/`，`tools/postbuild.mjs` 补 shebang 并自检
    "产物里不能残留 `.ts` 的 import"
  - **为什么要编译**：Node 明确拒绝对 `node_modules` 里的文件做类型剥离
    （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），直接发 `.ts` 会让 `npx` 直接失败——本地安装测试发现的
  - `bin` 提供 `notice-radar` 与 `radr` 两个名字；`files` 只带 `dist` + `config`
  - `.github/workflows/publish-npm.yml`：手动（可 dry-run）或打 tag 自动发布，带 `--provenance` 供应链签名；
    没配 `NPM_TOKEN` 时不失败，只做打包自检
  - CLI 里所有"随包发布的文件"改为相对**包根**解析（`PKG_ROOT`），这样在任意目录 `npx notice-radar` 都能找到
    学校预设与登记表
- **通知频次统计**
  - `src/core/history.ts` 新增 `summarize()` / `renderStats()`：来源、标签、最近 12 周、最近 6 个月、
    **星期分布**（看学校习惯哪天发通知）、最近 7/30 天、有新增天数、单日最多
  - `radr stats` 终端报告（带条形图）+ `--json` 输出
  - 应用的「统计」页同步升级：总览卡片 + 14 天趋势 + 按来源 + **按标签** + **星期分布**
- **适配器市场**
  - `config/schools/registry.json`：每个学校预设登记维护者、状态（verified/community/broken）、最后验证日期
  - `radr schools` 命令行浏览
  - `tests/registry.test.ts` 三重校验：登记的预设必须存在、**不许有"野生"预设**、`sources` 数量必须与主预设一致
  - [docs/adapters.md](docs/adapters.md)：字段说明、接手失效学校的流程

### 变更

- 版本号 0.5.0 → 0.6.0；测试 37 → 42（新增统计 2、适配器市场 3）
- **没 npm 账号也能装**：打 tag 时 `publish-npm.yml` 会把打包产物 `notice-radar-x.y.z.tgz`
  一并上传到 Release，用户可直接
  `npm i -g https://github.com/Yang-Yin734/notice-radar/releases/download/v0.6.0/notice-radar-0.6.0.tgz`
  （已实测：4 秒装完、两个命令名都可用、在任意目录执行正常）
- 构建脚本改为 `tools/tsc.mjs`（Node 显式解析 typescript 入口，不依赖 PATH）+
  `prepare` 脚本（让 git 直装也能构建）；`npm i -g github:...` 在 Windows 上仍会因 npm 自身的
  git 依赖准备 `EPERM` 失败，已在 [docs/publish.md](docs/publish.md) 说明并给出规避方式

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
