# POLARIS remediation 2026-10-12 - Windows verification and packaging run.
#
# What it does, in order (each stage writes raw logs under evidence\remediation-2026-10-12\windows\<UTC stamp>\):
#   0. Resource read (CPU, RAM, running model servers) - read only. Nothing is stopped.
#   1. Tree identity: branch, HEAD, a SHA-256 over every tracked and untracked source file (local changes included).
#   2. Contracts and renderer: generate:check, typecheck, unit tests, production build (vite).
#   3. Rust: cargo test for core (single test thread), providers, maint and the Windows adapter (win).
#   4. Package: polaris-maint release build, then the NSIS installer through the pinned Tauri CLI (tauri.release.conf.json).
#      Hashes of polaris-desktop.exe, polaris-maint.exe and the installer; Authenticode status (expected NotSigned).
#   5. Migration rehearsal (optional, -Rehearsal): copies the live store ONLY while POLARIS is closed (db + wal + shm together),
#      into a new temp folder, runs the NEW polaris-maint upgrade and verify --full there. The live store is never written.
#   6. Window smoke (optional, -Smoke): starts the packaged polaris-desktop.exe with POLARIS_DATA_DIR pointing at a fresh temp
#      folder, waits for the startup report, closes only that process (by handle), and reports survivors it owns.
#
# Nothing is published, pushed, uploaded or signed. No model is loaded. Heavy stages honour -Jobs (default 2).
# Encoding: ASCII in every executable line.

