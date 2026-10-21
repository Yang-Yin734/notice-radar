#!/usr/bin/env bash
# 常驻节点 · 学院通知（数学科学学院 ×2，见 config/schools/uestc-math.yaml）
#
# 这两个源部署了瑞数类 JS 机器人挑战，会拒绝**无头**浏览器（实测回 HTTP 400）。
# 做法和云端 poll-math.yml 一样：挂一个虚拟显示器（Xvfb），跑真实的、非无头的 Chrome。
# 不是伪造 UA、也不隐藏 navigator.webdriver —— 就是一个真浏览器访问公开页面。
#
# 手动跑：sudo -u radar bash /opt/notice-radar/deploy/poll-math.sh
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SELF_DIR")}"
DATA_DIR="${DATA_DIR:-/var/lib/notice-radar}"
CONFIG="${CONFIG:-config/schools/uestc-math.yaml}"
RETRIES="${RETRIES:-2}"
DELAY="${DELAY:-2000}"

STATE="$DATA_DIR/state.json"
LOG="$DATA_DIR/run.log"
JSON="$DATA_DIR/latest-math.json"

cd "$APP_DIR" 2>/dev/null || { echo "进不去 $APP_DIR" >&2; exit 1; }
install -d "$DATA_DIR" 2>/dev/null || true

if [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
fi

if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 5000000 ]; then
  mv -f "$LOG" "$LOG.1"
fi
touch "$LOG" 2>/dev/null || true
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null || true; }

# 没在 .env 里指定浏览器就自己找一遍（install.sh 一般已经写好了）
if [ -z "${NOTICE_RADAR_BROWSER:-}" ]; then
  for c in google-chrome-stable google-chrome chromium chromium-browser; do
    p="$(command -v "$c" 2>/dev/null || true)"
    [ -n "$p" ] && { export NOTICE_RADAR_BROWSER="$p"; break; }
  done
fi
[ -n "${NOTICE_RADAR_BROWSER:-}" ] || log "! 找不到 Chrome/Chromium：这个源一定会失败（先跑 deploy/install.sh）"

# 有 xvfb-run 就用它（无头服务器必须；有桌面的机器加不加都行）
XVFB=()
command -v xvfb-run >/dev/null 2>&1 && XVFB=(xvfb-run -a)

log "==== run-math $CONFIG（浏览器 ${NOTICE_RADAR_BROWSER:-未找到}）===="
attempt=1
while [ "$attempt" -le "$RETRIES" ]; do
  if "${XVFB[@]}" node src/cli.ts run --config="$CONFIG" --allow-browser \
       --state="$STATE" --json="$JSON" --delay="$DELAY" >>"$LOG" 2>&1; then
    log "✓ 第 $attempt 次尝试成功"
    exit 0
  fi
  if [ "$attempt" -lt "$RETRIES" ]; then
    log "! 第 $attempt 次尝试失败，60s 后重试"
    sleep 60
  fi
  attempt=$((attempt + 1))
done

log "✗ 学院源连续 $RETRIES 次失败（挑战升级？Chrome 版本太旧？看上面的日志）"
[ -n "${NOTICE_RADAR_WEBHOOK:-}" ] && curl -sS -m 15 -X POST "$NOTICE_RADAR_WEBHOOK" \
  -H 'Content-Type: application/json' \
  -d "{\"title\":\"notice-radar 学院源异常\",\"markdown\":\"$(hostname) · 连续 $RETRIES 次失败\"}" \
  >/dev/null 2>&1
exit 1
