#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-01 - the single verification run.

.DESCRIPTION
  One command. It closes P01-W2, builds the desktop tier, runs every Phase-01
  test group, measures the application natively on Windows, re-runs the frozen
  Phase-00 gate, derives the evidence and decides the Phase-01 final gate.

  ORDER (dependency direction, not preference)
  --------------------------------------------
    0  bootstrap              root, toolchain, P01-B1 read
    1  ascii discipline       the class guard for the defect that stopped W2
    2  P01-W2 closure         the existing W2 runner, unchanged
    3  renderer               install, generate, drift guard, typecheck, build
    4  native host            build-mode guard, cargo build (packaged frontend), both binaries
    5  test groups            every Phase-01 lane, with exact counts
    6  native measurement     launch, window, scaling, dogfood, exit
    7  Phase-00 regression    snapshot, then the frozen W6 runner
    8  derivation             the Phase-01 evidence documents
    9  byte gate              every canonical document
   10  final gate             the matrix, and the Phase-02 decision
   11  byte gate, second pass including the final gate itself

  WHY THE W2 RUNNER IS CALLED RATHER THAN REIMPLEMENTED
  -----------------------------------------------------
  P01-W2 owns evidence\phase-01-ipc.json. A second writer for a closed work
  package's canonical document is how a closed result quietly changes. This
  runner calls it and reads what it wrote.

  ENCODING
  --------
  Every executable line in this file is ASCII. Arabic lives in comments only.
  A single non-ASCII character inside a quoted string is what stopped P01-W2:
  Windows PowerShell decodes a BOM-less file with the local code page, and the
  UTF-8 bytes of an em dash end in 0x94, which the parser accepts as a closing
  quotation mark. tools\p01-conformance\ascii-discipline.mjs enforces the rule.

.PARAMETER RepositoryRoot
  Explicit repository root. When supplied it is used and validated.

.PARAMETER SkipPhase00Regression
  Skip stage 7. A run with this switch can never produce a clean Phase-01
  verdict, and says so.

.PARAMETER SkipNativeMeasurement
  Skip stage 6. Same rule: the Windows claims stay NOT_TESTED.

.PARAMETER SelfCheck
  Resolve the root, prove the toolchain, read P01-B1 and stop.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SkipPhase00Regression,
  [switch] $SkipNativeMeasurement,
  [switch] $SelfCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:RunnerName = "polaris.p01.conformance.runner"
$script:NativeMarker = "POLARIS_P01_NATIVE_RUN"
$script:RootResolutionMethod = "UNRESOLVED"
$script:Steps = New-Object System.Collections.Generic.List[object]
$script:RepositoryMarkers = @(
  "contracts\package.json",
  "contracts\registry\phase-01-ipc.registry.json",
  "runtime\package.json",
  "desktop\host\Cargo.toml",
  "desktop\renderer\package.json",
  "tools\p01-conformance\p01-groups.mjs",
  "tools\p01-w2-conformance\run.ps1"
)

<#
  التطبيع الوحيد المعتمد قبل أي ‎.Count‎ أو فهرسة. الدرس نفسه المُسجَّل في W5:
  ‎PowerShell‎ يعدّ قيمة الإرجاع إلى المجرى، فصفر عنصر يصير ‎$null‎ وعنصر واحد
  يصير قيمة مفردة، و‎.Count‎ على أيٍّ منهما تحت ‎StrictMode‎ ترمي.
#>
function ConvertTo-CountableArray {
  param([Parameter(Mandatory = $false)] $Value)
  if ($null -eq $Value) { return ,@() }
  return ,@($Value)
}

function Join-MarkerPath {
  param([Parameter(Mandatory = $true)][string] $Root, [Parameter(Mandatory = $true)][string] $Marker)
  $path = $Root
  foreach ($segment in ($Marker -split '[\\/]')) {
    if ([string]::IsNullOrWhiteSpace($segment)) { continue }
    $path = Join-Path $path $segment
  }
  return $path
}

