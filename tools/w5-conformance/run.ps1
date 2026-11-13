#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-00 / W5 - the single verification run.

.DESCRIPTION
  One command. It owns the whole sequence, in dependency order, and writes the
  W5 evidence. Nothing in W5 claims a Windows result until this script has
  actually run on Windows.

  ORDER (dependency direction, not preference)
  --------------------------------------------
    1  contracts: verify
    2  packages: refresh the local contracts package inside runtime
    3  package resolution gate
    4  runtime: typecheck + build
    5  W5 adapter: static check
    6  W5 adapter: build                (soft - a failure BLOCKS W5-P01, it does
                                         not take the rest of the run down)
    7  W5 test groups                   (audit, approval, panic stop host
                                         semantics, completion proof, scenarios,
                                         structural invariants)
    8  W5 native probe                  (panic stop on a live confined child)
    9  W4 native regression             (the frozen W4 runner, unmodified)
   10  runtime: final test              (the whole suite, after the probes)
   11  cleanup verification             (survivors and leftover profiles)
   12  W5 verdict

  BOOTSTRAP CONTRACT
  ------------------
  Repository-root discovery never depends on $PSScriptRoot alone, and never
  inside a param() default - that fails during parameter binding, before the
  body runs, and some hosts continue with an EMPTY root and report failures
  that were never tested. This is the same defect W4 closed; it is not
  reintroduced here.

.PARAMETER RepositoryRoot
  Explicit repository root. When supplied it is used and validated, and no
  fallback is attempted: an explicit wrong answer must fail loudly.

.PARAMETER SkipW4Regression
  Skip step 9. For iterating on W5 only. A run with this switch can never
  produce a clean W5 verdict, and says so.

.PARAMETER PackageRefreshPreflight
  Prove the package-refresh path contract and the deletion destination, then
  stop. Nothing is removed, nothing is installed, no adapter is compiled, no
  probe runs, and no canonical W5 evidence is written. A clean preflight is
  PACKAGE_REFRESH_PREFLIGHT = PASS, and that is never a W5 result.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w5-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SkipW4Regression,
  [switch] $SelfCheck,
  [switch] $PackageRefreshPreflight
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

<#
  ملاحظة مقصودة: Set-StrictMode و $ErrorActionPreference = "Stop" يبقيان كما هما.
  هما اللذان كشفا عيب النقل هذا؛ إطفاؤهما يخفي العيب ولا يصلحه.
#>

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:RunnerName = "polaris.w5.conformance.runner"
$script:BootstrapErrorCode = "W5_RUNNER_BOOTSTRAP_DEFECT"
# يُضبط قبل أي قراءة، فلا يقع StrictMode على متغيّر غير معرَّف.
$script:LastSoftStepCode = 0
$script:RootResolutionMethod = "UNRESOLVED"
$script:CanonicalRunStarted = $false
$script:RepositoryMarkers = @(
  "contracts\package.json",
  "runtime\package.json",
  "desktop\host",
  "tools\w4-windows-conformance\run.ps1",
  "tools\w5-conformance\w5-test-groups.mjs",
  "tools\w5-windows-adapter\build.ps1"
)

# اسم الحزمة معرّف npm لا مسار. ترجمته إلى مقاطع مجلدات تجري في عقد المسارات.
$script:ContractsPackageName = '@polaris/contracts'
# حالة التحقق من وجهة الحذف. تُضبط قبل أي قراءة، فلا يقع StrictMode عليها.
$script:PackageRefreshState = $null
$script:PathContractModule = ""
$script:JsonEvidenceModule = ""

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

<#
  التطبيع الوحيد المعتمد قبل أي .Count أو فهرسة على قيمة قد تكون مجموعة.

  العيب الذي يغلقه، حرفيًا: PowerShell يعدّ قيمة إرجاع الدالة إلى المجرى، فما
  يصل المستدعي ليس ما كتبته الدالة:

      صفر عنصر  →  $null            (المجرى لم يُصدر شيئًا)
      عنصر واحد →  قيمة مفردة        (String هنا، لا String[])
      عنصران+   →  Object[]

  و .Count على الأوليَين تحت Set-StrictMode ترمي PropertyNotFoundStrict:
  "The property 'Count' cannot be found on this object."

  الحالة الوحيدة التي تعمل هي الحالة الثالثة — وهي بالضبط الحالة التي لا
  يمرّ بها تشغيل سليم، فبقي العيب مستترًا حتى أول تشغيل أصلي بجذر صحيح.

  @() تجعل الحالات الثلاث حالة واحدة. وهي لا تخفي شيئًا: الفراغ يبقى فراغًا
  بـCount صفر، ولا يُقلَب إلى نجاح ولا إلى فشل.
#>
function ConvertTo-CountableArray {
  param([Parameter(Mandatory = $false)] $Value)
  # $null هنا يعني "المجرى لم يُصدر شيئًا"، أي مجموعة فارغة — لا قيمة مفقودة.
  # التمييز بين الغياب والفراغ محفوظ في Get-JsonProperty أدناه، حيث يعني شيئًا آخر.
  #
  # معامل الفاصلة إلزامي في السطرين: بدونه يعدّ المجرى قيمةَ الإرجاع مرة أخرى،
  # فتعود @() فارغةً إلى $null وتعود المصفوفة أحادية العنصر إلى قيمة مفردة —
  # أي أن دالة التطبيع نفسها تُعيد إنتاج العيب الذي وُجدت لتغلقه. وقد وقع هذا
  # فعلًا في أول تشغيل بعد الإصلاح، وكُشف بتشغيل لا بمراجعة.
  if ($null -eq $Value) { return ,@() }
  return ,@($Value)
}

