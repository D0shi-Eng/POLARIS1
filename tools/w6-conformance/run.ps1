#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-00 / W6 - the single verification run.

.DESCRIPTION
  One command. It owns the whole sequence and writes the W6 evidence and the
  Phase-00 final gate. Nothing in W6 claims a Windows result until this script
  has actually run on Windows.

  ORDER (dependency direction, not preference)
  --------------------------------------------
    1  W5 verification run          the FROZEN W5 runner, unmodified. It owns
                                    contracts, the package refresh, the package
                                    graph, typecheck + build, the W5 groups,
                                    the W5-P01 native probe, the W4 native
                                    regression and the full runtime suite.
    2  W6 test groups               the integrated groups, one record each
    3  W6 dogfood                   scenario verdicts D01..D12, derived
    4  W6 skip inventory            every skip in the suite, classified
    5  W6 repeatability             the scenario twice, from clean workspaces
    6  cleanup verification         survivors, profiles, workspaces
    7  evidence byte gate           every canonical document, discovered by pattern
    8  W6 run record                evidence\w6-run.json
    9  Phase-00 final gate          evidence\phase-00-final-gate.json

  WHY W6 DELEGATES STEP 1
  -----------------------
  The W4 and W5 regressions must be the frozen instruments, not a W6 copy of
  them. Re-implementing that chain here would produce a second, unproven
  measurement of claims that already have one. So W6 runs the W5 runner as it
  is, reads its canonical evidence, and adds only what W6 owns.

  BOOTSTRAP CONTRACT
  ------------------
  Repository-root discovery never depends on $PSScriptRoot alone and never
  inside a param() default. Same contract as W4 and W5; it is not relaxed here.

.PARAMETER RepositoryRoot
  Explicit repository root. When supplied it is used and validated, and no
  fallback is attempted: an explicit wrong answer must fail loudly.

.PARAMETER SkipW5Regression
  Skip step 1. For iterating on W6 only. A run with this switch can never
  produce a clean W6 verdict, and says so.

.PARAMETER SelfCheck
  Resolve the root, load the contracts, prove the toolchain, then stop. No
  measurement, no canonical evidence, and a clean self-check is not a W6 result.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w6-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SkipW5Regression,
  [switch] $SelfCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:RunnerName = "polaris.w6.conformance.runner"
$script:BootstrapErrorCode = "W6_RUNNER_BOOTSTRAP_DEFECT"
$script:RootResolutionMethod = "UNRESOLVED"
$script:CanonicalRunStarted = $false
$script:LastSoftStepCode = 0
$script:RepositoryMarkers = @(
  "contracts\package.json",
  "runtime\package.json",
  "docs\phases\PHASE-00",
  "tools\w4-windows-conformance\run.ps1",
  "tools\w5-conformance\run.ps1",
  "tools\w6-conformance\w6-test-groups.mjs"
)

<#
  التطبيع الوحيد المعتمد قبل أي .Count أو فهرسة.

  PowerShell يعدّ قيمة الإرجاع إلى المجرى: صفر عنصر يصير $null، وعنصر واحد يصير
  قيمة مفردة، و.Count على أيٍّ منهما تحت StrictMode ترمي. هذا هو العيب الذي
  أوقف أول تشغيل أصلي لـW5 في إقلاعه، ولا يُعاد إنتاجه هنا.
#>
function ConvertTo-CountableArray {
  param([Parameter(Mandatory = $false)] $Value)
  if ($null -eq $Value) { return ,@() }
  return ,@($Value)
}

function Get-SafeVariableValue {
  param([Parameter(Mandatory = $true)][string] $Name)
  $variable = Get-Variable -Name $Name -ErrorAction SilentlyContinue
  if ($null -eq $variable) { return $null }
  return $variable.Value
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

function Get-VersionTableValue {
  param([Parameter(Mandatory = $true)][string] $Name, [string] $Fallback = "")
  if ($PSVersionTable.ContainsKey($Name)) {
    $value = $PSVersionTable[$Name]
    if ($null -ne $value) { return [string] $value }
  }
  return $Fallback
}

function Get-JsonProperty {
  param($Object, [Parameter(Mandatory = $true)][string] $Name)
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $null }
  return $property.Value
}

