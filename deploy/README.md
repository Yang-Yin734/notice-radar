# 境内常驻节点（有服务器时怎么做）

> 这份文件回答一件事：**手上已经有一台国内服务器时，怎么把它变成项目的常驻抓取节点**。
> 全部改动都在本目录 + 两个 workflow 的两行，不需要改任何业务代码。

> ## ⚠️ 2026-10 实测更正：学生券不能抵年费
>
> 曾在阿里云下单页实测该学生券，页面原文是：
>
> ```
> 可抵扣余额  ¥30.00（总额 ¥300.00）
> 有效期      2026-10-21 12:00:00 — 2027-10-21 12:00:00
> 不可用原因  此优惠券只可与特定的折扣优惠叠加使用
> ```
>
> 也就是：**单笔订单最多抵 30 元**，而云服务器年付订单本身带折扣（1 年 7.4 折），券直接不可用。
> 境内最便宜的年付 ECS 是 284.99 元 —— 券最多减 30，**现金仍要 255 元起**。
> 因此「0 元 + 一年 + 24 小时不占本机」只有 Serverless 能做到，见 [fc/README.md](fc/README.md)（函数计算，长期落在免费额度内）。
> 本文余下内容适用于**你自费买了服务器**或**从别处拿到一台国内机器**的情况。

---

## 0. 一句话结论

把一台**包年包月或长期在线的国内云服务器**当作常驻抓取节点（2 核 2G 够用）：
**只抓取、只推送，不对外开 Web**，所以不需要 ICP 备案。
域名、对象存储这类按量付费的东西自付几十块，别指望券（也用不了）。

---

## 1. 券的硬规则（下单前逐条对照，踩一条就白买）

| 规则 | 具体含义 | 会被怎么坑 |
|---|---|---|
| 有效期 1 年 | 从领取日起算，不是从下单日起（实测 2026-10-21 → 2027-10-21） | 攒着想"以后再用"= 过期作废 |
| 一人一张、不可转让 | 绑账号 | 想帮同学买是走不通的 |
| **单笔订单最多抵 30 元** | 总额 300，要分 10 单才花得完 | 指望一单抵掉年费 = 不可能 |
| **只能买「学生用券专区」里的包年包月 / 资源包** | 专区：<https://university.aliyun.com/buycenter> | 在普通购买页按量下单，券一分钱抵不掉 |
| **不能当"后付费预留金额"** | 按量 ECS 的订单页选不到券；但**按量账单出账后会自动用券抵扣** | 以为"反正是抵扣券"，结果下单页看不到券就放弃 |
| **不与产品折扣叠加** | 带折扣的订单会显示"此优惠券只可与特定的折扣优惠叠加使用" | 页面打 7.4 折的机型用券 = 券用不上 |
| 订单金额 ≤ 券余额可反复使用 | 多笔订单累计抵扣，直到余额为 0 | 想一次买 400 的机型 = 券用不上 |
| 用券订单退款可能让券失效 | —— | 买了发现不合适想退，券可能就没了，别冲动下单 |

**券适合买的东西**：OSS 存储包 / 下行流量包（本项目用来托管 APK 与仪表盘，正好对症）、按量账单的自动抵扣
**别买**：RDS（本项目零数据库）、SLB / K8s（单机不需要）、短信服务（推送走你自己的 webhook/邮件）、**CDN**（通用券不适用名单里明确排除 cdn）、GPU / 无影云电脑（本项目不吃算力）
**那两个"算力包"（毕设包 339 / 科创包 389）别买**：卡片写"可叠 300 元学生券"，但实测单笔只抵 30（339 → 309），且里面的实例是**按量付费**、不能备案、地域被限死在几个机房、**6 个月后就消失了** —— 对"要长期常驻"的项目是负资产。

---

## 2. 下单清单（自费买服务器时照着勾，5 分钟）