<#
  قراءة خاصية من مستند JSON دون أن ترمي StrictMode على خاصية غائبة.
  هنا $null يعني "غائبة" ويجب أن يبقى متميّزًا عن قيمة موجودة تساوي صفرًا.
#>
<#
  قراءة مفتاح من $PSVersionTable.

  هو Hashtable لا PSCustomObject، فقارئ خصائص PSObject لا يراه — وقد أنتج ذلك
  فعلًا حقلَي platform و powershell_edition خاطئين في أول سجل إقلاع: قال
  السجل Win32NT على مضيف لينكس. حقلٌ كاذب في ملف دليل أسوأ من حقل غائب.
#>
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

<#
  الفحص المسبق لتحديث الحزم: يبني وجهة الحزمة المثبَّتة من مقاطع مُعلنة،
  ويُثبت عقد المسار عليها، ويُثبت سلامتها كوجهة حذف. لا يلمس نظام الملفات:
  لا حذف، ولا تثبيت، ولا إنشاء. يُعيد حالة التحقق أو يرمي.

  يُستدعى في الإقلاع أيضًا، لا عند الحذف فقط: قيمة مسار فاسدة يجب أن توقف
  التشغيل قبل أن يبدأ، لا في منتصفه.
#>
function Invoke-PackageRefreshPreflight {
  param([Parameter(Mandatory = $true)][string] $Root)
  $destination = Get-InstalledPackagePath -RepositoryRoot $Root -PackageName $script:ContractsPackageName
  return (Assert-PackageRefreshDestinationSafe -RepositoryRoot $Root -Destination $destination -PackageName $script:ContractsPackageName)
}