function Get-MissingMarkers {
  param([Parameter(Mandatory = $true)][string] $Root)
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($marker in $script:RepositoryMarkers) {
    if (-not (Test-Path -LiteralPath (Join-MarkerPath -Root $Root -Marker $marker))) { [void] $missing.Add($marker) }
  }
  return ,@($missing.ToArray())
}

function Resolve-RepositoryRoot {
  param([string] $Explicit)

  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    $resolved = [System.IO.Path]::GetFullPath($Explicit)
    $missing = ConvertTo-CountableArray (Get-MissingMarkers -Root $resolved)
    if ($missing.Count -gt 0) {
      throw "BOOTSTRAP FAILED: explicit RepositoryRoot `"$resolved`" is missing markers: $($missing -join ', ')."
    }
    $script:RootResolutionMethod = "EXPLICIT_PARAMETER"
    return $resolved
  }

  $candidates = New-Object System.Collections.Generic.List[string]
  if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    [void] $candidates.Add([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..")))
  }
  [void] $candidates.Add($script:DefaultRepositoryRoot)
  [void] $candidates.Add((Get-Location).Path)

  foreach ($candidate in $candidates) {
    $missing = ConvertTo-CountableArray (Get-MissingMarkers -Root $candidate)
    if ($missing.Count -eq 0) {
      $script:RootResolutionMethod = "MARKER_SEARCH"
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  throw "BOOTSTRAP FAILED: no candidate path carries the POLARIS Phase-01 markers."
}

$RepositoryRoot = Resolve-RepositoryRoot -Explicit $RepositoryRoot

$script:NodeCommand = if (Get-Command node.exe -ErrorAction SilentlyContinue) { 'node.exe' } else { 'node' }
if (-not (Get-Command $script:NodeCommand -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: node is not on PATH." }
$script:NpmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
if (-not (Get-Command $script:NpmCommand -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: npm is not on PATH." }
$script:CargoCommand = if (Get-Command cargo.exe -ErrorAction SilentlyContinue) { 'cargo.exe' } else { 'cargo' }
if (-not (Get-Command $script:CargoCommand -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: cargo is not on PATH." }

Write-Host "runner     : $script:RunnerName"
Write-Host "root       : $RepositoryRoot  ($script:RootResolutionMethod)"
Write-Host "node       : $script:NodeCommand"
Write-Host "npm        : $script:NpmCommand"
Write-Host "cargo      : $script:CargoCommand"
Write-Host "powershell : $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)"

# -- 0 the prerequisite: P01-B1 is read, never re-measured ---------------------

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
$baselinePath = Join-Path $evidenceDirectory 'phase-01-baseline.json'
if (-not (Test-Path -LiteralPath $baselinePath)) {
  throw "P01-B1 PREREQUISITE MISSING: `"$baselinePath`" does not exist. Phase-01 cannot start."
}
$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
if ($baseline.claim_id -ne 'P01-B1' -or $baseline.verdict -ne 'PASS' -or $baseline.canonical -ne $true -or $baseline.native -ne $true) {
  throw "P01-B1 PREREQUISITE NOT SATISFIED: verdict=$($baseline.verdict) canonical=$($baseline.canonical) native=$($baseline.native)."
}
Write-Host "--- P01-B1 prerequisite: PASS (run $($baseline.run_id), measured $($baseline.measured_at))"

if ($SelfCheck) {
  Write-Host "self-check complete. No measurement was performed and no canonical evidence was written."
  exit 0
}

Set-Location -LiteralPath $RepositoryRoot

function Invoke-Step {
  param([string] $Name, [scriptblock] $Body)
  Write-Host "--- $Name"
  $started = Get-Date
  $global:LASTEXITCODE = 0
  & $Body
  $code = $LASTEXITCODE
  [void] $script:Steps.Add([pscustomobject] @{ name = $Name; exit_code = $code; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds })
  if ($code -ne 0) { throw "$Name failed with exit code $code" }
}

function Invoke-SoftStep {
  param([string] $Name, [scriptblock] $Body)
  Write-Host "--- $Name"
  $started = Get-Date
  $global:LASTEXITCODE = 0
  # Windows PowerShell 5.1: with ErrorActionPreference=Stop, any stderr line of a
  # native command merged by 2>&1 becomes a terminating NativeCommandError. A soft
  # step is judged by its exit code only, so stderr is shown, never thrown.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Body 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Host $_.ToString() } else { Write-Host $_ }
    }
  }
  finally { $ErrorActionPreference = $previousPreference }
  $code = $LASTEXITCODE
  [void] $script:Steps.Add([pscustomobject] @{ name = $Name; exit_code = $code; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds })
  $script:LastSoftStepCode = $code
  return $code
}

