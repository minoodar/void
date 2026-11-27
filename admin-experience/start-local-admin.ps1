# Local admin preview launcher -- sandbox only, never touches production.
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File admin-experience\start-local-admin.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File admin-experience\start-local-admin.ps1 -Stop
#
# The secret below is a throwaway local placeholder, not a real credential.
# Production ADMIN_SECRET lives in Cloudflare secrets and is never set here.

param(
    [switch]$Stop,
    [string]$AdminSecret = 'local-dev-signals-secret-not-real',
    [int]$ApiPort = 8787,
    [int]$SitePort = 8991
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Logs = Join-Path $Root '_tmp\logs'
$Node = 'E:\Program Files\nodejs\node.exe'
if (-not (Test-Path $Node)) { $Node = (Get-Command node).Source }

if ($Stop) {
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
        $_.CommandLine -match 'wrangler-dist[\\/]cli\.js' -or $_.CommandLine -match 'admin-static\.mjs'
    } | ForEach-Object {
        Write-Host ("stopping pid " + $_.ProcessId)
        Stop-Process -Id $_.ProcessId -Force
    }
    return
}

New-Item -ItemType Directory -Force -Path $Logs | Out-Null

$Wrangler = Join-Path $Root 'worker\letters\node_modules\wrangler\wrangler-dist\cli.js'
$Static = Join-Path $Root '_tmp\admin-static.mjs'
foreach ($p in @($Wrangler, $Static)) {
    if (-not (Test-Path $p)) { throw "missing $p" }
}

Start-Process -FilePath $Node -ArgumentList @(
    "`"$Wrangler`"", 'dev', '--local', '--persist-to', '../../.wrangler/signals-local',
    '--config', 'wrangler.local.toml', '--port', "$ApiPort", '--ip', '127.0.0.1',
    '--var', "ADMIN_SECRET:$AdminSecret"
) -WorkingDirectory (Join-Path $Root 'worker\letters') -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $Logs 'worker.out.log') `
  -RedirectStandardError (Join-Path $Logs 'worker.err.log')

Start-Process -FilePath $Node -ArgumentList @("`"$Static`"", "$SitePort") `
  -WorkingDirectory $Root -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $Logs 'static.out.log') `
  -RedirectStandardError (Join-Path $Logs 'static.err.log')

Write-Host "starting worker on 127.0.0.1:$ApiPort and site on 127.0.0.1:$SitePort ..."
foreach ($try in 1..30) {
    Start-Sleep -Seconds 2
    try {
        $api = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 `
            -Uri "http://127.0.0.1:$ApiPort/signals/version").StatusCode
    } catch { $api = 0 }
    try {
        $site = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 `
            -Uri "http://127.0.0.1:$SitePort/index.html").StatusCode
    } catch { $site = 0 }
    if ($api -eq 200 -and $site -eq 200) {
        Write-Host "READY  api:$api  site:$site"
        Write-Host ("Admin panel : http://127.0.0.1:$SitePort/index.html?admin=true&local-api=1")
        Write-Host ("Admin secret: $AdminSecret   (local sandbox placeholder, never a production credential)")
        Write-Host ("Stop        : powershell -NoProfile -ExecutionPolicy Bypass -File admin-experience\\start-local-admin.ps1 -Stop")
        return
    }
}
Write-Host "NOT READY  api:$api site:$site  -- see $Logs"