function Get-MissingMarkers {
  <#
    تعيد أسماء العلامات الغائبة. الفراغ يعني مستودعًا صالحًا.
    الإرجاع بمعامل الفاصلة حتى لا يفكّك المجرى المصفوفة عند صفر أو عنصر واحد.
  #>
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
    # التطبيع عند الاستهلاك أيضًا: حارسان مستقلان خير من واحد في مسار إقلاع.
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

<#
  سجل إقلاع غير قانوني.

  يُكتب في كل الأحوال — نجح الإقلاع أم فشل — ولا يحمل أبدًا حكم PASS أو FAIL
  لـW5. فشلُ إقلاع ليس فشلَ قياس: المسابر لم تُشغَّل أصلًا، فالتصنيف BLOCKED
  ورمز السبب W5_RUNNER_BOOTSTRAP_DEFECT.
#>
function Write-BootstrapRecord {
  param(
    [Parameter(Mandatory = $true)][hashtable] $Record,
    [string] $Root,
    [string] $Name = 'w5-runner-bootstrap.json'
  )
  $target = $null
  if (-not [string]::IsNullOrWhiteSpace($Root)) {
    $directory = Join-Path $Root 'evidence'
    try {
      New-Item -ItemType Directory -Force -Path $directory | Out-Null
      $target = Join-Path $directory $Name
    } catch { $target = $null }
  }
  if ($null -eq $target) {
    # جذر غير محلول: الدليل يُكتب حيث يمكن، ولا يُبتلع.
    $target = Join-Path ([System.IO.Path]::GetTempPath()) ('polaris-w5-' + $Name)
  }
  try {
    <#
      عقد البايتات: UTF-8 بلا BOM.

      Set-Content -Encoding UTF8 على Windows PowerShell 5.1 يكتب BOM (EF BB BF)،
      وهو ما أسقط سبعة اختبارات JSON.parse في التشغيل الأصلي الثالث. الكاتب
      القانوني هو Write-PolarisJsonFile. والبديل أدناه ليس تساهلًا: هو نفس
      العقد مكتوبًا مباشرةً، لأن هذا السجل يجب أن يُكتب حتى حين يفشل تحميل
      الوحدة نفسها — وذلك بالضبط أحد أعطاب الإقلاع التي يسجّلها.
    #>
    if (Get-Command Write-PolarisJsonFile -ErrorAction SilentlyContinue) {
      [void] (Write-PolarisJsonFile -Path $target -InputObject ([pscustomobject] $Record) -Depth 6)
    } else {
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

function New-BootstrapRecord {
  param([string] $Root)
  $nodeVersion = ""
  try { if (Get-Command node -ErrorAction SilentlyContinue) { $nodeVersion = [string] (& node --version) } } catch { $nodeVersion = "" }
  return @{
    runner                = $script:RunnerName
    canonical             = $false
    non_canonical_note    = "Bootstrap diagnostics only. This file never carries a W5 PASS or FAIL: it records whether the runner could start."
    repository_root       = $Root
    root_resolution_method = $script:RootResolutionMethod
    powershell_version    = $PSVersionTable.PSVersion.ToString()
    powershell_edition    = (Get-VersionTableValue -Name 'PSEdition' -Fallback 'Desktop')
    strict_mode           = "Latest"
    # Windows PowerShell 5.1 لا يحمل مفتاح Platform أصلًا، وغيابه هناك يعني Win32NT.
    # ولا يُفترض ذلك على مضيف يعلن منصّته: القيمة المعلنة تُقرأ ولا تُخمَّن.
    platform              = (Get-VersionTableValue -Name 'Platform' -Fallback 'Win32NT')
    os                    = (Get-VersionTableValue -Name 'OS' -Fallback '')
    node_version          = $nodeVersion
    self_check            = [bool] $SelfCheck
    canonical_run_started = $script:CanonicalRunStarted
  }
}

<#
  عائق ما قبل القياس.

  فشلٌ بعد إقلاع سليم وقبل أول قياس ليس فشلَ W5 ولا انحدارَ W4: لا مسبار
  شُغِّل، ولا دليل قانوني كُتب. يُسجَّل باسم مرحلته ورمز سببه في ملف غير
  قانوني، ويُنهي التشغيل بالرمز 2 كما يفعل عائق الإقلاع.
#>
function Stop-BeforeMeasurement {
  param(
    [Parameter(Mandatory = $true)] $Failure,
    [Parameter(Mandatory = $true)][string] $Stage,
    [string] $Root
  )
  $message = [string] $Failure.Exception.Message
  $reason = if (Get-Command Get-PackageRefreshReasonCode -ErrorAction SilentlyContinue) {
    Get-PackageRefreshReasonCode -Message $message
  } else { "W5_PACKAGE_REFRESH_FAILED" }

  $record = New-BootstrapRecord -Root $Root
  $record["bootstrap_started"]   = $script:BootstrapStarted
  $record["bootstrap_completed"] = $script:BootstrapCompleted
  $record["classification"]      = "BLOCKED"
  $record["failure_stage"]       = $Stage
  $record["error_code"]          = $reason
  $record["error_id"]            = [string] $Failure.FullyQualifiedErrorId
  $record["error_message"]       = $message
  $record["script_name"]         = $(if ($null -ne $Failure.InvocationInfo) { [string] $Failure.InvocationInfo.ScriptName } else { "" })
  $record["script_line"]         = $(if ($null -ne $Failure.InvocationInfo) { [int] $Failure.InvocationInfo.ScriptLineNumber } else { 0 })
  $record["script_statement"]    = $(if ($null -ne $Failure.InvocationInfo) { ([string] $Failure.InvocationInfo.Line).Trim() } else { "" })
  $record["script_stack"]        = [string] $Failure.ScriptStackTrace
  $record["bootstrap_ok"]        = $true
  $record["destination_validation"] = $script:PackageRefreshState
  $record["canonical_measurement_started"] = $script:CanonicalRunStarted

  Write-Host ""
  Write-Host "POLARIS Phase-00 / W5 - BLOCKED BEFORE MEASUREMENT" -ForegroundColor Red
  Write-Host "classification : BLOCKED"
  Write-Host "stage          : $Stage"
  Write-Host "error_code     : $reason"
  Write-Host "error_id       : $($record["error_id"])"
  Write-Host "message        : $message"
  Write-Host "at             : $($record["script_name"]):$($record["script_line"])"
  Write-Host "statement      : $($record["script_statement"])"
  Write-Host ""
  Write-Host "No probe ran. No canonical W5 evidence was written. W5-P01, panic stop, approval,"
  Write-Host "audit, completion proof and the W4 regression are UNMEASURED by this run, not failed."
  [void] (Write-BootstrapRecord -Record $record -Root $Root -Name 'w5-runner-precondition.json')
  exit 2
}

# ── الإقلاع ─────────────────────────────────────────────────────────────────
#
# كل ما قبل أول قياس يجري داخل هذا الحارس، فأي استثناء إقلاع يُصنَّف BLOCKED
# ويحمل موضعه الحقيقي — اسم السكربت ورقم السطر وأثر المكدس — بدل أن يُترك
# للمالك ليبحث عنه سطرًا سطرًا.

$script:BootstrapStarted = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
$script:BootstrapStage = "ROOT_RESOLUTION"

try {
  $RepositoryRoot = Resolve-RepositoryRoot -Explicit $RepositoryRoot

  <#
    عقد المسارات يُحمَّل قبل أي عمل على نظام الملفات.

    غيابه عيب إقلاع لا يُتجاوز بصمت: بدونه يعود بناء وجهة الحذف إلى نصّ حرفي
    غير مُثبَت، وهو بالضبط ما أنتج "Illegal characters in path".
  #>
  $script:BootstrapStage = "PATH_CONTRACT_MODULE"
  $moduleDirectory = Get-SafeVariableValue -Name 'PSScriptRoot'
  if ([string]::IsNullOrWhiteSpace($moduleDirectory)) {
    $commandPath = Get-SafeVariableValue -Name 'PSCommandPath'
    if (-not [string]::IsNullOrWhiteSpace($commandPath)) { $moduleDirectory = Split-Path -Parent $commandPath }
  }
  if ([string]::IsNullOrWhiteSpace($moduleDirectory)) {
    $moduleDirectory = Join-MarkerPath -Root $RepositoryRoot -Marker 'tools\w5-conformance'
  }
  $script:PathContractModule = Join-Path $moduleDirectory 'path-contract.ps1'
  if (-not (Test-Path -LiteralPath $script:PathContractModule)) {
    throw "BOOTSTRAP FAILED: the path contract module is missing at '$($script:PathContractModule)'."
  }
  . $script:PathContractModule

  <#
    عقد بايتات الدليل يُحمَّل كذلك قبل أي كتابة.

    غيابه يعني أن الكتابة ستقع بترميز يختاره المضيف ضمنًا — وهو ما أنتج
    EF BB BF في أدلة التشغيل الأصلي الثالث.
  #>
  $script:BootstrapStage = "JSON_EVIDENCE_MODULE"
  $script:JsonEvidenceModule = Join-MarkerPath -Root $RepositoryRoot -Marker 'tools\evidence-contract\json-evidence.ps1'
  if (-not (Test-Path -LiteralPath $script:JsonEvidenceModule)) {
    throw "BOOTSTRAP FAILED: the JSON evidence byte contract module is missing at '$($script:JsonEvidenceModule)'."
  }
  . $script:JsonEvidenceModule

  $script:BootstrapStage = "TOOLCHAIN_DISCOVERY"
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: node is not on PATH." }
  $script:NpmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
  if (-not (Get-Command $script:NpmCommand -ErrorAction SilentlyContinue)) { throw "BOOTSTRAP FAILED: npm is not on PATH." }

  # المفسّر الذي سيُشغَّل به مشغّل W4 يُحسم في الإقلاع لا عند الاستدعاء: اسمٌ
  # غير موجود هناك يفشل في منتصف التشغيل ويبدو انحدارًا في W4 وهو عيب إقلاع.
  $script:PowerShellCommand = ""
  foreach ($candidate in @('powershell', 'pwsh')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) { $script:PowerShellCommand = $candidate; break }
  }
  if ($script:PowerShellCommand.Length -eq 0) {
    throw "BOOTSTRAP FAILED: neither powershell nor pwsh is on PATH; the W4 regression could not be invoked."
  }

  <#
    تمرين مسار التطبيع نفسه الذي انكسر، بحالاته الثلاث، قبل أي عمل.

    ليس زينة: العيب لم يظهر إلا في الحالتين اللتين لا يمرّ بهما تشغيل سليم
    (صفر وواحد). تمرينهما هنا يجعل الانحدار مستحيلًا بصمت — وهذا بالضبط ما
    يشغّله وضع -SelfCheck.
  #>
  $script:BootstrapStage = "COLLECTION_NORMALISATION_SELFTEST"
  $probeZero = ConvertTo-CountableArray (Get-MissingMarkers -Path $RepositoryRoot)
  $probeOne  = ConvertTo-CountableArray "single-marker"
  $probeMany = ConvertTo-CountableArray @("a", "b")
  $probeNull = ConvertTo-CountableArray $null
  if ($probeZero.Count -ne 0) { throw "BOOTSTRAP FAILED: the resolved root reported missing markers after validation." }
  if ($probeOne.Count -ne 1) { throw "BOOTSTRAP FAILED: single-element normalisation is broken." }
  if ($probeMany.Count -ne 2) { throw "BOOTSTRAP FAILED: multi-element normalisation is broken." }
  if ($probeNull.Count -ne 0) { throw "BOOTSTRAP FAILED: null normalisation is broken." }

  <#
    وجهة الحذف تُثبت في الإقلاع، قبل أول خطوة.

    العيب الأصلي لم يظهر إلا بعد أن مرّت العقود واختباراتها — أي بعد دقائق
    من العمل — لأن المسار لم يُلمس قبل ذلك. إثباته هنا يجعل قيمة فاسدة توقف
    التشغيل في ثانيته الأولى، ويجعل الفشل عائقًا مُسمّى لا خطأً غامضًا.
  #>
  $script:BootstrapStage = "PACKAGE_REFRESH_PATH_CONTRACT"
  $script:PackageRefreshState = Invoke-PackageRefreshPreflight -Root $RepositoryRoot

  $script:BootstrapStage = "COMPLETE"
}
catch {
  $failure = $_
  $record = New-BootstrapRecord -Root $RepositoryRoot
  $record["bootstrap_started"]  = $script:BootstrapStarted
  $record["bootstrap_completed"] = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
  $record["classification"]     = "BLOCKED"
  $record["failure_stage"]      = $script:BootstrapStage
  # عيب مسار ليس عيب إقلاع عامًّا: الرمز يقول أي عقد انكسر.
  $record["error_code"]         = $(
    if ($script:BootstrapStage -eq "PACKAGE_REFRESH_PATH_CONTRACT") {
      Get-PackageRefreshReasonCode -Message ([string] $failure.Exception.Message)
    } else { $script:BootstrapErrorCode })
  $record["destination_validation"] = $script:PackageRefreshState
  $record["canonical_measurement_started"] = $script:CanonicalRunStarted
  $record["error_id"]           = [string] $failure.FullyQualifiedErrorId
  $record["error_message"]      = [string] $failure.Exception.Message
  $record["script_name"]        = $(if ($null -ne $failure.InvocationInfo) { [string] $failure.InvocationInfo.ScriptName } else { "" })
  $record["script_line"]        = $(if ($null -ne $failure.InvocationInfo) { [int] $failure.InvocationInfo.ScriptLineNumber } else { 0 })
  $record["script_statement"]   = $(if ($null -ne $failure.InvocationInfo) { ([string] $failure.InvocationInfo.Line).Trim() } else { "" })
  $record["script_stack"]       = [string] $failure.ScriptStackTrace
  $record["bootstrap_ok"]       = $false

  Write-Host ""
  Write-Host "POLARIS Phase-00 / W5 - BOOTSTRAP FAILED" -ForegroundColor Red
  Write-Host "classification : BLOCKED"
  Write-Host "error_code     : $($script:BootstrapErrorCode)"
  Write-Host "failure_stage  : $($script:BootstrapStage)"
  Write-Host "error_id       : $($record["error_id"])"
  Write-Host "message        : $($record["error_message"])"
  Write-Host "at             : $($record["script_name"]):$($record["script_line"])"
  Write-Host "statement      : $($record["script_statement"])"
  Write-Host ""
  Write-Host "No probe ran. No W5 measurement was attempted, and no canonical W5 evidence was written."
  Write-Host "This is a runner defect, not a W5 result: W5-P01, panic stop, approval, audit, completion"
  Write-Host "proof and the W4 regression are all UNMEASURED by this run, not failed."
  [void] (Write-BootstrapRecord -Record $record -Root $RepositoryRoot)
  exit 2
}

$script:BootstrapCompleted = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)

Write-Host "POLARIS Phase-00 / W5 - verification run"
Write-Host "repository : $RepositoryRoot"
Write-Host "resolved by: $($script:RootResolutionMethod)"
Write-Host "node       : $(node --version)"
Write-Host "npm        : $script:NpmCommand"
Write-Host "powershell : $($PSVersionTable.PSVersion.ToString()) (W4 regression via '$($script:PowerShellCommand)')"
Write-Host ""

<#
  وضع الفحص الذاتي.

  يُنفّذ كل تحضير الوسائط والجذر والبيئة، ويمرّن مسار التطبيع الذي انكسر
  بحالاته الثلاث، ثم يقف قبل تصريف أي محوّل وقبل أي مسبار. لا يُحدث أثرًا،
  ولا يدّعي شيئًا أمنيًا، ولا يكتب دليلًا قانونيًا — ونجاحه ليس W5 = PASS.
#>
if ($SelfCheck -or $PackageRefreshPreflight) {
  $record = New-BootstrapRecord -Root $RepositoryRoot
  $record["bootstrap_started"]   = $script:BootstrapStarted
  $record["bootstrap_completed"] = $script:BootstrapCompleted
  $record["classification"]      = "NOT_TESTED"
  $record["failure_stage"]       = ""
  $record["error_code"]          = ""
  $record["error_id"]            = ""
  $record["error_message"]       = ""
  $record["script_name"]         = ""
  $record["script_line"]         = 0
  $record["script_statement"]    = ""
  $record["script_stack"]        = ""
  $record["bootstrap_ok"]        = $true
  $record["destination_validation"] = $script:PackageRefreshState
  $record["canonical_measurement_started"] = $script:CanonicalRunStarted
  $record["interpretation"]      = "Bootstrap only. No adapter was compiled, no probe ran, and no security claim follows. A clean self-check is not a W5 result."
  [void] (Write-BootstrapRecord -Record $record -Root $RepositoryRoot)

  # الوجهة تُطبع مقتبسة: محرف تحكّم داخلها يُرى بين القوسين بدل أن يكسر السطر.
  Write-Host ("package refresh destination : `"$($script:PackageRefreshState.destination)`"")
  Write-Host "PACKAGE_REFRESH_PREFLIGHT = PASS"
  Write-Host "nothing was removed, nothing was installed, and node_modules was not touched."
  if ($SelfCheck) {
    Write-Host "SELFCHECK RESULT: BOOTSTRAP_OK"
    Write-Host "stopped before adapter compilation and before any probe. This is not a W5 verdict."
  }
  exit 0
}

$evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
New-Item -ItemType Directory -Force -Path $evidenceDirectory | Out-Null

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

<#
  خطوة تُسجَّل ولا توقف التشغيل. تُستعمل حيث يجب أن يُكتب الدليل مهما كانت
  النتيجة: تقرير مفقود أسوأ من تقرير يقول «فشل».
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

# ── 1..4 العقود، والحزم، وبناء طبقة التشغيل ─────────────────────────────────

Invoke-Step "contracts: verify" {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot "contracts")
  try { & $script:NpmCommand 'run' 'verify' } finally { Pop-Location }
}

<#
  إعادة تثبيت حزمة العقود المحلية داخل runtime.

  العيب الذي تغلقه هذه الخطوة حقيقي ورأيناه: `npm install` يقول "up to date"
  ولا يعيد حزم مجلد العقود، فتبني العقود نسخة جديدة بينما تظل runtime تقرأ
  النسخة القديمة المثبَّتة. النتيجة أسوأ من فشل: "contracts: verify" يمر،
  ثم تفشل runtime بخطأ إصدار لا علاقة له بالسبب.

  العلاج إزالة الحزمة المثبَّتة صراحةً ثم التثبيت، فيُعاد الحزم حتمًا.
#>
<#
  العيب الذي أوقف التشغيل الأصلي كان هنا، وفي سطر واحد:

      $installed = Join-Path $RepositoryRoot 'runtime\node_modules\@polaris\contracts'

  كُتب النصّ الحرفي مرّةً بأداة فسّرت \n تسلسلَ هروب، فصار داخل الاقتباس
  محرف سطر جديد حقيقي، وصارت القيمة 'runtime<LF>ode_modules\@polaris\contracts'.
  النصّ المفرد لا يُظهر ذلك للعين، والمشغّل لم يكن يُثبت شيئًا قبل الاستعمال،
  فوصلت القيمة إلى Test-Path فرمى: Illegal characters in path.

  العلاج ليس تنظيف القيمة عند الاستهلاك — ذلك يجعل الحذف يعمل على مسار لم
  يقصده أحد. العلاج ألا تُبنى القيمة من نصّ حرفي أصلًا: تُبنى من مقاطع
  مُعلنة، ويُثبت عقد المسار عليها، وتُثبت سلامتها كوجهة حذف قبل Remove-Item.
#>
$script:BootstrapStage = "PACKAGE_REFRESH"
try {
  Invoke-Step "packages: refresh the local contracts package inside runtime" {
    # الوجهة أُثبتت في الإقلاع. تُعاد هنا حارسًا ثانيًا مستقلًا: حارسان في
    # مسار حذف خير من واحد، وهذا هو انضباط W4 نفسه.
    $script:PackageRefreshState = Invoke-PackageRefreshPreflight -Root $RepositoryRoot
    $installed = Assert-ScalarPathString -Label "installed" -Value $script:PackageRefreshState.destination
    Write-Host ("  destination : `"$installed`"")
    if (Test-Path -LiteralPath $installed) { Remove-Item -LiteralPath $installed -Recurse -Force }
    Push-Location -LiteralPath (Join-Path $RepositoryRoot "runtime")
    try { & $script:NpmCommand 'install' '--no-audit' '--no-fund' | Out-Host } finally { Pop-Location }
  }
}
catch {
  Stop-BeforeMeasurement -Failure $_ -Stage $script:BootstrapStage -Root $RepositoryRoot
}

Invoke-Step "package resolution gate" {
  & node (Join-Path $RepositoryRoot 'tools\package-resolution\check-package-graph.mjs') --root $RepositoryRoot | Out-Host
}

Invoke-Step "runtime: typecheck and build" {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot "runtime")
  try {
    & $script:NpmCommand 'run' 'typecheck'
    if ($LASTEXITCODE -ne 0) { return }
    & $script:NpmCommand 'run' 'build'
  } finally { Pop-Location }
}

# ── 5..6 محوّل W5 ───────────────────────────────────────────────────────────

Invoke-Step "W5 adapter: static check" {
  & node (Join-Path $RepositoryRoot 'tools\w5-windows-adapter\static-check.mjs')
}

# البناء ناعم عمدًا: فشل تصريف في شيفرة W5 يجب أن يُصنَّف عائقًا لمسبار W5
# وحده، ولا يمنع انحدار W4 من التشغيل ولا يخفي نتيجته.
Invoke-SoftStep "W5 adapter: build" {
  & (Join-Path $RepositoryRoot 'tools\w5-windows-adapter\build.ps1') -RepositoryRoot $RepositoryRoot
  if (-not $?) { $global:LASTEXITCODE = 1 }
}
$adapterBuildCode = $script:LastSoftStepCode
$script:W5AdapterPath = Join-Path $RepositoryRoot 'tools\w5-windows-adapter\bin\polaris-w5-windows-adapter.exe'

# العلامة التي تجعل الدليل القانوني ملكًا لهذا المشغّل وحده. من هنا فقط يبدأ
# القياس، ومن هنا فقط يجوز أن يُكتب دليل W5 قانوني.
$script:CanonicalRunStarted = $true
$env:POLARIS_W5_NATIVE_RUN = '1'

# ── 7 مجموعات اختبارات W5 ───────────────────────────────────────────────────

Invoke-SoftStep "W5 test groups" {
  & node (Join-Path $RepositoryRoot 'tools\w5-conformance\w5-test-groups.mjs') --root $RepositoryRoot
}
$testGroupsCode = $script:LastSoftStepCode

# ── 8 المسبار الأصلي ────────────────────────────────────────────────────────

Invoke-SoftStep "W5 native probe: panic stop on a live confined child" {
  & node (Join-Path $RepositoryRoot 'tools\w5-conformance\w5-native-probes.mjs') --root $RepositoryRoot
}
$nativeProbeCode = $script:LastSoftStepCode

Remove-Item Env:\POLARIS_W5_NATIVE_RUN -ErrorAction SilentlyContinue

# ── 9 انحدار W4 ─────────────────────────────────────────────────────────────

$w4Code = $null
if ($SkipW4Regression) {
  Write-Host "--- W4 native regression: SKIPPED by switch. This run cannot produce a clean W5 verdict."
} else {
  Invoke-SoftStep "W4 native regression (the frozen W4 runner, unmodified)" {
    & $script:PowerShellCommand -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\w4-windows-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
  }
  $w4Code = $script:LastSoftStepCode
}

# ── 10 اختبارات طبقة التشغيل كاملة، بعد المسابر ─────────────────────────────

Invoke-SoftStep "runtime: final test" {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot "runtime")
  try { & $script:NpmCommand 'run' 'test' } finally { Pop-Location }
}
$runtimeTestCode = $script:LastSoftStepCode