| 项 | 选什么 | 为什么 |
|---|---|---|
| 计费方式 | **包年包月** | 长期在线的前提；按量容易被账单吓到 |
| 地域 | 成都 / 杭州 / 北京（离学校近的） | 抓国内站点延迟低；**别选香港/新加坡**，那就白折腾了 |
| 镜像 | **Ubuntu 24.04 LTS** | 本目录脚本按 apt 写的；Alibaba Cloud Linux 3 也能跑（脚本会自动走 dnf 分支） |
| 规格 | 2 核 2G（够用） | 抓取是 IO 等待型；Chrome 峰值约 1G，配下面第 4 步的 swap 更稳 |
| 系统盘 | 40G ESSD Entry（默认即可） | node_modules + 日志 < 1G |
| 带宽 | **按使用流量**（峰值 100Mbps）或 3Mbps 固定 | 抓取几乎不吃带宽；**别按固定带宽买 5M 以上**，纯浪费 |
| 时长 | **1 年**（若活动价更便宜就先买活动价，反正券也用不上） | 别为了用券去买原价 |
| 安全组 | 只留 **22** | 不开 80/443 = 没有"对外提供网站服务"这件事 = 不用备案 |

> **关键**：`radr rate --min=0.8` 跑一遍，成功率 ≥90% 再切换流量；低于 60% 先查学校出口/DNS。

---

## 3. 这台机器解决什么（对应项目的四个真短板）

| 短板 | 现状 | 有了境内节点之后 |
|---|---|---|
| B1 境外 runner 抓国内教育网成功率约四成 | 所以 `poll.yml` 被迫用 10 分钟间隔去"撞概率" | 单轮成功率应到 90%+，间隔可以放宽到 30 分钟，**通知反而更快** |
| B2 Pages 曾被停用导致整站 404 | 网页版依赖 GitHub | 不变（本节点不接管网页版），但推送这条链路不再依赖 GitHub |
| B3 瑞数挑战的学院源每天只能抓 1 次 | 云端 Xvfb 每天 08:00 一次 | 本机 Xvfb + 真 Chrome 每 **4 小时**一次（`notice-radar-math.timer`） |
| B4 国内学生下不动 GitHub 里的 APK | Release 直连几十 KB/s | 见第 7 步：同一份 APK 推到 OSS，给一个国内直连地址 |

---

## 4. 装（一条命令）

```bash
# 服务器上，root
apt-get update && apt-get install -y git        # 只是为了让下一步能 clone
git clone --depth 1 https://github.com/Yang-Yin734/notice-radar.git /opt/notice-radar
sudo bash /opt/notice-radar/deploy/install.sh
```

也可以直接跑（脚本会自己 clone）：

```bash
sudo bash deploy/install.sh --poll-minutes 5
```

`install.sh` 做的 8 件事（**幂等**，重复跑只更新代码与 unit，不动你的 `.env` 与 `state.json`）：

| # | 动作 | 说明 |
|---|---|---|
| 1 | 装 git / curl / **Xvfb** / 中文字体 | 缺 CJK 字体时 Chrome 会渲染成豆腐块 |
| 2 | 装 Node 22.18+（NodeSource） | 项目直接跑 `.ts`，靠 Node 自带的类型剥离，**不需要 build** |
| 3 | 装 Google Chrome（非无头用） | 学院站点只认真浏览器 |
| 4 | 建 `radar` 用户 + `/var/lib/notice-radar` | Chrome 不能用 root 跑；状态放仓库外，**工作区永远干净** |
| 5 | clone / `git pull` 到 `/opt/notice-radar` | 之后每轮抓取前还会 `git pull` 拿最新源配置 |
| 6 | `npm ci`（走 npmmirror） | 国内直连 npm 官方源会很慢 |
| 7 | 生成 `/opt/notice-radar/.env`（600 权限） | 模板见 [env.example](env.example) |
| 8 | 装 4 个 systemd unit 并启用 timer | 立刻试跑一轮，打印日志尾部 |

**2G 内存建议加 2G swap**（Chrome 峰值约 1G，加 swap 免得被 OOM killer 杀掉）：

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**关于备案**：这台机器只做"出站抓取 + 出站推送"，**没有**在 80/443 上对外提供网站服务，
因此不涉及 ICP 备案。备案是"域名解析到大陆机房并对外提供 Web 服务"时的事 —— 等哪天你想用域名
访问网页版了再说（那时才需要域名 + 备案，两者都要自己花钱）。

---

## 5. 配推送 + 首轮验证

```bash
sudo nano /opt/notice-radar/.env          # 填 NOTICE_RADAR_WEBHOOK 或 SMTP_URL
sudo systemctl start notice-radar-poll.service
sudo tail -n 40 /var/lib/notice-radar/run.log
```