function Get-MissingMarkers {
  param([Parameter(Mandatory = $true)][string] $Path)
  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($marker in $script:RepositoryMarkers) {
    if (-not (Test-Path -LiteralPath (Join-MarkerPath -Root $Path -Marker $marker))) { [void] $missing.Add($marker) }
  }
  return ,$missing.ToArray()
}

function Resolve-RepositoryRoot {
  param([string] $Explicit)

  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    $missing = ConvertTo-CountableArray (Get-MissingMarkers -Path $Explicit)
    if ($missing.Count -gt 0) {
      throw "BOOTSTRAP FAILED: -RepositoryRoot '$Explicit' is missing $($missing -join ', ')"
    }
    $script:RootResolutionMethod = "EXPLICIT_PARAMETER"
    return (Get-Item -LiteralPath $Explicit).FullName
  }

  $candidates = New-Object System.Collections.Generic.List[object]
  $scriptRoot = Get-SafeVariableValue -Name 'PSScriptRoot'
  if (-not [string]::IsNullOrWhiteSpace($scriptRoot)) {
    [void] $candidates.Add([pscustomobject] @{ method = "PSSCRIPTROOT"; path = (Join-Path $scriptRoot '..\..') })
  }
  $invocation = Get-SafeVariableValue -Name 'PSCommandPath'
  if (-not [string]::IsNullOrWhiteSpace($invocation)) {
    [void] $candidates.Add([pscustomobject] @{ method = "PSCOMMANDPATH"; path = (Join-Path (Split-Path -Parent $invocation) '..\..') })
  }
  [void] $candidates.Add([pscustomobject] @{ method = "CURRENT_DIRECTORY"; path = (Get-Location).Path })
  [void] $candidates.Add([pscustomobject] @{ method = "DEFAULT_ROOT"; path = $script:DefaultRepositoryRoot })

  foreach ($candidate in $candidates) {
    try { $resolved = (Resolve-Path -LiteralPath $candidate.path -ErrorAction Stop).Path } catch { continue }
    $missing = ConvertTo-CountableArray (Get-MissingMarkers -Path $resolved)
    if ($missing.Count -eq 0) {
      $script:RootResolutionMethod = $candidate.method
      return (Get-Item -LiteralPath $resolved).FullName
    }
  }
  throw "BOOTSTRAP FAILED: no candidate directory looks like the POLARIS repository. Pass -RepositoryRoot explicitly."
}

function New-BootstrapRecord {
  param([string] $Root)
  $nodeVersion = ""
  try { if (Get-Command node -ErrorAction SilentlyContinue) { $nodeVersion = [string] (& node --version) } } catch { $nodeVersion = "" }
  return @{
    runner                 = $script:RunnerName
    canonical              = $false
    non_canonical_note     = "Bootstrap diagnostics only. This file never carries a W6 PASS or FAIL: it records whether the runner could start."
    repository_root        = $Root
    root_resolution_method = $script:RootResolutionMethod
    powershell_version     = $PSVersionTable.PSVersion.ToString()
    powershell_edition     = (Get-VersionTableValue -Name 'PSEdition' -Fallback 'Desktop')
    strict_mode            = "Latest"
    platform               = (Get-VersionTableValue -Name 'Platform' -Fallback 'Win32NT')
    os                     = (Get-VersionTableValue -Name 'OS' -Fallback '')
    node_version           = $nodeVersion
    self_check             = [bool] $SelfCheck
    canonical_run_started  = $script:CanonicalRunStarted
  }
}

function Write-BootstrapRecord {
  param([Parameter(Mandatory = $true)][hashtable] $Record, [string] $Root, [string] $Name = 'w6-runner-bootstrap.json')
  $target = $null
  if (-not [string]::IsNullOrWhiteSpace($Root)) {
    $directory = Join-Path $Root 'evidence'
    try {
      New-Item -ItemType Directory -Force -Path $directory | Out-Null
      $target = Join-Path $directory $Name
    } catch { $target = $null }
  }
  if ($null -eq $target) { $target = Join-Path ([System.IO.Path]::GetTempPath()) ('polaris-w6-' + $Name) }
  try {
    if (Get-Command Write-PolarisJsonFile -ErrorAction SilentlyContinue) {
      [void] (Write-PolarisJsonFile -Path $target -InputObject ([pscustomobject] $Record) -Depth 6)
    } else {
      # نفس عقد البايتات مكتوبًا مباشرةً: هذا السجل يجب أن يُكتب حتى حين يفشل
      # تحميل وحدة العقد نفسها، وذلك أحد أعطاب الإقلاع التي يسجّلها.
      $fallbackJson = ([pscustomobject] $Record | ConvertTo-Json -Depth 6)
      $fallbackText = ([string] ($fallbackJson -join "`n")).Replace("`r`n", "`n").Replace("`r", "`n")
      if (-not $fallbackText.EndsWith("`n")) { $fallbackText = $fallbackText + "`n" }
      [System.IO.File]::WriteAllText($target, $fallbackText, (New-Object System.Text.UTF8Encoding($false)))
    }
    Write-Host "bootstrap record : $target"
  } catch {
    Write-Host "bootstrap record could not be written: $($_.Exception.Message)" -ForegroundColor Yellow
  }
  return $target
}