# ── 11 التحقق من التنظيف ────────────────────────────────────────────────────

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
    Where-Object { $_.Name -like 'polaris-w5-panic-*' } | Select-Object -ExpandProperty Name)
} catch { $leftoverWorkspaces = @() }

# ── 12 الحكم ────────────────────────────────────────────────────────────────

$groups = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w5-test-groups.json')
$probe = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w5-panic-stop.json')
$w4Run = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w4-windows-run.json')
$w4Conformance = Read-JsonOrNull -Path (Join-Path $evidenceDirectory 'w4-windows-conformance.json')

# التطبيع نفسه يُطبَّق على كل ما يُعدّ: الثلاثة مبنية بـ@() أصلًا، ويُعاد
# تطبيعها هنا فلا يعتمد الحكم على أن يبقى بناؤها كما هو بعد أي تعديل لاحق.
$survivors          = ConvertTo-CountableArray $survivors
$leftoverProfiles   = ConvertTo-CountableArray $leftoverProfiles
$leftoverWorkspaces = ConvertTo-CountableArray $leftoverWorkspaces
$cleanupClean = ($survivors.Count -eq 0) -and ($leftoverProfiles.Count -eq 0) -and ($leftoverWorkspaces.Count -eq 0)

<#
  قراءة ملخّص المجموعات دون افتراض وجود حقوله.

  نفس صنف العيب: خاصية غائبة تحت StrictMode ترمي PropertyNotFoundStrict.
  وهنا الغياب ليس صفرًا: ملخّصٌ ناقص الحقول دليلٌ غير مكتمل، وحكمه
  W5_TEST_GROUP_EVIDENCE_INCOMPLETE لا "صفر إخفاقات".
