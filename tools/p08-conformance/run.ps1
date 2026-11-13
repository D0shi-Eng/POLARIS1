#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-08 - the single verification run (final product completion).

.DESCRIPTION
  One command. It verifies the contracts, the runtime and the renderer, builds the
  product, the measurement build, the maintenance tool and the Phase-08 harness, runs
  every Phase-08 test group, runs the native harness on this computer (AppContainer
  sandbox, headless Edge, every artifact format, the real local model, the 24-task
  benchmark with Missions A-E, the scheduler, cancel and restart), runs the in-window
  UI E2E twice (first launch and restart), re-runs the Phase-07 gate (which re-runs
  Phase-06 down to the frozen Phase-00 gate), scans for secrets, checks the repository
  files, derives the thirteen Phase-08 evidence documents and decides the final gate.

  ORDER
  -----
     1  prerequisite        Phase-07 final gate PASS
     2  contracts           generate, drift check, typecheck, build
     3  runtime             package refresh, typecheck, build
     4  renderer            install, generate, drift check, typecheck, build, CSP guard, ASCII, test build
     5  host build          product, measurement, maintenance and harness binaries
     6  host groups         Phase-08 groups, host core, other crates, binding, clippy
     7  renderer groups     Phase-08 UX, accessibility, every renderer test, instruments, contracts
     8  native harness      sandbox, browser, artifacts, real model, benchmark, lifecycle, restart
     9  UI E2E              the measurement build in a real window, first launch and restart
    10  regression          the Phase-07 runner (re-runs Phase-06 .. the frozen Phase-00 gate)
    11  repository          secret scan, notices, repository files
    12  derivation          the thirteen documents and the final gate

  Nothing is published, uploaded, pushed or signed by this runner. Every process it
  starts is ended by handle, never by name. The harness and the UI E2E use owned data
  folders under evidence\p08-native\scratch; the user's own POLARIS data is not used.

  ENCODING
  --------
  Every executable line in this file is ASCII.

.PARAMETER RepositoryRoot
  Explicit repository root.

.PARAMETER Model
  Optional local model id for the benchmark (for example ollama:qwen2.5:7b). Without
  it the harness picks the best local chat model it discovers.

.PARAMETER TaskMinutes
  Wall-clock limit for each benchmark task (default 20).

.PARAMETER IncludeModel
  Run the real-model tests as well (harness sections 'model' and 'missions', the UI scenarios that
  drive a mission with the model). Without it they are DEFERRED to a later phase (owner decision
  2026-09-30): the run record says so, and the derivation marks exactly the closed list of
  model-dependent conditions DEFERRED, never PASS (p08-derive.mjs MODEL_DEFERRED_CLAIMS).

.PARAMETER Regression
  PriorGates (default, owner policy 2026-09-30: each phase is tested separately): stage 10 does not
  re-run the Phase-07 runner; P08-REG-01/02 read the Phase-07 gate as its own runner decided it and
  require it canonical and PASS. Rerun: the Phase-07 runner is re-run inside this run (stage 10).

.PARAMETER SkipRegression
  Skip stage 10. Such a run cannot produce PHASE-08 = PASS, and says so.

.PARAMETER DeriveOnly
  Re-run stages 11-12 over the raw records of the last full run, measuring nothing again.

.PARAMETER Remeasure
  Re-measure named stages over the raw records of the last full run, then stages 11-12:
  'ui' (renderer build, measurement build, UI E2E in a real window), 'regression'
  (the Phase-07 runner) and/or 'missions' (only the benchmark tasks named by -RemeasureTasks,
  each as a new mission with the same model and the same checks; needs -IncludeModel; the
  earlier rows are kept under 'superseded' by p08-merge-missions.mjs). Every other raw record is kept; the run record says which stages
  were re-measured, when, and why (-RemeasureReason).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p08-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [string] $Model = '',
  [int] $TaskMinutes = 20,
  [switch] $IncludeModel,
  [switch] $SkipRegression,
  [ValidateSet('PriorGates', 'Rerun')] [string] $Regression = 'PriorGates',
  [switch] $DeriveOnly,
  [string[]] $Remeasure = @(),
  [string] $RemeasureTasks = '',
  [string] $RemeasureReason = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:Marker = "POLARIS_P08_NATIVE_RUN"