# ── الإقلاع ─────────────────────────────────────────────────────────────────

$script:BootstrapStarted = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
$script:BootstrapStage = "ROOT_RESOLUTION"

try {
  $RepositoryRoot = Resolve-RepositoryRoot -Explicit $RepositoryRoot

  $script:BootstrapStage = "JSON_EVIDENCE_MODULE"
  $script:JsonEvidenceModule = Join-MarkerPath -Root $RepositoryRoot -Marker 'tools\evidence-contract\json-evidence.ps1'
  if (-not (Test-Path -LiteralPath $script:JsonEvidenceModule)) {
    throw "BOOTSTRAP FAILED: the JSON evidence byte contract module is missing at '$($script:JsonEvidenceModule)'."
  }
  . $script:JsonEvidenceModule

  $script:BootstrapStage = "TOOLCHAIN_DISCOVERY"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: node is not on PATH." }
  $script:PowerShellCommand = ""
  foreach ($candidate in @('powershell', 'pwsh')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) { $script:PowerShellCommand = $candidate; break }
  }
  if ($script:PowerShellCommand.Length -eq 0) {
    throw "BOOTSTRAP FAILED: neither powershell nor pwsh is on PATH; the W5 regression could not be invoked."
  }

  $script:BootstrapStage = "FROZEN_RUNNER_PRESENCE"
  $script:W5Runner = Join-MarkerPath -Root $RepositoryRoot -Marker 'tools\w5-conformance\run.ps1'
  if (-not (Test-Path -LiteralPath $script:W5Runner)) {
    throw "BOOTSTRAP FAILED: the frozen W5 runner is missing at '$($script:W5Runner)'."
  }

  $script:BootstrapStage = "COLLECTION_NORMALISATION_SELFTEST"
  if ((ConvertTo-CountableArray $null).Count -ne 0) { throw "BOOTSTRAP FAILED: null normalisation is broken." }
  if ((ConvertTo-CountableArray "one").Count -ne 1) { throw "BOOTSTRAP FAILED: single-element normalisation is broken." }
  if ((ConvertTo-CountableArray @("a", "b")).Count -ne 2) { throw "BOOTSTRAP FAILED: multi-element normalisation is broken." }

  $script:BootstrapStage = "COMPLETE"
}
catch {
  $failure = $_
  $record = New-BootstrapRecord -Root $RepositoryRoot
  $record["bootstrap_started"]   = $script:BootstrapStarted
  $record["bootstrap_completed"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
  $record["classification"]      = "BLOCKED"
  $record["failure_stage"]       = $script:BootstrapStage
  $record["error_code"]          = $script:BootstrapErrorCode
  $record["error_id"]            = [string] $failure.FullyQualifiedErrorId
  $record["error_message"]       = [string] $failure.Exception.Message
  $record["script_name"]         = $(if ($null -ne $failure.InvocationInfo) { [string] $failure.InvocationInfo.ScriptName } else { "" })
  $record["script_line"]         = $(if ($null -ne $failure.InvocationInfo) { [int] $failure.InvocationInfo.ScriptLineNumber } else { 0 })
  $record["script_statement"]    = $(if ($null -ne $failure.InvocationInfo) { ([string] $failure.InvocationInfo.Line).Trim() } else { "" })
  $record["script_stack"]        = [string] $failure.ScriptStackTrace
  $record["bootstrap_ok"]        = $false
  $record["canonical_measurement_started"] = $script:CanonicalRunStarted

  Write-Host ""
  Write-Host "POLARIS Phase-00 / W6 - BOOTSTRAP FAILED" -ForegroundColor Red
  Write-Host "classification : BLOCKED"
  Write-Host "error_code     : $($script:BootstrapErrorCode)"
  Write-Host "failure_stage  : $($script:BootstrapStage)"
  Write-Host "message        : $($record["error_message"])"
  Write-Host "at             : $($record["script_name"]):$($record["script_line"])"
  Write-Host ""
  Write-Host "No measurement was attempted and no canonical W6 evidence was written."
  Write-Host "This is a runner defect, not a W6 result."
  [void] (Write-BootstrapRecord -Record $record -Root $RepositoryRoot)
  exit 2
}

$script:BootstrapCompleted = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)