#>
$groupsSummary = Get-JsonProperty -Object $groups -Name 'summary'
$groupsFailed       = Get-JsonProperty -Object $groupsSummary -Name 'failed'
$groupsBlocked      = Get-JsonProperty -Object $groupsSummary -Name 'blocked'
$groupsInconclusive = Get-JsonProperty -Object $groupsSummary -Name 'inconclusive'
$groupsNotTested    = Get-JsonProperty -Object $groupsSummary -Name 'not_tested'
$probeVerdict = Get-JsonProperty -Object $probe -Name 'verdict'

<#
  تصنيف انحدار W4: المسابر الأصلية شيء، ورمز خروج المشغّل شيء آخر.

  في التشغيل الأصلي الثالث خرج مشغّل W4 بالرمز 5 بينما كانت مسابره الأصلية
  W-01..W-12 كلها PASS (12/12). الخطوة غير الصفرية الوحيدة كانت "runtime: test"،
  أي طبقة التشغيل التي تحمل اختبارات W5 الجديدة — لا حبس W4.

  "W4_REGRESSION_FAILED" في تلك الحال جملة غير صحيحة: تقول إن الحبس انكسر وهو
  لم ينكسر. والحقيقتان تُحفظان معًا: المسابر مرّت، والمُجمَّع لم يكن نظيفًا،
  والثاني يبقى عائقًا. لا يُتجاهل رمز الخروج، ولا يُضعَّف المشغّل.