$script:Stages = New-Object System.Collections.Generic.List[object]
$script:HardFailure = $null
$script:Markers = @(
  "contracts\package.json",
  "desktop\host\Cargo.toml",
  "desktop\host\core\src\p08\mod.rs",
  "desktop\host\harness\Cargo.toml",
  "desktop\host\win\Cargo.toml",
  "desktop\renderer\package.json",
  "tools\p07-conformance\run.ps1",
  "tools\p08-conformance\p08-common.mjs"
)

function Resolve-P08Root {
  param([string] $Explicit)
  $candidates = @()
  if (-not [string]::IsNullOrWhiteSpace($Explicit)) { $candidates = @([System.IO.Path]::GetFullPath($Explicit)) }
  else {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) { $candidates += [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..")) }
    $candidates += $script:DefaultRepositoryRoot
  }
  foreach ($candidate in $candidates) {
    $missing = @($script:Markers | Where-Object { -not (Test-Path -LiteralPath (Join-Path $candidate $_)) })
    if ($missing.Count -eq 0) { return $candidate }
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) { throw ("BOOTSTRAP FAILED: RepositoryRoot " + $candidate + " is missing: " + ($missing -join ', ')) }
  }
  throw "BOOTSTRAP FAILED: no candidate path carries the POLARIS Phase-08 markers."
}

$RepositoryRoot = Resolve-P08Root -Explicit $RepositoryRoot
Set-Location -LiteralPath $RepositoryRoot

function Get-ToolCommand {
  param([string] $Windows, [string] $Other)
  if (Get-Command $Windows -ErrorAction SilentlyContinue) { return $Windows }
  if (Get-Command $Other -ErrorAction SilentlyContinue) { return $Other }
  throw ("BOOTSTRAP FAILED: " + $Other + " is not on PATH.")
}

$script:Node = Get-ToolCommand 'node.exe' 'node'
$script:Npm = Get-ToolCommand 'npm.cmd' 'npm'
$script:Cargo = Get-ToolCommand 'cargo.exe' 'cargo'

function Get-VersionText {
  param([string] $Command, [string[]] $Arguments)
  try { return ((& $Command @Arguments 2>$null) | Select-Object -First 1) -as [string] } catch { return '' }
}

$environmentRecord = [ordered] @{
  os_version      = [System.Environment]::OSVersion.VersionString
  is_windows      = ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT)
  powershell      = ($PSVersionTable.PSVersion.ToString() + ' ' + $PSVersionTable.PSEdition)
  node            = (Get-VersionText $script:Node @('--version'))
  cargo           = (Get-VersionText $script:Cargo @('--version'))
  rustc           = (Get-VersionText 'rustc' @('--version'))
  processor_count = [System.Environment]::ProcessorCount
}

Write-Host "runner     : polaris.p08.conformance.runner"
Write-Host "root       : $RepositoryRoot"
Write-Host ("node       : " + $environmentRecord.node + "   cargo : " + $environmentRecord.cargo)

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
$rawDirectory = Join-Path $evidenceDirectory 'p08-native'
if (-not (Test-Path -LiteralPath $rawDirectory)) { [void] (New-Item -ItemType Directory -Path $rawDirectory -Force) }
$tools = Join-Path $RepositoryRoot 'tools\p08-conformance'

