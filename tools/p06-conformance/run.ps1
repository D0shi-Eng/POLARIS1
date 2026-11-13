#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-06 - the single verification run.

.DESCRIPTION
  One command. It verifies the contracts, the connector framework, connector
  security and authentication, the connector gateway, cost and usage, budgets,
  observability and health, the settings control plane and effective config,
  privacy, agent integration and persistence; builds the product and measurement
  binaries; runs the native Windows E2E suite twice (first launch and restart)
  against a loopback TEST FIXTURE model provider and a loopback TEST FIXTURE REST
  connector; scans for secrets, including a per-run credential canary; re-runs
  the Phase-05 gate (which re-runs Phase-04, Phase-03, Phase-02, Phase-01 and the
  frozen Phase-00 gate); derives the canonical Phase-06 evidence; and decides
  the Phase-06 final gate.

  ORDER
  -----
     1  prerequisite read       Phase-05 final gate PASS and Phase-06 ALLOWED
     2  contract generation     generate, drift check
     3  contracts verify        typecheck, build, Phase-06 suite
     4  runtime verify          package refresh, typecheck, build
     5  host units              connectors, connector security, auth, gateway
     6  host units              cost, budgets, observability, health
     7  host units              settings, effective config, privacy
     8  host integration        the real agent path, persistence, security
     9  renderer                install, generate, drift check, typecheck, build, CSP guard
    10  host build              product and measurement binaries
    11  host tests              core, binding with the measurement feature, clippy
    12  renderer tests          Phase-06 UI, every renderer test file, instruments
    13  native E2E              first launch and restart, TEST FIXTURES, canary scan
    14  security                static scan
    15  performance             derived from the native measurements
    16  Phase-00..05            the Phase-05 runner, which re-runs every gate below it
    17  evidence byte gate      every canonical Phase-06 document
    18  Phase-06 derivation     the nine canonical documents
    19  final gate              the conditions, and the Phase-07 decision

  A genuine failure in stages 2-12 stops the work: the runner still derives
  and writes the evidence, so the failure is recorded, then exits non-zero.

  DEVICE SAFETY
  -------------
  Heavy steps run one at a time. No model is loaded and no paid credential is
  needed: the connector credential is a random canary made for this run, known
  only to this runner, the TEST FIXTURE connector and the product process. It is
  never written to a log or an evidence file; its SHA-256 is. Every fixture is
  started and stopped by this runner. The runner ends only processes it started,
  by handle, never by name.

  ENCODING
  --------
  Every executable line in this file is ASCII.

.PARAMETER RepositoryRoot
  Explicit repository root.

.PARAMETER SkipRegression
  Skip stage 16. Such a run cannot produce PHASE-06 = PASS, and says so.

.PARAMETER Regression
  PriorGates (default, owner policy 2026-09-30: each phase is tested separately): stage 16 does not
  re-run the Phase-05 runner; the regression conditions read every lower gate as its own runner
  decided it and require it canonical, PASS and opening the next phase. Rerun: the Phase-05 runner
  is re-run inside this run and every lower gate must be re-decided after this run started.

.PARAMETER SelfCheck
  Resolve the root, prove the toolchain, read the prerequisite and stop.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p06-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
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
$script:Marker = "POLARIS_P06_NATIVE_RUN"
$script:Stages = New-Object System.Collections.Generic.List[object]
$script:HardFailure = $null
$script:Markers = @(
  "contracts\package.json",
  "contracts\registry\phase-06-ipc.registry.json",
  "runtime\package.json",
  "desktop\host\Cargo.toml",
  "desktop\host\core\src\p06\service.rs",
  "desktop\renderer\package.json",
  "tools\p05-conformance\run.ps1",
  "tools\p06-conformance\p06-common.mjs"
)

function Resolve-P06Root {
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
  throw "BOOTSTRAP FAILED: no candidate path carries the POLARIS Phase-06 markers."
}

$RepositoryRoot = Resolve-P06Root -Explicit $RepositoryRoot
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

Write-Host "runner     : polaris.p06.conformance.runner"
Write-Host "root       : $RepositoryRoot"
Write-Host ("node       : " + $environmentRecord.node + "   cargo : " + $environmentRecord.cargo)
Write-Host ("powershell : " + $environmentRecord.powershell)

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
$rawDirectory = Join-Path $evidenceDirectory 'p06-native'
if (-not (Test-Path -LiteralPath $rawDirectory)) { [void] (New-Item -ItemType Directory -Path $rawDirectory) }
$tools = Join-Path $RepositoryRoot 'tools\p06-conformance'