# -- 1 the defect-class guard --------------------------------------------------

Invoke-Step "ascii discipline over every PowerShell instrument" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\ascii-discipline.mjs') --root $RepositoryRoot | Out-Host
}

# -- 2 P01-W2 closure, by its own runner --------------------------------------

Invoke-Step "P01-W2 closure" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p01-w2-conformance\run.ps1') -RepositoryRoot $RepositoryRoot | Out-Host
}

$ipcPath = Join-Path $evidenceDirectory 'phase-01-ipc.json'
if (-not (Test-Path -LiteralPath $ipcPath)) { throw "P01-W2 produced no canonical document; Phase-01 stops." }
$ipcDocument = Get-Content -LiteralPath $ipcPath -Raw | ConvertFrom-Json
Write-Host "--- P01-W2 = $($ipcDocument.verdict)"
if ($ipcDocument.verdict -ne 'PASS') { throw "P01-W2 is $($ipcDocument.verdict); ADR-017 and ADR-018 are not accepted and Phase-01 stops." }

# -- 3 the renderer -----------------------------------------------------------

$rendererDirectory = Join-Path $RepositoryRoot 'desktop\renderer'

Invoke-Step "renderer: install dependencies" {
  Push-Location -LiteralPath $rendererDirectory
  try { & $script:NpmCommand 'install' '--no-audit' '--no-fund' | Out-Host } finally { Pop-Location }
}

Invoke-Step "renderer: regenerate the contract bundle and prove it has not drifted" {
  Push-Location -LiteralPath $rendererDirectory
  try {
    & $script:NpmCommand 'run' 'generate' | Out-Host
    if ($LASTEXITCODE -ne 0) { return }
    & $script:NpmCommand 'run' 'generate:check' | Out-Host
  }
  finally { Pop-Location }
}

Invoke-Step "renderer: typecheck and build" {
  $started = Get-Date
  Push-Location -LiteralPath $rendererDirectory
  try {
    & $script:NpmCommand 'run' 'typecheck' | Out-Host
    if ($LASTEXITCODE -ne 0) { return }
    & $script:NpmCommand 'run' 'build' | Out-Host
  }
  finally { Pop-Location }
  $script:RendererBuildExit = $LASTEXITCODE
  $script:RendererBuildMs = [int]((Get-Date) - $started).TotalMilliseconds
}

# the CSP guard (P01_STARTUP_REPORT_ABSENT): the packaged page runs under the
# product CSP, which forbids string evaluation. A bundle that compiles schemas at
# run time loads, throws before desktop.bootstrap, and never reaches the host.
Invoke-Step "renderer: CSP guard over the sources and the packaged bundle" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\csp-guard.mjs') --root $RepositoryRoot | Out-Host
}

$rendererBuildOk = ($script:RendererBuildExit -eq 0)
$rendererBuildMs = $script:RendererBuildMs

Invoke-Step "renderer: compile the test lane" {
  Push-Location -LiteralPath $rendererDirectory
  try { & $script:NpmCommand 'run' 'build:tests' | Out-Host } finally { Pop-Location }
}

# -- 4 the native host --------------------------------------------------------

$hostDirectory = Join-Path $RepositoryRoot 'desktop\host'
$hostReleaseOk = $false
$hostReleaseMs = 0
$hostE2EOk = $false

