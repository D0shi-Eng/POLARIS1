#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-03 - the single verification run.

.DESCRIPTION
  One command. It verifies contracts, runtime, agents, missions, the task
  graph, orchestration, budgets, trust, truth, evidence, verification and
  persistence; builds the product and measurement binaries; runs the native
  Windows E2E suite twice (first launch and restart) against a loopback TEST
  FIXTURE provider; scans for secrets; re-runs the Phase-02 gate (which
  re-runs Phase-01, which re-runs the frozen Phase-00 gate); derives the
  canonical Phase-03 evidence; and decides the Phase-03 final gate.

  ORDER
  -----
     1  prerequisite read       Phase-02 final gate PASS and Phase-03 ALLOWED
     2  contract generation     generate, drift check
     3  contracts verify        typecheck, build, Phase-03 suite
     4  runtime verify          package refresh, typecheck, build, suite
     5  host units              agents, missions, task graph, budgets
     6  host trust and truth    trust, truth, evidence
     7  host integration        orchestration, verification, persistence
     8  renderer                install, generate, drift check, typecheck, build, CSP guard
     9  host build              product and measurement binaries
    10  host tests              core, binding with the measurement feature, clippy
    11  renderer tests          every renderer test file, Phase-03 instruments
    12  native E2E              first launch and restart, TEST FIXTURE
    13  security                static scan, evidence scan
    14  performance             derived from the native measurements
    15  Phase-00/01/02 regress  the Phase-02 runner, which re-runs the two below it
    16  evidence byte gate      every canonical Phase-03 document
    17  Phase-03 derivation     the ten canonical documents
    18  final gate              the conditions, and the Phase-04 decision

  A genuine failure in stages 2-11 stops the work: the runner still derives
  and writes the evidence, so the failure is recorded, then exits non-zero.

  DEVICE SAFETY
  -------------
  Heavy steps run one at a time. No model is loaded or unloaded, and no paid
  credential is needed: the only provider is a loopback TEST FIXTURE this
  runner starts and stops itself. The runner ends only processes it started,
  by handle or by recorded process id, never by name.

  ENCODING
  --------
  Every executable line in this file is ASCII.

.PARAMETER RepositoryRoot
  Explicit repository root.

.PARAMETER SkipRegression
  Skip stage 15. Such a run cannot produce PHASE-03 = PASS, and says so.

.PARAMETER SelfCheck
  Resolve the root, prove the toolchain, read the prerequisite and stop.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p03-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SkipRegression,
  [switch] $SelfCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:Marker = "POLARIS_P03_NATIVE_RUN"
$script:Stages = New-Object System.Collections.Generic.List[object]
$script:HardFailure = $null
$script:Markers = @(
  "contracts\package.json",
  "contracts\registry\phase-03-ipc.registry.json",
  "runtime\package.json",
  "desktop\host\Cargo.toml",
  "desktop\host\core\src\p03\service.rs",
  "desktop\renderer\package.json",
  "tools\p02-conformance\run.ps1",
  "tools\p03-conformance\p03-common.mjs"
)

function Resolve-P03Root {
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
  throw "BOOTSTRAP FAILED: no candidate path carries the POLARIS Phase-03 markers."
}

$RepositoryRoot = Resolve-P03Root -Explicit $RepositoryRoot
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

Write-Host "runner     : polaris.p03.conformance.runner"
Write-Host "root       : $RepositoryRoot"
Write-Host ("node       : " + $environmentRecord.node + "   cargo : " + $environmentRecord.cargo)
Write-Host ("powershell : " + $environmentRecord.powershell)

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
$rawDirectory = Join-Path $evidenceDirectory 'p03-native'
if (-not (Test-Path -LiteralPath $rawDirectory)) { [void] (New-Item -ItemType Directory -Path $rawDirectory) }
$tools = Join-Path $RepositoryRoot 'tools\p03-conformance'

