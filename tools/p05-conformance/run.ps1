#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-05 - the single verification run.

.DESCRIPTION
  One command. It verifies the contracts, memory, memory trust, the browser and
  its navigation policy, computer use and its safety rules, agent and skill
  integration, evidence, cancellation, approvals and persistence; builds the
  product and measurement binaries; runs the native Windows E2E suite twice
  (first launch and restart) against a loopback TEST FIXTURE model provider, a
  loopback TEST FIXTURE web site and a harness-owned TEST FIXTURE desktop window;
  scans for secrets; re-runs the Phase-04 gate (which re-runs Phase-03, Phase-02,
  Phase-01 and the frozen Phase-00 gate); derives the canonical Phase-05
  evidence; and decides the Phase-05 final gate.

  ORDER
  -----
     1  prerequisite read       Phase-04 final gate PASS and Phase-05 ALLOWED
     2  contract generation     generate, drift check
     3  contracts verify        typecheck, build, Phase-05 suite
     4  runtime verify          package refresh, typecheck, build
     5  host units              memory, memory trust, browser, browser security
     6  host units              computer, computer security, skills, evidence
     7  host integration        the real agent path, cancellation, approval, persistence
     8  renderer                install, generate, drift check, typecheck, build, CSP guard
     9  host build              product and measurement binaries
    10  host tests              core, binding with the measurement feature, clippy
    11  renderer tests          every renderer test file, Phase-05 UI, instruments
    12  native E2E              first launch and restart, TEST FIXTURES
    13  security                static scan, evidence scan
    14  performance             derived from the native measurements
    15  Phase-00..04            the Phase-04 runner, which re-runs every gate below it
    16  evidence byte gate      every canonical Phase-05 document
    17  Phase-05 derivation     the nine canonical documents
    18  final gate              the conditions, and the Phase-06 decision

  A genuine failure in stages 2-11 stops the work: the runner still derives
  and writes the evidence, so the failure is recorded, then exits non-zero.

  DEVICE AND DESKTOP SAFETY
  -------------------------
  Heavy steps run one at a time. No model is loaded and no paid credential is
  needed. Every fixture is started and stopped by this runner. The computer-use
  scenarios touch one window only: the TEST FIXTURE window this runner opens.
  No user file, mail, browser profile, account, setting or other program is
  touched. The runner ends only processes it started, by handle, never by name.

  ENCODING
  --------
  Every executable line in this file is ASCII.

.PARAMETER RepositoryRoot
  Explicit repository root.

.PARAMETER SkipRegression
  Skip stage 15. Such a run cannot produce PHASE-05 = PASS, and says so.

.PARAMETER Regression
  PriorGates (default, owner policy 2026-09-30: each phase is tested separately): stage 15 does not
  re-run the Phase-04 runner; the regression conditions read every lower gate as its own runner
  decided it and require it canonical, PASS and opening the next phase. Rerun: the old nested re-run.

.PARAMETER SelfCheck
  Resolve the root, prove the toolchain, read the prerequisite and stop.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p05-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SkipRegression,
  [ValidateSet('PriorGates', 'Rerun')] [string] $Regression = 'PriorGates',
  [switch] $SelfCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:Marker = "POLARIS_P05_NATIVE_RUN"
$script:Stages = New-Object System.Collections.Generic.List[object]
$script:HardFailure = $null
$script:Markers = @(
  "contracts\package.json",
  "contracts\registry\phase-05-ipc.registry.json",
  "runtime\package.json",
  "desktop\host\Cargo.toml",
  "desktop\host\core\src\p05\service.rs",
  "desktop\renderer\package.json",
  "tools\p04-conformance\run.ps1",
  "tools\p05-conformance\p05-common.mjs"
)

function Resolve-P05Root {
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
  throw "BOOTSTRAP FAILED: no candidate path carries the POLARIS Phase-05 markers."
}