Write-Host "POLARIS Phase-00 / W6 - verification run"
Write-Host "repository : $RepositoryRoot"
Write-Host "resolved by: $($script:RootResolutionMethod)"
Write-Host "node       : $(node --version)"
Write-Host "powershell : $($PSVersionTable.PSVersion.ToString()) (frozen runners via '$($script:PowerShellCommand)')"
Write-Host ""

if ($SelfCheck) {
  $record = New-BootstrapRecord -Root $RepositoryRoot
  $record["bootstrap_started"]   = $script:BootstrapStarted
  $record["bootstrap_completed"] = $script:BootstrapCompleted
  $record["classification"]      = "NOT_TESTED"
  $record["bootstrap_ok"]        = $true
  $record["failure_stage"]       = ""
  $record["error_code"]          = ""
  $record["error_message"]       = ""
  $record["canonical_measurement_started"] = $false
  $record["interpretation"]      = "Bootstrap only. No group ran, no scenario was derived, and no security claim follows. A clean self-check is not a W6 result."
  [void] (Write-BootstrapRecord -Record $record -Root $RepositoryRoot)
  Write-Host "SELFCHECK RESULT: BOOTSTRAP_OK"
  Write-Host "stopped before any measurement. This is not a W6 verdict."
  exit 0
}

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null
Set-Location -LiteralPath $RepositoryRoot

$script:Steps = New-Object System.Collections.Generic.List[object]

<#
  خطوة تُسجَّل ولا توقف التشغيل. كل خطوات W6 ناعمة عمدًا: تقرير مفقود أسوأ من
  تقرير يقول «فشل»، والحكم يُحسب من الأدلة في النهاية لا من أول انقطاع.
#>
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

function Read-JsonOrNull {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  try { return (Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json) } catch { return $null }
}

<#
  ختمٌ زمني يُقرأ أو يُعلن تعذُّره صراحةً. تحويلٌ يفشل بصمت يجعل الربط الزمني
  يبدو محسوبًا وهو غير محسوب.