看到"推送"那几行成功、且手机上真收到了，才算这一步过。没配 `.env` 的话它只会抓取、不会通知你
（结论同样落在 `$DATA_DIR/last-notify.json`，里面记着每个通道成没成）。

再跑一次体检，确认这台机器值得托付：

```bash
sudo -u radar bash /opt/notice-radar/deploy/verify.sh --rounds 2
```

| 结果 | 含义 |
|---|---|
| ≥ 90% | 合格，进第 6 步切流 |
| 60% ~ 90% | 看是哪个源失败：超时 = 机器网络；解析 0 条 = 站点改版（跟机器无关） |
| ≈ 40% | 别怀疑机器，先 `curl` 一下学校站点看是不是 DNS/出口问题 |

---

## 6. 切流（**最容易搞错的一步**）

现状：GitHub Actions 和这台机器**各记一份"已见通知"状态**。
两边同时开着又不做处理 → **同一条通知会推两次**。

所以：**通知交给这台机器，Actions 改成"只更新数据、不发通知"**。
两个 workflow 的文件头已经有提示块，照它改两处即可。

> **2026-10-31 起，这一步多数情况可以省了。**
> 本机（`tools\run-daily.ps1 -Push`）或这台机器跑完会把时间戳写进 `data/poller.json`
> 并推回 main；`poll.yml` 开头读到"20 分钟内刚跑过"就让路，后面的抓取步全部跳过
> （那轮日志里会打印「境内节点最后跑过：N 分钟前 → 本轮让路」）。
> 两边共用同一份 `data/state.json`，所以也不会重复推送；
> 节点停机超过 20 分钟，Actions 自己接管，不需要人工切换。
> 下面的手动改法仍然有效，适合"想彻底不跑 Actions 抓取"的场景。

### 6.1 `.github/workflows/poll.yml`

```diff
   schedule:
-    - cron: '*/10 * * * *'
+    # 境内节点已接管通知；Actions 只负责刷新仪表盘与 APK 内置数据，
+    # 数据晚半小时无所谓（通知不再走这里），所以从 10 分钟放宽到 30 分钟
+    - cron: '*/30 * * * *'
```

```diff
-            if node src/cli.ts run --json=data/latest.json --delay=1500; then
+            # --no-notify：只抓取、进归档与仪表盘，不推送（推送由境内节点负责，否则会重复）
+            if node src/cli.ts run --json=data/latest.json --delay=1500 --no-notify; then
```

### 6.2 `.github/workflows/poll-math.yml`

```diff
-        run: xvfb-run -a node src/cli.ts run --config=config/schools/uestc-math.yaml --allow-browser --json=data/latest-math.json
+        # 学院源的通知已由境内节点每 4 小时覆盖；这里只负责让仪表盘数据不落后
+        run: xvfb-run -a node src/cli.ts run --config=config/schools/uestc-math.yaml --allow-browser --json=data/latest-math.json --no-notify
```

### 6.3 为什么不是直接禁用这两个 workflow

禁用之后，`docs/` 下的仪表盘与 APK 内置数据就没人更新了（那部分是 Pages 与手机端读的）。
保留 `--no-notify` 等于：**通知靠境内节点，数据靠 GitHub**，两条腿各走各的；
反过来说，境内节点哪天挂了，网页版至少还在更新。

### 6.4 顺序

1. 境内节点跑通并**真的收到过通知**
2. 再改 workflow（改完 Actions 会因 `paths` 触发一轮，看那轮有没有误发通知）
3. 观察一天：通知条数与以前是否一致（**不应变多**，变多说明两步没改全）

---

## 7. APK 的国内下载地址（可选，成本几块钱）

国内学生直连 GitHub Release 经常只有几十 KB/s。把同一份 APK 传到 OSS 即可：

```bash
# CI 里：配好 secrets 后每个 APK 构建都会自动同步（见 .github/workflows/android.yml 的
# 「同步 APK 到国内对象存储」步骤），需要的 secrets：
#   OSS_ENDPOINT   oss-cn-chengdu.aliyuncs.com
#   OSS_BUCKET     你的 bucket 名
#   OSS_AK_ID / OSS_AK_SECRET   只授该 bucket PutObject 的 RAM 子账号
#
# 或者手动从服务器推：
bash deploy/oss-sync.sh --apk ./notice-radar.apk
```

