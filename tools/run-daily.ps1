# 每天早上由 Windows 计划任务调用：抓取 + 推送 + 提交状态。
#
# ⚠️ 本文件必须保存为「UTF-8 with BOM」。Windows PowerShell 5.1 读无 BOM 的 UTF-8 脚本时
#    会按系统 OEM 代码页（简中是 GBK）解码，中文注释会让解析直接报错。
#    改完请确认前三个字节是 EF BB BF。
#
# 行为（为什么要分两种跑法）：
#   1) 先 git pull 同步云端状态（需要代理可达 github.com）
#   2) 同步成功 → 跑全部 6 个源（含学院；学院源需要可见浏览器窗口）
#      同步失败（代理没开/网络不通）→ 只跑学院 2 个源
#      —— 因为本地与云端各记一份"已见"状态，不同步就跑全量会让同一条通知推两次
#   3) 把状态变更提交到本地仓库
#
# 加 -Push 时（推荐用法）：把 data/ 与 docs/ 一并推回 main。本机在国内，
#   抓取成功率远高于 GitHub runner 的跨境访问（同一个源：本机 200ms，runner 40s 超时），
#   推回后网页与应用立刻看到国内出口抓到的内容；同时写 data/poller.json，
#   云端 poll.yml 看到它就知道"刚有人跑过"，本轮让路，避免同一条通知推两遍。
#
# 手动试跑：powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-daily.ps1 -Push
#
# 加 -HttpOnly 时：只跑教务处 5 个纯 HTTP 源，不启动浏览器（2 秒 / 107 MB）。
#   适合 10–30 分钟一次的高频任务 —— 办事类通知（选课、报名、缴费、评教）全在这几个源里。
#   学院源（数学学院，WAF 挡着要真浏览器）用不带 -HttpOnly 的全量跑，每天一两次就够。
#   推荐的两条计划任务：
#     主力 → run-daily.ps1 -HttpOnly -Push   每 15 分钟
#     补充 → run-daily.ps1 -Push             每天 09:00（或你睡前）

param(
  # 推回 main：写完 data/ 与 docs/ 后推上去，网页与应用、以及云端的"已见"状态都以远端为准
  [switch]$Push,

  # 只跑教务处那几个纯 HTTP 源，不启动浏览器。
  # 实测（2026-10-31）：全量 7 源要开浏览器 → 14 秒、整棵进程树峰值约 1 GB、18 个进程；
  # 只跑 5 个 HTTP 源 → 2 秒、node 峰值 107 MB、1 个进程，跑完不留任何常驻。
  # 所以高频（10–30 分钟）用它，学院源（数学学院，有 WAF，要浏览器）改成每天一两次跑全量。
  [switch]$HttpOnly
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo

$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'daily.log'

# 日志超过 1 MB 就轮转，避免计划任务长期运行把磁盘写满
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) {
  Move-Item -LiteralPath $log -Destination "$log.1" -Force
}

# PowerShell 5.1 默认按系统 OEM 代码页解码子进程输出，node 输出的是 UTF-8，不设这个日志里中文就是乱码
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # 无控制台时设置会失败，忽略
}

function Write-Log([string]$message) {
  Add-Content -LiteralPath $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message" -Encoding UTF8
}

Write-Log '==== 开始 ===='

# 可选：每天自动拉起代理客户端。
# 为什么要它：下面第 1 步要访问 github.com 同步状态；代理没开就拉不到，
# 于是只能退化成"只跑学院源"。想每天拿到全量日报，就把它设成 $true
# （或者更省事：在代理客户端里打开"开机自启"，这里保持 $false）。
$startProxy = $false
$proxyExe = 'D:\下载\v2rayN-windows-64\v2rayN-windows-64\v2rayN.exe'
$proxyPort = 10808

function Test-Port([int]$port) {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    $open = $async.AsyncWaitHandle.WaitOne(800)
    if ($open) { $client.EndConnect($async) }
    $client.Close()
    return $open
  } catch {
    return $false
  }
}

if ($startProxy -and -not (Test-Port $proxyPort)) {
  if (Test-Path $proxyExe) {
    Write-Log "代理未运行，尝试启动：$proxyExe"
    Start-Process -FilePath $proxyExe -WorkingDirectory (Split-Path -Parent $proxyExe) | Out-Null
    for ($i = 0; $i -lt 20; $i++) {
      Start-Sleep -Seconds 1
      if (Test-Port $proxyPort) { break }
    }
    Write-Log "代理端口 $proxyPort 现在可用：$(Test-Port $proxyPort)"
  } else {
    Write-Log "想自动启动代理，但找不到 $proxyExe"
  }
}