function Write-RawJson {
  param([string] $Path, $Value)
  $json = ($Value | ConvertTo-Json -Depth 40).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText($Path, ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

# -- 1 prerequisite -----------------------------------------------------------

$phase02GatePath = Join-Path $evidenceDirectory 'phase-02-final-gate.json'
if (-not (Test-Path -LiteralPath $phase02GatePath)) { throw "PREREQUISITE MISSING: evidence\phase-02-final-gate.json" }
$phase02Before = Get-Content -LiteralPath $phase02GatePath -Raw | ConvertFrom-Json
if ($phase02Before.verdict -ne 'PASS' -or $phase02Before.phase_03_gate -ne 'ALLOWED') {
  throw ("PREREQUISITE NOT SATISFIED: PHASE-02 = " + $phase02Before.verdict + ", PHASE-03 GATE = " + $phase02Before.phase_03_gate)
}
Write-Host ("--- 1 prerequisite: PHASE-02 = PASS, PHASE-03 GATE = ALLOWED (decided " + $phase02Before.measured_at + ")")
if ($SelfCheck) {
  Write-Host "self-check complete. Nothing was measured and no evidence was written."
  exit 0
}

$runStarted = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
foreach ($name in @('phase-00-final-gate.json', 'phase-01-final-gate.json', 'phase-02-final-gate.json')) {
  $source = Join-Path $evidenceDirectory $name
  if (Test-Path -LiteralPath $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $rawDirectory ($name.Replace('.json', '.before.local.json'))) -Force
  }
}
# a fresh run: the previous group record would mix two runs
$groupsPath = Join-Path $rawDirectory 'groups.local.json'
if (Test-Path -LiteralPath $groupsPath) { Remove-Item -LiteralPath $groupsPath -Force }

Set-Item -Path ("Env:" + $script:Marker) -Value '1'

$runRecord = [ordered] @{
  schema_version       = '1.0.0'
  tool                 = 'polaris.p03.runner'
  run_started          = $runStarted
  environment          = $environmentRecord
  builds               = [ordered] @{}
  stages               = @()
  phase02_runner_exit  = $null
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
  $arguments = @((Join-Path $tools 'p03-test-groups.mjs'), '--root', $RepositoryRoot)
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
  Invoke-Groups @('P03-CONTRACTS')
}

# -- 4 runtime ----------------------------------------------------------------

Invoke-Stage "4 runtime verify" {
  # the packed contracts copy is rebuilt from the new build, as the Phase-00 runner does
  $installed = Join-Path (Join-Path (Join-Path (Join-Path $runtime 'node_modules') '@polaris') 'contracts') ''
  $installed = $installed.TrimEnd('\')
  $expectedTail = 'runtime\node_modules\@polaris\contracts'
  if (-not $installed.EndsWith($expectedTail)) { throw ("refusing to refresh an unexpected path: " + $installed) }
  if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Recurse -Force }
  Invoke-Npm $runtime @('install', '--no-audit', '--no-fund')
  Invoke-Npm $runtime @('run', 'typecheck')
  Invoke-Npm $runtime @('run', 'build')
  Invoke-Groups @('P03-RUNTIME')
}

# -- 5 / 6 / 7 host units and integration -------------------------------------

Invoke-Stage "5 host units: agents, missions, task graph, budgets" {
  Invoke-Groups @('P03-AGENTS', 'P03-MISSIONS', 'P03-TASK-GRAPH', 'P03-BUDGETS')
}

Invoke-Stage "6 host units: trust, truth, evidence" {
  Invoke-Groups @('P03-TRUST', 'P03-TRUTH', 'P03-EVIDENCE')
}

Invoke-Stage "7 host integration: orchestration, verification, persistence" {
  Invoke-Groups @('P03-ORCHESTRATION', 'P03-VERIFICATION', 'P03-PERSISTENCE')
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

Invoke-Stage "10 host tests" { Invoke-Groups @('P03-HOST-CORE', 'P03-HOST-BINDING', 'P03-HOST-LINT') }
Invoke-Stage "11 renderer tests" { Invoke-Groups @('P03-RENDERER', 'P03-RENDERER-UI', 'P03-TOOLS') }

# -- 12 native E2E ------------------------------------------------------------

. (Join-Path $tools 'p03-native.ps1')

$native = [ordered] @{
  performed      = $false
  reason         = ''
  run_started    = $runStarted
  data_directory = $null
  fixture_state  = $null
  fixture_log    = $null
  first          = $null
  restart        = $null
}

Invoke-Stage "12 native E2E (TEST FIXTURE)" -Soft {
  if ($null -ne $script:HardFailure) { $native.reason = ('STOPPED_AFTER_FAILURE: ' + $script:HardFailure); return }
  if (-not $environmentRecord.is_windows) { $native.reason = 'NOT_WINDOWS'; return }
  $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
  $scratch = Join-Path ([System.IO.Path]::GetTempPath()) ('polaris-p03-e2e-' + $stamp)
  $dataDir = Join-Path $scratch 'data'
  [void] (New-Item -ItemType Directory -Path $dataDir -Force)
  $native.data_directory = $dataDir

  $statePath = Join-Path $rawDirectory 'fixture-state.local.json'
  $logPath = Join-Path $rawDirectory 'fixture-log.local.json'
  $fixture = Start-P03Fixture -NodeCommand $script:Node -Script (Join-Path $tools 'p03-fixture-server.mjs') -StatePath $statePath -LogPath $logPath
  if ($null -eq $fixture.state) { $native.reason = 'FIXTURE_DID_NOT_START'; return }
  $native.fixture_state = $fixture.state
  try {
    $marker = 'm' + $stamp
    $common = @{
      'POLARIS_DATA_DIR'         = $dataDir
      'POLARIS_E2E_FIXTURE_PORT' = [string] $fixture.state.port
      'POLARIS_E2E_MARKER'       = $marker
      'POLARIS_LOCALE'           = 'en'
    }
    $first = $common.Clone()
    $first['POLARIS_E2E_SUITE'] = 'p03-first'
    $first['POLARIS_STARTUP_REPORT'] = (Join-Path $rawDirectory 'first-startup.local.json')
    $native.first = Invoke-P03Launch -ExecutablePath $e2eExe -ReportPath $first['POLARIS_STARTUP_REPORT'] -Environment $first
    $restart = $common.Clone()
    $restart['POLARIS_E2E_SUITE'] = 'p03-restart'
    $restart['POLARIS_STARTUP_REPORT'] = (Join-Path $rawDirectory 'restart-startup.local.json')
    $native.restart = Invoke-P03Launch -ExecutablePath $e2eExe -ReportPath $restart['POLARIS_STARTUP_REPORT'] -Environment $restart
    $native.performed = $true
  }
  finally {
    $native.fixture_log = Stop-P03Fixture -Fixture $fixture -LogPath $logPath
    Write-RawJson -Path (Join-Path $rawDirectory 'native.local.json') -Value $native
  }
  foreach ($launch in @($native.first, $native.restart)) {
    if ($null -eq $launch) { continue }
    $report = $launch.e2e_report
    if ($null -eq $report) { Write-Host ("  no E2E report: " + ($launch.reason_codes -join ',')); continue }
    # the report is nested: scenarios live under renderer (see startup.rs)
    $inner = if ($null -ne $report.renderer) { $report.renderer } else { $report }
    foreach ($scenario in @($inner.scenarios)) {
      Write-Host ("  " + $scenario.status.PadRight(11) + $scenario.id.PadRight(14) + $scenario.detail)
    }
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $rawDirectory 'native.local.json'))) {
  Write-RawJson -Path (Join-Path $rawDirectory 'native.local.json') -Value $native
}

# -- 13 security --------------------------------------------------------------

# the evidence secret scan can only scan documents that exist, so it runs after
# the derivation, at stage 13b. Running it here would report NOT_TESTED and make
# this stage exit non-zero for a measurement that simply had not happened yet.
Invoke-Stage "13 security (static scan)" -Soft {
  & $script:Node (Join-Path $tools 'p03-security.mjs') --root $RepositoryRoot
}

# -- 14 performance is derived in stage 17 ------------------------------------

[void] $script:Stages.Add([pscustomobject] @{ name = '14 performance (derived from stage 12)'; exit_code = 0; duration_ms = 0 })

# -- 15 regression ------------------------------------------------------------

if ($SkipRegression) {
  Write-Host "--- 15 regression SKIPPED by switch. PHASE-03 cannot be PASS from this run."
}
elseif ($null -ne $script:HardFailure) {
  Write-Host ("--- 15 regression not run after failure: " + $script:HardFailure)
}
else {
  Invoke-Stage "15 Phase-02 runner (re-runs Phase-01, which re-runs the frozen Phase-00 gate)" -Soft {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p02-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
    $runRecord.phase02_runner_exit = $LASTEXITCODE
  }
}
Set-Item -Path ("Env:" + $script:Marker) -Value '1'
Save-RunRecord

# -- 16 / 17 / 18 evidence ----------------------------------------------------

Invoke-Stage "17 Phase-03 derivation" -Soft { & $script:Node (Join-Path $tools 'p03-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "16 evidence byte gate" -Soft { & $script:Node (Join-Path $tools 'p03-evidence-bytes.mjs') --root $RepositoryRoot }
# the derivation reads the byte gate result for P03-Q4, so it runs once more
Invoke-Stage "17b Phase-03 derivation with the byte gate" -Soft { & $script:Node (Join-Path $tools 'p03-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "16b evidence byte gate, second pass" -Soft { & $script:Node (Join-Path $tools 'p03-evidence-bytes.mjs') --root $RepositoryRoot }
Invoke-Stage "13b evidence secret scan after derivation" -Soft { & $script:Node (Join-Path $tools 'p03-security.mjs') --root $RepositoryRoot --scan-evidence }
Invoke-Stage "17c Phase-03 derivation with the evidence scan" -Soft { & $script:Node (Join-Path $tools 'p03-derive.mjs') --root $RepositoryRoot }
Invoke-Stage "18 final gate" -Soft { & $script:Node (Join-Path $tools 'p03-final-gate.mjs') --root $RepositoryRoot }
Invoke-Stage "18b byte gate including the final gate" -Soft { & $script:Node (Join-Path $tools 'p03-evidence-bytes.mjs') --root $RepositoryRoot --include-final-gate }

Remove-Item -Path ("Env:" + $script:Marker) -ErrorAction SilentlyContinue

$gatePath = Join-Path $evidenceDirectory 'phase-03-final-gate.json'
$verdict = 'INCONCLUSIVE'
$phase04 = 'NOT_ALLOWED'
if (Test-Path -LiteralPath $gatePath) {
  $gate = Get-Content -LiteralPath $gatePath -Raw | ConvertFrom-Json
  $verdict = [string] $gate.verdict
  $phase04 = [string] $gate.phase_04_gate
}

Write-Host ""
foreach ($stage in $script:Stages) { Write-Host (("exit " + $stage.exit_code).PadRight(9) + $stage.name) }
Write-Host ""
if ($null -ne $script:HardFailure) { Write-Host ("STOPPED AT: " + $script:HardFailure) }
if ($SkipRegression) { Write-Host "PHASE-03 cannot be PASS: the regression stage was skipped by switch." }
Write-Host ("PHASE-03 = " + $verdict)
Write-Host ("PHASE-04 GATE = " + $phase04)
if ($verdict -eq 'PASS' -and $phase04 -eq 'ALLOWED' -and $null -eq $script:HardFailure) { exit 0 }
exit 1