没有配 secrets 时那一步会打印"跳过"，**不会**让 APK 构建失败。

---

## 8. 日常运维

```bash
systemctl list-timers 'notice-radar*' --all          # 下一次什么时候跑
systemctl start notice-radar-poll.service            # 立刻抓一轮（oneshot，会阻塞到跑完）
systemctl start notice-radar-math.service            # 立刻抓学院源
tail -f /var/lib/notice-radar/run.log                # 人看的日志（5MB 自动轮转）
journalctl -u notice-radar-poll -n 50 --no-pager     # systemd 视角（含启动失败原因）
sudo -u radar bash deploy/verify.sh                  # 体检
cd /opt/notice-radar && sudo -u radar git log --oneline -3   # 配置更新到哪一版了
```

改配置不需要动这台机器：改仓库里的 `config/schools/*.yaml` 推上去，下一轮 `git pull` 自动生效。

---

## 9. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `install.sh` 卡在 NodeSource | 外网慢 | 换 nvm + `--registry=https://registry.npmmirror.com` 手动装 22.18+ |
| 学院源报 `Failed to move to new namespace` | Chrome sandbox 要 user namespace | `sysctl -w kernel.unprivileged_userns_clone=1`（Debian 系）或确认 `/proc/sys/user/max_user_namespaces` > 0 |
| 学院源抓到 0 条但 HTTP 200 | 挑战判定失败 / 选择器过期 | 先 `systemctl start notice-radar-math.service` 看日志，再核对 `config/schools/uestc-math.yaml` 的选择器 |
| 日志里全是 `ECONNRESET` | 学校站点在教育网，商用网出口抖动 | 换地域/换线路，或把该源 `--delay` 调大 |
| `git pull` 一直失败 | 服务器到 GitHub 不稳 | 抓取不受影响（只用本地配置）；可换镜像前缀：`deploy/install.sh --repo https://<mirror>/Yang-Yin734/notice-radar.git` |
| 通知推两次 | 第 6 步只改了一半 | 检查两个 workflow 是否都加了 `--no-notify` |
| 磁盘满了 | 日志 + npm 缓存 | `journalctl --vacuum-size=50M`、`rm -f /var/lib/notice-radar/run.log.1` |

---

## 10. 回滚

```bash
sudo bash /opt/notice-radar/deploy/uninstall.sh     # 停 timer，保留数据
# 想把 GitHub 侧也改回去：撤掉第 6 步的两处 --no-notify，cron 改回 */10
```

`uninstall.sh --purge-data` 会连 `state.json` 一起删 —— 注意那等于**重置去重状态，下次会把当前列表重推一遍**。

---

## 11. 成本

| 项 | 钱 | 说明 |
|---|---|---|
| 云服务器（2C2G，1 年） | **255 起**（自费） | 学生券单笔最多抵 30，抵不了年费；见开头更正 |
| 域名 | 30 ~ 60 / 年 | 只在想用域名访问网页版时才需要；**服务器本身不需要** |
| OSS 存储 + 流量 | 券抵后可到 0 | APK 约 10MB，一个月几十次下载；用券买资源包 |
| 短信 / CDN / RDS | 0 | 不买 |

> 想 0 元跑一年：走 [fc/README.md](fc/README.md)（函数计算），别买服务器。

---

## 12. 验收清单

- [ ] 订单确认页：包年包月、大陆地域、**看清实际支付金额**（券对带折扣的年付订单不可用）
- [ ] 安全组只开 22，没有 80/443
- [ ] `install.sh` 跑完，`systemctl list-timers 'notice-radar*'` 两个 timer 都是 active
- [ ] `.env` 填了推送通道，`systemctl start notice-radar-poll.service` 后**手机真收到**
- [ ] `deploy/verify.sh` 成功率 ≥ 90%
- [ ] 学院源手动跑一次能出条数（`notice-radar-math.service` 成功）
- [ ] 两个 workflow 已加 `--no-notify`，`poll.yml` 的 cron 已放宽
- [ ] 观察 24 小时：通知数量与切流前一致，没有重复
