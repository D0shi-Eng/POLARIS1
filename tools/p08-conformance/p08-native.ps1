# Phase-08 native measurement: the harness and the in-window UI E2E.
#
# Invoke-P08Harness runs the measurement harness (polaris-p08-native.exe) once over an
# owned data folder: the AppContainer sandbox, headless Edge in a Job Object, every
# artifact format, the real local model, the 24-task benchmark with Missions A-E, the
# scheduler, cancel and restart. The canary marker is set only in the harness process
# environment, so the sandbox check can prove it does not leak into a sandboxed run.
#
# Invoke-P08UiE2E launches the measurement build of the product twice (first stage and
# restart stage) with the Phase-08 suite, reusing the Phase-04 launch probe as it is
# (window, startup report, E2E report, graceful close, owned survivors by identity).
#
# It ends only processes it started, by handle - never by name.
#
# Encoding: ASCII in every executable line.

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '..\p04-conformance\p04-native.ps1')

# The value the harness compares against. A marker, not a secret.
$script:P08CanaryName = 'POLARIS_P08_SECRET_CANARY'
$script:P08CanaryValue = 'p08-canary-7f3a9c'

function Get-P08EdgeSurvivors {
  param([Parameter(Mandatory = $true)][string] $DataDirectory)
  $needle = $DataDirectory.ToLowerInvariant()
  $found = @()
  try {
    foreach ($p in @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'python.exe' OR Name = 'powershell.exe'" -ErrorAction Stop)) {
      $line = [string] $p.CommandLine
      if ($line -ne '' -and $line.ToLowerInvariant().Contains($needle)) { $found += [int] $p.ProcessId }
    }
  }
  catch { }
  return ,@($found)
}

function Invoke-P08Harness {
  param(
    [Parameter(Mandatory = $true)][string] $Executable,
    [Parameter(Mandatory = $true)][string] $OutDirectory,
    [Parameter(Mandatory = $true)][string] $DataDirectory,
    [int] $TaskMinutes = 20,
    [int] $TimeoutMinutes = 720,
    [string] $Model = '',
    [string] $Sections = '',
    [string] $Tasks = ''
  )
  $record = [ordered] @{ executable_present = (Test-Path -LiteralPath $Executable); started = $false; exit_code = $null; timed_out = $false; duration_ms = 0; survivors = @(); summary = $null; reason_codes = @() }
  if (-not $record.executable_present) { $record.reason_codes += 'HARNESS_MISSING'; return $record }
  foreach ($d in @($OutDirectory, $DataDirectory)) { if (-not (Test-Path -LiteralPath $d)) { [void] (New-Item -ItemType Directory -Path $d -Force) } }
  $stdout = Join-Path $OutDirectory 'harness-stdout.local.txt'
  $stderr = Join-Path $OutDirectory 'harness-stderr.local.txt'
  $arguments = @('--out', ('"' + $OutDirectory + '"'), '--data', ('"' + $DataDirectory + '"'), '--task-minutes', [string] $TaskMinutes)
  if ($Sections -ne '') { $arguments += @('--sections', $Sections) }
  if ($Tasks -ne '') { $arguments += @('--tasks', $Tasks) }
  [System.Environment]::SetEnvironmentVariable($script:P08CanaryName, $script:P08CanaryValue, 'Process')
  if ($Model -ne '') { [System.Environment]::SetEnvironmentVariable('POLARIS_P08_MODEL', $Model, 'Process') }
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $process = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    $record.started = $true
  }
  finally {
    [System.Environment]::SetEnvironmentVariable($script:P08CanaryName, $null, 'Process')
    [System.Environment]::SetEnvironmentVariable('POLARIS_P08_MODEL', $null, 'Process')
  }
  $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
  $lastLines = 0
  while (-not $process.HasExited) {
    if ((Get-Date) -gt $deadline) {
      $record.timed_out = $true
      $record.reason_codes += 'HARNESS_TIMED_OUT'
      try { $process.Kill() } catch { }
      break
    }
    Start-Sleep -Seconds 5
    $process.Refresh()
    if (Test-Path -LiteralPath $stdout) {
      $lines = @(Get-Content -LiteralPath $stdout -Encoding UTF8 -ErrorAction SilentlyContinue)
      if ($lines.Count -gt $lastLines) {
        foreach ($line in $lines[$lastLines..($lines.Count - 1)]) { Write-Host ("  " + $line) }
        $lastLines = $lines.Count
      }
    }
  }
  [void] $process.WaitForExit(30000)
  $process.Refresh()
  if ($process.HasExited) { $record.exit_code = $process.ExitCode }
  $record.duration_ms = [int] $clock.Elapsed.TotalMilliseconds
  Start-Sleep -Seconds 2
  $record.survivors = Get-P08EdgeSurvivors -DataDirectory $DataDirectory
  if (@($record.survivors).Count -gt 0) { $record.reason_codes += 'OWNED_PROCESS_SURVIVED' }
  $summaryPath = Join-Path $OutDirectory 'summary.local.json'
  if (Test-Path -LiteralPath $summaryPath) { $record.summary = Get-Content -LiteralPath $summaryPath -Raw -Encoding UTF8 | ConvertFrom-Json }
  else { $record.reason_codes += 'HARNESS_SUMMARY_ABSENT' }
  return $record
}

