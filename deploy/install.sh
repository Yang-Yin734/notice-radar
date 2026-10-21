#!/usr/bin/env bash
# 把 notice-radar 装成一台常驻的「境内抓取节点」：systemd timer 定时跑 radr run。
#
# 为什么需要它：GitHub Actions 的 runner 在境外，抓国内教育网站点单轮成功率只有四成左右；
# 学院站点还部署了瑞数类挑战，必须用「真浏览器 + 虚拟显示器」。这台机器只抓取与推送，
# 不对外开 Web 服务，所以**不需要 ICP 备案**（备案只针对 80/443 上的站点服务）。
#
# 用法（服务器上，root 或 sudo）：
#   sudo bash deploy/install.sh
#   sudo bash deploy/install.sh --poll-minutes 10 --skip-math
#
# 看完不改也行；要改就带参数或改下面的默认值：
#   --repo <url>        仓库地址（默认本项目的 GitHub 地址；国内拉不动可换镜像前缀）
#   --branch <name>     分支（默认 main）
#   --app-dir <path>    代码目录（默认 /opt/notice-radar）
#   --data-dir <path>   状态与日志目录（默认 /var/lib/notice-radar，在仓库外，不进 git）
#   --user <name>       运行用户（默认 radar；Chrome 不能以 root 跑）
#   --poll-minutes <n>  主抓取间隔（默认 5）
#   --skip-math         不启用学院（真浏览器）任务
#   --skip-packages     跳过系统包安装（已经自己装好 git/node/xvfb/chrome）
#
# 幂等：重复跑只会更新代码、重装 unit、重启 timer，不会动你的 .env 与 state.json。
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Yang-Yin734/notice-radar.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/notice-radar}"
DATA_DIR="${DATA_DIR:-/var/lib/notice-radar}"
APP_USER="${APP_USER:-radar}"
POLL_MINUTES="${POLL_MINUTES:-5}"
SKIP_MATH="${SKIP_MATH:-0}"
SKIP_APT="${SKIP_APT:-0}"

say()  { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

usage() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --repo)          REPO_URL="$2"; shift 2 ;;
    --branch)        BRANCH="$2"; shift 2 ;;
    --app-dir)       APP_DIR="$2"; shift 2 ;;
    --data-dir)      DATA_DIR="$2"; shift 2 ;;
    --user)          APP_USER="$2"; shift 2 ;;
    --poll-minutes)  POLL_MINUTES="$2"; shift 2 ;;
    --skip-math)     SKIP_MATH=1; shift ;;
    --skip-packages) SKIP_APT=1; shift ;;
    -h|--help)       usage; exit 0 ;;
    *) die "未知参数：$1（--help 看用法）" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "需要 root：sudo bash deploy/install.sh"

# ---------------------------------------------------------------------------
say "1/8 系统依赖（git / curl / Xvfb / 中文字体）"
PKG=""
command -v apt-get >/dev/null 2>&1 && PKG=apt
[ -z "$PKG" ] && command -v dnf >/dev/null 2>&1 && PKG=dnf
[ -z "$PKG" ] && command -v yum >/dev/null 2>&1 && PKG=yum
[ -n "$PKG" ] || die "只认 apt / dnf / yum 的发行版（Ubuntu、Debian、Alibaba Cloud Linux、CentOS 都行）"

if [ "$SKIP_APT" != "1" ]; then
  case "$PKG" in
    apt)
      apt-get update -qq
      # fonts-noto-cjk：页面是中文，缺字体会让 Chrome 渲染出豆腐块，某些按文本判断的挑战会直接判失败
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
        git curl ca-certificates xvfb unzip >/dev/null
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq fonts-noto-cjk >/dev/null \
        || warn "fonts-noto-cjk 装不上（换 fonts-wqy-zenhei 也行，不装也能跑）"
      ;;
    dnf|yum)
      $PKG install -y -q git curl ca-certificates xorg-x11-server-Xvfb unzip >/dev/null
      $PKG install -y -q google-noto-sans-cjk-fonts >/dev/null 2>&1 \
        || $PKG install -y -q google-noto-sans-cjk-ttc-fonts >/dev/null 2>&1 \
        || warn "CJK 字体没装上（不影响抓取，但中文页面可能渲染成方块）"
      ;;
  esac
  ok "git / curl / Xvfb / 字体就绪"
else
  warn "按 --skip-packages 跳过系统包安装"