$RepositoryRoot = Resolve-P05Root -Explicit $RepositoryRoot
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
  os_version        = [System.Environment]::OSVersion.VersionString
  is_windows        = ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT)
  powershell        = ($PSVersionTable.PSVersion.ToString() + ' ' + $PSVersionTable.PSEdition)
  node              = (Get-VersionText $script:Node @('--version'))
  npm               = (Get-VersionText $script:Npm @('--version'))
  cargo             = (Get-VersionText $script:Cargo @('--version'))
  rustc             = (Get-VersionText 'rustc' @('--version'))
  processor_count   = [System.Environment]::ProcessorCount
}

Write-Host "runner     : polaris.p05.conformance.runner"
Write-Host "root       : $RepositoryRoot"
Write-Host ("node       : " + $environmentRecord.node + "   cargo : " + $environmentRecord.cargo)
Write-Host ("powershell : " + $environmentRecord.powershell)

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
$rawDirectory = Join-Path $evidenceDirectory 'p05-native'
if (-not (Test-Path -LiteralPath $rawDirectory)) { [void] (New-Item -ItemType Directory -Path $rawDirectory) }
$tools = Join-Path $RepositoryRoot 'tools\p05-conformance'

function Write-RawJson {
  param([string] $Path, $Value)
  $json = ($Value | ConvertTo-Json -Depth 40).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($Path, ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

# -- 1 prerequisite -----------------------------------------------------------

$phase04GatePath = Join-Path $evidenceDirectory 'phase-04-final-gate.json'
if (-not (Test-Path -LiteralPath $phase04GatePath)) { throw "PREREQUISITE MISSING: evidence\phase-04-final-gate.json" }
$phase04Before = Get-Content -LiteralPath $phase04GatePath -Raw | ConvertFrom-Json
if ($phase04Before.verdict -ne 'PASS' -or $phase04Before.phase_05_gate -ne 'ALLOWED') {
  throw ("PREREQUISITE NOT SATISFIED: PHASE-04 = " + $phase04Before.verdict + ", PHASE-05 GATE = " + $phase04Before.phase_05_gate)
}
Write-Host ("--- 1 prerequisite: PHASE-04 = PASS, PHASE-05 GATE = ALLOWED (decided " + $phase04Before.measured_at + ")")
if ($SelfCheck) {
  Write-Host "self-check complete. Nothing was measured and no evidence was written."
  exit 0
}

$runStarted = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
foreach ($name in @('phase-00-final-gate.json', 'phase-01-final-gate.json', 'phase-02-final-gate.json', 'phase-03-final-gate.json', 'phase-04-final-gate.json')) {
  $source = Join-Path $evidenceDirectory $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $rawDirectory ($name.Replace('.json', '.before.local.json'))) -Force
  }
}
# a fresh run: records from a previous run would mix two runs
foreach ($stale in @('groups.local.json', 'native.local.json', 'security-static.local.json', 'security-evidence.local.json', 'evidence-bytes.local.json')) {
  $path = Join-Path $rawDirectory $stale
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

Set-Item -Path ("Env:" + $script:Marker) -Value '1'

$runRecord = [ordered] @{
  schema_version       = '1.0.0'
  tool                 = 'polaris.p05.runner'
  run_started          = $runStarted
  environment          = $environmentRecord
  builds               = [ordered] @{}
  stages               = @()
  phase04_runner_exit  = $null
  regression_mode      = $(if ($Regression -eq 'Rerun') { 'RERUN' } else { 'PRIOR_GATES' })
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
  $arguments = @((Join-Path $tools 'p05-test-groups.mjs'), '--root', $RepositoryRoot)
  foreach ($id in $Ids) { $arguments += @('--group', $id) }
  & $script:Node @arguments
}

$contracts = Join-Path $RepositoryRoot 'contracts'
$runtime = Join-Path $RepositoryRoot 'runtime'
$renderer = Join-Path $RepositoryRoot 'desktop\renderer'
$hostDirectory = Join-Path $RepositoryRoot 'desktop\host'

# -- 2 / 3 contracts ----------------------------------------------------------

Invoke-Stage "2 contract generation and drift check" {
  Invoke-Npm $contracts @('run', 'generate')
  Invoke-Npm $contracts @('run', 'generate:check')
}

Invoke-Stage "3 contracts verify" {
  Invoke-Npm $contracts @('run', 'typecheck')
  Invoke-Npm $contracts @('run', 'build')
  Invoke-Groups @('P05-CONTRACTS')
}

# -- 4 runtime ----------------------------------------------------------------

Invoke-Stage "4 runtime verify" {
  $installed = Join-Path (Join-Path (Join-Path (Join-Path $runtime 'node_modules') '@polaris') 'contracts') ''
  $installed = $installed.TrimEnd('\')
  $expectedTail = 'runtime\node_modules\@polaris\contracts'
  if (-not $installed.EndsWith($expectedTail)) { throw ("refusing to refresh an unexpected path: " + $installed) }
  if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Recurse -Force }
  Invoke-Npm $runtime @('install', '--no-audit', '--no-fund')
  Invoke-Npm $runtime @('run', 'typecheck')
  Invoke-Npm $runtime @('run', 'build')
}

# -- 5 / 6 / 7 host units and integration -------------------------------------

Invoke-Stage "5 host units: memory, memory trust, browser, browser security" {
  Invoke-Groups @('P05-MEMORY', 'P05-MEMORY-TRUST', 'P05-BROWSER', 'P05-BROWSER-SECURITY')
}

Invoke-Stage "6 host units: computer, computer security, skills, evidence" {
  Invoke-Groups @('P05-COMPUTER', 'P05-COMPUTER-SECURITY', 'P05-SKILL-INTEGRATION', 'P05-EVIDENCE')
}

Invoke-Stage "7 host integration: the real agent path, cancellation, approval, persistence" {
  Invoke-Groups @('P05-AGENT-INTEGRATION', 'P05-CANCELLATION', 'P05-APPROVAL', 'P05-PERSISTENCE')
}

# -- 8 renderer ---------------------------------------------------------------

Invoke-Stage "8 renderer typecheck and build" {
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

# -- 9 host build -------------------------------------------------------------

$productExe = Join-Path $hostDirectory 'target\release\polaris-desktop.exe'
$e2eExe = Join-Path $hostDirectory 'target-e2e\release\polaris-desktop.exe'

Invoke-Stage "9 host build (product and measurement binaries)" {
  Push-Location -LiteralPath $hostDirectory
  try {
    $started = Get-Date
    & $script:Cargo 'build' '--release' '-p' 'polaris-host' '--features' 'custom-protocol'
    if ($LASTEXITCODE -ne 0) { throw "product build failed" }
    $runRecord.builds.product = [ordered] @{ ok = $true; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds; bytes = (Get-Item -LiteralPath $productExe).Length }
    $started = Get-Date
    & $script:Cargo 'build' '--release' '-p' 'polaris-host' '--features' 'custom-protocol,e2e' '--target-dir' 'target-e2e'
    if ($LASTEXITCODE -ne 0) { throw "measurement build failed" }
    $runRecord.builds.measurement = [ordered] @{ ok = $true; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds; bytes = (Get-Item -LiteralPath $e2eExe).Length }
  }
  finally { Pop-Location }
}

# -- 10 / 11 tests ------------------------------------------------------------

Invoke-Stage "10 host tests" { Invoke-Groups @('P05-HOST-CORE', 'P05-HOST-BINDING', 'P05-HOST-LINT') }
Invoke-Stage "11 renderer tests and instruments" { Invoke-Groups @('P05-RENDERER', 'P05-RENDERER-UI', 'P05-TOOLS') }

# -- 12 native E2E ------------------------------------------------------------

. (Join-Path $tools 'p05-native.ps1')

$native = [ordered] @{
  performed      = $false
  reason         = ''
  run_started    = $runStarted
  data_directory = $null
  fixture_state  = $null
  fixture_log    = $null
  fixture_exited = $false
  desktop_pid    = $null
  desktop        = $null
  first          = $null
  restart        = $null
}

Invoke-Stage "12 native E2E (TEST FIXTURE model, web site and desktop window)" -Soft {
  if ($null -ne $script:HardFailure) { $native.reason = ('STOPPED_AFTER_FAILURE: ' + $script:HardFailure); return }
  if (-not $environmentRecord.is_windows) { $native.reason = 'NOT_WINDOWS'; return }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
  $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('polaris-p05-e2e-' + $stamp)
  $dataDir = Join-Path $scratch 'data'
  [void] (New-Item -ItemType Directory -Path $dataDir -Force)
  $native.data_directory = $dataDir

  $statePath = Join-Path $rawDirectory 'fixture-state.local.json'
  $logPath = Join-Path $rawDirectory 'fixture-log.local.json'
  $desktopStatePath = Join-Path $scratch 'desktop-fixture-state.json'
  $fixture = Start-P05Fixture -NodeCommand $script:Node -Script (Join-Path $tools 'p05-fixture-server.mjs') -StatePath $statePath -LogPath $logPath
  if ($null -eq $fixture.state) { $native.reason = 'FIXTURE_DID_NOT_START'; return }
  $native.fixture_state = $fixture.state
  $desktop = Start-P05DesktopFixture -Script (Join-Path $tools 'p05-desktop-fixture.ps1') -StatePath $desktopStatePath
  try {
    if ($null -eq $desktop.state) { $native.reason = 'DESKTOP_FIXTURE_DID_NOT_START'; return }
    $native.desktop_pid = [int] $desktop.state.pid
    $marker = 'm' + $stamp
    $common = @{
      'POLARIS_DATA_DIR'          = $dataDir
      'POLARIS_E2E_FIXTURE_PORT'  = [string] $fixture.state.port
      'POLARIS_E2E_WEB_PORT'      = [string] $fixture.state.web_port
      'POLARIS_E2E_DESKTOP_PID'   = [string] $desktop.state.pid
      'POLARIS_E2E_MARKER'        = $marker
      'POLARIS_LOCALE'            = 'en'
    }
    $first = $common.Clone()
    $first['POLARIS_E2E_SUITE'] = 'p05-first'
    $first['POLARIS_STARTUP_REPORT'] = (Join-Path $rawDirectory 'first-startup.local.json')
    $native.first = Invoke-P04Launch -ExecutablePath $e2eExe -ReportPath $first['POLARIS_STARTUP_REPORT'] -Environment $first -SuiteTimeoutSeconds 1500
    $restart = $common.Clone()
    $restart['POLARIS_E2E_SUITE'] = 'p05-restart'
    $restart['POLARIS_STARTUP_REPORT'] = (Join-Path $rawDirectory 'restart-startup.local.json')
    $native.restart = Invoke-P04Launch -ExecutablePath $e2eExe -ReportPath $restart['POLARIS_STARTUP_REPORT'] -Environment $restart
    $native.performed = $true
  }
  finally {
    $native.fixture_log = Stop-P05Fixture -Fixture $fixture -LogPath $logPath
    $fixture.process.Refresh()
    $native.fixture_exited = $fixture.process.HasExited
    $native.desktop = Stop-P05DesktopFixture -Fixture $desktop -StatePath $desktopStatePath
    Write-RawJson -Path (Join-Path $rawDirectory 'native.local.json') -Value $native
  }
  foreach ($launch in @($native.first, $native.restart)) {
    if ($null -eq $launch) { continue }
    $report = $launch.e2e_report
    if ($null -eq $report) { Write-Host ("  no E2E report: " + ($launch.reason_codes -join ',')); continue }
    $inner = if ($null -ne $report.PSObject.Properties['renderer'] -and $null -ne $report.renderer) { $report.renderer } else { $report }
    foreach ($scenario in @($inner.scenarios)) {
      Write-Host ("  " + $scenario.status.PadRight(11) + $scenario.id.PadRight(14) + $scenario.detail)
    }
  }
  if ($null -ne $native.desktop -and $null -ne $native.desktop.state) {
    Write-Host ("  desktop fixture: counter " + $native.desktop.state.counter + ", delete presses " + $native.desktop.state.delete_count + ", password length " + $native.desktop.state.password_len)
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $rawDirectory 'native.local.json'))) {
  Write-RawJson -Path (Join-Path $rawDirectory 'native.local.json') -Value $native
}

# -- 13 security --------------------------------------------------------------

Invoke-Stage "13 security (static scan)" -Soft {
  & $script:Node (Join-Path $tools 'p05-security.mjs') --root $RepositoryRoot
}

# -- 14 performance is derived in stage 17 ------------------------------------

[void] $script:Stages.Add([pscustomobject] @{ name = '14 performance (derived from stage 12)'; exit_code = 0; duration_ms = 0 })

# -- 15 regression ------------------------------------------------------------

if ($SkipRegression) {
  Write-Host "--- 15 regression SKIPPED by switch. PHASE-05 cannot be PASS from this run."
}
elseif ($null -ne $script:HardFailure) {
  Write-Host ("--- 15 regression not run after failure: " + $script:HardFailure)
}
elseif ($Regression -eq 'PriorGates') {
  Write-Host "--- 15 regression: each phase is tested separately; the lower gates are read, not re-run (derivation checks each)"
  [void] $script:Stages.Add([pscustomobject] @{ name = '15 regression (prior gates read, not re-run)'; exit_code = 0; duration_ms = 0 })
}
else {
  Invoke-Stage "15 Phase-04 runner (re-runs Phase-03, Phase-02, Phase-01 and the frozen Phase-00 gate)" -Soft {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p04-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
    $runRecord.phase04_runner_exit = $LASTEXITCODE
  }
}
Set-Item -Path ("Env:" + $script:Marker) -Value '1'
Save-RunRecord

# -- 16 / 17 / 18 evidence ----------------------------------------------------

Invoke-Stage "17 Phase-05 derivation" -Soft { & $script:Node (Join-Path $tools 'p05-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "16 evidence byte gate" -Soft { & $script:Node (Join-Path $tools 'p05-evidence-bytes.mjs') --root $RepositoryRoot }
Invoke-Stage "17b Phase-05 derivation with the byte gate" -Soft { & $script:Node (Join-Path $tools 'p05-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "16b evidence byte gate, second pass" -Soft { & $script:Node (Join-Path $tools 'p05-evidence-bytes.mjs') --root $RepositoryRoot }
Invoke-Stage "13b evidence secret scan after derivation" -Soft { & $script:Node (Join-Path $tools 'p05-security.mjs') --root $RepositoryRoot --scan-evidence }
Invoke-Stage "17c Phase-05 derivation with the evidence scan" -Soft { & $script:Node (Join-Path $tools 'p05-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "18 final gate" -Soft { & $script:Node (Join-Path $tools 'p05-final-gate.mjs') --root $RepositoryRoot }
Invoke-Stage "18b byte gate including the final gate" -Soft { & $script:Node (Join-Path $tools 'p05-evidence-bytes.mjs') --root $RepositoryRoot --include-final-gate }

Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue

$gatePath = Join-Path $evidenceDirectory 'phase-05-final-gate.json'
$verdict = 'INCONCLUSIVE'
$phase06 = 'NOT_ALLOWED'
if (Test-Path -LiteralPath $gatePath) {
  $gate = Get-Content -LiteralPath $gatePath -Raw | ConvertFrom-Json
  $verdict = [string] $gate.verdict
  $phase06 = [string] $gate.phase_06_gate
}

Write-Host ""
foreach ($stage in $script:Stages) { Write-Host (("exit " + $stage.exit_code).PadRight(9) + $stage.name) }
Write-Host ""
if ($null -ne $script:HardFailure) { Write-Host ("STOPPED AT: " + $script:HardFailure) }
if ($SkipRegression) { Write-Host "PHASE-05 cannot be PASS: the regression stage was skipped by switch." }
Write-Host ("PHASE-05 = " + $verdict)
Write-Host ("PHASE-06 GATE = " + $phase06)
if ($verdict -eq 'PASS' -and $phase06 -eq 'ALLOWED' -and $null -eq $script:HardFailure) { exit 0 }
exit 1
