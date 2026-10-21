# 函数计算（FC）部署：0 元、24 小时、不占本机

这是 `notice-radar` 的第三种跑法：

| 跑法 | 谁在跑 | 成本 | 适合 |
|---|---|---|---|
| GitHub Actions | 境外 runner | 0 元 | 现状，抓国内站点约四成成功率 |
| systemd（`deploy/install.sh`） | 自己的云服务器 | 一年 255 元起 | 有服务器时最省心 |
| **函数计算（本目录）** | 阿里云境内 | **0 元**（免费额度内） | 不花钱、本机关机也要跑 |

## 为什么是 Serverless

阿里云学生券 300 元是**单笔订单最多抵 30 元**的小额补贴（有效期一年），
拿它抵年付服务器是不可能的：境内最便宜的年付 ECS 是 284.99 元，券最多减 30 元。
所以「0 元 + 一年 + 24 小时」只能靠按量计费、且用量落在免费额度里的产品 —— 函数计算正好符合：

- 定时触发器每 5 分钟一次；每次执行约 20~30 CU·s；每月约 8.6 万次调用 / 20 万 CU·s。
- 免费额度：每月 40 万 CU·s + 100 万次调用 + 公网流量（详见[函数计算计费](https://help.aliyun.com/zh/functioncompute/fc/product-overview/billing-overview)）。
- 结论：**长期落在免费额度内，不需要续费，明年那张新券可以完整留给别的用途。**

## 前置准备（一次性，约 10 分钟）

### 1. 开通 OSS 并建桶

1. 打开 [OSS 控制台](https://oss.console.aliyun.com/) → 创建 Bucket。
2. 地域选 **华北2（北京）**（和函数同地域，走内网免费、延迟最低）。
3. 读写权限选 **私有**：函数用 AK 读写，不需要公开。
4. 记下桶名，例如 `notice-radar-data`。

> 状态文件很小（state.json 几十 KB），一年也就几十 MB 流量。
> **不用买资源包**：学生券在资源包订单上不可用（见下文「成本与额度」），按量计费 + 内网端点才是不花钱的路径。

### 2. 创建 RAM 用户拿 AccessKey

1. [RAM 控制台](https://ram.console.aliyun.com/users) → 创建用户 → 勾选「使用永久 AccessKey 访问」。
2. 授予两个系统策略：
   - **AliyunOSSFullAccess** —— 读写状态桶
   - **AliyunFCFullAccess** —— 部署函数与定时触发器
3. 保存 AccessKey ID / Secret —— 只显示一次。

> 不要用主账号 AK。函数的 AK 泄露风险虽低，但最小权限是底线。

### 3. 安装部署工具

```bash
npm install -g @serverless-devs/s
```

AK 不用手动 `s config add`（那条命令在非交互环境会卡在别名提示上）。
本目录的脚本会从仓库根 `.env` 读出 `OSS_AK_ID` / `OSS_AK_SECRET` 注入环境，`s.yaml` 里只写
`${env('OSS_AK_ID')}` 占位，密钥永远不进仓库。

`.env`（已被 `.gitignore` 忽略）里加四行：

```
OSS_AK_ID=LTAI...
OSS_AK_SECRET=...
OSS_BUCKET=notice-radar-data
OSS_REGION=oss-cn-beijing
```

## 构建与部署

```bash
npm run build            # 先跑 tsc，生成 dist/

# Windows（脚本带 BOM，必须走 -ExecutionPolicy Bypass，否则被安全策略拦）
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/fc/deploy.ps1 deploy

# Linux / macOS / Git Bash
bash deploy/fc/deploy.sh deploy
```

脚本内部做三件事：`node deploy/fc/build.mjs` 组装 `code/` → 从 `.env` 注入 AK → `s deploy -y`。
首次部署约 1~2 分钟，控制台会打印 `functionArn` 与 `cronExpression`。

日常命令：

```bash
bash deploy/fc/deploy.sh invoke   # 手动触发一次
bash deploy/fc/deploy.sh logs     # 最近的调用日志（需先在 s.yaml 里配 logConfig）
bash deploy/fc/deploy.sh remove   # 删函数（OSS 里的状态不动）
```

触发器 `every-5-minutes`（`0 */5 * * * *`）部署后立刻按 5 分钟节奏跑。

## 开推送

`s.yaml` 里 `NOTICE_RADAR_WEBHOOK` 等四项**故意留空**（webhook URL 带 token，属于凭据，不写进仓库）。
要开推送走控制台，不用改代码也不用重新部署：

1. 打开 [FC 控制台](https://fcnext.console.aliyun.com/cn-beijing/functions) → 函数 `notice-radar-poll`
2. 配置 → 环境变量 → 新增
   - `NOTICE_RADAR_WEBHOOK` = 企业微信 / 飞书 / 钉钉 / 自建 HTTP 的地址
   - 或 `SMTP_URL` + `MAIL_TO` + `MAIL_FROM`
3. 保存，下一轮（≤5 分钟）就生效

> 注意 `s deploy` 会用 `s.yaml` 覆盖环境变量。日后重新部署时，先把这几项补进控制台，
> 或者临时把值写进 `s.yaml`（**别提交**）。

## 切流 checklist（避免同一条通知推两次）

函数计算和 GitHub Actions 各自记一份「已见」状态，两边同时开推送就会重复。切换时按顺序做：

- [ ] 控制台给函数配上 webhook，等一轮，确认能收到推送
- [ ] 把 `.github/workflows/poll.yml` 里的 `node src/cli.ts run --delay=1500` 改成
      `node src/cli.ts run --delay=1500 --no-notify`
      （继续抓、继续更新 `data/` 与仪表盘，只是不再推送）
- [ ] `poll-math.yml` **不要**加 `--no-notify`：学院那两个源只有 Actions 能跑（要真 Chrome），
      推送得留着
- [ ] 想彻底停掉 Actions 侧的主站抓取，可以把 `poll.yml` 的 cron 从 `*/10` 调到 `0 */6`，
      让它在 FC 挂掉时当兜底

回滚：把 `--no-notify` 去掉，重新提交即可。

## 环境变量

在 `s.yaml` 的 `environmentVariables` 里改，改完重新 `s deploy`。

| 变量 | 必填 | 说明 |
|---|---|---|
| `OSS_BUCKET` | ✅ | 状态桶名 |
| `OSS_REGION` | ✅ | 与桶同地域，如 `oss-cn-beijing` |
| `OSS_INTERNAL` | | 默认 `true`：走 `oss-cn-beijing-internal.aliyuncs.com` 内网端点，**不产生外网流量费**。跨地域部署时才改成 `false` |
| `OSS_AK_ID` / `OSS_AK_SECRET` | ✅ | RAM 用户的 AK。`s.yaml` 写 `${env('OSS_AK_ID')}`，值由 `deploy.sh` / `deploy.ps1` 从根 `.env` 注入，不落仓库 |
| `OSS_STATE_KEY` | | 状态对象名，默认 `notice-radar/state.json` |
| `OSS_LATEST_KEY` | | 最近一轮结果，默认 `notice-radar/latest.json` |
| `OSS_LOCK_KEY` | | 防并发锁，默认 `notice-radar/lock.json` |
| `OSS_HEARTBEAT_KEY` | | 每轮心跳，默认 `notice-radar/heartbeat.json` |
| `RADR_CONFIG` | | 跑哪个学校配置，默认 `config/schools/uestc.yaml` |
| `RADR_DELAY` | | 请求间隔毫秒，默认 `1200` |
| `RADR_ALLOW_BROWSER` | | 是否允许浏览器渲染（FC 没有 Chrome，保持 `false`） |
| `RADR_NO_NOTIFY` | | 只抓不推 |
| `NOTICE_RADAR_WEBHOOK` | | 推送 Webhook（企业微信/飞书/钉钉均可）。**在控制台配，不写 s.yaml** |
| `SMTP_URL` / `MAIL_TO` / `MAIL_FROM` | | 邮件推送，同上 |

## 验证

```bash
bash deploy/fc/deploy.sh invoke
```

返回 JSON 里看四个字段：

| 字段 | 第一次 | 第二次（状态已落地） |
|---|---|---|
| `ok` / `exitCode` | `true` / `0` | `true` / `0` |
| `pulledStateBytes` | `0`（还没有状态） | `812`（从 OSS 拉到了） |
| `uploadedStateBytes` | `812` | `812` |
| `uploadedLatestBytes` | `34102` | `34102` |
| `stdoutTail` 里的新增数 | 11 条 | **0 条**（去重生效） |

实测（2026-10-21，`cn-beijing`）：

```
✓ 教务处·重要公告：200/28KB 解析 15 → 新增 4
✓ 教务处·学生事务公告：200/31KB 解析 15 → 新增 14
✓ 新闻网·公告：200/97KB 解析 4 → 新增 3
✓ 新闻网·学术：200/97KB 解析 4 → 新增 0
✓ 研究生院·通知：200/34KB 解析 20 → 新增 0
⏭ 数学科学学院 ×2（需要 Chrome，FC 无浏览器，按预期跳过）
本次检查 7 个源（成功 5 / 失败 0 / 跳过 2）
```

**5/5 全成功**，而 GitHub Actions 的境外 runner 长期是「约每 3 次有 1 次整体不通」。
这就是把抓取搬到境内的直接收益。

也可以直接看 OSS：

```bash
ossutil ls oss://notice-radar-data/notice-radar/
```

### 心跳对象：确认定时器还活着

函数每轮都会写 `notice-radar/heartbeat.json`（约 100 字节），
即使这轮没有新通知（不写 state / latest）也会写：

```json
{"at":"2026-10-21T06:25:13.958Z","ok":true,"exitCode":0,"pulledStateBytes":812,"durationMs":10547}
```

我留在本地的实测证据（时间均为北京时间）：

| 时间 | 触发方式 | 结果 |
|---|---|---|
| 14:20:13 | 定时触发器自动 | 跑通 |
| 14:22:23 | 手动 `s invoke` | `ok:true`，写心跳 |
| **14:25:13** | **定时触发器自动** | **`ok:true`，`pulledStateBytes:812`，10.5s** |

第三行是关键：那次不是我点的，是 5 分钟 cron 自己跑的 —— 说明触发器确实在工作。
以后函数"静默"了，看这个对象的时间戳就知道是停了还是只是没新闻。

## 分工建议

FC 没有 Chrome，跑不了数学科学学院那两个瑞数 JS 挑战源（`config/schools/uestc-math.yaml`）。
所以推荐的组合是：

- **函数计算** → `uestc.yaml`（教务处 ×2 / 新闻网 / 研究生院），每 5 分钟
- **GitHub Actions** → `poll-math.yml`（学院 ×2，xvfb + 真 Chrome），每天一次，本来就是现状

两边的状态互不相干（各自记各自看过的通知），不会重复推送。

## 成本与额度

| 项 | 用量（每 5 分钟一次） | 免费额度 | 是否花钱 |
|---|---|---|---|
| 调用次数 | ≈8.6 万次/月 | 100 万次/月 | 否 |
| 计算资源 | ≈20 万 CU·s/月 | 40 万 CU·s/月 | 否 |
| 公网出流量 | 几 MB/月 | 有免费额度 | 否 |
| OSS 存储与流量 | 几十 KB / 几百 MB | — | 否（走内网端点） |

**OSS 侧不需要买资源包**。实测：把「标准-同城冗余 100GB/月」加进购物车后，确认订单页
和收银台都**没有优惠券栏**（学生券在资源包订单上不可用），最小规格也要 14 元现金。
而本方案的状态文件只有几十 KB、且函数与桶同地域走内网 endpoint，按量计费的账单趋近 0，
买资源包反而是纯支出。

若日后把间隔调到 1 分钟、或加跑更多学校导致超出免费额度，产生的按量账单会被券**自动抵扣**
（官方规则：按量付费出账后自动用券抵扣），有效期到券的到期日。

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `RuntimeError: ${env.OSS_AK_ID} not found` | `s.yaml` 写成了点号语法 | 必须写 `${env('OSS_AK_ID')}` |
| `ENOENT ... stat '{"at":1792563401681}'` | `ali-oss` 的 `put()` 收到字符串会当成**本地文件路径** | 写对象内容一律包一层 `Buffer.from(...)` |
| `缺少环境变量 OSS_BUCKET` | 没填桶名 | 改 `s.yaml` 重新部署 |
| `NoSuchKey` 被吞掉、状态不增长 | 对象名对不上 | 核对 `OSS_STATE_KEY` |
| 返回 `skipped: 上一轮还没跑完` | 上一轮超 5 分钟 | 属正常保护；可把 `cronExpression` 调到 10 分钟 |
| `radr run 失败（exit 1）` | 学校站点不可达 | 看 `stderrTail`；连续失败会在 `latest.json` 体现 |
| 想换地域 | — | 改 `vars.region` 与 `OSS_REGION`，OSS 桶要在同地域，否则把 `OSS_INTERNAL` 设成 `false` |

## 回滚

```bash
cd deploy/fc
s remove            # 删掉函数与触发器
```

OSS 里的 `notice-radar/` 前缀是状态数据，删函数不会动它；重建函数后接着跑，不会重复推送旧通知。