fi
command -v xvfb-run >/dev/null 2>&1 && ok "xvfb-run 可用" || warn "没有 xvfb-run：学院源（真浏览器）会抓不了"

# ---------------------------------------------------------------------------
say "2/8 Node.js（要 22.18+：项目直接跑 .ts，靠的是 Node 自带的类型剥离）"
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v major minor
  v="$(node -v)"; v="${v#v}"
  major="${v%%.*}"; minor="${v#*.}"; minor="${minor%%.*}"
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 18 ]; }
}
if node_ok; then
  ok "已装 Node $(node -v)"
else
  case "$PKG" in
    apt) curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh ;;
    *)   curl -fsSL https://rpm.nodesource.com/setup_22.x -o /tmp/nodesource.sh ;;
  esac
  bash /tmp/nodesource.sh >/dev/null 2>&1 || die "NodeSource 脚本执行失败；可改用 nvm + npmmirror 手动装 22.18+"
  case "$PKG" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null ;;
    *)   $PKG install -y -q nodejs >/dev/null ;;
  esac
  node_ok || die "Node 仍是 $(node -v 2>/dev/null || echo 未安装)，需要 22.18+"
  ok "已装 Node $(node -v)"
fi

# ---------------------------------------------------------------------------
say "3/8 真浏览器（学院站点的瑞数挑战会拒绝无头浏览器）"
BROWSER="$(command -v google-chrome-stable || command -v google-chrome || command -v chromium || command -v chromium-browser || true)"
ARCH="$(uname -m)"
if [ -n "$BROWSER" ]; then
  ok "已装：$BROWSER"
elif [ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ]; then
  if [ "$PKG" = "apt" ]; then
    curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
      || die "下载 Chrome 失败；可换 chromium：apt install -y chromium"
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/chrome.deb >/dev/null \
      || { apt-get -f install -y -qq >/dev/null; DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /tmp/chrome.deb >/dev/null; }
  else
    curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_x86_64.rpm -o /tmp/chrome.rpm \
      || die "下载 Chrome 失败；可换 chromium：$PKG install -y chromium"
    $PKG install -y -q /tmp/chrome.rpm >/dev/null
  fi
  BROWSER="$(command -v google-chrome-stable || command -v google-chrome || true)"
  [ -n "$BROWSER" ] && ok "已装：$BROWSER" || warn "Chrome 装完没找到可执行文件，学院源先跳过"
else
  warn "非 x86_64（$ARCH）：Google 没有对应安装包，请自己装 chromium 并写进 .env 的 NOTICE_RADAR_BROWSER"
fi

# ---------------------------------------------------------------------------
say "4/8 运行用户与目录"
if id -u "$APP_USER" >/dev/null 2>&1; then
  ok "用户已存在：$APP_USER"
else
  # 系统用户 + home 就是数据目录：Chrome 和 npm 都需要一个可写的 HOME
  useradd -r -m -d "$DATA_DIR" -s /bin/bash "$APP_USER"
  ok "已创建用户 $APP_USER（home = $DATA_DIR）"
fi
install -d -o "$APP_USER" -m 0755 "$DATA_DIR"
ok "数据目录 $DATA_DIR（state.json / run.log 都在这，仓库工作区保持干净）"

# ---------------------------------------------------------------------------
say "5/8 代码"
if [ -d "$APP_DIR/.git" ]; then
  if sudo -u "$APP_USER" env HOME="$DATA_DIR" git -C "$APP_DIR" pull --ff-only --quiet; then
    ok "已更新到 $(git -C "$APP_DIR" rev-parse --short HEAD)"
  else
    warn "git pull 失败（本地有改动？），沿用现有代码"
  fi
elif [ -d "$APP_DIR" ] && [ -n "$(ls -A "$APP_DIR" 2>/dev/null || true)" ]; then
  die "$APP_DIR 非空且不是 git 仓库。换个 --app-dir，或先清空这个目录再跑。"
else
  install -d -o "$APP_USER" -m 0755 "$APP_DIR"
  sudo -u "$APP_USER" env HOME="$DATA_DIR" \
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$APP_DIR" >/dev/null
  ok "已克隆 $REPO_URL（$(git -C "$APP_DIR" rev-parse --short HEAD)）"