#>
function ConvertTo-UtcTime {
  param([string] $Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  try {
    return [datetime]::Parse(
      $Value,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [System.Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  } catch { return $null }
}

# ── 1 انحدار W5 و W4 عبر المشغّل المجمَّد ───────────────────────────────────

$w5Code = $null
if ($SkipW5Regression) {
  Write-Host "--- W5 verification run: SKIPPED by switch. This run cannot produce a clean W6 verdict."
} else {
  Invoke-SoftStep "W5 verification run (the frozen W5 runner, unmodified)" {
    & $script:PowerShellCommand -NoProfile -ExecutionPolicy Bypass -File $script:W5Runner -RepositoryRoot $RepositoryRoot
  }
  $w5Code = $script:LastSoftStepCode
}

# العلامة التي تجعل دليل W6 ملكًا لهذا المشغّل وحده.
$script:CanonicalRunStarted = $true
$env:POLARIS_W6_NATIVE_RUN = '1'

# ── 2..5 قياسات W6 ──────────────────────────────────────────────────────────

Invoke-SoftStep "W6 test groups" {
  & node (Join-Path $RepositoryRoot 'tools\w6-conformance\w6-test-groups.mjs') --root $RepositoryRoot
}
$groupsCode = $script:LastSoftStepCode

Invoke-SoftStep "W6 dogfood scenarios (derived from measurements that already ran)" {
  & node (Join-Path $RepositoryRoot 'tools\w6-conformance\w6-dogfood.mjs') --root $RepositoryRoot
}
$dogfoodCode = $script:LastSoftStepCode

Invoke-SoftStep "W6 skip inventory (the whole suite, every skip classified)" {
  & node (Join-Path $RepositoryRoot 'tools\w6-conformance\w6-skip-inventory.mjs') --root $RepositoryRoot
}
$skipCode = $script:LastSoftStepCode

Invoke-SoftStep "W6 repeatability (the scenario twice, from clean workspaces)" {
  & node (Join-Path $RepositoryRoot 'tools\w6-conformance\w6-repeatability.mjs') --root $RepositoryRoot
}
$repeatCode = $script:LastSoftStepCode

# ── 6 التحقق من التنظيف ─────────────────────────────────────────────────────

$survivors = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*host-main.js*' -or $_.CommandLine -like '*w5-hold-main.js*' })
$leftoverProfiles = @()
try {
  $profileRoot = Join-Path $env:LOCALAPPDATA 'Packages'
  if (Test-Path -LiteralPath $profileRoot) {
    $leftoverProfiles = @(Get-ChildItem -LiteralPath $profileRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'polaris-w4-exec*' -or $_.Name -like 'polaris-w5-*' } | Select-Object -ExpandProperty Name)
  }
} catch { $leftoverProfiles = @() }
$leftoverWorkspaces = @()
try {
  $leftoverWorkspaces = @(Get-ChildItem -LiteralPath ([System.IO.Path]::GetTempPath()) -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'polaris-w4-*' -or $_.Name -like 'polaris-w5-*' } | Select-Object -ExpandProperty Name)
} catch { $leftoverWorkspaces = @() }

$survivors          = ConvertTo-CountableArray $survivors
$leftoverProfiles   = ConvertTo-CountableArray $leftoverProfiles
$leftoverWorkspaces = ConvertTo-CountableArray $leftoverWorkspaces
$cleanupClean = ($survivors.Count -eq 0) -and ($leftoverProfiles.Count -eq 0) -and ($leftoverWorkspaces.Count -eq 0)

$cleanupRecord = [ordered] @{
  schema_version                 = '1.0.0'
  tool                           = 'polaris.w6.cleanup'
  claim_id                       = 'W6-CLEANUP'
  description                    = 'after the whole W6 run no owned execution survives, no AppContainer profile is left behind, and no temporary workspace remains'
  platform                       = 'win32'
  native                         = $true
  measurement_started            = $script:BootstrapStarted
  measurement_completed          = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
  evidence_complete              = $true
  clean                          = $cleanupClean
  surviving_execution_hosts      = @($survivors | ForEach-Object { $_.ProcessId })
  leftover_appcontainer_profiles = @($leftoverProfiles)
  leftover_workspaces            = @($leftoverWorkspaces)
  verdict                        = $(if ($cleanupClean) { 'PASS' } else { 'FAIL' })
  reason_code                    = $(if ($cleanupClean) { '' } else { 'CLEANUP_NOT_CLEAN' })
  evidence_reference             = 'evidence\w6-cleanup.json'
}
[void] (Write-PolarisJsonFile -Path (Join-Path $evidenceDirectory 'w6-cleanup.json') -InputObject $cleanupRecord -Depth 6)

# ── 7 بوابة بايتات الدليل ───────────────────────────────────────────────────

Invoke-SoftStep "W6 evidence byte gate (every canonical document, discovered by pattern)" {
  & node (Join-Path $RepositoryRoot 'tools\w6-conformance\w6-evidence-bytes.mjs') --root $RepositoryRoot
}
$bytesCode = $script:LastSoftStepCode

# ── 8 سجل التشغيل والحكم ────────────────────────────────────────────────────

$w5Run     = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w5-run.json')
$w6Groups  = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w6-test-groups.json')
$w6Dogfood = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w6-dogfood.json')
$w6Skips   = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w6-skip-classification.json')
$w6Bytes   = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w6-evidence-bytes.json')
$w6Repeat  = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w6-repeatability.json')

$groupsSummary  = Get-JsonProperty -Object $w6Groups  -Name 'summary'
$dogfoodSummary = Get-JsonProperty -Object $w6Dogfood -Name 'summary'

$blockers = New-Object System.Collections.Generic.List[string]
if ($SkipW5Regression) { [void] $blockers.Add("W5_REGRESSION_SKIPPED") }
elseif ($w5Code -ne 0) { [void] $blockers.Add("W5_REGRESSION_NOT_CLEAN") }
if ($null -eq $w5Run) { [void] $blockers.Add("W5_RUN_EVIDENCE_MISSING") }
elseif ([string] (Get-JsonProperty -Object $w5Run -Name 'verdict') -ne 'PASS') { [void] $blockers.Add("W5_VERDICT_NOT_PASS") }

if ($null -eq $groupsSummary) { [void] $blockers.Add("W6_TEST_GROUP_EVIDENCE_MISSING") }
elseif (([int] (Get-JsonProperty -Object $groupsSummary -Name 'failed') +
         [int] (Get-JsonProperty -Object $groupsSummary -Name 'blocked') +
         [int] (Get-JsonProperty -Object $groupsSummary -Name 'inconclusive') +
         [int] (Get-JsonProperty -Object $groupsSummary -Name 'not_tested')) -gt 0) {
  [void] $blockers.Add("W6_TEST_GROUP_NOT_CLEAN")
}
if ($groupsCode -ne 0 -and $blockers.Count -eq 0) { [void] $blockers.Add("W6_TEST_GROUP_EXIT_CODE") }

if ($null -eq $dogfoodSummary) { [void] $blockers.Add("W6_DOGFOOD_EVIDENCE_MISSING") }
elseif (([int] (Get-JsonProperty -Object $dogfoodSummary -Name 'failed') +
         [int] (Get-JsonProperty -Object $dogfoodSummary -Name 'blocked') +
         [int] (Get-JsonProperty -Object $dogfoodSummary -Name 'inconclusive') +
         [int] (Get-JsonProperty -Object $dogfoodSummary -Name 'not_tested')) -gt 0) {
  [void] $blockers.Add("W6_SCENARIO_NOT_CLEAN")
}
if ($dogfoodCode -ne 0 -and -not ($blockers -contains "W6_SCENARIO_NOT_CLEAN")) { [void] $blockers.Add("W6_DOGFOOD_EXIT_CODE") }

if ($null -eq $w6Skips) { [void] $blockers.Add("W6_SKIP_EVIDENCE_MISSING") }
elseif ([string] (Get-JsonProperty -Object $w6Skips -Name 'verdict') -ne 'PASS') {
  [void] $blockers.Add("W6_SKIP_" + [string] (Get-JsonProperty -Object $w6Skips -Name 'reason_code'))
}
if ($skipCode -ne 0 -and $null -ne $w6Skips -and [string] (Get-JsonProperty -Object $w6Skips -Name 'verdict') -eq 'PASS') {
  [void] $blockers.Add("W6_SKIP_INVENTORY_EXIT_CODE")
}

if ($null -eq $w6Repeat) { [void] $blockers.Add("W6_REPEATABILITY_EVIDENCE_MISSING") }
elseif ([string] (Get-JsonProperty -Object $w6Repeat -Name 'verdict') -ne 'PASS') { [void] $blockers.Add("W6_REPEATABILITY_NOT_CLEAN") }
if ($repeatCode -ne 0 -and $null -ne $w6Repeat -and [string] (Get-JsonProperty -Object $w6Repeat -Name 'verdict') -eq 'PASS') {
  [void] $blockers.Add("W6_REPEATABILITY_EXIT_CODE")
}

if (-not $cleanupClean) { [void] $blockers.Add("CLEANUP_NOT_CLEAN") }

if ($null -eq $w6Bytes) { [void] $blockers.Add("W6_EVIDENCE_BYTES_MISSING") }
elseif ([string] (Get-JsonProperty -Object $w6Bytes -Name 'verdict') -ne 'PASS') { [void] $blockers.Add("W6_EVIDENCE_ENCODING_DEFECT") }
if ($bytesCode -ne 0 -and $null -ne $w6Bytes -and [string] (Get-JsonProperty -Object $w6Bytes -Name 'verdict') -eq 'PASS') {
  [void] $blockers.Add("W6_EVIDENCE_BYTES_EXIT_CODE")
}

$verdict = if ($blockers.Count -eq 0) { 'PASS' } else { 'NOT_CLEAN' }

<#
  ربط سجل W5 بهذا التشغيل.

  خطر حقيقي لا نظري: خطوة "contracts: verify" في مشغّل W5 خطوة صلبة — تفشل
  فترمي فيتوقف المشغّل قبل أن يكتب evidence\w5-run.json، فيبقى على القرص سجلّ
  التشغيل السابق الناجح. قارئٌ لا يربط الوثيقة بنافذة هذا التشغيل يقرأ نجاحًا
  قديمًا ويكتبه حكمًا جديدًا. النافذة تُقاس من حقول موجودة أصلًا، فلا تحتاج
  قياسًا جديدًا.
#>
$runRanAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
$w5RunRanAt = if ($null -ne $w5Run) { [string] (Get-JsonProperty -Object $w5Run -Name 'ran_at') } else { "" }
$w5WrittenAt  = ConvertTo-UtcTime -Value $w5RunRanAt
$windowStart  = ConvertTo-UtcTime -Value $script:BootstrapStarted
$windowEnd    = ConvertTo-UtcTime -Value $runRanAt
$w5EvidenceBound = (
  ($null -ne $w5WrittenAt) -and ($null -ne $windowStart) -and ($null -ne $windowEnd) -and
  ($w5WrittenAt -ge $windowStart) -and ($w5WrittenAt -le $windowEnd)
)
$w5Delegated = (-not [bool] $SkipW5Regression)

$runRecord = [ordered] @{
  harness         = $script:RunnerName
  harness_version = '1.0.0'
  ran_at          = $runRanAt
  repository_root = $RepositoryRoot
  platform        = 'win32'
  native          = $true
  powershell      = $PSVersionTable.PSVersion.ToString()
  node            = (node --version)
  steps           = $script:Steps
  bootstrap = [ordered] @{
    root_resolution_method = $script:RootResolutionMethod
    bootstrap_started      = $script:BootstrapStarted
    bootstrap_completed    = $script:BootstrapCompleted
    bootstrap_ok           = $true
    canonical_run_started  = $script:CanonicalRunStarted
    record                 = 'evidence\w6-runner-bootstrap.json'
  }
  w5_regression = [ordered] @{
    skipped        = [bool] $SkipW5Regression
    exit_code      = $w5Code
    runner         = 'tools\w5-conformance\run.ps1'
    frozen         = $true
    verdict        = if ($null -ne $w5Run) { Get-JsonProperty -Object $w5Run -Name 'verdict' } else { $null }
    run_reference  = 'evidence\w5-run.json'
    interpretation = "W6 does not re-implement the W4 or W5 chain. It runs the frozen W5 runner, which itself runs the frozen W4 runner, and reads their canonical evidence."
  }
  <#
    خريطة القياس المُفوَّض.

    العيب الذي تغلقه: بوابة Phase-00 كانت تقرأ "contracts: verify" و
    runtime_test_exit_code من هذا الملف. لم يكونا فيه — W6 يُفوّضهما إلى مشغّل
    W5 المجمَّد — ولم يكن في الملف ما يقول أين هما. فصار الغياب عند القارئ
    "غير مُختبَر" مرةً و"فاشل" مرة.

    والخريطة تسمّي الموضع ولا تنسخ الرقم: نسخةٌ ثانية للقياس نفسه هي بالضبط
    الطريق إلى مصدرَي حقيقة ينحرفان. لا أرقام هنا ولا أحكام؛ القارئ يذهب إلى
    المصدر المُسمّى ويقرأه هناك، وevidence_bound يقول هل تلك الوثيقة وثيقةُ
    هذا التشغيل أم بقيّة تشغيل سابق.
  #>
  delegated_measurements = [ordered] @{
    interpretation = "W6 measures neither the contracts nor the runtime suite: the frozen W5 runner owns both. These entries name where each measurement lives and tie that document to this run. They carry no numbers and no verdicts - the reader goes to the named source and reads it there."
    run_window     = [ordered] @{
      started = $script:BootstrapStarted
      ended   = $runRanAt
    }
    contracts_verify = [ordered] @{
      claim_id             = 'PH00-W2'
      owner                = 'tools\w5-conformance\run.ps1'
      source_evidence      = 'evidence\w5-run.json'
      source_locator       = "steps[name='contracts: verify'].exit_code"
      measured_in_this_run = $w5Delegated
      source_ran_at        = $w5RunRanAt
      evidence_bound       = $w5EvidenceBound
    }
    runtime_suite = [ordered] @{
      claim_id               = 'PH00-W3'
      owner                  = 'tools\w5-conformance\run.ps1'
      source_evidence        = 'evidence\w5-run.json'
      source_locator         = 'runtime_test_exit_code'
      final_step             = 'runtime: final test'
      corroborating_evidence = 'evidence\w6-skip-classification.json'
      corroborating_locator  = 'suite_summary'
      measured_in_this_run   = $w5Delegated
      source_ran_at          = $w5RunRanAt
      evidence_bound         = $w5EvidenceBound
    }
  }
  w6_test_groups  = $groupsSummary
  w6_dogfood      = $dogfoodSummary
  w6_skips = [ordered] @{
    verdict     = if ($null -ne $w6Skips) { Get-JsonProperty -Object $w6Skips -Name 'verdict' } else { $null }
    total       = if ($null -ne $w6Skips) { Get-JsonProperty -Object $w6Skips -Name 'skipped_total' } else { $null }
    by_class    = if ($null -ne $w6Skips) { Get-JsonProperty -Object $w6Skips -Name 'by_class' } else { $null }
    reference   = 'evidence\w6-skip-classification.json'
  }
  w6_repeatability = [ordered] @{
    verdict   = if ($null -ne $w6Repeat) { Get-JsonProperty -Object $w6Repeat -Name 'verdict' } else { $null }
    reference = 'evidence\w6-repeatability.json'
  }
  evidence_bytes = [ordered] @{
    contract  = 'UTF-8 without BOM, LF newlines, valid JSON document, exactly one trailing LF'
    verdict   = if ($null -ne $w6Bytes) { Get-JsonProperty -Object $w6Bytes -Name 'verdict' } else { $null }
    checked   = if ($null -ne $w6Bytes) { Get-JsonProperty -Object $w6Bytes -Name 'checked' } else { $null }
    reference = 'evidence\w6-evidence-bytes.json'
    note      = "w6-run.json and w6-evidence-bytes.json are written through the byte contract's own writers, so they satisfy it by construction rather than by this gate."
  }
  cleanup = [ordered] @{
    clean                          = $cleanupClean
    surviving_execution_hosts      = @($survivors | ForEach-Object { $_.ProcessId })
    leftover_appcontainer_profiles = @($leftoverProfiles)
    leftover_workspaces            = @($leftoverWorkspaces)
    reference                      = 'evidence\w6-cleanup.json'
  }
  verdict      = $verdict
  reason_codes = @($blockers)
}
[void] (Write-PolarisJsonFile -Path (Join-Path $evidenceDirectory 'w6-run.json') -InputObject $runRecord -Depth 8)


# ── 9 بوابة Phase-00 ────────────────────────────────────────────────────────

Write-Host ""
Write-Host "--- Phase-00 final gate"
& node (Join-Path $RepositoryRoot 'tools\w6-conformance\phase-00-gate.mjs') --root $RepositoryRoot | Out-Host
$gateCode = $LASTEXITCODE

# العلامة تُرفع بعد البوابة لا قبلها: البوابة النهائية تكتب باسم قانوني فقط حين
# ترى علامة المشغّل. رفعها قبلها يجعل حكم Phase-00 يُكتب باسم adhoc في تشغيل
# أصلي نظيف — أي أن التشغيل يقيس ولا يُغلق.
Remove-Item Env:\POLARIS_W6_NATIVE_RUN -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "evidence:"
foreach ($file in @(
  'w6-run.json', 'w6-test-groups.json', 'w6-dogfood.json', 'w6-skip-classification.json',
  'w6-repeatability.json', 'w6-evidence-bytes.json', 'w6-cleanup.json', 'phase-00-final-gate.json',
  'w5-run.json', 'w4-windows-run.json')) {
  $path = Join-Path $evidenceDirectory $file
  if (Test-Path -LiteralPath $path) { Write-Host "  $path" }
}

Write-Host ""
if ($verdict -eq 'PASS') {
  Write-Host "W6 verification run: CLEAN" -ForegroundColor Green
} else {
  Write-Host "W6 verification run: NOT CLEAN" -ForegroundColor Red
  foreach ($blocker in $blockers) { Write-Host "  $blocker" }
}
Write-Host "read evidence\w6-run.json and evidence\phase-00-final-gate.json before promoting anything."
Write-Host "BLOCKED, INCONCLUSIVE and NOT_TESTED are never PASS."

if ($verdict -ne 'PASS') { exit 1 }
exit $gateCode
