#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-01 / P01-W2 — the single verification run.

.DESCRIPTION
  One command. It owns the whole P01-W2 sequence and writes the canonical
  P01-W2 evidence. Nothing in W2 is a closed result until this script has
  actually run and put its marker on the evidence.

  ORDER (dependency direction, not preference)
  --------------------------------------------
    1  P01-B1 prerequisite     read, never re-measured. ADR-018's condition.
    2  contracts               generate, typecheck, build, test
    3  package refresh         re-materialise @polaris/contracts inside runtime
                               as a packed package (ADR-005). No bridge install.
    4  package resolution gate the frozen graph check
    5  runtime                 typecheck, build, test — the Phase-00 regression
    6  P01-W2 test groups      ten groups, one evidence record each
    7  P01-W2 derivation       evidence\phase-01-ipc.json
    8  evidence byte gate      every canonical P01-W2 document

  WHY STEP 1 IS A READ
  --------------------
  P01-B1 measured the host toolchain in P01-W1 and is canonical. Re-measuring
  it here would produce a second, unproven measurement of a claim that already
  has one. It is read and its verdict is honoured; if it is not PASS the run
  stops before any measurement, because ADR-018's condition would not hold.

  WHAT THIS SCRIPT NEVER DOES
  ---------------------------
  It installs nothing beyond re-materialising the local contracts package that
  ADR-005 requires, downloads nothing, and touches no Git.

.PARAMETER RepositoryRoot
  Explicit repository root. When supplied it is used and validated, and no
  fallback is attempted: an explicit wrong answer must fail loudly.

.PARAMETER SkipRuntimeRegression
  Skip steps 3 to 5. For iterating on the contract surface only. A run with
  this switch can never produce a clean P01-W2 verdict, and says so.

.PARAMETER SelfCheck
  Resolve the root, prove the toolchain and read P01-B1, then stop. No
  measurement, no canonical evidence, and a clean self-check is not a result.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-w2-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SkipRuntimeRegression,
  [switch] $SelfCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:RunnerName = "polaris.p01.w2.conformance.runner"
$script:NativeMarker = "POLARIS_P01_W2_NATIVE_RUN"
$script:RootResolutionMethod = "UNRESOLVED"
$script:RepositoryMarkers = @(
  "contracts\package.json",
  "contracts\schemas\ipc-envelope.v1.schema.json",
  "contracts\registry\phase-01-ipc.registry.json",
  "runtime\package.json",
  "docs\phases\PHASE-01",
  "tools\p01-w2-conformance\p01-w2-groups.mjs"
)

<#
  التطبيع الوحيد المعتمد قبل أي .Count أو فهرسة. PowerShell يعدّ قيمة الإرجاع
  إلى المجرى: صفر عنصر يصير $null، وعنصر واحد يصير قيمة مفردة، و.Count على أيٍّ
  منهما تحت StrictMode ترمي. هذا هو العيب الذي أوقف أول تشغيل أصلي لـW5.
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

<#
  اكتشاف الجذر لا يعتمد على $PSScriptRoot وحده ولا يقع داخل param() الافتراضي.
  نفس عقد W4 و W5 و W6، ولا يُخفَّف هنا.
#>
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

  throw "BOOTSTRAP FAILED: no candidate path carries the POLARIS repository markers."
}

$RepositoryRoot = Resolve-RepositoryRoot -Explicit $RepositoryRoot