function Invoke-P08UiE2E {
  param(
    [Parameter(Mandatory = $true)][string] $Executable,
    [Parameter(Mandatory = $true)][string] $NodeCommand,
    [Parameter(Mandatory = $true)][string] $Tools,
    [Parameter(Mandatory = $true)][string] $RawDirectory,
    [Parameter(Mandatory = $true)][string] $ScratchDirectory,
    [string] $Model = ''
  )
  $native = [ordered] @{ performed = $false; reason = $null; model_id = $Model; first = $null; restart = $null; fixture_log = $null; data_survivors = @() }
  if (-not (Test-Path -LiteralPath $Executable)) { $native.reason = 'MEASUREMENT_BUILD_MISSING'; return $native }
  $dataDir = Join-Path $ScratchDirectory 'ui-data'
  [void] (New-Item -ItemType Directory -Path $dataDir -Force)
  $statePath = Join-Path $RawDirectory 'ui-fixture-state.local.json'
  $logPath = Join-Path $RawDirectory 'ui-fixture-log.local.json'
  $fixture = Start-P04Fixture -NodeCommand $NodeCommand -Script (Join-Path $Tools 'p08-web-fixture.mjs') -StatePath $statePath -LogPath $logPath
  if ($null -eq $fixture.state) { $native.reason = 'WEB_FIXTURE_DID_NOT_START'; return $native }
  try {
    $marker = 'm' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
    $common = @{
      'POLARIS_DATA_DIR'      = $dataDir
      'POLARIS_E2E_WEB_PORT'  = [string] $fixture.state.port
      'POLARIS_E2E_MARKER'    = $marker
      'POLARIS_LOCALE'        = 'en'
    }
    if ($Model -ne '') { $common['POLARIS_E2E_P08_MODEL'] = $Model }
    $first = $common.Clone()
    $first['POLARIS_E2E_SUITE'] = 'p08-first'
    $first['POLARIS_STARTUP_REPORT'] = (Join-Path $RawDirectory 'ui-first-startup.local.json')
    $native.first = Invoke-P04Launch -ExecutablePath $Executable -ReportPath $first['POLARIS_STARTUP_REPORT'] -Environment $first -SuiteTimeoutSeconds 7200
    $restart = $common.Clone()
    $restart['POLARIS_E2E_SUITE'] = 'p08-restart'
    $restart['POLARIS_STARTUP_REPORT'] = (Join-Path $RawDirectory 'ui-restart-startup.local.json')
    $native.restart = Invoke-P04Launch -ExecutablePath $Executable -ReportPath $restart['POLARIS_STARTUP_REPORT'] -Environment $restart -SuiteTimeoutSeconds 900
    $native.performed = $true
  }
  finally {
    $native.fixture_log = Stop-P04Fixture -Fixture $fixture -LogPath $logPath
    $native.data_survivors = Get-P08EdgeSurvivors -DataDirectory $dataDir
  }
  foreach ($launch in @($native.first, $native.restart)) {
    if ($null -eq $launch) { continue }
    $report = $launch.e2e_report
    if ($null -eq $report) { Write-Host ("  no E2E report: " + ($launch.reason_codes -join ',')); continue }
    $inner = if ($null -ne $report.PSObject.Properties['renderer'] -and $null -ne $report.renderer) { $report.renderer } else { $report }
    if ($null -ne $inner.PSObject.Properties['fatal']) { Write-Host ("  fatal: " + $inner.fatal) }
    foreach ($scenario in @($inner.scenarios)) { Write-Host ("  " + $scenario.status.PadRight(11) + $scenario.id.PadRight(14) + $scenario.detail) }
  }
  return $native
}
