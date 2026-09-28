# 每天 08:00 由 Windows 计划任务调用：抓学院源并推送到手机。
#
# ⚠️ 本文件必须保存为「UTF-8 with BOM」。Windows PowerShell 5.1 读无 BOM 的 UTF-8 脚本时
#    会按系统 OEM 代码页（简中是 GBK）解码，中文注释会让解析直接报错。
#    改完请确认前三个字节是 EF BB BF，命令见 README「本机每天自动跑」。
#
# 为什么单独一个脚本：计划任务里的命令要处理 node 路径、日志、状态提交，
# 写进任务参数里全是转义地狱，不如放一个可读、可版本管理的脚本。
#
# 手动试跑：powershell -NoProfile -ExecutionPolicy Bypass -File tools\run-math-daily.ps1

$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repo

$logDir = Join-Path $repo 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'math-daily.log'

# 日志超过 1 MB 就轮转，避免计划任务长期运行把磁盘写满
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 1MB)) {
  Move-Item -LiteralPath $log -Destination "$log.1" -Force
}

# 关键：PowerShell 5.1 默认按系统 OEM 代码页解码子进程输出，
# node 输出的是 UTF-8，不设这个日志里中文就是乱码。
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
  # 无控制台时设置会失败，忽略即可
}

function Write-Log([string]$message) {
  Add-Content -LiteralPath $log -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $message" -Encoding UTF8
}

Write-Log '==== 开始 ===='

# 计划任务的环境里 PATH 可能不含 node，兜底用绝对路径
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
if (-not (Test-Path $node)) {
  Write-Log '找不到 node（PATH 与 C:\Program Files\nodejs\node.exe 都没有），本次跳过'
  exit 1
}

# 用变量接住输出再统一以 UTF-8 追加，避免 *>> 写出 UTF-16 混合编码
$output = & $node (Join-Path $repo 'src\cli.ts') run --config=config/schools/uestc-math.yaml --allow-browser 2>&1 | Out-String
$code = $LASTEXITCODE
Add-Content -LiteralPath $log -Value $output -Encoding UTF8
Write-Log "退出码 $code"

# 把状态变更提交到本地仓库（不推送）：保持工作区干净，
# 免得下次 git pull --rebase 被"本地已修改的 data/state.json"挡住。
git add data/state.json 2>&1 | Out-Null
git diff --cached --quiet 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  git -c user.name='notice-radar-bot' -c user.email='notice-radar-bot@users.noreply.github.com' commit -q -m 'chore(state): 本地学院源抓取 [skip ci]' 2>&1 | Out-Null
  Write-Log '状态已本地提交（未推送）'
}

Write-Log '==== 结束 ===='
exit $code