function Write-RawJson {
  param([string] $Path, $Value)
  $json = ($Value | ConvertTo-Json -Depth 40).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($Path, ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

function Invoke-NodeTool {
  param([string] $Script, [string[]] $Arguments = @())
  & $script:Node (Join-Path $tools $Script) '--root' $RepositoryRoot @Arguments
}

function Write-Verdicts {
  $gatePath = Join-Path $evidenceDirectory 'phase-08-final-gate.json'
  if (-not (Test-Path -LiteralPath $gatePath)) { Write-Host "PHASE-08 = INCONCLUSIVE (no final gate was written)"; return $null }
  $gate = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Host ""
  Write-Host ("PHASE-08 = " + $gate.verdict + "  (" + $gate.summary.pass + "/" + $gate.summary.conditions + " conditions PASS)")
  foreach ($p in $gate.release_verdicts.PSObject.Properties) { if ($p.Value -isnot [System.Array]) { Write-Host (($p.Name.ToUpperInvariant()).PadRight(28) + " = " + $p.Value) } }
  return $gate
}

# -- 1 prerequisite -----------------------------------------------------------

$phase07Path = Join-Path $evidenceDirectory 'phase-07-final-gate.json'
if (-not (Test-Path -LiteralPath $phase07Path)) { throw "PREREQUISITE MISSING: evidence\phase-07-final-gate.json" }
$phase07Before = Get-Content -LiteralPath $phase07Path -Raw -Encoding UTF8 | ConvertFrom-Json
if ($phase07Before.verdict -ne 'PASS') { throw ("PREREQUISITE NOT SATISFIED: PHASE-07 = " + $phase07Before.verdict) }
Write-Host ("--- 1 prerequisite: PHASE-07 = PASS (decided " + $phase07Before.measured_at + ")")

if ($DeriveOnly) {
  Set-Item -Path ("Env:" + $script:Marker) -Value '1'
  foreach ($step in @('p08-secrets.mjs', 'p08-notices.mjs', 'p08-repository.mjs', 'p08-derive.mjs', 'p08-final-gate.mjs')) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $script:Node (Join-Path $tools $step) '--root' $RepositoryRoot 2>&1 | ForEach-Object { Write-Host $_ }
    $ErrorActionPreference = $previous
  }
  Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue
  $gate = Write-Verdicts
  if ($null -ne $gate -and $gate.verdict -eq 'PASS') { exit 0 }
  exit 1
}

# -- 1b leftovers of an interrupted run -------------------------------------------
# A measurement binary built from this repository that is still running (an earlier run whose
# console was closed) would hold its executable open and share the local model. Only processes
# whose image lives under this repository's build folder are stopped; nothing else is touched.
$ownedTarget = Join-Path $RepositoryRoot 'desktop\host\target'
$leftovers = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $p = $null; try { $p = $_.Path } catch { }
  $p -and $p.StartsWith($ownedTarget, [System.StringComparison]::OrdinalIgnoreCase)
})
foreach ($l in $leftovers) {
  Write-Host ("stopping a leftover measurement process: " + $l.ProcessName + " (pid " + $l.Id + ")")
  try { Stop-Process -Id $l.Id -Force -ErrorAction Stop } catch { Write-Host ("  could not stop it: " + $_.Exception.Message) }
}
$script:LeftoverNames = @($leftovers | ForEach-Object { $_.ProcessName })
if ($leftovers.Count -gt 0) { Start-Sleep -Seconds 3 }

$runStarted = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$harnessOut = Join-Path $rawDirectory 'harness'
if ($Remeasure.Count -eq 0) {
  foreach ($stale in @('groups.local.json', 'ui.local.json', 'secrets.local.json', 'repository.local.json')) {
    $path = Join-Path $rawDirectory $stale
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
  if (Test-Path -LiteralPath $harnessOut) { Remove-Item -LiteralPath $harnessOut -Recurse -Force }
}
$scratch = Join-Path $rawDirectory ('scratch-' + (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))
[void] (New-Item -ItemType Directory -Path $scratch -Force)

Set-Item -Path ("Env:" + $script:Marker) -Value '1'

$runRecord = [ordered] @{
  leftover_processes_stopped = @($script:LeftoverNames)
  schema_version      = '1.0.0'
  tool                = 'polaris.p08.runner'
  canonical           = $true
  run_started         = $runStarted
  environment         = $environmentRecord
  builds              = [ordered] @{}
  stages              = @()
  harness             = $null
  phase07_runner_exit = $null
  skip_regression     = [bool] $SkipRegression
  regression_mode     = $(if ($Regression -eq 'Rerun') { 'RERUN' } else { 'PRIOR_GATES' })
  model_deferred      = (-not $IncludeModel)
  model_deferred_reason = $(if ($IncludeModel) { $null } else { 'owner decision 2026-09-30: real-model tests (benchmark, model-driven missions and UI scenarios) move to a later phase' })
}

function Save-RunRecord {
  $runRecord.stages = @($script:Stages.ToArray())
  Write-RawJson -Path (Join-Path $rawDirectory 'run.local.json') -Value $runRecord
}

function Invoke-Stage {
  param([string] $Name, [scriptblock] $Body, [switch] $Soft)
  if ($null -ne $script:HardFailure -and -not $Soft) {
    [void] $script:Stages.Add([pscustomobject] @{ name = $Name; kind = 'hard'; exit_code = -1; duration_ms = 0; skipped_after = $script:HardFailure })
    Write-Host ("--- SKIPPED after failure: " + $Name)
    Save-RunRecord
    return
  }
  Write-Host ("--- " + $Name)
  $started = Get-Date
  $global:LASTEXITCODE = 0
  $code = 0
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Body 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host $_.ToString() } else { Write-Host $_ }
    }
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
  }
  catch {
    Write-Host ("stage error: " + $_.Exception.Message)
    $code = 99
  }
  finally { $ErrorActionPreference = $previous }
  $kind = 'hard'
  if ($Soft) { $kind = 'soft' }
  [void] $script:Stages.Add([pscustomobject] @{ name = $Name; kind = $kind; exit_code = $code; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds })
  Save-RunRecord
  if ($code -ne 0) {
    Write-Host ("--- FAILED (" + $code + "): " + $Name)
    if (-not $Soft) { $script:HardFailure = $Name }
  }
}

