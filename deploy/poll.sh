#!/usr/bin/env bash
# 常驻节点 · 主抓取（教务处 ×2 + 新闻网 + 研究生院，见 config/schools/uestc.yaml）
#
# 由 notice-radar-poll.timer 定时调用；也可以手动：
#   sudo -u radar bash /opt/notice-radar/deploy/poll.sh
#
# 关键设计：状态放在**仓库外**（--state），所以这台机器完全不碰 git 提交。
# 仓库对它只是「配置来源」——每轮开头 git pull 一下，拿到的就是最新的源配置。
# 这样它不会和 GitHub Actions 抢 data/state.json（那个另有 --no-notify 的切流步骤处理）。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SELF_DIR")}"
DATA_DIR="${DATA_DIR:-/var/lib/notice-radar}"
CONFIG="${CONFIG:-config/schools/uestc.yaml}"
DELAY="${DELAY:-1500}"
RETRIES="${RETRIES:-3}"

STATE="$DATA_DIR/state.json"
LOG="$DATA_DIR/run.log"
JSON="$DATA_DIR/latest.json"

cd "$APP_DIR" 2>/dev/null || { echo "进不去 $APP_DIR" >&2; exit 1; }
install -d "$DATA_DIR" 2>/dev/null || true

# .env 由 bash 直接 source（systemd 的 EnvironmentFile 对引号/# 太挑剔，值里带 URL 参数就容易翻车）
if [ -f "$APP_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$APP_DIR/.env"
  set +a
fi

# 日志按 5 MB 轮转一次，只留一份 .1（2C2G 的机器上别把盘写满）
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 5000000 ]; then
  mv -f "$LOG" "$LOG.1"
fi
touch "$LOG" 2>/dev/null || true
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >>"$LOG" 2>/dev/null || true; }

# 连续失败时用推送通道喊一声：节点挂了没人知道，比抓不到更糟
alarm() {
  [ -n "${NOTICE_RADAR_WEBHOOK:-}" ] || return 0
  curl -sS -m 15 -X POST "$NOTICE_RADAR_WEBHOOK" -H 'Content-Type: application/json' \
    -d "{\"title\":\"notice-radar 节点异常\",\"markdown\":\"$(hostname) · $1\"}" >/dev/null 2>&1 || true
}

# 配置同步：只读拉取。失败不中止 —— 配置没变，抓取照样该跑
if [ -d .git ]; then
  if git pull --ff-only --quiet >>"$LOG" 2>&1; then
    log "配置已同步 $(git rev-parse --short HEAD 2>/dev/null)"
  else
    log "! git pull 失败，沿用当前配置继续抓取（不影响通知）"
  fi
fi

log "==== run $CONFIG ===="
attempt=1
while [ "$attempt" -le "$RETRIES" ]; do
  # 退出码非零 = 这一轮所有源都失败（单源失败不影响退出码，CLI 自己会处理）
  if node src/cli.ts run --config="$CONFIG" --state="$STATE" --json="$JSON" --delay="$DELAY" >>"$LOG" 2>&1; then
    log "✓ 第 $attempt 次尝试成功"
    exit 0
  fi
  if [ "$attempt" -lt "$RETRIES" ]; then
    backoff=$((attempt * 30))
    log "! 第 $attempt 次尝试失败，${backoff}s 后重试"
    sleep "$backoff"
  fi
  attempt=$((attempt + 1))
done

log "✗ 连续 $RETRIES 次全部失败（上面有每个源的失败原因）"
alarm "连续 $RETRIES 轮抓取全部失败，最近一次 $(date '+%F %T')，见 $LOG"
exit 1