#>
$w4ProbeSummary = Get-JsonProperty -Object $w4Conformance -Name 'summary'
$w4ProbesPassed = Get-JsonProperty -Object $w4ProbeSummary -Name 'passed'
$w4ProbesTotal  = Get-JsonProperty -Object $w4ProbeSummary -Name 'total'
$w4NativeProbes = "UNKNOWN"
if (($null -ne $w4ProbesPassed) -and ($null -ne $w4ProbesTotal)) {
  $w4NativeProbes = if (([int] $w4ProbesTotal -gt 0) -and ([int] $w4ProbesPassed -eq [int] $w4ProbesTotal)) { "PASS" } else { "NOT_CLEAN" }
}

$w4Steps = ConvertTo-CountableArray (Get-JsonProperty -Object $w4Run -Name 'steps')
$w4FailingSteps = ConvertTo-CountableArray @(
  $w4Steps |
    Where-Object { [int] (Get-JsonProperty -Object $_ -Name 'exit_code') -ne 0 } |
    ForEach-Object { [string] (Get-JsonProperty -Object $_ -Name 'name') })
$w4NonRuntimeFailingSteps = ConvertTo-CountableArray @($w4FailingSteps | Where-Object { $_ -ne 'runtime: test' })

$w4Classification = $(
  if ($SkipW4Regression) { "W4_REGRESSION_SKIPPED" }
  elseif (($null -eq $w4Run) -or ($null -eq $w4ProbeSummary)) { "W4_REGRESSION_EVIDENCE_MISSING" }
  elseif ($w4NativeProbes -ne "PASS") { "W4_REGRESSION_PROBES_FAILED" }
  elseif ($w4Code -eq 0) { "W4_REGRESSION_PASS" }
  elseif (($w4FailingSteps.Count -gt 0) -and ($w4NonRuntimeFailingSteps.Count -eq 0)) { "W4_REGRESSION_PROBES_PASS_RUNTIME_SUITE_FAILED" }
  else { "W4_REGRESSION_PROBES_PASS_AGGREGATE_NONZERO" })

