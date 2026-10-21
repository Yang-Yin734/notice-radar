#!/usr/bin/env bash
# 把 APK（以及可选的网页版静态目录）同步到阿里云 OSS，给国内一个能下得动的地址。
#
# 为什么需要：GitHub Release 的下载在国内经常只有几十 KB/s，甚至直接断。
# 同一份 APK 放 OSS 之后，学生点的是 oss-cn-*.aliyuncs.com 的直连地址。
#
# 用法：
#   bash deploy/oss-sync.sh --apk ./notice-radar.apk
#   bash deploy/oss-sync.sh --apk ./notice-radar.apk --docs      # 顺带同步网页版
#
# 前置（二选一）：
#   1) .env 里配 OSS_ENDPOINT / OSS_BUCKET / OSS_AK_ID / OSS_AK_SECRET
#   2) 已经跑过 ossutil config（读写 ~/.ossutilconfig）
#
# 权限最小化建议：给这个 AK 只授 Bucket 的 PutObject/GetObject，别用主账号 AK。
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(dirname "$SELF_DIR")}"
APK=""
DO_DOCS=0
OSSUTIL="$(command -v ossutil || echo /usr/local/bin/ossutil)"

while [ $# -gt 0 ]; do
  case "$1" in
    --apk)   APK="$2"; shift 2 ;;
    --docs)  DO_DOCS=1; shift ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [ -f "$APP_DIR/.env" ]; then set -a; . "$APP_DIR/.env"; set +a; fi

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "${OSS_BUCKET:-}" ] || die "没有 OSS_BUCKET：在 .env 里配 OSS_ENDPOINT/OSS_BUCKET/OSS_AK_ID/OSS_AK_SECRET，或先跑 ossutil config"

# ossutil：单文件二进制，装上就完事（v1.7.x 的 cp/sync 语法稳定，v2 也一样认 -f）
if [ ! -x "$OSSUTIL" ]; then
  say "安装 ossutil"
  case "$(uname -m)" in
    x86_64|amd64) URL=https://gosspublic.alicdn.com/ossutil/1.7.19/ossutil64 ;;
    aarch64|arm64) URL=https://gosspublic.alicdn.com/ossutil/1.7.19/ossutilarm64 ;;
    *) die "不认识的架构 $(uname -m)" ;;
  esac
  curl -fsSL "$URL" -o /tmp/ossutil || die "下载 ossutil 失败（可手动装：https://help.aliyun.com/zh/oss/developer-reference/ossutil）"
  install -m 0755 /tmp/ossutil /usr/local/bin/ossutil
  OSSUTIL=/usr/local/bin/ossutil
  ok "已装 $($OSSUTIL --version 2>&1 | head -1)"
fi

# 没给凭据就沿用 ~/.ossutilconfig
if [ -n "${OSS_AK_ID:-}" ] && [ -n "${OSS_AK_SECRET:-}" ]; then
  [ -n "${OSS_ENDPOINT:-}" ] || die "配了 AK 就要一起配 OSS_ENDPOINT（例：oss-cn-chengdu.aliyuncs.com）"
  "$OSSUTIL" config -e "$OSS_ENDPOINT" -i "$OSS_AK_ID" -k "$OSS_AK_SECRET" >/dev/null 2>&1 \
    || die "写 ossutil 配置失败"
  ok "凭据已写入 ~/.ossutilconfig"
fi

ENDPOINT="${OSS_ENDPOINT:-}"
[ -n "$ENDPOINT" ] || die "不知道 OSS_ENDPOINT（Bucket 的访问域名后缀，例：oss-cn-chengdu.aliyuncs.com）"
DOMAIN="https://${OSS_BUCKET}.${ENDPOINT#https://}"

if [ -n "$APK" ]; then
  [ -f "$APK" ] || die "找不到文件：$APK"
  KEY="${OSS_APK_PATH:-notice-radar/notice-radar.apk}"
  say "上传 APK → oss://$OSS_BUCKET/$KEY"
  # Content-Type 必须显式给：安卓浏览器按它判断"能不能直接装"
  # Cache-Control 给 10 分钟：APK 每次构建换 versionCode，但文件名固定，缓存太久会拿到旧包
  "$OSSUTIL" cp "$APK" "oss://$OSS_BUCKET/$KEY" -f \
    --meta "Content-Type:application/vnd.android.package-archive#Cache-Control:public, max-age=600" \
    || die "上传失败（检查 RAM 权限是不是只有 PutObject）"
  ok "$(du -h "$APK" | cut -f1) 已上传"
  echo "  国内下载地址：$DOMAIN/$KEY"
  echo "  校验 sha256：$(sha256sum "$APK" | cut -d' ' -f1)"
  echo "  想让学生少打字？把这个地址写进 README 与 Release 说明。"
fi

if [ "$DO_DOCS" = "1" ]; then
  [ -d "$APP_DIR/docs" ] || die "没有 $APP_DIR/docs"
  say "同步网页版静态站 → oss://$OSS_BUCKET/${OSS_DOCS_PREFIX:-notice-radar}/"
  # 不用 --delete：万一本地产物不全，一次误删就是整站 404（Pages 被停用那次已经吃过一次了）
  "$OSSUTIL" sync "$APP_DIR/docs/" "oss://$OSS_BUCKET/${OSS_DOCS_PREFIX:-notice-radar}/" -f \
    --meta "Cache-Control:public, max-age=300" || die "同步失败"
  ok "网页版：$DOMAIN/${OSS_DOCS_PREFIX:-notice-radar}/index.html"
  warn "OSS 静态网站需要开「静态页面托管」并把默认首页设为 index.html；"
  warn "想用自定义域名 + HTTPS，域名本身要备案（服务器不用，域名解析到国内节点就要）。"
fi

cat <<EOF

────────────────────────────────────────────
提醒：
  · 应用内的数据镜像地址在 android/.../AppData.kt 的 DATA_URLS；
    网页版在 dashboard 生成的 dataUrls 里。本脚本只搬文件，不改应用内地址。
  · 别忘了给 Bucket 设一条「防盗链/流量阈值」或者干脆用私网 + CDN 回源，
    2C2G 的券买的是计算，不含 OSS 流量费（公网下行约 ¥0.5/GB）。
────────────────────────────────────────────
EOF