function Invoke-Npm {
  param([string] $Directory, [string[]] $Arguments)
  Push-Location -LiteralPath $Directory
  try {
    & $script:Npm @Arguments
    if ($LASTEXITCODE -ne 0) { throw ("npm " + ($Arguments -join ' ') + " exited " + $LASTEXITCODE) }
  }
  finally { Pop-Location }
}

function Invoke-Groups {
  param([string[]] $Ids)
  $arguments = @((Join-Path $tools 'p08-test-groups.mjs'), '--root', $RepositoryRoot)
  foreach ($id in $Ids) { $arguments += @('--group', $id) }
  & $script:Node @arguments
}

$contracts = Join-Path $RepositoryRoot 'contracts'
$runtime = Join-Path $RepositoryRoot 'runtime'
$renderer = Join-Path $RepositoryRoot 'desktop\renderer'
$hostDirectory = Join-Path $RepositoryRoot 'desktop\host'

# -- re-measurement of named stages ----------------------------------------------

if ($Remeasure.Count -gt 0) {
  $previousRun = Join-Path $rawDirectory 'run.local.json'
  if (-not (Test-Path -LiteralPath $previousRun)) { throw "a re-measurement needs the run record of a full run" }
  $record = Get-Content -LiteralPath $previousRun -Raw -Encoding UTF8 | ConvertFrom-Json
  $done = [ordered] @{}
  # the same environment the full run gives its test groups (the Arabic PDF test needs a font)
  $arialFont = Join-Path $env:WINDIR 'Fonts\arial.ttf'
  if (Test-Path -LiteralPath $arialFont) { Set-Item -Path 'Env:POLARIS_P08_PDF_FONT' -Value $arialFont }
  if ($Remeasure -contains 'ui') {
    Write-Host "--- 9 (re-measured) UI E2E over the raw records of the last full run"
    $uiStarted = Get-Date
    $uiCode = 0
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      Invoke-Npm $renderer @('run', 'build')
      Push-Location -LiteralPath $hostDirectory
      try {
        & $script:Cargo @('build', '--release', '-p', 'polaris-host', '--features', 'custom-protocol,e2e', '--target-dir', 'target-e2e') 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw "measurement build failed" }
      }
      finally { Pop-Location }
      . (Join-Path $tools 'p08-native.ps1')
      $chosen = $Model
      $modelDoc = Join-Path $harnessOut 'model.local.json'
      if (-not $IncludeModel) { $chosen = '' }
      elseif ($chosen -eq '' -and (Test-Path -LiteralPath $modelDoc)) {
        $m = Get-Content -LiteralPath $modelDoc -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $m.extra -and $null -ne $m.extra.model_id) { $chosen = [string] $m.extra.model_id }
      }
      $ui = Invoke-P08UiE2E -Executable (Join-Path $hostDirectory 'target-e2e\release\polaris-desktop.exe') -NodeCommand $script:Node -Tools $tools -RawDirectory $rawDirectory -ScratchDirectory $scratch -Model $chosen
      Write-RawJson -Path (Join-Path $rawDirectory 'ui.local.json') -Value $ui
      if (-not $ui.performed) { throw ("UI E2E not performed: " + $ui.reason) }
    }
    catch {
      Write-Host ("stage error: " + $_.Exception.Message)
      $uiCode = 99
    }
    finally { $ErrorActionPreference = $previous }
    foreach ($st in @($record.stages)) {
      if ($st.name -like '9 UI E2E*') { $st.exit_code = $uiCode; $st.duration_ms = [int]((Get-Date) - $uiStarted).TotalMilliseconds }
    }
    $done.ui = $uiCode
  }
  if ($Remeasure -contains 'missions') {
    Write-Host ("--- 8 (re-measured) benchmark tasks " + $RemeasureTasks + " over the raw records of the last full run")
    $misCode = 0
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      if (-not $IncludeModel) { throw "re-measuring benchmark tasks needs -IncludeModel" }
      if ($RemeasureTasks.Trim() -eq '') { throw "name the tasks with -RemeasureTasks" }
      $modelDoc = Join-Path $harnessOut 'model.local.json'
      $chosen = $Model
      if ($chosen -eq '' -and (Test-Path -LiteralPath $modelDoc)) {
        $m = Get-Content -LiteralPath $modelDoc -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($null -ne $m.extra -and $null -ne $m.extra.model_id) { $chosen = [string] $m.extra.model_id }
      }
      if ($chosen -eq '') { throw "the model of the full run is unknown" }
      Push-Location -LiteralPath $hostDirectory
      try {
        & $script:Cargo @('build', '--release', '-p', 'polaris-p08-harness') 2>&1 | ForEach-Object { Write-Host $_ }
        if ($LASTEXITCODE -ne 0) { throw "harness build failed" }
      }
      finally { Pop-Location }
      . (Join-Path $tools 'p08-native.ps1')
      $stampText = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
      $remeasureOut = Join-Path $rawDirectory ('harness-remeasure-' + $stampText)
      $h = Invoke-P08Harness -Executable (Join-Path $hostDirectory 'target\release\polaris-p08-native.exe') -OutDirectory $remeasureOut -DataDirectory (Join-Path $scratch 'harness-remeasure-data') -TaskMinutes $TaskMinutes -Model $chosen -Sections 'model,missions' -Tasks $RemeasureTasks
      if (@($h.reason_codes).Count -gt 0) { throw ("harness: " + (@($h.reason_codes) -join ', ')) }
      & $script:Node (Join-Path $tools 'p08-merge-missions.mjs') '--root' $RepositoryRoot '--from' $remeasureOut '--tasks' $RemeasureTasks '--reason' $RemeasureReason 2>&1 | ForEach-Object { Write-Host $_ }
      if ($LASTEXITCODE -ne 0) { throw "merge refused" }
    }
    catch {
      Write-Host ("stage error: " + $_.Exception.Message)
      $misCode = 99
    }
    finally { $ErrorActionPreference = $previous }
    $done.missions = [ordered] @{ exit_code = $misCode; tasks = $RemeasureTasks }
  }
  if ($Remeasure -contains 'regression') {
    Write-Host "--- 10 (re-measured) Phase-07 runner"
    $regStarted = Get-Date
    Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p07-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
    $regCode = $LASTEXITCODE
    $record.phase07_runner_exit = $regCode
    foreach ($st in @($record.stages)) {
      if ($st.name -like '10 Phase-07 runner*') { $st.exit_code = $regCode; $st.duration_ms = [int]((Get-Date) - $regStarted).TotalMilliseconds }
    }
    $done.regression = $regCode
  }
  # every re-measurement is kept, oldest first; none replaces an earlier one
  $history = @()
  if ($null -ne $record.PSObject.Properties['remeasurements']) { $history = @($record.remeasurements) }
  if ($null -ne $record.PSObject.Properties['remeasured']) { $history += $record.remeasured; $record.PSObject.Properties.Remove('remeasured') }
  $history += [pscustomobject] ([ordered] @{ at = $runStarted; stages = $done; reason = $RemeasureReason; environment = $environmentRecord })
  $record | Add-Member -NotePropertyName remeasurements -NotePropertyValue $history -Force
  Write-RawJson -Path $previousRun -Value $record
  Set-Item -Path ("Env:" + $script:Marker) -Value '1'
  foreach ($step in @('p08-secrets.mjs', 'p08-notices.mjs', 'p08-repository.mjs', 'p08-derive.mjs', 'p08-final-gate.mjs')) {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $script:Node (Join-Path $tools $step) '--root' $RepositoryRoot 2>&1 | ForEach-Object { Write-Host $_ }
    $ErrorActionPreference = $previous
  }
  Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue
  $gate = Write-Verdicts
  if ($null -ne $gate -and $gate.verdict -eq 'PASS') { exit 0 }
  exit 1
}