function Write-RawJson {
  param([string] $Path, $Value)
  $json = ($Value | ConvertTo-Json -Depth 40).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($Path, ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

# -- 1 prerequisite -----------------------------------------------------------

$phase05GatePath = Join-Path $evidenceDirectory 'phase-05-final-gate.json'
if (-not (Test-Path -LiteralPath $phase05GatePath)) { throw "PREREQUISITE MISSING: evidence\phase-05-final-gate.json" }
$phase05Before = Get-Content -LiteralPath $phase05GatePath -Raw | ConvertFrom-Json
if ($phase05Before.verdict -ne 'PASS' -or $phase05Before.phase_06_gate -ne 'ALLOWED') {
  throw ("PREREQUISITE NOT SATISFIED: PHASE-05 = " + $phase05Before.verdict + ", PHASE-06 GATE = " + $phase05Before.phase_06_gate)
}
Write-Host ("--- 1 prerequisite: PHASE-05 = PASS, PHASE-06 GATE = ALLOWED (decided " + $phase05Before.measured_at + ")")
if ($SelfCheck) {
  Write-Host "self-check complete. Nothing was measured and no evidence was written."
  exit 0
}

$runStarted = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
foreach ($name in @('phase-00-final-gate.json', 'phase-01-final-gate.json', 'phase-02-final-gate.json', 'phase-03-final-gate.json', 'phase-04-final-gate.json', 'phase-05-final-gate.json')) {
  $source = Join-Path $evidenceDirectory $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $rawDirectory ($name.Replace('.json', '.before.local.json'))) -Force
  }
}
# a fresh run: records from a previous run would mix two runs
foreach ($stale in @('groups.local.json', 'native.local.json', 'security-static.local.json', 'security-evidence.local.json', 'evidence-bytes.local.json', 'fixture-state.local.json', 'fixture-log.local.json', 'first-startup.local.json', 'first-startup.local-e2e.json', 'restart-startup.local.json', 'restart-startup.local-e2e.json')) {
  $path = Join-Path $rawDirectory $stale
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}

Set-Item -Path ("Env:" + $script:Marker) -Value '1'