<#
  بوابة ترميز الدليل.

  دليل قانوني بعلامة ترتيب بايتات ليس دليلًا مقبولًا. الإصلاح المعتمد في
  الكاتب، والبوابة هنا تمنع انجراف كاتب جديد من المرور صامتًا. ولا يُقشَّر
  المحرف عند القراءة: ذلك يجعل الفساد مقبولًا ويُبقي المُنتِج حيًّا.
#>
$encodingTargets = New-Object System.Collections.Generic.List[string]
foreach ($name in @(
  'w5-test-groups.json', 'w5-audit-chain.json', 'w5-approval.json', 'w5-panic-stop-host.json',
  'w5-completion-proof.json', 'w5-scenarios.json', 'w5-runner-bootstrap-regression.json',
  'w5-runner-package-refresh.json', 'w5-evidence-encoding.json', 'w5-test-group-contract.json',
  'w5-architecture.json', 'w5-panic-stop.json', 'w5-windows-adapter-build.json',
  'w5-runner-bootstrap.json', 'w4-windows-run.json', 'w4-windows-conformance.json',
  'w4-windows-adapter-build.json')) {
  [void] $encodingTargets.Add((Join-Path $evidenceDirectory $name))
}
$encodingReport = ConvertTo-CountableArray (Get-PolarisEvidenceEncodingReport -Paths $encodingTargets.ToArray())
$encodingDefects = ConvertTo-CountableArray @($encodingReport | Where-Object { -not $_.ok })

