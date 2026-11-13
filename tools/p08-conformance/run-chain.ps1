# POLARIS Phase-08 - development launcher: re-decide Phase-01..07 bottom-up (each runner re-runs the phases
# below it, as it always does), then run the canonical Phase-08 runner. Needed after a run whose regression
# failed: every runner requires the phase below it to be PASS before it starts.
# Stops at the first phase whose gate is not PASS. Writes one console copy per runner under evidence\p08-native.
#
# Each runner runs as its own powershell process (-File), exactly as the runners call one another. It must not
# run inside a redirected scope ("& runner *>&1"): there, Windows PowerShell 5.1 turns any native stderr line
# (for example an npm warning) into a terminating NativeCommandError under the runner's
# ErrorActionPreference = Stop, and the runner dies without deciding its gate (measured 2026-09-30, Phase-01
# stopped at "renderer: install dependencies"). Regression test: P08-TOOLS-010.
param(
  [string] $RepositoryRoot = 'D:\POLARIS',
  [string[]] $Phases = @('05', '06', '07', '08'),
  [switch] $SkipPreflight
)
$ErrorActionPreference = 'Stop'
$evidence = Join-Path $RepositoryRoot 'evidence'
$consoles = Join-Path $evidence 'p08-native'
if (-not (Test-Path -LiteralPath $consoles)) { [void] (New-Item -ItemType Directory -Path $consoles -Force) }
# Preflight, seconds instead of an hour: leftovers of an interrupted run (a W4/W5 workspace in TEMP or an
# AppContainer profile) make the frozen Phase-00 cleanup check fail at the end of every regression. They are
# named here and nothing is deleted; the owner moves them away, then the chain is started again.
if (-not $SkipPreflight) {
  $leftovers = @()
  $leftovers += @(Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'polaris-w4-*' -or $_.Name -like 'polaris-w5-*' } | ForEach-Object { $_.FullName })
  $packages = Join-Path $env:LOCALAPPDATA 'Packages'
  if (Test-Path -LiteralPath $packages) {
    $leftovers += @(Get-ChildItem -LiteralPath $packages -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'polaris-w4-exec*' -or $_.Name -like 'polaris-w5-*' } | ForEach-Object { $_.FullName })
  }
  if ($leftovers.Count -gt 0) {
    Write-Host "=== chain stopped: leftovers of an interrupted run would fail the Phase-00 cleanup check:"
    $leftovers | ForEach-Object { Write-Host ("    " + $_) }
    exit 1
  }
}
foreach ($phase in $Phases) {
  $runner = Join-Path $RepositoryRoot ("tools\p$phase-conformance\run.ps1")
  $console = Join-Path $consoles ("runner-console-chain-p$phase.local.txt")
  if ($phase -eq '08') { $console = Join-Path $consoles 'runner-console.local.txt' }
  # gate timestamps carry whole seconds only
  $started = (Get-Date).ToUniversalTime()
  $started = $started.AddTicks(-($started.Ticks % [TimeSpan]::TicksPerSecond))
  Write-Host ("=== chain: Phase-$phase runner started " + $started.ToString('o'))
  & powershell -NoProfile -ExecutionPolicy Bypass -Command "`$ErrorActionPreference = 'Continue'; & powershell -NoProfile -ExecutionPolicy Bypass -File '$runner' -RepositoryRoot '$RepositoryRoot' 2>&1 | ForEach-Object { `"`$_`" } | Tee-Object -FilePath '$console'; exit `$LASTEXITCODE"
  Write-Host ("=== chain: Phase-$phase runner exited with code " + $LASTEXITCODE)
  $gatePath = Join-Path $evidence ("phase-$phase-final-gate.json")
  if (-not (Test-Path -LiteralPath $gatePath)) { Write-Host ("=== chain stopped: no gate file for PHASE-$phase"); exit 1 }
  $gate = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  $decidedText = [string] $gate.measured_at
  if ([string]::IsNullOrWhiteSpace($decidedText)) { $decidedText = [string] $gate.decided_at }
  Write-Host ("=== chain: PHASE-$phase = " + $gate.verdict + " (decided " + $decidedText + ")")
  # a gate the runner did not re-decide in this run is stale: its verdict, even PASS, is never accepted
  $decided = [DateTime]::MinValue
  $parsed = [DateTime]::TryParse($decidedText, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal, [ref] $decided)
  if (-not $parsed -or $decided -lt $started) { Write-Host ("=== chain stopped: PHASE-$phase gate was not re-decided by this run (stale)"); exit 1 }
  if ($gate.verdict -ne 'PASS') { Write-Host "=== chain stopped: a gate is not PASS"; exit 1 }
}
Write-Host ("=== chain finished: PHASE-" + ($Phases -join ', ') + " decided in order")
exit 0
