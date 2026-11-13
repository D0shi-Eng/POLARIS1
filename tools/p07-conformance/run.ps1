#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-07 - the single verification run (final hardening and release candidate).

.DESCRIPTION
  One command. It verifies the contracts and the renderer, builds the product,
  the measurement binary and the maintenance tool, runs every Phase-07 group
  (recovery, backup and restore, migrations, retention, the update verifier,
  managed policy, red team, the maintenance executable) and the full host and
  renderer suites, builds the Windows installer twice (an older-version fixture
  for the upgrade test and the release candidate), records the signing status
  Windows reports, inventories dependencies, licences, the network surface and
  the platform sites, reads the PE hardening flags of the shipped binaries, runs
  the native release E2E (install, launch, upgrade a real v1 store, recover a
  damaged store, restore, verify a signed update, check a policy, uninstall) in
  owned paths, re-runs the Phase-06 gate (which re-runs Phase-05 down to the
  frozen Phase-00 gate), writes the release artifacts, derives the canonical
  Phase-07 evidence and decides the final gate.

  ORDER
  -----
     1  prerequisite            Phase-06 final gate PASS and Phase-07 ALLOWED
     2  contracts               generate, drift check, typecheck, build
     3  runtime                 package refresh, typecheck, build
     4  renderer                install, generate, drift check, typecheck, build, CSP guard, ASCII, test build
     5  host build              product, measurement and maintenance binaries
     6  host groups             Phase-07 groups, host core, providers, binding, clippy
     7  renderer groups         accessibility, every renderer test, instruments, contracts
     8  packaging               NSIS installers (upgrade fixture and release), signing status
     9  hardening               inventory, licences, network surface, PE flags, webview, source
    10  release E2E             the installed product on Windows, owned paths only
    11  regression              the Phase-06 runner (re-runs Phase-05 .. the frozen Phase-00 gate)
    12  release artifacts       checksums, update manifest (unsigned), SBOM, signing status
    13  derivation              the eleven canonical documents, byte gate, secret scan
    14  final gate              the conditions and the separate release verdicts

  A genuine failure in stages 2-8 stops the work that depends on it: the runner
  still derives and writes the evidence, so the failure is recorded, then exits
  non-zero.

  DEVICE SAFETY
  -------------
  Heavy steps run one at a time. The installer test installs to an owned folder
  under %LOCALAPPDATA%\POLARIS-P07-TEST and uses an owned data folder; an existing
  POLARIS installation of the user blocks that stage instead of being replaced.
  Nothing is published, uploaded or signed with an invented certificate. Every
  process started here is ended by handle, never by name.

  ENCODING
  --------
  Every executable line in this file is ASCII.

.PARAMETER RepositoryRoot
  Explicit repository root.

.PARAMETER Regression
  PriorGates (default, owner policy 2026-09-30: each phase is tested separately): stage 11 does not
  re-run the Phase-06 runner; the regression conditions read every lower gate as its own runner
  decided it and require it canonical and PASS. Rerun: the Phase-06 runner is re-run inside this run
  and every lower gate must be re-decided after this run started.

.PARAMETER SkipRegression
  Skip stage 11. Such a run cannot produce PHASE-07 = PASS, and says so.

.PARAMETER SelfCheck
  Resolve the root, prove the toolchain, read the prerequisite and stop.

.PARAMETER DeriveOnly
  Re-run stages 12-14 (release artifacts, derivation, byte gate, secret scan,
  final gate) over the raw records of the LAST full run, without measuring
  anything again. Used only after an instrument defect is fixed; the run record
  keeps its original stages and gains a 'rederivations' entry that says so.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p07-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SkipRegression,
  [ValidateSet('PriorGates', 'Rerun')] [string] $Regression = 'PriorGates',
  [switch] $SelfCheck,
  [switch] $DeriveOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:Marker = "POLARIS_P07_NATIVE_RUN"