$script:NodeCommand = if (Get-Command node.exe -ErrorAction SilentlyContinue) { 'node.exe' } else { 'node' }
if (-not (Get-Command $script:NodeCommand -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: node is not on PATH." }
$script:NpmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
if (-not (Get-Command $script:NpmCommand -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: npm is not on PATH." }

Write-Host "runner     : $script:RunnerName"
Write-Host "root       : $RepositoryRoot  ($script:RootResolutionMethod)"
Write-Host "node       : $script:NodeCommand"
Write-Host "npm        : $script:NpmCommand"
Write-Host "powershell : $($PSVersionTable.PSVersion) $($PSVersionTable.PSEdition)"

# ── 1 الشرط المسبق: P01-B1 يُقرأ ولا يُعاد قياسه ────────────────────────────

$baselinePath = Join-Path $RepositoryRoot 'evidence\phase-01-baseline.json'
if (-not (Test-Path -LiteralPath $baselinePath)) {
  throw "P01-B1 PREREQUISITE MISSING: `"$baselinePath`" does not exist. P01-W2 cannot start."
}
$baseline = Get-Content -LiteralPath $baselinePath -Raw | ConvertFrom-Json
if ($baseline.claim_id -ne 'P01-B1' -or $baseline.verdict -ne 'PASS' -or $baseline.canonical -ne $true -or $baseline.native -ne $true) {
  throw "P01-B1 PREREQUISITE NOT SATISFIED: verdict=$($baseline.verdict) canonical=$($baseline.canonical) native=$($baseline.native). ADR-018's condition does not hold; P01-W2 stops."
}
Write-Host "--- P01-B1 prerequisite: PASS (run $($baseline.run_id), measured $($baseline.measured_at))"

if ($SelfCheck) {
  Write-Host "self-check complete. No measurement was performed and no canonical evidence was written."
  exit 0
}

Set-Location -LiteralPath $RepositoryRoot
$script:Steps = New-Object System.Collections.Generic.List[object]

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
  & $Body 2>&1 | Out-Host
  $code = $LASTEXITCODE
  [void] $script:Steps.Add([pscustomobject] @{ name = $Name; exit_code = $code; duration_ms = [int]((Get-Date) - $started).TotalMilliseconds })
  $script:LastSoftStepCode = $code
}

# ── 2 العقود ────────────────────────────────────────────────────────────────

Invoke-Step "contracts: verify" {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot "contracts")
  try { & $script:NpmCommand 'run' 'verify' } finally { Pop-Location }
}

# ── 3..5 الحزم وطبقة التشغيل ────────────────────────────────────────────────

if ($SkipRuntimeRegression) {
  Write-Host "--- runtime regression SKIPPED by switch. This run cannot produce a clean P01-W2 verdict."
}
else {
  <#
    إعادة تحقيق حزمة العقود المحلية داخل runtime. العيب الذي تغلقه هذه الخطوة
    حقيقي: `npm install` يقول "up to date" ولا يعيد حزم مجلد العقود، فتبني
    العقود نسخة جديدة بينما تظل runtime تقرأ القديمة. النتيجة أسوأ من فشل.
  #>
  Invoke-Step "packages: refresh the local contracts package inside runtime" {
    $installed = Join-Path $RepositoryRoot 'runtime'
    $installed = Join-Path $installed 'node_modules'
    $installed = Join-Path $installed '@polaris'
    $installed = Join-Path $installed 'contracts'
    Write-Host ("  destination : `"$installed`"")
    if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Recurse -Force }
    Push-Location -LiteralPath (Join-Path $RepositoryRoot "runtime")
    try { & $script:NpmCommand 'install' '--no-audit' '--no-fund' | Out-Host } finally { Pop-Location }
  }

  Invoke-Step "package resolution gate" {
    & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\package-resolution\check-package-graph.mjs') --root $RepositoryRoot | Out-Host
  }

  Invoke-Step "runtime: typecheck, build and test" {
    Push-Location -LiteralPath (Join-Path $RepositoryRoot "runtime")
    try { & $script:NpmCommand 'run' 'verify' } finally { Pop-Location }
  }
}

# ── 6 العلامة، ثم المجموعات ─────────────────────────────────────────────────

# من هنا فقط يبدأ القياس المملوك، ومن هنا فقط يجوز أن يُكتب دليل W2 قانوني.
if (-not $SkipRuntimeRegression) {
  Set-Item -Path "Env:$script:NativeMarker" -Value '1'
}

Invoke-SoftStep "P01-W2 test groups" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-w2-conformance\p01-w2-test-groups.mjs') --root $RepositoryRoot
}
$groupsCode = $script:LastSoftStepCode

# ── 7 الاشتقاق ──────────────────────────────────────────────────────────────

Invoke-SoftStep "P01-W2 derivation" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-w2-conformance\p01-w2-ipc.mjs') --root $RepositoryRoot
}
$derivationCode = $script:LastSoftStepCode

# ── 8 بوابة البايتات ────────────────────────────────────────────────────────

Invoke-SoftStep "P01-W2 evidence byte gate" {
  & $script:NodeCommand (Join-Path $RepositoryRoot 'tools\p01-w2-conformance\p01-w2-evidence-bytes.mjs') --root $RepositoryRoot
}
$byteGateCode = $script:LastSoftStepCode

if (-not $SkipRuntimeRegression) {
  Remove-Item -Path "Env:$script:NativeMarker" -ErrorAction SilentlyContinue
}

# ── الحكم ───────────────────────────────────────────────────────────────────

$verdictPath = Join-Path $RepositoryRoot 'evidence\phase-01-ipc.json'
$verdict = 'INCONCLUSIVE'
if (Test-Path -LiteralPath $verdictPath) {
  $document = Get-Content -LiteralPath $verdictPath -Raw | ConvertFrom-Json
  $verdict = [string] $document.verdict
}

Write-Host ""
Write-Host "P01-W2 test groups   exit $groupsCode"
Write-Host "P01-W2 derivation    exit $derivationCode"
Write-Host "P01-W2 byte gate     exit $byteGateCode"
Write-Host ""
if ($SkipRuntimeRegression) {
  Write-Host "P01-W2 = INCONCLUSIVE - the runtime regression was skipped by switch."
  exit 1
}
Write-Host "P01-W2 = $verdict"
if ($verdict -eq 'PASS' -and $groupsCode -eq 0 -and $derivationCode -eq 0 -and $byteGateCode -eq 0) {
  Write-Host "P01-W3 GATE = ALLOWED"
  exit 0
}
Write-Host "P01-W3 GATE = NOT_ALLOWED"
exit 1
