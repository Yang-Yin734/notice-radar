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
#   3) 把状态变更提交到本地仓库（不推送）
#
# 手动试跑：powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-daily.ps1

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
git pull --rebase --autostash --quiet 2>&1 | Out-Null
$config = 'config/schools/uestc-math.yaml'
if ($LASTEXITCODE -eq 0) {
  $config = 'config/schools/uestc.yaml'
  Write-Log '已同步云端状态 → 本次跑全部源'
} else {
  git rebase --abort 2>&1 | Out-Null   # 避免把仓库留在 rebase 中途
  Write-Log '同步云端状态失败（代理没开或网络不通）→ 本次只跑学院源，避免与云端重复推送'
}

# 2) 抓取 + 推送
$output = & $node (Join-Path $repo 'src\cli.ts') run "--config=$config" --allow-browser 2>&1 | Out-String
$code = $LASTEXITCODE
Add-Content -LiteralPath $log -Value $output -Encoding UTF8
Write-Log "配置 $config，退出码 $code"

# 3) 状态变更提交到本地（不推送）：保持工作区干净，免得下次 pull 被本地改动挡住
git add data/state.json 2>&1 | Out-Null
git diff --cached --quiet 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  git -c user.name='notice-radar-bot' -c user.email='notice-radar-bot@users.noreply.github.com' commit -q -m 'chore(state): 本机每日抓取 [skip ci]' 2>&1 | Out-Null
  Write-Log '状态已本地提交（未推送）'
}

Write-Log '==== 结束 ===='
exit $code