# -- 2 / 3 contracts and runtime ------------------------------------------------

Invoke-Stage "2 contracts: generation, drift check, typecheck, build" {
  Invoke-Npm $contracts @('run', 'generate')
  Invoke-Npm $contracts @('run', 'generate:check')
  Invoke-Npm $contracts @('run', 'typecheck')
  Invoke-Npm $contracts @('run', 'build')
}

Invoke-Stage "3 runtime verify" {
  $installed = (Join-Path (Join-Path (Join-Path $runtime 'node_modules') '@polaris') 'contracts').TrimEnd('\')
  if (-not $installed.EndsWith('runtime\node_modules\@polaris\contracts')) { throw ("refusing to refresh an unexpected path: " + $installed) }
  if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Recurse -Force }
  Invoke-Npm $runtime @('install', '--no-audit', '--no-fund')
  Invoke-Npm $runtime @('run', 'typecheck')
  Invoke-Npm $runtime @('run', 'build')
}

# -- 4 renderer ------------------------------------------------------------------

Invoke-Stage "4 renderer: install, generate, drift check, typecheck, build, CSP guard, ASCII, test build" {
  Invoke-Npm $renderer @('install', '--no-audit', '--no-fund')
  Invoke-Npm $renderer @('run', 'generate')
  Invoke-Npm $renderer @('run', 'generate:check')
  Invoke-Npm $renderer @('run', 'typecheck')
  Invoke-Npm $renderer @('run', 'build')
  & $script:Node (Join-Path $RepositoryRoot 'tools\p01-conformance\csp-guard.mjs') --root $RepositoryRoot
  if ($LASTEXITCODE -ne 0) { throw "CSP guard failed" }
  & $script:Node (Join-Path $RepositoryRoot 'tools\p01-conformance\ascii-discipline.mjs') --root $RepositoryRoot
  if ($LASTEXITCODE -ne 0) { throw "ASCII discipline failed" }
  Invoke-Npm $renderer @('run', 'build:tests')
}

