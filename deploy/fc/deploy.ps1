# 自动从仓库根 .env 读取 AK 再执行 s 命令，避免密钥进 s.yaml / git。
#
#   powershell -File deploy/fc/deploy.ps1 deploy    # 构建 + 部署（含定时触发器）
#   powershell -File deploy/fc/deploy.ps1 invoke    # 手动触发一次，看返回 JSON
#   powershell -File deploy/fc/deploy.ps1 logs      # 看最近调用日志
#   powershell -File deploy/fc/deploy.ps1 remove    # 删函数（OSS 里的状态不动）

param(
  [ValidateSet('deploy', 'invoke', 'logs', 'remove', 'config')]
  [string]$Action = 'deploy'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $here '..\..')
$envFile = Join-Path $root '.env'

if (-not (Test-Path $envFile)) {
  throw "找不到 $envFile；先在仓库根放一份 .env（含 OSS_AK_ID / OSS_AK_SECRET）"
}

Get-Content $envFile | Where-Object {
  $_ -match '^(OSS_AK_(ID|SECRET)|NOTICE_RADAR_WEBHOOK|SMTP_URL|MAIL_TO|MAIL_FROM)='
} | ForEach-Object {
  $k, $v = $_ -split '=', 2
  Set-Item -Path "env:$k" -Value $v
}

if (-not $env:OSS_AK_ID -or -not $env:OSS_AK_SECRET) {
  throw '.env 里缺少 OSS_AK_ID 或 OSS_AK_SECRET'
}

Push-Location $here
try {
  switch ($Action) {
    'deploy' { & s deploy -y }
    'invoke' { & s invoke }
    'logs' { & s logs }
    'remove' { & s remove -y }
    'config' { & s config get }
  }
} finally {
  Pop-Location
}