$runRecord = [ordered] @{
  schema_version       = '1.0.0'
  tool                 = 'polaris.p06.runner'
  run_started          = $runStarted
  environment          = $environmentRecord
  builds               = [ordered] @{}
  stages               = @()
  phase05_runner_exit  = $null
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
  $arguments = @((Join-Path $tools 'p06-test-groups.mjs'), '--root', $RepositoryRoot)
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
  Invoke-Groups @('P06-CONTRACTS')
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

# -- 5 / 6 / 7 / 8 host units and integration ---------------------------------

Invoke-Stage "5 host units: connectors, connector security, auth, gateway" {
  Invoke-Groups @('P06-CONNECTORS', 'P06-CONNECTOR-SECURITY', 'P06-CONNECTOR-AUTH', 'P06-CONNECTOR-GATEWAY')
}

Invoke-Stage "6 host units: cost, budgets, observability, health" {
  Invoke-Groups @('P06-COST', 'P06-BUDGETS', 'P06-OBSERVABILITY', 'P06-HEALTH')
}

Invoke-Stage "7 host units: settings, effective config, privacy" {
  Invoke-Groups @('P06-SETTINGS', 'P06-EFFECTIVE-CONFIG', 'P06-PRIVACY')
}

Invoke-Stage "8 host integration: the real agent path, persistence, security" {
  Invoke-Groups @('P06-AGENT-INTEGRATION', 'P06-PERSISTENCE', 'P06-SECURITY')
}

# -- 9 renderer ---------------------------------------------------------------

Invoke-Stage "9 renderer typecheck and build" {
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

# -- 10 host build ------------------------------------------------------------

$productExe = Join-Path $hostDirectory 'target\release\polaris-desktop.exe'
$e2eExe = Join-Path $hostDirectory 'target-e2e\release\polaris-desktop.exe'

Invoke-Stage "10 host build (product and measurement binaries)" {
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

# -- 11 / 12 tests ------------------------------------------------------------

Invoke-Stage "11 host tests" { Invoke-Groups @('P06-HOST-CORE', 'P06-HOST-BINDING', 'P06-HOST-LINT') }
Invoke-Stage "12 renderer tests and instruments" { Invoke-Groups @('P06-RENDERER', 'P06-RENDERER-ALL', 'P06-TOOLS') }

# -- 13 native E2E ------------------------------------------------------------

. (Join-Path $tools 'p06-native.ps1')

# the per-run credential canary: in memory only; its digest goes to the evidence
$script:Canary = New-P06Canary
$native = [ordered] @{
  performed        = $false
  reason           = ''
  run_started      = $runStarted
  data_directory   = $null
  fixture_state    = $null
  fixture_log      = $null
  fixture_exited   = $false
  canary_sha256    = (Get-P06Sha256Hex -Text $script:Canary)
  canary_length    = $script:Canary.Length
  canary_scan      = $null
  report_canary    = $null
  first            = $null
  restart          = $null
}

Invoke-Stage "13 native E2E (TEST FIXTURE model and REST connector)" -Soft {
  if ($null -ne $script:HardFailure) { $native.reason = ('STOPPED_AFTER_FAILURE: ' + $script:HardFailure); return }
  if (-not $environmentRecord.is_windows) { $native.reason = 'NOT_WINDOWS'; return }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
  $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('polaris-p06-e2e-' + $stamp)
  $dataDir = Join-Path $scratch 'data'
  $workspace = Join-Path $scratch 'workspace'
  [void] (New-Item -ItemType Directory -Path $dataDir -Force)
  [void] (New-Item -ItemType Directory -Path $workspace -Force)
  $native.data_directory = $dataDir

  $statePath = Join-Path $rawDirectory 'fixture-state.local.json'
  $logPath = Join-Path $rawDirectory 'fixture-log.local.json'
  $fixture = Start-P06Fixture -NodeCommand $script:Node -Script (Join-Path $tools 'p06-fixture-server.mjs') -StatePath $statePath -LogPath $logPath -Canary $script:Canary
  if ($null -eq $fixture.state) { $native.reason = 'FIXTURE_DID_NOT_START'; return }
  $native.fixture_state = $fixture.state
  try {
    $marker = 'm' + $stamp
    $common = @{
      'POLARIS_DATA_DIR'              = $dataDir
      'POLARIS_E2E_FIXTURE_PORT'      = [string] $fixture.state.port
      'POLARIS_E2E_CONNECTOR_PORT'    = [string] $fixture.state.connector_port
      'POLARIS_E2E_WORKSPACE'         = $workspace
      'POLARIS_E2E_MARKER'            = $marker
      'POLARIS_LOCALE'                = 'en'
      'POLARIS_CONNECTOR_TEST_TOKEN'  = $script:Canary
    }
    $first = $common.Clone()
    $first['POLARIS_E2E_SUITE'] = 'p06-first'
    $first['POLARIS_STARTUP_REPORT'] = (Join-Path $rawDirectory 'first-startup.local.json')
    $native.first = Invoke-P04Launch -ExecutablePath $e2eExe -ReportPath $first['POLARIS_STARTUP_REPORT'] -Environment $first -SuiteTimeoutSeconds 1500
    $restart = $common.Clone()
    $restart['POLARIS_E2E_SUITE'] = 'p06-restart'
    $restart['POLARIS_STARTUP_REPORT'] = (Join-Path $rawDirectory 'restart-startup.local.json')
    $native.restart = Invoke-P04Launch -ExecutablePath $e2eExe -ReportPath $restart['POLARIS_STARTUP_REPORT'] -Environment $restart
    $native.performed = $true
  }
  finally {
    $native.fixture_log = Stop-P06Fixture -Fixture $fixture -LogPath $logPath
    $fixture.process.Refresh()
    $native.fixture_exited = $fixture.process.HasExited
    # every file the product wrote, and every report this probe wrote, scanned for the canary
    $native.canary_scan = Find-P06CanaryInFiles -Directory $dataDir -Canary $script:Canary
    $native.report_canary = Find-P06CanaryInFiles -Directory $rawDirectory -Canary $script:Canary
    Write-RawJson -Path (Join-Path $rawDirectory 'native.local.json') -Value $native
  }
  foreach ($launch in @($native.first, $native.restart)) {
    if ($null -eq $launch) { continue }
    $report = $launch.e2e_report
    if ($null -eq $report) { Write-Host ("  no E2E report: " + ($launch.reason_codes -join ',')); continue }
    $inner = if ($null -ne $report.PSObject.Properties['renderer'] -and $null -ne $report.renderer) { $report.renderer } else { $report }
    if ($null -ne $inner.PSObject.Properties['fatal']) { Write-Host ("  fatal: " + $inner.fatal) }
    foreach ($scenario in @($inner.scenarios)) {
      Write-Host ("  " + $scenario.status.PadRight(11) + $scenario.id.PadRight(14) + $scenario.detail)
    }
  }
  Write-Host ("  canary: data files " + $native.canary_scan.files + ", with the canary " + $native.canary_scan.files_with_canary + "; probe reports with the canary " + $native.report_canary.files_with_canary)
}
if (-not (Test-Path -LiteralPath (Join-Path $rawDirectory 'native.local.json'))) {
  Write-RawJson -Path (Join-Path $rawDirectory 'native.local.json') -Value $native
}

# -- 14 security --------------------------------------------------------------

Invoke-Stage "14 security (static scan)" -Soft {
  & $script:Node (Join-Path $tools 'p06-security.mjs') --root $RepositoryRoot
}

# -- 15 performance is derived in stage 18 ------------------------------------

[void] $script:Stages.Add([pscustomobject] @{ name = '15 performance (derived from stage 13)'; exit_code = 0; duration_ms = 0 })

# -- 16 regression ------------------------------------------------------------

if ($SkipRegression) {
  Write-Host "--- 16 regression SKIPPED by switch. PHASE-06 cannot be PASS from this run."
}
elseif ($null -ne $script:HardFailure) {
  Write-Host ("--- 16 regression not run after failure: " + $script:HardFailure)
}
elseif ($Regression -eq 'PriorGates') {
  Write-Host "--- 16 regression: each phase is tested separately; the lower gates are read, not re-run (derivation checks each)"
  [void] $script:Stages.Add([pscustomobject] @{ name = '16 regression (prior gates read, not re-run)'; exit_code = 0; duration_ms = 0 })
}
else {
  Invoke-Stage "16 Phase-05 runner (re-runs Phase-04, Phase-03, Phase-02, Phase-01 and the frozen Phase-00 gate)" -Soft {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p05-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
    $runRecord.phase05_runner_exit = $LASTEXITCODE
  }
}
Set-Item -Path ("Env:" + $script:Marker) -Value '1'
Save-RunRecord

# -- 17 / 18 / 19 evidence ----------------------------------------------------

function Invoke-EvidenceScan {
  # the canary reaches the scanner through its own environment, for this call only
  [System.Environment]::SetEnvironmentVariable('P06_CANARY', $script:Canary, 'Process')
  try { & $script:Node (Join-Path $tools 'p06-security.mjs') --root $RepositoryRoot --scan-evidence }
  finally { [System.Environment]::SetEnvironmentVariable('P06_CANARY', $null, 'Process') }
}

Invoke-Stage "18 Phase-06 derivation" -Soft { & $script:Node (Join-Path $tools 'p06-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "17 evidence byte gate" -Soft { & $script:Node (Join-Path $tools 'p06-evidence-bytes.mjs') --root $RepositoryRoot }
Invoke-Stage "18b Phase-06 derivation with the byte gate" -Soft { & $script:Node (Join-Path $tools 'p06-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "17b evidence byte gate, second pass" -Soft { & $script:Node (Join-Path $tools 'p06-evidence-bytes.mjs') --root $RepositoryRoot }
Invoke-Stage "14b evidence secret and canary scan after derivation" -Soft { Invoke-EvidenceScan }
Invoke-Stage "18c Phase-06 derivation with the evidence scan" -Soft { & $script:Node (Join-Path $tools 'p06-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "19 final gate" -Soft { & $script:Node (Join-Path $tools 'p06-final-gate.mjs') --root $RepositoryRoot }
Invoke-Stage "17c byte gate including the final gate" -Soft { & $script:Node (Join-Path $tools 'p06-evidence-bytes.mjs') --root $RepositoryRoot --include-final-gate }
Invoke-Stage "14c evidence canary scan including the final gate" -Soft { Invoke-EvidenceScan }

$script:Canary = $null
Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue

$gatePath = Join-Path $evidenceDirectory 'phase-06-final-gate.json'
$verdict = 'INCONCLUSIVE'
$phase07 = 'NOT_ALLOWED'
if (Test-Path -LiteralPath $gatePath) {
  $gate = Get-Content -LiteralPath $gatePath -Raw | ConvertFrom-Json
  $verdict = [string] $gate.verdict
  $phase07 = [string] $gate.phase_07_gate
}

Write-Host ""
foreach ($stage in $script:Stages) { Write-Host (("exit " + $stage.exit_code).PadRight(9) + $stage.name) }
Write-Host ""
if ($null -ne $script:HardFailure) { Write-Host ("STOPPED AT: " + $script:HardFailure) }
if ($SkipRegression) { Write-Host "PHASE-06 cannot be PASS: the regression stage was skipped by switch." }
Write-Host ("PHASE-06 = " + $verdict)
Write-Host ("PHASE-07 GATE = " + $phase07)
if ($verdict -eq 'PASS' -and $phase07 -eq 'ALLOWED' -and $null -eq $script:HardFailure) { exit 0 }
exit 1