# 计划任务的环境里 PATH 可能不含 node，兜底用绝对路径
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) {
  Write-Log '找不到 node（PATH 与 C:\Program Files\nodejs\node.exe 都没有），本次跳过'
  exit 1
}

# 1) 同步云端状态；失败不致命，但要换用"只跑学院"的预设
git checkout -- data/state.json 2>&1 | Out-Null
# --autostash：工作区有未提交改动时也能 pull（否则 rebase 直接拒绝：
# "cannot pull with rebase: You have unstaged changes"），拉完自动还原改动
# 直连 GitHub（约 2026-10 起本机直连稳定；gitconfig 里若写着代理，代理没开时反而连不上）
git -c http.proxy= -c https.proxy= pull --rebase --autostash --quiet 2>&1 | Out-Null
$synced = $LASTEXITCODE -eq 0
if (-not $synced) {
  git rebase --abort 2>&1 | Out-Null   # 避免把仓库留在 rebase 中途
}

# 选源：状态同步成功才敢跑全量（本地与云端各记一份"已见"，不同步会重复推送）；
# 同步失败时退到只跑学院源 —— 那几个源云端几乎抓不动（跨境超时），撞车概率最低。
if (-not $synced) {
  $runArgs = @('run', '--config=config/schools/uestc-math.yaml', '--allow-browser')
  Write-Log '同步云端状态失败（代理没开或网络不通）→ 本次只跑学院源，避免与云端重复推送'
} elseif ($HttpOnly) {
  # 教务处 5 个源：一次 2 秒、107 MB。--only 收的是不带学校前缀的短 id
  $runArgs = @('run', '--only=jwc-important,jwc-student,news-notice,news-academic,gr-notice', '--delay=1500', '--timeout=15000', '--concurrency=4')
  Write-Log '已同步云端状态 → 本次只跑教务处纯 HTTP 源（--HttpOnly，不启浏览器）'
} else {
  $runArgs = @('run', '--config=config/schools/uestc.yaml', '--allow-browser')
  Write-Log '已同步云端状态 → 本次跑全部源'
}

# 2) 抓取 + 推送
$output = & $node (Join-Path $repo 'src\cli.ts') @runArgs 2>&1 | Out-String
$code = $LASTEXITCODE
Add-Content -LiteralPath $log -Value $output -Encoding UTF8
Write-Log "抓取完成，退出码 $code"

# 2.5) 只有要推回线上时才重建产物（网页 / 应用读的就是 docs/ 下面这些文件）
if ($Push -and $code -eq 0) {
  & $node (Join-Path $repo 'src\cli.ts') dashboard 2>&1 | Out-String | Add-Content -LiteralPath $log -Encoding UTF8
  & $node (Join-Path $repo 'tools\build-schools.mjs') 2>&1 | Out-String | Add-Content -LiteralPath $log -Encoding UTF8
  Write-Log '已重建 docs/index.html 与按校数据'
}

# 3) 记一笔"本机刚跑过"的时间戳，云端 poll.yml 读它决定是否让路
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
Set-Content -LiteralPath (Join-Path $repo 'data\poller.json') -Value ('{"at":"' + $stamp + '","where":"local"}') -Encoding utf8

# 4) 提交状态变更；-Push 时再推回 main，让网页/应用与云端状态都跟上
git add data docs 2>&1 | Out-Null
git diff --cached --quiet 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
  Write-Log '状态无变化，跳过提交'
} else {
  git -c user.name='notice-radar-bot' -c user.email='notice-radar-bot@users.noreply.github.com' commit -q -m "chore(state): 本机抓取 $stamp [skip ci]" 2>&1 | Out-Null
  if (-not $Push) {
    Write-Log '状态已本地提交（未推送；加 -Push 才会推回 main）'
  } else {
    # 直连 GitHub：本机 gitconfig 里可能写着代理，代理没开时会导致 push 失败
    git -c http.proxy= -c https.proxy= pull --rebase --autostash --quiet 2>&1 | Out-Null
    git -c http.proxy= -c https.proxy= push --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Log '已推回 main（国内出口 → 线上）'
    } else {
      git rebase --abort 2>&1 | Out-Null
      Write-Log '推送失败（检查 git 凭据与网络）；本地提交保留，下次跑会先 pull --rebase 再试'
    }
  }
}

Write-Log '==== 结束 ===='
exit $code