# the build input guard: tauri-build needs icons\icon.ico for the Windows resource.
# A missing or corrupt icon is a packaging defect and is reported here, before cargo.
Invoke-Step "native host: application asset guard" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\make-app-icon.mjs') --root $RepositoryRoot --check | Out-Host
  if ($LASTEXITCODE -ne 0) { return }
  & $script:NodeCommand '--test' (Join-Path $RepositoryRoot 'tools\p01-conformance\tests\app-icon.test.mjs') | Out-Host
}

# the build-mode guard (P01_PRODUCT_BINARY_BUILT_IN_TAURI_DEV_MODE): a cargo release
# profile alone is not a Tauri production build. Without tauri/custom-protocol the
# tauri build script emits cfg(dev) and the binary embeds devUrl. The static half
# runs here, before any compile time is spent.
$productExe = Join-Path $hostDirectory 'target\release\polaris-desktop.exe'
$e2eExe = Join-Path $hostDirectory 'target-e2e\release\polaris-desktop.exe'
$buildModeTool = Join-Path $RepositoryRoot 'tools\p01-conformance\build-mode.mjs'
$productMessages = Join-Path $hostDirectory 'target\p01-build-messages.jsonl'
$e2eMessages = Join-Path $hostDirectory 'target-e2e\p01-build-messages.jsonl'
$productMode = Join-Path $hostDirectory 'target\p01-build-mode.json'
$e2eMode = Join-Path $hostDirectory 'target-e2e\p01-build-mode.json'
foreach ($dir in @((Join-Path $hostDirectory 'target'), (Join-Path $hostDirectory 'target-e2e'))) {
  if (-not (Test-Path -LiteralPath $dir)) { [void] (New-Item -ItemType Directory -Path $dir) }
}

Invoke-Step "native host: build-mode guard (static)" {
  & $script:NodeCommand $buildModeTool --root $RepositoryRoot | Out-Host
}

Invoke-Step "native host: build the product binary" {
  $started = Get-Date
  Push-Location -LiteralPath $hostDirectory
  try {
    & $script:CargoCommand 'build' '--release' '-p' 'polaris-host' '--features' 'custom-protocol' '--message-format=json-render-diagnostics' | Out-File -LiteralPath $productMessages -Encoding ascii
  }
  finally { Pop-Location }
  $script:HostReleaseExit = $LASTEXITCODE
  $script:HostReleaseMs = [int]((Get-Date) - $started).TotalMilliseconds
}
$hostReleaseOk = ($script:HostReleaseExit -eq 0)
$hostReleaseMs = $script:HostReleaseMs

Invoke-Step "native host: product binary build-mode guard" {
  & $script:NodeCommand $buildModeTool --root $RepositoryRoot --messages $productMessages --artifact product --expected-exe $productExe --out $productMode | Out-Host
}

Invoke-Step "native host: build the measurement binary" {
  Push-Location -LiteralPath $hostDirectory
  try {
    & $script:CargoCommand 'build' '--release' '-p' 'polaris-host' '--features' 'custom-protocol,e2e' '--target-dir' 'target-e2e' '--message-format=json-render-diagnostics' | Out-File -LiteralPath $e2eMessages -Encoding ascii
  }
  finally { Pop-Location }
  $script:HostE2EExit = $LASTEXITCODE
}
$hostE2EOk = ($script:HostE2EExit -eq 0)

Invoke-Step "native host: measurement binary build-mode guard" {
  & $script:NodeCommand $buildModeTool --root $RepositoryRoot --messages $e2eMessages --artifact measurement --expected-exe $e2eExe --out $e2eMode | Out-Host
}

$productFrontendMode = [string] ((Get-Content -LiteralPath $productMode -Raw | ConvertFrom-Json).mode)
$e2eFrontendMode = [string] ((Get-Content -LiteralPath $e2eMode -Raw | ConvertFrom-Json).mode)
Write-Host "--- frontend mode: product=$productFrontendMode measurement=$e2eFrontendMode"

# the development server port, read from the configuration rather than written here.
# It is only observed: a listener on it would contaminate the standalone proof.
$tauriConfig = Get-Content -LiteralPath (Join-Path $hostDirectory 'app\tauri.conf.json') -Raw | ConvertFrom-Json
$devServerPort = ([System.Uri] [string] $tauriConfig.build.devUrl).Port