[CmdletBinding()]
param(
  [string] $RepositoryRoot = '',
  [int] $Jobs = 2,
  [switch] $SkipRust,
  [switch] $SkipPackage,
  [switch] $Rehearsal,
  [switch] $Smoke
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 leaves $PSScriptRoot empty inside param defaults; resolve the root here instead.
if ([string]::IsNullOrEmpty($RepositoryRoot)) {
  $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
  $RepositoryRoot = (Resolve-Path (Join-Path $scriptDir '..\..\..')).Path
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$out = Join-Path $RepositoryRoot ("evidence\remediation-2026-10-12\windows\" + $stamp)
[void] (New-Item -ItemType Directory -Path $out -Force)
$record = [ordered] @{ stamp_utc = $stamp; repository = $RepositoryRoot; stages = [ordered] @{} }

function Save-Record {
  $json = $record | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText((Join-Path $out 'build-record.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-Stage {
  param([string] $Name, [string] $WorkDir, [string] $Exe, [string[]] $Arguments)
  $log = Join-Path $out ($Name + '.log')
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  Push-Location -LiteralPath $WorkDir
  # R-18: PowerShell 5.1 turns every stderr line of a native tool into a terminating NativeCommandError under 'Stop'
  # (vite warnings, cargo progress). The stage verdict is the exit code only, so stderr is logged, not thrown.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Exe @Arguments *> $log
    $code = $LASTEXITCODE
  }
  finally { $ErrorActionPreference = $previous; Pop-Location }
  $clock.Stop()
  $record.stages[$Name] = [ordered] @{ exit = $code; seconds = [math]::Round($clock.Elapsed.TotalSeconds, 1); log = ($Name + '.log') }
  Save-Record
  Write-Host ("[{0}] exit {1} in {2}s" -f $Name, $code, [math]::Round($clock.Elapsed.TotalSeconds, 1))
  return $code
}

function Get-FileSha {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $item = Get-Item -LiteralPath $Path
  return [ordered] @{ path = $Path; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash; bytes = $item.Length; modified_utc = $item.LastWriteTimeUtc.ToString('o') }
}

# 0. Resources (read only)
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$os = Get-CimInstance Win32_OperatingSystem
$models = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(ollama|LM Studio|lms|llama-server)$' } | ForEach-Object { $_.ProcessName })
$record.resources = [ordered] @{
  cpu = $cpu.Name; logical_processors = $cpu.NumberOfLogicalProcessors; load_percent = $cpu.LoadPercentage
  ram_total_mb = [math]::Round($os.TotalVisibleMemorySize / 1024); ram_free_mb = [math]::Round($os.FreePhysicalMemory / 1024)
  model_servers_running = $models; jobs = $Jobs
}
Save-Record
if ($models.Count -gt 0) { Write-Host ("Model server running (" + ($models -join ',') + "): heavy build stages may compete with it. Nothing is stopped.") }
$env:CARGO_BUILD_JOBS = [string] $Jobs
$env:RUST_TEST_THREADS = '1'

# 1. Tree identity
Push-Location -LiteralPath $RepositoryRoot
try {
  $files = @(& git ls-files -co --exclude-standard -- contracts desktop tools | Sort-Object)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $buffer = New-Object System.IO.MemoryStream
  foreach ($f in $files) {
    if (Test-Path -LiteralPath $f -PathType Leaf) {
      $h = (Get-FileHash -Algorithm SHA256 -LiteralPath $f).Hash
      $line = [System.Text.Encoding]::UTF8.GetBytes($h + '  ' + $f + "`n")
      $buffer.Write($line, 0, $line.Length)
    }
  }
  $tree = ([System.BitConverter]::ToString($sha.ComputeHash($buffer.ToArray()))).Replace('-', '').ToLowerInvariant()
  $record.tree = [ordered] @{ branch = (& git rev-parse --abbrev-ref HEAD); head = (& git rev-parse HEAD); dirty_files = @(& git status --porcelain).Count; source_files = $files.Count; source_sha256 = $tree }
  $record.toolchain = [ordered] @{ rustc = (& rustc --version); cargo = (& cargo --version); node = (& node --version); npm = (& npm --version); windows = $os.Caption + ' ' + $os.Version }
}
finally { Pop-Location }
Save-Record

# 2. Contracts and renderer
$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if ($null -eq $npm) { $npm = 'npm' }
[void] (Invoke-Stage 'contracts-generate-check' (Join-Path $RepositoryRoot 'contracts') $npm @('run', '-s', 'generate:check'))
[void] (Invoke-Stage 'contracts-verify' (Join-Path $RepositoryRoot 'contracts') $npm @('run', '-s', 'verify'))
[void] (Invoke-Stage 'renderer-verify' (Join-Path $RepositoryRoot 'desktop\renderer') $npm @('run', '-s', 'verify'))

# 3. Rust
$hostDir = Join-Path $RepositoryRoot 'desktop\host'
if (-not $SkipRust) {
  [void] (Invoke-Stage 'cargo-test-core' $hostDir 'cargo' @('test', '-p', 'polaris-host-core', '--', '--test-threads=1'))
  [void] (Invoke-Stage 'cargo-test-providers' $hostDir 'cargo' @('test', '-p', 'polaris-host-providers', '--', '--test-threads=1'))
  [void] (Invoke-Stage 'cargo-test-maint' $hostDir 'cargo' @('test', '-p', 'polaris-maint', '--', '--test-threads=1'))
  [void] (Invoke-Stage 'cargo-test-win' $hostDir 'cargo' @('test', '-p', 'polaris-host-win', '--', '--test-threads=1'))
}

# 4. Package
if (-not $SkipPackage) {
  [void] (Invoke-Stage 'cargo-build-maint-release' $hostDir 'cargo' @('build', '--release', '-p', 'polaris-maint'))
  $node = (Get-Command node.exe).Source
  $cli = Join-Path $RepositoryRoot 'desktop\renderer\node_modules\@tauri-apps\cli\tauri.js'
  $releaseConfig = Join-Path $RepositoryRoot 'desktop\host\app\tauri.release.conf.json'
  [void] (Invoke-Stage 'tauri-build-nsis' (Join-Path $RepositoryRoot 'desktop\host\app') $node @($cli, 'build', '--bundles', 'nsis', '--ci', '--config', $releaseConfig))
  $exe = Join-Path $hostDir 'target\release\polaris-desktop.exe'
  $maint = Join-Path $hostDir 'target\release\polaris-maint.exe'
  $installer = @(Get-ChildItem -LiteralPath (Join-Path $hostDir 'target\release\bundle\nsis') -Filter '*-setup.exe' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1)
  $record.artifacts = [ordered] @{ desktop = (Get-FileSha $exe); maint = (Get-FileSha $maint); installer = $(if ($installer.Count -gt 0) { Get-FileSha $installer[0].FullName } else { $null }) }
  $signing = @()
  foreach ($p in @($exe, $maint) + @($installer | ForEach-Object { $_.FullName })) {
    if ($null -ne $p -and (Test-Path -LiteralPath $p)) {
      $s = Get-AuthenticodeSignature -LiteralPath $p
      $signing += [ordered] @{ file = (Split-Path $p -Leaf); status = [string] $s.Status; signer = $(if ($null -ne $s.SignerCertificate) { $s.SignerCertificate.Subject } else { $null }) }
    }
  }
  $record.signing = $signing
  $record.signing_verdict = 'UNSIGNED unless a status above reads Valid with the owner''s certificate'
  $record.published = $false
  Save-Record
}

# 5. Migration rehearsal on a copy (never the live store)
if ($Rehearsal) {
  $live = Join-Path $env:LOCALAPPDATA 'sa.polaris.desktop'
  $running = @(Get-Process -Name 'polaris-desktop' -ErrorAction SilentlyContinue)
  if ($running.Count -gt 0) {
    $record.rehearsal = [ordered] @{ status = 'BLOCKED'; reason = 'POLARIS is running; close it so the store files form one consistent set' }
  }
  elseif (-not (Test-Path -LiteralPath (Join-Path $live 'polaris.db'))) {
    $record.rehearsal = [ordered] @{ status = 'NOT_RUN'; reason = 'no live store found at ' + $live }
  }
  else {
    $copy = Join-Path $env:TEMP ('polaris-rehearsal-' + $stamp)
    [void] (New-Item -ItemType Directory -Path $copy)
    foreach ($name in @('polaris.db', 'polaris.db-wal', 'polaris.db-shm')) {
      $src = Join-Path $live $name
      if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination (Join-Path $copy $name) }
    }
    $maintExe = Join-Path $hostDir 'target\release\polaris-maint.exe'
    $before = Get-FileSha (Join-Path $live 'polaris.db')
    [void] (Invoke-Stage 'rehearsal-upgrade' $copy $maintExe @('upgrade', '--data-dir', $copy))
    [void] (Invoke-Stage 'rehearsal-verify' $copy $maintExe @('verify', '--data-dir', $copy, '--full'))
    $after = Get-FileSha (Join-Path $live 'polaris.db')
    $record.rehearsal = [ordered] @{ status = 'RUN'; copy = $copy; live_unchanged = ($before.sha256 -eq $after.sha256) }
  }
  Save-Record
}

# 6. Window smoke with a fresh data folder
if ($Smoke) {
  $exe = Join-Path $hostDir 'target\release\polaris-desktop.exe'
  $data = Join-Path $env:TEMP ('polaris-smoke-' + $stamp)
  [void] (New-Item -ItemType Directory -Path $data)
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $exe
  $info.UseShellExecute = $false
  $info.EnvironmentVariables['POLARIS_DATA_DIR'] = $data
  $process = [System.Diagnostics.Process]::Start($info)
  $deadline = (Get-Date).AddSeconds(60)
  $report = Join-Path $data 'logs\host-diagnostics.log'
  while ((Get-Date) -lt $deadline -and -not (Test-Path -LiteralPath $report)) { Start-Sleep -Milliseconds 500 }
  Start-Sleep -Seconds 5
  $windowed = $process.MainWindowHandle -ne [IntPtr]::Zero
  [void] $process.CloseMainWindow()
  if (-not $process.WaitForExit(20000)) { $process.Kill(); $closed = 'KILLED_AFTER_TIMEOUT' } else { $closed = 'CLOSED' }
  $record.smoke = [ordered] @{ data_dir = $data; window = $windowed; diagnostics_written = (Test-Path -LiteralPath $report); exit = $closed; schema = $null }
  $maintExe = Join-Path $hostDir 'target\release\polaris-maint.exe'
  [void] (Invoke-Stage 'smoke-verify-store' $data $maintExe @('verify', '--data-dir', $data))
  Save-Record
}

Write-Host ('Record: ' + (Join-Path $out 'build-record.json'))