# -- 5 host build ----------------------------------------------------------------

Invoke-Stage "5 host build: product, measurement, maintenance and harness binaries" {
  Push-Location -LiteralPath $hostDirectory
  try {
    foreach ($build in @(
        @{ label = 'product'; args = @('build', '--release', '-p', 'polaris-host', '--features', 'custom-protocol'); file = 'target\release\polaris-desktop.exe' },
        @{ label = 'measurement'; args = @('build', '--release', '-p', 'polaris-host', '--features', 'custom-protocol,e2e', '--target-dir', 'target-e2e'); file = 'target-e2e\release\polaris-desktop.exe' },
        @{ label = 'maintenance'; args = @('build', '--release', '-p', 'polaris-maint'); file = 'target\release\polaris-maint.exe' },
        @{ label = 'harness'; args = @('build', '--release', '-p', 'polaris-p08-harness'); file = 'target\release\polaris-p08-native.exe' })) {
      $started = Get-Date
      & $script:Cargo @($build.args)
      if ($LASTEXITCODE -ne 0) { throw ($build.label + " build failed") }
      $runRecord.builds[$build.label] = [ordered] @{ ok = $true; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds; bytes = (Get-Item -LiteralPath (Join-Path $hostDirectory $build.file)).Length }
    }
  }
  finally { Pop-Location }
}

# -- 6 / 7 test groups -------------------------------------------------------------

# the Arabic PDF test needs a system font with Arabic glyphs; Arial ships with Windows
$arial = Join-Path $env:WINDIR 'Fonts\arial.ttf'
if (Test-Path -LiteralPath $arial) { Set-Item -Path 'Env:POLARIS_P08_PDF_FONT' -Value $arial }

Invoke-Stage "6 host groups: Phase-08 groups, host core, other crates, binding, clippy" {
  Invoke-Groups @('P08-EXECUTION', 'P08-SANDBOX', 'P08-PYTHON', 'P08-BROWSER', 'P08-ARTIFACTS', 'P08-FILES', 'P08-VOICE', 'P08-SCHEDULER', 'P08-OAUTH', 'P08-CONNECTORS', 'P08-IPC', 'P08-HOST-CORE', 'P08-HOST-OTHERS', 'P08-HOST-BINDING', 'P08-HOST-LINT')
}

Invoke-Stage "7 renderer groups: Phase-08 UX, accessibility, every renderer test, instruments, contracts" {
  Invoke-Groups @('P08-UX', 'P08-A11Y', 'P08-RENDERER-ALL', 'P08-TOOLS', 'P08-CONTRACTS')
}

# -- 8 native harness --------------------------------------------------------------