fi
chmod +x "$APP_DIR"/deploy/*.sh 2>/dev/null || true

# ---------------------------------------------------------------------------
say "6/8 依赖（npm ci，走 npmmirror 镜像）"
sudo -u "$APP_USER" env HOME="$DATA_DIR" bash -c \
  "cd '$APP_DIR' && npm ci --no-audit --no-fund --registry=https://registry.npmmirror.com" >/dev/null
ok "node_modules 就绪"

# ---------------------------------------------------------------------------
say "7/8 推送凭据（$APP_DIR/.env）"
ENV_FILE="$APP_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  ok ".env 已存在，不动它"
else
  cp "$APP_DIR/deploy/env.example" "$ENV_FILE"
  chown "$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  warn "已生成模板：$ENV_FILE —— 不填的话只会抓取、不会推送"
fi
if grep -qE '^[[:space:]]*(NOTICE_RADAR_WEBHOOK|SMTP_URL|SMTP_HOST|MAIL_TO)[[:space:]]*=[[:space:]]*[^[:space:]]' "$ENV_FILE"; then
  ok "检测到推送通道配置"
else
  warn "还没有推送通道：编辑 $ENV_FILE 填 NOTICE_RADAR_WEBHOOK 或 SMTP_URL"
fi
# 浏览器路径落进 .env：让手动跑和 systemd 跑用的是同一个 Chrome
if [ -n "$BROWSER" ] && ! grep -q '^[[:space:]]*NOTICE_RADAR_BROWSER[[:space:]]*=' "$ENV_FILE"; then
  printf '\n# 由 deploy/install.sh 自动写入：学院站点用的真浏览器\nNOTICE_RADAR_BROWSER=%s\n' "$BROWSER" >>"$ENV_FILE"
  ok "已写入 NOTICE_RADAR_BROWSER=$BROWSER"
fi

# ---------------------------------------------------------------------------
say "8/8 systemd 定时任务"
UNITS=/etc/systemd/system
for tpl in notice-radar-poll.service notice-radar-poll.timer \
           notice-radar-math.service notice-radar-math.timer; do
  sed -e "s|@APP_DIR@|$APP_DIR|g" \
      -e "s|@DATA_DIR@|$DATA_DIR|g" \
      -e "s|@APP_USER@|$APP_USER|g" \
      -e "s|@POLL_MINUTES@|$POLL_MINUTES|g" \
      "$APP_DIR/deploy/$tpl.in" >"$UNITS/$tpl"
  chmod 644 "$UNITS/$tpl"
done
systemctl daemon-reload
systemctl enable --now notice-radar-poll.timer >/dev/null 2>&1
ok "notice-radar-poll.timer（每 $POLL_MINUTES 分钟）"
if [ "$SKIP_MATH" = "1" ]; then
  systemctl disable --now notice-radar-math.timer >/dev/null 2>&1 || true
  warn "按 --skip-math 未启用学院任务"
else
  systemctl enable --now notice-radar-math.timer >/dev/null 2>&1
  ok "notice-radar-math.timer（每 4 小时，Xvfb + 真 Chrome）"
fi

# ---------------------------------------------------------------------------
say "立刻试跑一次（第一次会给每个源补全列表，30-90 秒）"
if systemctl start notice-radar-poll.service; then
  ok "首轮抓取成功"
else
  warn "首轮抓取失败 —— 往下看日志尾部定位"
fi
printf '\n--- %s ---\n' "$DATA_DIR/run.log"
tail -n 20 "$DATA_DIR/run.log" 2>/dev/null || echo "（没有日志，用 journalctl -u notice-radar-poll 看）"

cat <<EOF

────────────────────────────────────────────
装完了。常用命令：

  看状态      systemctl list-timers 'notice-radar*' --all
  手动跑一次  systemctl start notice-radar-poll.service
  抓学院源    systemctl start notice-radar-math.service
  看日志      tail -f $DATA_DIR/run.log
  看本轮成败  systemctl status notice-radar-poll.service --no-pager
  体检        sudo -u $APP_USER bash $APP_DIR/deploy/verify.sh
  卸载        sudo bash $APP_DIR/deploy/uninstall.sh

下一步（顺序别反）：
  1. 填 $ENV_FILE 里的推送地址，然后 systemctl start notice-radar-poll.service 看真推没推出去
  2. 跑 deploy/verify.sh，成功率明显高于四成（应为 90%+）再往下
  3. 改 .github/workflows/poll.yml 与 poll-math.yml 加 --no-notify
     （不改会**同一条通知推两次**：两边各记一份「已见」状态）
────────────────────────────────────────────
EOF