# -- the marker: from here the run owns its measurement -----------------------

Set-Item -Path "Env:$script:NativeMarker" -Value '1'

# -- 5 test groups ------------------------------------------------------------

$groupsCode = Invoke-SoftStep "Phase-01 test groups" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\p01-test-groups.mjs') --root $RepositoryRoot
}

# -- 6 native measurement -----------------------------------------------------

. (Join-Path $RepositoryRoot 'tools\p01-conformance\desktop-native.ps1')

$probeDirectory = Join-Path $evidenceDirectory 'p01-native'
if (-not (Test-Path -LiteralPath $probeDirectory)) { [void] (New-Item -ItemType Directory -Path $probeDirectory) }

$probe = [ordered] @{
  tool         = 'polaris.p01.native-probe'
  # لا يُستعمل ‎$IsWindows‎: غير معرّف في ‎Windows PowerShell 5.1‎، و‎StrictMode‎ ترمي عليه.
  platform     = if ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT) { 'win32' } else { 'other' }
  measured_at  = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  build        = [ordered] @{
    host_release = [ordered] @{ ok = $hostReleaseOk; exit_code = $script:HostReleaseExit; duration_ms = $hostReleaseMs; frontend_mode = $productFrontendMode }
    host_e2e     = [ordered] @{ ok = $hostE2EOk; exit_code = $script:HostE2EExit; duration_ms = 0; frontend_mode = $e2eFrontendMode }
    renderer     = [ordered] @{ ok = $rendererBuildOk; exit_code = 0; duration_ms = $rendererBuildMs }
  }
  product_run  = $null
  e2e_runs     = @()
  restart_run  = $null
}

if ($SkipNativeMeasurement) {
  Write-Host "--- native measurement SKIPPED by switch. The Windows claims stay NOT_TESTED."
}
else {
  Invoke-SoftStep "native: product launch, window and exit" {
    $report = Join-Path $probeDirectory 'product-startup.json'
    $script:ProductRun = Invoke-PolarisLaunchProbe -ExecutablePath $productExe -ReportPath $report `
      -Environment @{ 'POLARIS_STARTUP_REPORT' = $report } -ForbiddenPort $devServerPort -ProbeWindow
    $global:LASTEXITCODE = 0
  }
  $probe.product_run = $script:ProductRun

  # قيم المقياس نصوص ثابتة لا أعداد: تحويل العدد إلى نص يتبع ثقافة النظام، وفاصلة
  # عشرية عربية داخل وسيط سطر أوامر تُنتج مقياسًا غير الذي قُصد.
  $scales = @(
    [pscustomobject] @{ label = '100'; value = '1.0' },
    [pscustomobject] @{ label = '125'; value = '1.25' },
    [pscustomobject] @{ label = '150'; value = '1.5' }
  )
  $runs = New-Object System.Collections.Generic.List[object]
  foreach ($scale in $scales) {
    Invoke-SoftStep ("native: measurement run at device scale " + $scale.value) {
      $report = Join-Path $probeDirectory ("e2e-" + $scale.label + ".json")
      $script:ScaleRun = Invoke-PolarisLaunchProbe -ExecutablePath $e2eExe -ReportPath $report -ForbiddenPort $devServerPort -Environment @{
        'POLARIS_STARTUP_REPORT'                = $report
        'WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS' = ("--force-device-scale-factor=" + $scale.value)
      }
      $global:LASTEXITCODE = 0
    }
    [void] $runs.Add([ordered] @{ scale = [double] $scale.value; record = $script:ScaleRun })
  }
  $probe.e2e_runs = @($runs.ToArray())

  Invoke-SoftStep "native: restart" {
    $report = Join-Path $probeDirectory 'product-restart.json'
    $script:RestartRun = Invoke-PolarisLaunchProbe -ExecutablePath $productExe -ReportPath $report `
      -Environment @{ 'POLARIS_STARTUP_REPORT' = $report } -ForbiddenPort $devServerPort
    $global:LASTEXITCODE = 0
  }
  $probe.restart_run = $script:RestartRun
}