$script:Stages = New-Object System.Collections.Generic.List[object]
$script:HardFailure = $null
$script:Markers = @(
  "contracts\package.json",
  "runtime\package.json",
  "desktop\host\Cargo.toml",
  "desktop\host\core\src\p07\mod.rs",
  "desktop\host\maint\Cargo.toml",
  "desktop\host\app\tauri.release.conf.json",
  "desktop\renderer\package.json",
  "tools\p06-conformance\run.ps1",
  "tools\p07-conformance\p07-common.mjs"
)

function Resolve-P07Root {
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
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
      throw ("BOOTSTRAP FAILED: RepositoryRoot " + $candidate + " is missing: " + ($missing -join ', '))
    }
  }
  throw "BOOTSTRAP FAILED: no candidate path carries the POLARIS Phase-07 markers."
}

$RepositoryRoot = Resolve-P07Root -Explicit $RepositoryRoot
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
  npm             = (Get-VersionText $script:Npm @('--version'))
  cargo           = (Get-VersionText $script:Cargo @('--version'))
  rustc           = (Get-VersionText 'rustc' @('--version'))
  processor_count = [System.Environment]::ProcessorCount
}

Write-Host "runner     : polaris.p07.conformance.runner"
Write-Host "root       : $RepositoryRoot"
Write-Host ("node       : " + $environmentRecord.node + "   cargo : " + $environmentRecord.cargo)
Write-Host ("powershell : " + $environmentRecord.powershell)

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
$rawDirectory = Join-Path $evidenceDirectory 'p07-native'
if (-not (Test-Path -LiteralPath $rawDirectory)) { [void] (New-Item -ItemType Directory -Path $rawDirectory -Force) }
$releaseDirectory = Join-Path $RepositoryRoot 'release\rc'
$tools = Join-Path $RepositoryRoot 'tools\p07-conformance'

