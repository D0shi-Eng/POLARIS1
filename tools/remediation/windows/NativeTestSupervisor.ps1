# POLARIS NativeTestSupervisor (2026-10-15).
# The only sanctioned way to launch polaris-desktop.exe for a test. It:
#   1. refuses a data folder outside D:\POLARIS\_local, or equal to the live folder;
#   2. refuses to start while any polaris-desktop.exe is already running;
#   3. fingerprints the live store and the owner's EBWebView before and after;
#   4. builds the child environment explicitly (ProcessStartInfo), so nothing is inherited by accident;
#   5. records exit code and surviving processes, and a verdict on the live folder.
# Mode Product: sets POLARIS_DATA_DIR only and REMOVES WEBVIEW2_USER_DATA_FOLDER, which proves that the
#   application isolates WebView2 by itself (D-1). Mode Defended: sets both (belt and braces).
# Reads the live folder only (hashes and timestamps). ASCII only (Windows PowerShell 5.1).
param(
  [Parameter(Mandatory = $true)] [string] $Root,
  [string] $Exe = 'D:\POLARIS\desktop\host\target\release\polaris-desktop.exe',
  [ValidateSet('Product', 'Defended')] [string] $Mode = 'Product',
  [int] $AutoCloseSeconds = 0,
  [int] $MaxSessions = 1,
  # Measurement variables for the e2e build only. Keys outside POLARIS_E2E_* and POLARIS_STARTUP_REPORT are refused.
  [hashtable] $ExtraEnv = @{},
  # With -AutoCloseSeconds: 30 s after the window appears, sample CPU and memory of the app and its WebView2
  # processes (the ones whose command line names this root) every second for 60 s (PERFORMANCE-PLAN.md).
  [switch] $MeasureIdle
)
$ErrorActionPreference = 'Stop'
$allowedBase = 'D:\POLARIS\_local\'
$live = Join-Path $env:LOCALAPPDATA 'sa.polaris.desktop'
$Root = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
if (-not ($Root + '\').StartsWith($allowedBase, [System.StringComparison]::OrdinalIgnoreCase)) { throw "REFUSED: root must be under $allowedBase" }
$data = Join-Path $Root 'data'
if ([System.IO.Path]::GetFullPath($data).TrimEnd('\') -ieq $live) { throw 'REFUSED: data folder equals the live folder' }
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$log = Join-Path $Root 'supervisor.jsonl'

function Write-Record([hashtable] $record) {
  $record['at'] = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $line = $record | ConvertTo-Json -Compress -Depth 6
  Add-Content -LiteralPath $log -Value $line -Encoding ASCII
  Write-Host $line
}
function Get-LiveFingerprint {
  $db = Join-Path $live 'polaris.db'
  $wal = Join-Path $live 'polaris.db-wal'
  $eb = @(Get-ChildItem -LiteralPath (Join-Path $live 'EBWebView') -Recurse -File -Force -ErrorAction SilentlyContinue)
  $newest = $eb | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
  return [ordered] @{
    db = $(if (Test-Path -LiteralPath $db) { (Get-FileHash -Algorithm SHA256 -LiteralPath $db).Hash } else { $null })
    wal = $(if (Test-Path -LiteralPath $wal) { (Get-FileHash -Algorithm SHA256 -LiteralPath $wal).Hash } else { $null })
    ebwebview_files = $eb.Count
    ebwebview_newest_utc = $(if ($newest) { $newest.LastWriteTimeUtc.ToString('o') } else { $null })
  }
}
function Get-Polaris { @(Get-CimInstance Win32_Process -Filter "Name='polaris-desktop.exe'" -ErrorAction SilentlyContinue) }
function Get-Survivors([string] $marker) {
  @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      ($_.Name -eq 'polaris-desktop.exe') -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$marker*") })
}

$running = Get-Polaris
if ($running.Count -gt 0) { throw ('REFUSED: polaris-desktop.exe already running: ' + (($running | ForEach-Object { $_.ProcessId }) -join ',')) }
$free = (Get-PSDrive -Name D).Free
if ($free -lt 5GB) { throw 'REFUSED: less than 5 GiB free on D:' }

$exeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Exe).Hash
$before = Get-LiveFingerprint
Write-Record @{ event = 'preflight'; exe = $Exe; exe_sha256 = $exeHash; mode = $Mode; data = $data; live_before = $before; free_gb = [math]::Round($free / 1GB, 1) }

for ($i = 1; $i -le $MaxSessions; $i++) {
  if (Test-Path -LiteralPath (Join-Path $Root 'STOP')) { Write-Record @{ event = 'stop-file' }; break }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Exe
  $info.UseShellExecute = $false
  $info.WorkingDirectory = $Root
  $info.EnvironmentVariables['POLARIS_DATA_DIR'] = $data
  if ($Mode -eq 'Defended') {
    $info.EnvironmentVariables['WEBVIEW2_USER_DATA_FOLDER'] = (Join-Path $data 'webview')
  } elseif ($info.EnvironmentVariables.ContainsKey('WEBVIEW2_USER_DATA_FOLDER')) {
    $info.EnvironmentVariables.Remove('WEBVIEW2_USER_DATA_FOLDER')
  }
  foreach ($name in $ExtraEnv.Keys) {
    if (-not ($name -like 'POLARIS_E2E_*' -or $name -eq 'POLARIS_STARTUP_REPORT')) { throw "REFUSED: extra variable $name" }
    $info.EnvironmentVariables[$name] = [string] $ExtraEnv[$name]
  }
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $p = [System.Diagnostics.Process]::Start($info)
  Write-Record @{ event = 'started'; session = $i; pid = $p.Id }
  if ($AutoCloseSeconds -gt 0) {
    $windowAt = $null
    while ($clock.Elapsed.TotalSeconds -lt $AutoCloseSeconds -and -not $p.HasExited) {
      Start-Sleep -Milliseconds 250
      $p.Refresh()
      if ($null -eq $windowAt -and $p.MainWindowHandle -ne [IntPtr]::Zero) { $windowAt = [math]::Round($clock.Elapsed.TotalMilliseconds) }
    }
    if ($MeasureIdle -and -not $p.HasExited) {
      Start-Sleep -Seconds 30
      $tree = { @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -eq $p.Id -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -like "*$Root*") }) }
      $ids = @(& $tree | ForEach-Object { [int] $_.ProcessId })
      $procs = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
      $cpuStart = ($procs | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum
      $samples = @()
      $wall = [System.Diagnostics.Stopwatch]::StartNew()
      for ($s = 0; $s -lt 60; $s++) {
        Start-Sleep -Seconds 1
        $now = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
        $samples += [math]::Round((($now | Measure-Object -Property WorkingSet64 -Sum).Sum) / 1MB, 1)
      }
      $wall.Stop()
      $procs = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
      $cpuEnd = ($procs | ForEach-Object { $_.TotalProcessorTime.TotalMilliseconds } | Measure-Object -Sum).Sum
      $cores = [Environment]::ProcessorCount
      $cpuPct = [math]::Round(100 * ($cpuEnd - $cpuStart) / ($wall.Elapsed.TotalMilliseconds * $cores), 3)
      $mem = $samples | Measure-Object -Average -Maximum
      $webviews = @(& $tree | Where-Object { $_.Name -eq 'msedgewebview2.exe' }).Count
      Write-Record @{ event = 'idle-measure'; session = $i; processes = $ids.Count; webview2_processes = $webviews; cpu_percent_of_all_cores = $cpuPct; cores = $cores; working_set_mib_avg = [math]::Round($mem.Average, 1); working_set_mib_max = $mem.Maximum; window_s = 60 }
    }
    Write-Record @{ event = 'auto-close'; session = $i; window_ms = $windowAt }
    $closeClock = [System.Diagnostics.Stopwatch]::StartNew()
    if (-not $p.HasExited) { [void] $p.CloseMainWindow() }
    if (-not $p.WaitForExit(30000)) { Write-Record @{ event = 'did-not-exit-30s'; session = $i; pid = $p.Id } }
    Write-Record @{ event = 'close'; session = $i; close_ms = [math]::Round($closeClock.Elapsed.TotalMilliseconds) }
  } else {
    $p.WaitForExit()
  }
  $clock.Stop()
  $code = $(if ($p.HasExited) { $p.ExitCode } else { $null })
  Start-Sleep -Seconds 6
  $left = Get-Survivors $Root
  Write-Record @{ event = 'exited'; session = $i; code = $code; after_s = [math]::Round($clock.Elapsed.TotalSeconds, 1); survivors_after_6s = $left.Count; survivors = (($left | ForEach-Object { $_.Name + ':' + $_.ProcessId }) -join ',') }
}

$after = Get-LiveFingerprint
$webview = Join-Path $data 'webview'
$owned = @(Get-ChildItem -LiteralPath $webview -Recurse -File -Force -ErrorAction SilentlyContinue).Count
$unchanged = ($before.db -eq $after.db) -and ($before.wal -eq $after.wal) -and ($before.ebwebview_newest_utc -eq $after.ebwebview_newest_utc) -and ($before.ebwebview_files -eq $after.ebwebview_files)
Write-Record @{ event = 'verdict'; live_after = $after; live_unchanged = $unchanged; owned_webview_files = $owned }
if (-not $unchanged) { Write-Host 'LIVE FOLDER CHANGED - STOP' ; exit 2 }