. (Join-Path $tools 'p08-native.ps1')

Invoke-Stage "8 native harness: sandbox, browser, artifacts, real model, benchmark, lifecycle, restart" -Soft {
  $exe = Join-Path $hostDirectory 'target\release\polaris-p08-native.exe'
  $sections = if ($IncludeModel) { '' } else { 'sandbox,browser,artifacts,lifecycle,restart' }
  $runRecord.harness = Invoke-P08Harness -Executable $exe -OutDirectory $harnessOut -DataDirectory (Join-Path $scratch 'harness-data') -TaskMinutes $TaskMinutes -Model $Model -Sections $sections
  Save-RunRecord
  if (@($runRecord.harness.reason_codes).Count -gt 0) { throw ("harness: " + (@($runRecord.harness.reason_codes) -join ', ')) }
}

# -- 9 UI E2E ----------------------------------------------------------------------

Invoke-Stage "9 UI E2E: the measurement build in a real window, first launch and restart" -Soft {
  $modelDoc = Join-Path $harnessOut 'model.local.json'
  $chosen = $Model
  if (-not $IncludeModel) { $chosen = '' }
  elseif ($chosen -eq '' -and (Test-Path -LiteralPath $modelDoc)) {
    $m = Get-Content -LiteralPath $modelDoc -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($null -ne $m.extra -and $null -ne $m.extra.model_id) { $chosen = [string] $m.extra.model_id }
  }
  $ui = Invoke-P08UiE2E -Executable (Join-Path $hostDirectory 'target-e2e\release\polaris-desktop.exe') -NodeCommand $script:Node -Tools $tools -RawDirectory $rawDirectory -ScratchDirectory $scratch -Model $chosen
  Write-RawJson -Path (Join-Path $rawDirectory 'ui.local.json') -Value $ui
  if (-not $ui.performed) { throw ("UI E2E not performed: " + $ui.reason) }
}

# -- 10 regression -----------------------------------------------------------------

if ($SkipRegression) {
  Write-Host "--- 10 regression SKIPPED by switch. PHASE-08 cannot be PASS from this run."
}
elseif ($null -ne $script:HardFailure) {
  Write-Host ("--- 10 regression not run after failure: " + $script:HardFailure)
}
elseif ($Regression -eq 'PriorGates') {
  Write-Host "--- 10 regression: each phase is tested separately; the Phase-07 gate is read, not re-run (P08-REG-01/02 check it)"
  [void] $script:Stages.Add([pscustomobject] @{ name = '10 regression (prior gate read, not re-run)'; exit_code = 0; duration_ms = 0 })
}
else {
  Invoke-Stage "10 Phase-07 runner (re-runs Phase-06, Phase-05, Phase-04, Phase-03, Phase-02, Phase-01 and the frozen Phase-00 gate)" -Soft {
    Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p07-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
    $runRecord.phase07_runner_exit = $LASTEXITCODE
    Set-Item -Path ("Env:" + $script:Marker) -Value '1'
  }
}
Set-Item -Path ("Env:" + $script:Marker) -Value '1'
Save-RunRecord

# -- 11 / 12 repository, evidence and the gate ----------------------------------------

Invoke-Stage "11 secret scan of every file that would be tracked" -Soft { Invoke-NodeTool 'p08-secrets.mjs' }
Invoke-Stage "11a third-party notices generated from the dependency graph of this build" -Soft { Invoke-NodeTool 'p08-notices.mjs' }
Invoke-Stage "11b repository files, notices and public documentation" -Soft { Invoke-NodeTool 'p08-repository.mjs' }
Invoke-Stage "12 Phase-08 derivation" -Soft { Invoke-NodeTool 'p08-derive.mjs' }
Invoke-Stage "12b final gate" -Soft { Invoke-NodeTool 'p08-final-gate.mjs' }

Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue

Write-Host ""
foreach ($stage in $script:Stages) { Write-Host (("exit " + $stage.exit_code).PadRight(9) + $stage.name) }
if ($null -ne $script:HardFailure) { Write-Host ("STOPPED AT: " + $script:HardFailure) }
if ($SkipRegression) { Write-Host "PHASE-08 cannot be PASS: the regression stage was skipped by switch." }
$gate = Write-Verdicts
if ($null -ne $gate -and $gate.verdict -eq 'PASS' -and $null -eq $script:HardFailure) { exit 0 }
exit 1