function Write-RawJson {
  param([string] $Path, $Value)
  $json = ($Value | ConvertTo-Json -Depth 40).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($Path, ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

# -- 1 prerequisite -----------------------------------------------------------

$phase06GatePath = Join-Path $evidenceDirectory 'phase-06-final-gate.json'
if (-not (Test-Path -LiteralPath $phase06GatePath)) { throw "PREREQUISITE MISSING: evidence\phase-06-final-gate.json" }
$phase06Before = Get-Content -LiteralPath $phase06GatePath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($phase06Before.verdict -ne 'PASS' -or $phase06Before.phase_07_gate -ne 'ALLOWED') {
  throw ("PREREQUISITE NOT SATISFIED: PHASE-06 = " + $phase06Before.verdict + ", PHASE-07 GATE = " + $phase06Before.phase_07_gate)
}
Write-Host ("--- 1 prerequisite: PHASE-06 = PASS, PHASE-07 GATE = ALLOWED (decided " + $phase06Before.measured_at + ")")
if ($SelfCheck) {
  Write-Host "self-check complete. Nothing was measured and no evidence was written."
  exit 0
}

if ($DeriveOnly) {
  $runPath = Join-Path $rawDirectory 'run.local.json'
  if (-not (Test-Path -LiteralPath $runPath)) { throw "DERIVE-ONLY: there is no run record to derive from" }
  $existing = Get-Content -LiteralPath $runPath -Raw -Encoding UTF8 | ConvertFrom-Json
  Set-Item -Path ("Env:" + $script:Marker) -Value '1'
  $codes = [ordered] @{}
  foreach ($step in @(
      @('p07-release.mjs'), @('p07-derive.mjs'), @('p07-evidence-bytes.mjs'), @('p07-security.mjs'), @('p07-derive.mjs'),
      @('p07-evidence-bytes.mjs'), @('p07-final-gate.mjs'), @('p07-evidence-bytes.mjs', '--include-final-gate'), @('p07-security.mjs', '--include-final-gate'))) {
    $extra = @()
    if ($step.Count -gt 1) { $extra = @($step[1..($step.Count - 1)]) }
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $script:Node (Join-Path $tools $step[0]) '--root' $RepositoryRoot @extra 2>&1 | ForEach-Object { Write-Host $_ }
    $ErrorActionPreference = $previous
    $codes[($step -join ' ')] = $LASTEXITCODE
  }
  Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue
  $entry = [ordered] @{ at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'); reason = 'instrument defect fixed; stages 12-14 re-run over the raw records of this run, nothing re-measured'; exit_codes = $codes }
  $list = @()
  if ($null -ne $existing.PSObject.Properties['rederivations']) { $list = @($existing.rederivations) }
  $list += $entry
  $existing | Add-Member -NotePropertyName 'rederivations' -NotePropertyValue $list -Force
  Write-RawJson -Path $runPath -Value $existing
  $gate = Get-Content -LiteralPath (Join-Path $evidenceDirectory 'phase-07-final-gate.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  Write-Host ("PHASE-07       = " + $gate.verdict)
  Write-Host ("WINDOWS_RC     = " + $gate.release_verdicts.windows_rc)
  Write-Host ("SIGNING        = " + $gate.release_verdicts.signing)
  Write-Host ("MACOS          = " + $gate.release_verdicts.macos)
  Write-Host ("PUBLIC_RELEASE = " + $gate.release_verdicts.public_release)
  if ($gate.verdict -eq 'PASS') { exit 0 }
  exit 1
}

$runStarted = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
# a fresh run: records from a previous run would mix two runs
foreach ($stale in @('groups.local.json', 'inventory.local.json', 'hardening.local.json', 'packaging.local.json', 'signing.local.json', 'release-e2e.local.json', 'release.local.json', 'security.local.json', 'evidence-bytes.local.json', 'evidence-bytes-final.local.json')) {
  $path = Join-Path $rawDirectory $stale
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

Set-Item -Path ("Env:" + $script:Marker) -Value '1'

$runRecord = [ordered] @{
  schema_version      = '1.0.0'
  tool                = 'polaris.p07.runner'
  run_started         = $runStarted
  environment         = $environmentRecord
  builds              = [ordered] @{}
  stages              = @()
  phase06_runner_exit = $null
  skip_regression     = [bool] $SkipRegression
  regression_mode     = $(if ($Regression -eq 'Rerun') { 'RERUN' } else { 'PRIOR_GATES' })
}

function Save-RunRecord {
  $runRecord.stages = @($script:Stages.ToArray())
  Write-RawJson -Path (Join-Path $rawDirectory 'run.local.json') -Value $runRecord
}

function Invoke-Stage {
  param([string] $Name, [scriptblock] $Body, [switch] $Soft)
  if ($null -ne $script:HardFailure -and -not $Soft) {
    [void] $script:Stages.Add([pscustomobject] @{ name = $Name; exit_code = -1; duration_ms = 0; skipped_after = $script:HardFailure })
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
  [void] $script:Stages.Add([pscustomobject] @{ name = $Name; exit_code = $code; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds })
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
  $arguments = @((Join-Path $tools 'p07-test-groups.mjs'), '--root', $RepositoryRoot)
  foreach ($id in $Ids) { $arguments += @('--group', $id) }
  & $script:Node @arguments
}

function Invoke-NodeTool {
  param([string] $Script, [string[]] $Arguments = @())
  & $script:Node (Join-Path $tools $Script) '--root' $RepositoryRoot @Arguments
}

$contracts = Join-Path $RepositoryRoot 'contracts'
$runtime = Join-Path $RepositoryRoot 'runtime'
$renderer = Join-Path $RepositoryRoot 'desktop\renderer'
$hostDirectory = Join-Path $RepositoryRoot 'desktop\host'

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

Invoke-Stage "5 host build: product, measurement and maintenance binaries" {
  Push-Location -LiteralPath $hostDirectory
  try {
    foreach ($build in @(
        @{ label = 'product'; args = @('build', '--release', '-p', 'polaris-host', '--features', 'custom-protocol'); file = 'target\release\polaris-desktop.exe' },
        @{ label = 'measurement'; args = @('build', '--release', '-p', 'polaris-host', '--features', 'custom-protocol,e2e', '--target-dir', 'target-e2e'); file = 'target-e2e\release\polaris-desktop.exe' },
        @{ label = 'maintenance'; args = @('build', '--release', '-p', 'polaris-maint'); file = 'target\release\polaris-maint.exe' })) {
      $started = Get-Date
      & $script:Cargo @($build.args)
      if ($LASTEXITCODE -ne 0) { throw ($build.label + " build failed") }
      $runRecord.builds[$build.label] = [ordered] @{ ok = $true; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds; bytes = (Get-Item -LiteralPath (Join-Path $hostDirectory $build.file)).Length }
    }
  }
  finally { Pop-Location }
}

# -- 6 / 7 test groups -------------------------------------------------------------

Invoke-Stage "6 host groups: Phase-07 groups, host core, providers, binding, clippy" {
  Invoke-Groups @('P07-RECOVERY', 'P07-BACKUP', 'P07-MIGRATION', 'P07-RETENTION', 'P07-UPDATER', 'P07-ENTERPRISE', 'P07-REDTEAM', 'P07-MAINTENANCE', 'P07-HOST-CORE', 'P07-HOST-PROVIDERS', 'P07-HOST-BINDING', 'P07-HOST-LINT')
}

Invoke-Stage "7 renderer groups: accessibility, every renderer test, instruments, contracts" {
  Invoke-Groups @('P07-A11Y', 'P07-RENDERER-ALL', 'P07-TOOLS', 'P07-CONTRACTS')
}

# -- 8 packaging -------------------------------------------------------------------

. (Join-Path $tools 'p07-package.ps1')
. (Join-Path $tools 'p07-sign.ps1')
$script:Packaging = $null

Invoke-Stage "8 packaging: NSIS installers (upgrade fixture, release) and signing status" {
  $script:Packaging = Invoke-P07Packaging -RepositoryRoot $RepositoryRoot -NodeCommand $script:Node -CargoCommand $script:Cargo -RawDirectory $rawDirectory -ReleaseDirectory $releaseDirectory
  Write-RawJson -Path (Join-Path $rawDirectory 'packaging.local.json') -Value $script:Packaging
  foreach ($build in $script:Packaging.builds) { Write-Host ("  " + $build.label.PadRight(16) + $build.file + "  " + $build.bytes + " bytes") }
  $signed = @($script:Packaging.release_installer, (Join-Path $hostDirectory 'target\release\polaris-desktop.exe'), (Join-Path $hostDirectory 'target\release\polaris-maint.exe'))
  $signing = Invoke-P07Signing -Files $signed
  Write-RawJson -Path (Join-Path $rawDirectory 'signing.local.json') -Value $signing
  Write-Host ("  signing: " + $signing.status)
}

# -- 9 hardening (after packaging: the bundler rebuilt the shipped binaries) --------

Invoke-Stage "9 hardening: inventory, licences, network surface, PE flags, webview, source" -Soft {
  Invoke-NodeTool 'p07-inventory.mjs'
  Invoke-NodeTool 'p07-hardening.mjs'
}

# -- 10 release E2E ----------------------------------------------------------------

. (Join-Path $tools 'p07-native.ps1')

Invoke-Stage "10 release E2E: install, launch, upgrade, recover, restore, update check, policy check, uninstall" -Soft {
  if ($null -eq $script:Packaging) { throw "no installers were built" }
  $e2e = Invoke-P07ReleaseE2E -RepositoryRoot $RepositoryRoot -NodeCommand $script:Node -FixtureInstaller $script:Packaging.fixture_installer -ReleaseInstaller $script:Packaging.release_installer -RawDirectory $rawDirectory
  Write-RawJson -Path (Join-Path $rawDirectory 'release-e2e.local.json') -Value $e2e
  foreach ($launch in $e2e.launches) {
    Write-Host ("  launch " + $launch.stage.PadRight(26) + " window " + $launch.window_appeared + ", bootstrap " + $launch.bootstrap_reached + ", exit " + $launch.exit_code + ", survivors " + $launch.surviving_processes)
  }
  foreach ($name in $e2e.steps.Keys) { Write-Host ("  step " + $name.PadRight(16) + " " + (($e2e.steps[$name] | ConvertTo-Json -Compress -Depth 5))) }
  if (@($e2e.reason_codes).Count -gt 0) { Write-Host ("  reason codes: " + (@($e2e.reason_codes) -join ', ')); throw "release E2E recorded reason codes" }
}

# -- 11 regression -----------------------------------------------------------------

if ($SkipRegression) {
  Write-Host "--- 11 regression SKIPPED by switch. PHASE-07 cannot be PASS from this run."
}
elseif ($null -ne $script:HardFailure) {
  Write-Host ("--- 11 regression not run after failure: " + $script:HardFailure)
}
elseif ($Regression -eq 'PriorGates') {
  Write-Host "--- 11 regression: each phase is tested separately; the lower gates are read, not re-run (derivation checks each)"
  [void] $script:Stages.Add([pscustomobject] @{ name = '11 regression (prior gates read, not re-run)'; exit_code = 0; duration_ms = 0 })
}
else {
  Invoke-Stage "11 Phase-06 runner (re-runs Phase-05, Phase-04, Phase-03, Phase-02, Phase-01 and the frozen Phase-00 gate)" -Soft {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p06-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
    $runRecord.phase06_runner_exit = $LASTEXITCODE
  }
}
Set-Item -Path ("Env:" + $script:Marker) -Value '1'
Save-RunRecord

# -- 12 / 13 / 14 release artifacts, evidence and the gate --------------------------

Invoke-Stage "12 release artifacts: checksums, unsigned update manifest, SBOM, signing status" -Soft { Invoke-NodeTool 'p07-release.mjs' }
Invoke-Stage "13 Phase-07 derivation" -Soft { Invoke-NodeTool 'p07-derive.mjs' }
Invoke-Stage "13b evidence byte gate" -Soft { Invoke-NodeTool 'p07-evidence-bytes.mjs' }
Invoke-Stage "13c evidence and release secret scan" -Soft { Invoke-NodeTool 'p07-security.mjs' }
Invoke-Stage "13d Phase-07 derivation with the scan" -Soft { Invoke-NodeTool 'p07-derive.mjs' }
Invoke-Stage "13e evidence byte gate after the last derivation" -Soft { Invoke-NodeTool 'p07-evidence-bytes.mjs' }
Invoke-Stage "14 final gate" -Soft { Invoke-NodeTool 'p07-final-gate.mjs' }
Invoke-Stage "14b byte gate including the final gate" -Soft { Invoke-NodeTool 'p07-evidence-bytes.mjs' @('--include-final-gate') }
Invoke-Stage "14c secret scan including the final gate" -Soft { Invoke-NodeTool 'p07-security.mjs' @('--include-final-gate') }

Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue

$gatePath = Join-Path $evidenceDirectory 'phase-07-final-gate.json'
$verdicts = $null
if (Test-Path -LiteralPath $gatePath) { $verdicts = Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json }

Write-Host ""
foreach ($stage in $script:Stages) { Write-Host (("exit " + $stage.exit_code).PadRight(9) + $stage.name) }
Write-Host ""
if ($null -ne $script:HardFailure) { Write-Host ("STOPPED AT: " + $script:HardFailure) }
if ($SkipRegression) { Write-Host "PHASE-07 cannot be PASS: the regression stage was skipped by switch." }
if ($null -eq $verdicts) {
  Write-Host "PHASE-07 = INCONCLUSIVE (no final gate was written)"
  exit 1
}
Write-Host ("PHASE-07       = " + $verdicts.verdict)
Write-Host ("WINDOWS_RC     = " + $verdicts.release_verdicts.windows_rc)
Write-Host ("SIGNING        = " + $verdicts.release_verdicts.signing)
Write-Host ("MACOS          = " + $verdicts.release_verdicts.macos)
Write-Host ("PUBLIC_RELEASE = " + $verdicts.release_verdicts.public_release)
if ($verdicts.verdict -eq 'PASS' -and $null -eq $script:HardFailure) { exit 0 }
exit 1