# ‎ConvertTo-Json‎ يفصل أسطره بـCRLF على ويندوز. الوثيقة الخام ليست دليلًا قانونيًا،
# لكن توحيد النهايات يجعلها تُقارَن وتُقرأ بالطريقة نفسها على الجانبين.
$probeJson = ($probe | ConvertTo-Json -Depth 24).Replace("`r`n", "`n")
$rawPath = Join-Path $evidenceDirectory 'phase-01-native-probe.local.json'
[System.IO.File]::WriteAllText($rawPath, ($probeJson + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "--- wrote $rawPath"

$nativeCode = Invoke-SoftStep "Phase-01 native derivation" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\p01-native.mjs') --root $RepositoryRoot
}

# -- 7 Phase-00 regression ----------------------------------------------------

$phase00Path = Join-Path $evidenceDirectory 'phase-00-final-gate.json'
$phase00Snapshot = Join-Path $evidenceDirectory 'phase-01-p00-baseline.local.json'
if (Test-Path -LiteralPath $phase00Path) {
  Copy-Item -LiteralPath $phase00Path -Destination $phase00Snapshot -Force
  Write-Host "--- Phase-00 gate snapshot taken before the re-run"
}
else {
  Write-Host "--- Phase-00 gate document absent; the regression comparison will report NOT_TESTED"
}

if ($SkipPhase00Regression) {
  Write-Host "--- Phase-00 regression SKIPPED by switch. This run cannot produce a clean Phase-01 verdict."
}
else {
  [void] (Invoke-SoftStep "Phase-00 frozen gate, re-run after Phase-01" {
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\w6-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
  })
}

# -- 8 derivation -------------------------------------------------------------

$deriveCode = Invoke-SoftStep "Phase-01 derivation" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\p01-derive.mjs') --root $RepositoryRoot
}

# -- 9 byte gate, first pass --------------------------------------------------

$byteCode = Invoke-SoftStep "Phase-01 evidence byte gate" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\p01-evidence-bytes.mjs') --root $RepositoryRoot
}

# -- 10 the final gate --------------------------------------------------------

$gateCode = Invoke-SoftStep "Phase-01 final gate" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\p01-final-gate.mjs') --root $RepositoryRoot
}

# -- 11 byte gate, second pass including the final gate itself ----------------

$byteCode2 = Invoke-SoftStep "Phase-01 evidence byte gate, second pass" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-conformance\p01-evidence-bytes.mjs') --root $RepositoryRoot --include-final-gate
}

Remove-Item -Path "Env:$script:NativeMarker" -ErrorAction SilentlyContinue

# -- the verdict --------------------------------------------------------------

$gatePath = Join-Path $evidenceDirectory 'phase-01-final-gate.json'
$verdict = 'INCONCLUSIVE'
$phase02 = 'NOT_ALLOWED'
if (Test-Path -LiteralPath $gatePath) {
  $gateDocument = Get-Content -LiteralPath $gatePath -Raw | ConvertFrom-Json
  $verdict = [string] $gateDocument.verdict
  $phase02 = [string] $gateDocument.phase_02_gate
}

Write-Host ""
Write-Host "test groups     exit $groupsCode"
Write-Host "native          exit $nativeCode"
Write-Host "derivation      exit $deriveCode"
Write-Host "byte gate       exit $byteCode"
Write-Host "final gate      exit $gateCode"
Write-Host "byte gate (2)   exit $byteCode2"
Write-Host ""
if ($SkipPhase00Regression -or $SkipNativeMeasurement) {
  Write-Host "PHASE-01 = INCONCLUSIVE - a measurement stage was skipped by switch."
  exit 1
}
Write-Host "PHASE-01 = $verdict"
Write-Host "PHASE-02 GATE = $phase02"
if ($verdict -eq 'PASS' -and $phase02 -eq 'ALLOWED') { exit 0 }
exit 1
