#!/usr/bin/env bash
# 体检：这台机器到底抓不抓得动？
#
# 背景数字：境外 runner 抓国内教育网站点，实测单轮成功率四成左右 —— 这正是 poll.yml
# 被迫用 10 分钟间隔的原因。换到境内机器上应该是 90%+；如果跑出来还是五成上下，
# 说明问题不在跨境网络，别急着改 workflow。
#
# 用法：sudo -u radar bash deploy/verify.sh [--rounds N]
# 退出码：0 = 全部达到门槛；1 = 有低于门槛的
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SELF_DIR")}"
DATA_DIR="${DATA_DIR:-/var/lib/notice-radar}"
MIN="${MIN:-0.8}"
ROUNDS=1

while [ $# -gt 0 ]; do
  case "$1" in
    --rounds) ROUNDS="$2"; shift 2 ;;
    --min)    MIN="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

cd "$APP_DIR" || { echo "进不去 $APP_DIR" >&2; exit 1; }
install -d "$DATA_DIR" 2>/dev/null || true
if [ -f "$APP_DIR/.env" ]; then set -a; . "$APP_DIR/.env"; set +a; fi

say() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
FAILED=0

say "主链路：config/schools/uestc.yaml（教务处 ×2 + 新闻网 + 研究生院）"
for i in $(seq 1 "$ROUNDS"); do
  echo "  第 $i/$ROUNDS 轮"
  # --state 指向本节点的状态：rate 会从 dirname(state)/runs.json 读历史成功率，
  # 用仓库默认的 data/state.json 读到的是 GitHub 那份，结论会串台
  if ! node src/cli.ts rate --config=config/schools/uestc.yaml \
        --state="$DATA_DIR/state.json" \
        --json="$DATA_DIR/rate-main.json" --min="$MIN"; then
    FAILED=1
  fi
done

say "学院源：config/schools/uestc-math.yaml（Xvfb + 真 Chrome）"
XVFB=()
command -v xvfb-run >/dev/null 2>&1 && XVFB=(xvfb-run -a)
for i in $(seq 1 "$ROUNDS"); do
  echo "  第 $i/$ROUNDS 轮"
  if ! "${XVFB[@]}" node src/cli.ts rate --config=config/schools/uestc-math.yaml \
        --allow-browser --state="$DATA_DIR/state.json" \
        --json="$DATA_DIR/rate-math.json" --min="$MIN"; then
    FAILED=1
  fi
done

cat <<EOF

────────────────────────────────────────────
判读方法：
  · 90% 以上          → 这台机器合格，可以按 deploy/README.md 第 6 步切流
  · 60% ~ 90%         → 先看日志里失败源的错因：超时=机器网络问题；
                        解析 0 条=站点改版（跟机器无关，所有人都会坏）
  · 和四成差不多      → 别怀疑机器，先怀疑学校出口或本地 DNS：
                        curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' https://www.jwc.uestc.edu.cn/
报告：$DATA_DIR/rate-main.json、$DATA_DIR/rate-math.json
门槛：$MIN（可用 --min 调；低于门槛时本脚本退出码为 1）
────────────────────────────────────────────
EOF
exit "$FAILED"
