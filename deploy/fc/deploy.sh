#!/usr/bin/env bash
# 自动从仓库根 .env 读取 AK 再执行 s 命令，避免密钥进 s.yaml / git。
#
#   bash deploy/fc/deploy.sh deploy    # 构建 + 部署（含每 5 分钟定时触发器）
#   bash deploy/fc/deploy.sh invoke    # 手动触发一次，看返回 JSON
#   bash deploy/fc/deploy.sh logs      # 看最近调用日志
#   bash deploy/fc/deploy.sh remove    # 删函数（OSS 里的状态不动）
set -euo pipefail

ACTION="${1:-deploy}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "找不到 $ENV_FILE；先在仓库根放一份 .env（含 OSS_AK_ID / OSS_AK_SECRET）" >&2
  exit 1
fi

# 只取 AK 两行，其他变量不进环境。
set -a
# shellcheck disable=SC1090
source <(grep -E '^OSS_AK_(ID|SECRET)=' "$ENV_FILE")
set +a

if [[ -z "${OSS_AK_ID:-}" || -z "${OSS_AK_SECRET:-}" ]]; then
  echo '.env 里缺少 OSS_AK_ID 或 OSS_AK_SECRET' >&2
  exit 1
fi

cd "$HERE"
case "$ACTION" in
  deploy) exec s deploy -y ;;
  invoke) exec s invoke ;;
  logs) exec s logs ;;
  remove) exec s remove -y ;;
  config) exec s config get ;;
  *)
    echo "用法: bash deploy/fc/deploy.sh [deploy|invoke|logs|remove|config]" >&2
    exit 2
    ;;
esac
