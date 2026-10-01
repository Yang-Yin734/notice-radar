# 不走 GitHub：在本机（Windows 计划任务）定时抓取 + 推微信。
#
# 与 tools/run-daily.ps1 的区别：那个是"云端兜底"，会 git pull 同步云端状态（因此依赖 GitHub）。
# 这个脚本让本机**完全独立**：状态放在仓库外的独立目录，不碰 git，也就不需要 GitHub。
#
# 用法（在本项目根目录）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\install-local-task.ps1
#
# 可选参数：
#   -IntervalMinutes 30     抓取间隔（默认 30 分钟）
#   -DataDir <路径>         状态/日志目录（默认 %USERPROFILE%\notice-radar-data）
#   -AllowBrowser           让主任务也抓"需要浏览器"的源（会短暂弹出浏览器窗口，默认关）
#   -SkipMath               不注册学院（WAF）源的每日任务
#   -Uninstall              卸载这两个计划任务
#
# ⚠️ 与云端同时跑会**重复推送**同一条通知（两边各记一份"已见"状态）。
#    本机接管后，请把云端的 PUSH_ENABLED 设成 false，或禁用 poll / poll-math 工作流。
param(
  [int]$IntervalMinutes = 30,
  [string]$DataDir = (Join-Path $env:USERPROFILE 'notice-radar-data'),
  [switch]$AllowBrowser,
  [switch]$SkipMath,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$taskMain = 'notice-radar-local'
$taskMath = 'notice-radar-local-math'

if ($Uninstall) {
  foreach ($t in @($taskMain, $taskMath)) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $t -Confirm:$false
      Write-Host "已删除计划任务：$t"
    }
  }
  Write-Host "状态与日志仍保留在：$DataDir（不需要就手动删掉）"
  exit 0
}

# 1) Node 版本（要 22.18+，才能原生跑 TypeScript，不用先 build）
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'PATH 里找不到 node。请先装 Node 22.18+（https://nodejs.org），然后重开终端再跑本脚本。' }
$nodeVersion = (& node -v)
$major = [int](($nodeVersion -replace '^v', '') -split '\.')[0]
if ($major -lt 22) { throw "Node 版本太低（$nodeVersion）：本项目直接跑 .ts，需要 22.18 以上。" }
Write-Host "✓ Node $nodeVersion（$node）"

# 2) 推送密钥必须在 .env 里（这是"能收到微信"的唯一前提）
$key = ''
$envFile = Join-Path $repo '.env'
if (Test-Path $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^\s*SERVERCHAN_KEY\s*=\s*(.+)$') { $key = $Matches[1].Trim() }
  }
}
if (-not $key) {
  Write-Host ''
  Write-Host '✗ 还没配推送密钥，先把这两件事做完再回来跑本脚本：' -ForegroundColor Yellow
  Write-Host '   1) 打开 https://sct.ftqq.com 微信扫码登录，按提示关注它的服务号，复制 SendKey'
  Write-Host "   2) 在 $envFile 写入：SERVERCHAN_KEY=SCT...（可复制 .env.example 改名）"
  Write-Host ''
  exit 1
}
Write-Host "✓ 已找到 SERVERCHAN_KEY（长度 $($key.Length)，不打印内容）"

# 3) 依赖（只需一次）
if (-not (Test-Path (Join-Path $repo 'node_modules'))) {
  Write-Host '▸ 首次运行，安装依赖（npm install）…'
  Push-Location -LiteralPath $repo
  & npm install --no-audit --no-fund
  Pop-Location
}
Write-Host '✓ 依赖就绪'

# 4) 状态目录放在仓库外：完全不碰 git，因此不依赖 GitHub
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
$state = Join-Path $DataDir 'state.json'
$log = Join-Path $DataDir 'run.log'

# 生成两个包装脚本（英文注释 + 纯 ASCII，避免 PowerShell 5.1 的编码坑）
$mainScript = Join-Path $DataDir 'run.ps1'
$mathScript = Join-Path $DataDir 'run-math.ps1'
$common = @"
Set-Location -LiteralPath '$repo'
if ((Test-Path '$log') -and ((Get-Item '$log').Length -gt 1MB)) { Move-Item -LiteralPath '$log' -Destination '$log.1' -Force }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
"@
$browserFlag = ''
if ($AllowBrowser) { $browserFlag = ' --allow-browser' }
@"
$common
"`$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==== run ====" | Add-Content -LiteralPath '$log' -Encoding UTF8
& '$node' 'src/cli.ts' run --state="`$state"$browserFlag *>> '$log'
"@ | Set-Content -LiteralPath $mainScript -Encoding UTF8

@"
$common
"`$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==== run-math ====" | Add-Content -LiteralPath '$log' -Encoding UTF8
& '$node' 'src/cli.ts' run --config='config/schools/uestc-math.yaml' --state="`$state" --allow-browser *>> '$log'
"@ | Set-Content -LiteralPath $mathScript -Encoding UTF8

# 5) 注册计划任务
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$mainAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$mainScript`""
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $taskMain -Action $mainAction -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "✓ 已注册：$taskMain（每 $IntervalMinutes 分钟）"

if (-not $SkipMath) {
  $mathAction = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$mathScript`""
  $mathTrigger = New-ScheduledTaskTrigger -Daily -At 9am
  Register-ScheduledTask -TaskName $taskMath -Action $mathAction -Trigger $mathTrigger -Settings $settings -Force | Out-Null
  Write-Host "✓ 已注册：$taskMath（每天 09:00，抓需要真浏览器的学院源）"
}

# 6) 立刻试跑一次并看结果（"能不能收到微信"就看这一步）
Write-Host ''
Write-Host '▸ 立刻试跑一次（约 10-30 秒）…'
Start-ScheduledTask -TaskName $taskMain
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 5
  $info = Get-ScheduledTask -TaskName $taskMain | Get-ScheduledTaskInfo
  if ($info.LastTaskResult -ne 267009) { break }  # 267009 = 正在运行
}
Write-Host ''
Write-Host '--- 日志尾部 ---'
if (Test-Path $log) { Get-Content -LiteralPath $log -Tail 15 } else { Write-Host '（还没有日志，稍等再手动跑一次：Start-ScheduledTask -TaskName notice-radar-local）' }

Write-Host ''
Write-Host '下一步：'
Write-Host "  · 微信收到消息 = 成功；没收到先看上面日志里的 serverchan 那行"
Write-Host "  · 手动跑一次：Start-ScheduledTask -TaskName $taskMain"
Write-Host "  · 看日志：Get-Content '$log' -Tail 40"
Write-Host "  · 卸载：powershell -File tools\install-local-task.ps1 -Uninstall"
Write-Host "  · 记得把云端关掉（仓库 Variables 里 PUSH_ENABLED=false），否则同一条通知会推两次"
