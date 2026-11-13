#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-01 - affected lane for P01_PRODUCT_BINARY_BUILT_IN_TAURI_DEV_MODE
  and P01_STARTUP_REPORT_ABSENT.

.DESCRIPTION
  Proves P01-NATIVE-ASSET-001 before the full canonical run spends its time:
    1  close the failed product window of the previous run, by exact path only
    2  static build-mode guard
    3  rebuild the renderer the binary embeds, prove the contract bundle has not
       drifted, and run the CSP guard over the sources and the built bundle
    4  build the product with the packaged frontend and guard its cargo messages
    5  launch the exact product binary with no development server
    6  require: bootstrap reached, packaged origin, no listener, clean exit
  The result is written as a non-canonical local document and never replaces
  canonical evidence.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-conformance\frontend-lane.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param([string] $RepositoryRoot = "D:\POLARIS")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
$hostDirectory = Join-Path $RepositoryRoot 'desktop\host'
$productExe = Join-Path $hostDirectory 'target\release\polaris-desktop.exe'
$buildModeTool = Join-Path $RepositoryRoot 'tools\p01-conformance\build-mode.mjs'
$messages = Join-Path $hostDirectory 'target\p01-build-messages.jsonl'
$modePath = Join-Path $hostDirectory 'target\p01-build-mode.json'
$probeDirectory = Join-Path $RepositoryRoot 'evidence\p01-native'
$node = if (Get-Command node.exe -ErrorAction SilentlyContinue) { 'node.exe' } else { 'node' }
$rendererDirectory = Join-Path $RepositoryRoot 'desktop\renderer'
$cspGuardTool = Join-Path $RepositoryRoot 'tools\p01-conformance\csp-guard.mjs'
$npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
$cargo = if (Get-Command cargo.exe -ErrorAction SilentlyContinue) { 'cargo.exe' } else { 'cargo' }
foreach ($dir in @((Join-Path $hostDirectory 'target'), $probeDirectory)) {
  if (-not (Test-Path -LiteralPath $dir)) { [void] (New-Item -ItemType Directory -Path $dir) }
}

# -- 1 the failed window: only the process whose image is this product binary --
# WebView2 child processes belong to that process and end with it. Nothing is
# selected by a browser process name.
$leftovers = @(Get-Process -Name 'polaris-desktop' -ErrorAction SilentlyContinue | Where-Object {
    $path = $null
    try { $path = $_.Path } catch { $path = $null }
    $null -ne $path -and [string]::Equals($path, $productExe, [System.StringComparison]::OrdinalIgnoreCase)
  })
foreach ($p in $leftovers) {
  Write-Host "--- closing the previous run's product window (pid $($p.Id))"
  try { [void] $p.CloseMainWindow() } catch { }
  if (-not $p.WaitForExit(10000)) { try { $p.Kill() } catch { }; [void] $p.WaitForExit(10000) }
}

# -- 2 static guard ------------------------------------------------------------
Write-Host "--- build-mode guard (static)"
& $node $buildModeTool --root $RepositoryRoot | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "LANE = FAIL (static guard)"; exit 1 }

# -- 3 the renderer the product embeds ------------------------------------------
# tauri embeds renderer\dist at compile time. A stale dist would measure old code,
# so the lane rebuilds it from the current sources before cargo runs.
Write-Host "--- renderer: contract bundle drift guard and production build"
Push-Location -LiteralPath $rendererDirectory
try {
  & $npm 'run' 'generate:check' | Out-Host
  if ($LASTEXITCODE -eq 0) { & $npm 'run' 'build' | Out-Host }
}
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { Write-Host "LANE = FAIL (renderer exit $LASTEXITCODE)"; exit 1 }

Write-Host "--- CSP guard (sources and packaged bundle)"
& $node $cspGuardTool --root $RepositoryRoot | Out-Host
if ($LASTEXITCODE -ne 0) { Write-Host "LANE = FAIL (CSP guard)"; exit 1 }

# -- 4 build and guard ------------------------------------------------------------
Write-Host "--- build the product binary with the packaged frontend"
Push-Location -LiteralPath $hostDirectory
try {
  & $cargo 'build' '--release' '-p' 'polaris-host' '--features' 'custom-protocol' '--message-format=json-render-diagnostics' | Out-File -LiteralPath $messages -Encoding ascii
}
finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { Write-Host "LANE = FAIL (cargo exit $LASTEXITCODE)"; exit 1 }

& $node $buildModeTool --root $RepositoryRoot --messages $messages --artifact product --expected-exe $productExe --out $modePath | Out-Host
$mode = [string] ((Get-Content -LiteralPath $modePath -Raw | ConvertFrom-Json).mode)
if ($mode -ne 'PACKAGED') { Write-Host "LANE = FAIL (frontend mode $mode)"; exit 1 }

# -- 5 standalone launch ----------------------------------------------------------
. (Join-Path $RepositoryRoot 'tools\p01-conformance\desktop-native.ps1')
$config = Get-Content -LiteralPath (Join-Path $hostDirectory 'app\tauri.conf.json') -Raw | ConvertFrom-Json
$devPort = ([System.Uri] [string] $config.build.devUrl).Port
$report = Join-Path $probeDirectory 'frontend-lane-startup.json'
Write-Host "--- launch the exact product binary with no development server"
$run = Invoke-PolarisLaunchProbe -ExecutablePath $productExe -ReportPath $report `
  -Environment @{ 'POLARIS_STARTUP_REPORT' = $report } -ForbiddenPort $devPort -TimeoutSeconds 60

# -- 6 verdict --------------------------------------------------------------------
$origin = $null
if ($null -ne $run.startup_report) { $origin = $run.startup_report.renderer_origin }
$packaged = @('http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost')
$checks = [ordered] @{
  build_mode_packaged    = ($mode -eq 'PACKAGED')
  window_appeared        = ($run.window_appeared -eq $true)
  no_dev_server_listener = ($run.dev_server_listening -eq $false)
  bootstrap_reached      = ($null -ne $run.startup_report -and $null -ne $run.startup_report.bootstrap_request_ms)
  packaged_origin        = ($null -ne $origin -and $packaged -contains [string] $origin)
  clean_exit             = ($run.process_exited -eq $true -and $run.orphan_processes -eq 0)
}
$pass = -not ($checks.Values -contains $false)
$document = [ordered] @{
  kind            = 'POLARIS_P01_FRONTEND_LANE'
  canonical       = $false
  claim           = 'P01-NATIVE-ASSET-001'
  measured_at     = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  verdict         = if ($pass) { 'PASS' } else { 'FAIL' }
  renderer_origin = $origin
  checks          = $checks
  run             = $run
}
$out = Join-Path $probeDirectory 'frontend-lane.local.json'
$json = ($document | ConvertTo-Json -Depth 16).Replace("`r`n", "`n")
[System.IO.File]::WriteAllText($out, ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))

foreach ($key in $checks.Keys) { Write-Host ("{0,-24} {1}" -f $key, $checks[$key]) }
Write-Host "renderer origin          $origin"
Write-Host "reason codes             $($run.reason_codes -join ', ')"
Write-Host "wrote $out"
Write-Host ("LANE = " + $document.verdict)
if ($pass) { exit 0 }
exit 1