$blockers = New-Object System.Collections.Generic.List[string]
if ($adapterBuildCode -ne 0) { [void] $blockers.Add("W5_ADAPTER_BUILD_FAILED") }
if ($null -eq $groups) { [void] $blockers.Add("W5_TEST_GROUP_EVIDENCE_MISSING") }
elseif (($null -eq $groupsFailed) -or ($null -eq $groupsBlocked) -or ($null -eq $groupsInconclusive) -or ($null -eq $groupsNotTested)) {
  [void] $blockers.Add("W5_TEST_GROUP_EVIDENCE_INCOMPLETE")
}
elseif ([int] $groupsFailed -gt 0) { [void] $blockers.Add("W5_TEST_GROUP_FAILED") }
elseif (([int] $groupsBlocked + [int] $groupsInconclusive + [int] $groupsNotTested) -gt 0) {
  [void] $blockers.Add("W5_TEST_GROUP_NOT_CLEAN")
}
if ($testGroupsCode -ne 0 -and $blockers.Count -eq 0) { [void] $blockers.Add("W5_TEST_GROUP_EXIT_CODE") }
if ($null -eq $probe) { [void] $blockers.Add("W5_NATIVE_PROBE_EVIDENCE_MISSING") }
elseif ($null -eq $probeVerdict) { [void] $blockers.Add("W5_NATIVE_PROBE_EVIDENCE_INCOMPLETE") }
elseif ([string] $probeVerdict -ne 'PASS') { [void] $blockers.Add("W5_NATIVE_PROBE_$([string] $probeVerdict)") }
if ($nativeProbeCode -ne 0 -and $null -ne $probeVerdict -and ([string] $probeVerdict) -eq 'PASS') { [void] $blockers.Add("W5_NATIVE_PROBE_EXIT_CODE") }
if ($SkipW4Regression) { [void] $blockers.Add("W4_REGRESSION_SKIPPED") }
elseif ($w4Code -ne 0) { [void] $blockers.Add($w4Classification) }
elseif ($w4NativeProbes -ne "PASS") { [void] $blockers.Add("W4_REGRESSION_PROBES_FAILED") }
if ($runtimeTestCode -ne 0) { [void] $blockers.Add("RUNTIME_SUITE_FAILED") }
if (-not $cleanupClean) { [void] $blockers.Add("CLEANUP_NOT_CLEAN") }
if ($encodingDefects.Count -gt 0) { [void] $blockers.Add("W5_EVIDENCE_ENCODING_DEFECT") }

$verdict = if ($blockers.Count -eq 0) { 'PASS' } else { 'NOT_CLEAN' }

$runRecord = [ordered] @{
  harness         = 'polaris.w5.conformance.runner'
  harness_version = '1.0.0'
  ran_at          = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
  repository_root = $RepositoryRoot
  platform        = 'win32'
  native          = $true
  powershell      = $PSVersionTable.PSVersion.ToString()
  node            = (node --version)
  steps           = $script:Steps
  w5_adapter = [ordered] @{
    path      = $script:W5AdapterPath
    built     = (Test-Path -LiteralPath $script:W5AdapterPath)
    exit_code = $adapterBuildCode
    sha256    = if (Test-Path -LiteralPath $script:W5AdapterPath) { (Get-FileHash -LiteralPath $script:W5AdapterPath -Algorithm SHA256).Hash } else { "" }
  }
  bootstrap = [ordered] @{
    root_resolution_method = $script:RootResolutionMethod
    bootstrap_started      = $script:BootstrapStarted
    bootstrap_completed    = $script:BootstrapCompleted
    bootstrap_ok           = $true
    canonical_run_started  = $script:CanonicalRunStarted
    record                 = 'evidence\w5-runner-bootstrap.json'
  }
  w5_test_groups  = $groupsSummary
  w5_native_probe = if ($null -ne $probe) { [ordered] @{
      verdict       = $probeVerdict
      reason_code   = (Get-JsonProperty -Object $probe -Name 'reason_code')
      survivors     = (Get-JsonProperty -Object $probe -Name 'survivors')
      cleanup_clean = (Get-JsonProperty -Object $probe -Name 'cleanup_clean')
    } } else { $null }
  w4_regression = [ordered] @{
    skipped        = [bool] $SkipW4Regression
    exit_code      = $w4Code
    classification = $w4Classification
    native_probes  = $w4NativeProbes
    probe_summary  = $w4ProbeSummary
    failing_steps  = @($w4FailingSteps)
    interpretation = "native_probes is the W4 confinement result; exit_code is the whole W4 runner. A nonzero aggregate whose only failing step is the runtime suite is not a confinement regression, and it is still a blocker."
    run_reference  = if ($null -ne $w4Run) { 'evidence\w4-windows-run.json' } else { $null }
  }
  evidence_encoding = [ordered] @{
    contract  = 'UTF-8 without BOM, LF newlines, valid JSON document'
    checked   = $encodingReport.Count
    defects   = @($encodingDefects)
    module    = $script:JsonEvidenceModule
  }
  runtime_test_exit_code = $runtimeTestCode
  cleanup = [ordered] @{
    clean                          = $cleanupClean
    surviving_execution_hosts      = @($survivors | ForEach-Object { $_.ProcessId })
    leftover_appcontainer_profiles = $leftoverProfiles
    leftover_workspaces            = $leftoverWorkspaces
  }
  verdict     = $verdict
  reason_codes = @($blockers)
}
$runRecordPath = Join-Path $evidenceDirectory 'w5-run.json'
[void] (Write-PolarisJsonFile -Path $runRecordPath -InputObject $runRecord -Depth 8)

Write-Host ""
Write-Host "evidence:"
foreach ($file in @(
  'w5-run.json', 'w5-test-groups.json', 'w5-audit-chain.json', 'w5-approval.json',
  'w5-panic-stop-host.json', 'w5-completion-proof.json', 'w5-scenarios.json',
  'w5-architecture.json', 'w5-panic-stop.json', 'w5-windows-adapter-build.json')) {
  $path = Join-Path $evidenceDirectory $file
  if (Test-Path -LiteralPath $path) { Write-Host "  $path" }
}

Write-Host ""
if ($verdict -eq 'PASS') {
  Write-Host "W5 verification run: CLEAN" -ForegroundColor Green
  Write-Host "read evidence\w5-run.json before promoting anything."
  exit 0
}
Write-Host "W5 verification run: NOT CLEAN" -ForegroundColor Red
foreach ($blocker in $blockers) { Write-Host "  $blocker" }
Write-Host ""
Write-Host "No W5 result may be promoted from this run. BLOCKED, INCONCLUSIVE and NOT_TESTED are never PASS."
exit 1
