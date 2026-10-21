#!/usr/bin/env bash
# 卸掉定时任务（代码与数据都留着，随时能再装回来）。
#   sudo bash deploy/uninstall.sh
#   sudo bash deploy/uninstall.sh --purge-data     # 连 state.json 与日志一起删
set -uo pipefail

PURGE=0
DATA_DIR="${DATA_DIR:-/var/lib/notice-radar}"
while [ $# -gt 0 ]; do
  case "$1" in
    --purge-data) PURGE=1; shift ;;
    --data-dir)   DATA_DIR="$2"; shift 2 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "需要 root：sudo bash deploy/uninstall.sh" >&2; exit 1; }

for t in notice-radar-poll.timer notice-radar-math.timer; do
  systemctl disable --now "$t" >/dev/null 2>&1 && echo "已停用：$t"
done
for u in notice-radar-poll.service notice-radar-poll.timer \
         notice-radar-math.service notice-radar-math.timer; do
  rm -f "/etc/systemd/system/$u" && echo "已删除：/etc/systemd/system/$u"
done
systemctl daemon-reload
systemctl reset-failed 'notice-radar*' >/dev/null 2>&1 || true

if [ "$PURGE" = "1" ]; then
  rm -rf "$DATA_DIR"
  echo "已删除数据目录：$DATA_DIR（state.json 没了 = 下次会重新推一遍当前列表）"
else
  echo "状态与日志仍在：$DATA_DIR（要一起删：--purge-data）"
fi

cat <<'EOF'

别忘了还有两处在 GitHub 侧，卸载不会自动改回去：
  1. .github/workflows/poll.yml 与 poll-math.yml 里的 --no-notify —— 不改回去就再也不会有通知
  2. settings 里的 STATE_DEPLOY_KEY 等 secrets —— 不用了可以删
EOF
