#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-01 / P01-B1 - the Windows toolchain baseline.

.DESCRIPTION
  One command. It measures whether the Windows host actually carries the
  toolchain Phase-01 needs, and writes evidence\phase-01-baseline.json.

  It builds nothing, installs nothing, downloads nothing and changes nothing
  outside the evidence file. It is a measurement, not a setup script.

  WHY THIS EXISTS
  ---------------
  ADR-018 selects Tauri v2 + React for the desktop tier and says so
  conditionally: the decision assumes a working Rust / MSVC / WebView2
  toolchain on this machine, and that assumption is NOT_TESTED until this
  script runs. Phase-01 does not proceed on an assumed toolchain.

  BOOTSTRAP CONTRACT
  ------------------
  Repository-root discovery never depends on $PSScriptRoot alone and never
  inside a param() default. Same contract as W4, W5 and W6.

  EVIDENCE CONTRACT
  -----------------
  The only writer is Write-PolarisJsonFile from
  tools\evidence-contract\json-evidence.ps1: UTF-8, no BOM, LF, one trailing
  newline, re-read and verified after writing.

  SERIALIZATION CONTRACT  (P01-W1 remediation, 2026-09-10)
  --------------------------------------------------------
  POWERSHELL_5_1_GENERIC_LIST_JSON_BINDER_FAILURE.

  The array-subexpression operator applied to a PSObject-wrapped
  System.Collections.Generic.List[System.Object] throws

      System.ArgumentException: Argument types do not match

  from System.Linq.Expressions.Expression.Condition, reached through
  PSToObjectArrayBinder.Bind -> PSEnumerableBinder.MaybeDebase.

  MaybeDebase is the code path that handles a PSObject-wrapped target: it
  emits Expression.Condition(target is PSObject, generator(debased),
  generator(raw)). For an element type of System.Object the two branches infer
  different static types, and Expression.Condition rejects that pair. That is
  why the failure is this precise:

      New-Object List[object]  + @($list)   FAILS
      [List[object]]::new()    + @($list)   works   - never PSObject-wrapped
      New-Object List[string]  + @($list)   works   - branches agree
      New-Object ArrayList     + @($list)   works
      $list.ToArray()                       works   - direct .NET call
      ICollection.CopyTo                    works   - direct .NET call
      [object[]] $list                      works
      foreach / pipeline / .Count           work
      ConvertTo-Json over a property        works

  Two consequences the original diagnosis did not carry. First, ConvertTo-Json
  was never the failing primitive: the diagnostic probe named
  convertto-json-with-list died on the @($l) inside its DTO literal, before
  ConvertTo-Json was reached. Second, the defect is NOT a Windows PowerShell
  5.1 compatibility quirk - it reproduces identically on PowerShell 7.4.6, so
  switching to pwsh would not have fixed it. It is an engine binder defect.

  The rule this file now keeps: a generic collection is an accumulator during
  measurement and never a value in the evidence document. It is converted to a
  true System.Object[] by an explicit .NET copy - never by @(), never by an
  implicit cast, never by pipeline unrolling - before anything reads it, and
  the plain array is what the rest of the script and the JSON writer see.

  The writer was not taught to tolerate the type. The producer was fixed.

.PARAMETER RepositoryRoot
  Explicit repository root. When supplied it is used and validated, and no
  fallback is attempted: an explicit wrong answer must fail loudly.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-baseline\baseline.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# تهيئة صريحة: StrictMode يعترض على قراءة LASTEXITCODE قبل أول أمر أصلي.
$global:LASTEXITCODE = 0

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:ToolName = "polaris.p01.baseline"
$script:SchemaVersion = "1.0.0"
$script:BootstrapErrorCode = "P01_BASELINE_BOOTSTRAP_DEFECT"
$script:SerializationErrorCode = "P01_BASELINE_SERIALIZATION_CONTRACT"
$script:IncompleteReasonCode = "P01_BASELINE_RUN_INCOMPLETE"

# هوية التشغيل. تُولَّد أولًا لأن السجل القانوني يُربط بها قبل أي قياس.
$script:RunId = [guid]::NewGuid().ToString()
$script:RunStarted = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# ── تطبيع المجموعات ────────────────────────────────────────────────────────
# المُقيِّد الديناميكي PSToObjectArrayBinder يسقط حين يُطلب منه تحويل
# List[object] ملفوفة بـPSObject إلى مصفوفة. لذلك لا يُستعمل @() ولا التحويل
# الضمني ولا فكّ الأنبوب: النسخ يقع بنداء .NET مباشر على ICollection، وهو مسار
# لا يمرّ بذلك المُقيِّد أصلًا. الناتج مصفوفة System.Object[] حقيقية دائمًا
# مهما كان نوع العنصر، بخلاف ToArray() التي تُعيد string[] عن List[string].
function ConvertTo-PolarisPlainArray {
  param([AllowNull()] $Value)

  if ($null -eq $Value) { return ,([object[]]::new(0)) }

  # مصفوفة كائنات عادية: تُعاد كما هي. المطابقة على النوع الدقيق لا على -is،
  # لأن string[] يجتاز -is [object[]] بالتغاير وليس System.Object[].
  if ($Value.GetType().FullName -eq "System.Object[]") { return ,$Value }

  if ($Value -is [System.Collections.ICollection]) {
    $count = [int] $Value.Count
    $plain = [object[]]::new($count)
    if ($count -gt 0) { ([System.Collections.ICollection] $Value).CopyTo($plain, 0) }
    return ,$plain
  }

  # مُعدِّد بلا عدّ: ليس عيبًا في التسلسل بل عيب في المُنتِج. يُسمّى ولا يُبتلع.
  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    throw "$($script:SerializationErrorCode): NON_COUNTABLE_ENUMERABLE ($($Value.GetType().FullName)) reached the evidence document."
  }

  # قيمة مفردة: لفّ صريح بلا تعداد.
  $single = [object[]]::new(1)
  $single[0] = $Value
  return ,$single
}

# ── جذر المستودع ───────────────────────────────────────────────────────────
# الجذر الصريح يُستعمل ويُتحقَّق منه بلا بديل. الخطأ الصريح يجب أن يسقط بصوت
# عالٍ، لا أن يُصحَّح بصمت إلى مسار آخر يبدو صحيحًا.

function Test-PolarisRepositoryRoot {
  param([Parameter(Mandatory = $true)][string] $Candidate)
  if ([string]::IsNullOrWhiteSpace($Candidate)) { return $false }
  if (-not (Test-Path -LiteralPath $Candidate -PathType Container)) { return $false }
  foreach ($marker in @("contracts", "runtime", "evidence", "docs")) {
    if (-not (Test-Path -LiteralPath (Join-Path $Candidate $marker) -PathType Container)) { return $false }
  }
  return $true
}

function Resolve-PolarisRepositoryRoot {
  param([AllowNull()][string] $Explicit)

  if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
    if (-not (Test-PolarisRepositoryRoot -Candidate $Explicit)) {
      throw "$($script:BootstrapErrorCode): explicit RepositoryRoot '$Explicit' is not a POLARIS repository root."
    }
    return @{ path = (Resolve-Path -LiteralPath $Explicit).ProviderPath; method = "EXPLICIT_PARAMETER" }
  }

  # الصعود من موقع السكربت، لا الاعتماد عليه وحده: لو نُقل السكربت خارج الشجرة
  # وجب أن يظهر ذلك، لا أن يُخمَّن جذر.
  if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $current = $PSScriptRoot
    for ($depth = 0; $depth -lt 8; $depth += 1) {
      if (Test-PolarisRepositoryRoot -Candidate $current) {
        return @{ path = (Resolve-Path -LiteralPath $current).ProviderPath; method = "SCRIPT_ROOT_ASCENT" }
      }
      $parent = Split-Path -Parent $current
      if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
      $current = $parent
    }
  }

  if (Test-PolarisRepositoryRoot -Candidate $script:DefaultRepositoryRoot) {
    return @{ path = (Resolve-Path -LiteralPath $script:DefaultRepositoryRoot).ProviderPath; method = "DEFAULT_CONSTANT" }
  }

  throw "$($script:BootstrapErrorCode): repository root could not be resolved."
}

# ── مسبار أداة واحدة ───────────────────────────────────────────────────────
# كل مسبار يُبلّغ عن ثلاثة أشياء لا اثنين: هل الأداة موجودة، وما إصدارها،
# وكيف عُرف ذلك. أداةٌ "موجودة" بلا إصدار مقروء ليست قياسًا مكتملًا.
#
# ولا يدخل السجل إلا نصّ أو رقم أو منطق: لا ApplicationInfo ولا ErrorRecord ولا
# RegistryKey ولا CimInstance ولا Version. الكائن الغني يُقرأ ثم يُترك خارجًا.

function New-ProbeResult {
  param(
    [Parameter(Mandatory = $true)][string] $Id,
    [Parameter(Mandatory = $true)][string] $Requirement,
    [Parameter(Mandatory = $true)][string] $Status,
    [AllowNull()][string] $Version,
    [AllowNull()][string] $Detail,
    [Parameter(Mandatory = $true)][string] $Method,
    [AllowNull()] $Facts
  )
  # التطبيع قبل البناء: قيمة الحقل تُحسم في متغيّر، لا داخل جسم الجدول. أجسام
  # الجداول في PowerShell 5.1 تقبل التعبيرات لا الجُمل الشرطية.
  $versionText = ""
  if (-not [string]::IsNullOrWhiteSpace($Version)) { $versionText = [string] $Version }
  $detailText = ""
  if (-not [string]::IsNullOrWhiteSpace($Detail)) { $detailText = [string] $Detail }

  $factRecord = [pscustomobject] @{}
  if ($null -ne $Facts) { $factRecord = [pscustomobject] $Facts }

  return [pscustomobject] @{
    id          = [string] $Id
    requirement = [string] $Requirement
    status      = [string] $Status
    version     = $versionText
    detail      = $detailText
    method      = [string] $Method
    facts       = $factRecord
  }
}

function Invoke-CommandProbe {
  param(
    [Parameter(Mandatory = $true)][string] $Id,
    [Parameter(Mandatory = $true)][string] $Requirement,
    [Parameter(Mandatory = $true)][string] $Executable,
    [Parameter(Mandatory = $true)][string[]] $Arguments
  )

  $resolved = Get-Command -Name $Executable -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $resolved) {
    return New-ProbeResult -Id $Id -Requirement $Requirement -Status "ABSENT" -Version "" `
      -Detail "'$Executable' is not on PATH" -Method "GET_COMMAND"
  }

  # ApplicationInfo يُقرأ هنا ويُحوَّل إلى نصّ فورًا. لا يُمرَّر إلى السجل.
  $source = [string] $resolved.Source

  try {
    $output = & $source @Arguments 2>&1
    $text = ([string]::Join(" ", (ConvertTo-PolarisPlainArray $output))).Trim()
    if ($LASTEXITCODE -ne 0) {
      return New-ProbeResult -Id $Id -Requirement $Requirement -Status "ERROR" -Version "" `
        -Detail "exit $LASTEXITCODE from '$Executable $($Arguments -join ' ')': $text" -Method "INVOKE_VERSION" `
        -Facts @{ source = $source }
    }
    return New-ProbeResult -Id $Id -Requirement $Requirement -Status "PRESENT" -Version $text `
      -Detail $source -Method "INVOKE_VERSION" -Facts @{ source = $source }
  } catch {
    return New-ProbeResult -Id $Id -Requirement $Requirement -Status "ERROR" -Version "" `
      -Detail ([string] $_.Exception.Message) -Method "INVOKE_VERSION" -Facts @{ source = $source }
  }
}

function Get-RegistryValueOrNull {
  param([Parameter(Mandatory = $true)][string] $Path, [Parameter(Mandatory = $true)][string] $Name)
  try {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $item = Get-ItemProperty -LiteralPath $Path -ErrorAction Stop
    if ($null -eq $item) { return $null }
    if (-not ($item.PSObject.Properties.Name -contains $Name)) { return $null }
    return [string] $item.$Name
  } catch { return $null }
}

# ── أدوات MSVC: من مكوّن مُعلَن إلى ثنائيات على القرص ──────────────────────
# vswhere -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 هو
# المعيار المعتمد من مايكروسوفت لهوية المكوّن، وهو معيار الحكم هنا ولا يُشدَّد
# في هذه المهمة. ما يُضاف حقائق مرصودة لا شرط جديد: إصدار أدوات VC وموقع
# cl.exe و link.exe إن وُجدا. لا تُعدَّل البيئة، ولا يُستدعى vcvars.
function Get-VcToolsFacts {
  param([Parameter(Mandatory = $true)][string] $InstallationPath)

  $facts = [ordered] @{
    installation_path = $InstallationPath
    vc_tools_version  = ""
    cl_exe            = ""
    link_exe          = ""
    binaries_found    = $false
  }
  try {
    $defaultFile = Join-Path $InstallationPath "VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt"
    if (-not (Test-Path -LiteralPath $defaultFile -PathType Leaf)) { return $facts }
    $toolsVersion = ([string] (Get-Content -LiteralPath $defaultFile -TotalCount 1 -ErrorAction Stop)).Trim()
    if ([string]::IsNullOrWhiteSpace($toolsVersion)) { return $facts }
    $facts.vc_tools_version = $toolsVersion

    $binDir = Join-Path $InstallationPath ("VC\Tools\MSVC\" + $toolsVersion + "\bin\Hostx64\x64")
    $cl = Join-Path $binDir "cl.exe"
    $link = Join-Path $binDir "link.exe"
    if (Test-Path -LiteralPath $cl -PathType Leaf) { $facts.cl_exe = $cl }
    if (Test-Path -LiteralPath $link -PathType Leaf) { $facts.link_exe = $link }
    $facts.binaries_found = ((-not [string]::IsNullOrWhiteSpace($facts.cl_exe)) -and (-not [string]::IsNullOrWhiteSpace($facts.link_exe)))
    return $facts
  } catch {
    return $facts
  }
}

# ── الجذر والسجل القانوني قبل القياس ───────────────────────────────────────
# الجذر يُحسم أولًا لأن السجل يُثبَّت على القرص قبل أن يبدأ القياس. الملف
# القانوني الذي على القرص الآن - إن وُجد - من تشغيل آخر، ولا يجوز أن يُقرأ
# كنتيجة هذا التشغيل لو مات هذا التشغيل في منتصفه. لا يُحذف دليل: يُستبدل
# بسجل صادق يقول عن نفسه إنه غير مكتمل، ثم يُستبدل بالقياس عند اكتماله.

$root = Resolve-PolarisRepositoryRoot -Explicit $RepositoryRoot
$evidencePath = Join-Path $root.path "evidence\phase-01-baseline.json"

. (Join-Path $root.path "tools\evidence-contract\json-evidence.ps1")

$openingRecord = [pscustomobject] @{
  schema_version    = $script:SchemaVersion
  tool              = $script:ToolName
  phase             = "PHASE-01"
  claim_id          = "P01-B1"
  platform          = "win32"
  native            = $true
  run_id            = $script:RunId
  run_started       = $script:RunStarted
  measured_at       = ""
  repository_root   = $root.path
  canonical         = $false
  evidence_complete = $false
  verdict           = "NOT_TESTED"
  reason_code       = $script:IncompleteReasonCode
  note              = "the measurement of this run had not completed when this record was written; a prior result must not be read as this run's result"
}
[void] (Write-PolarisJsonFile -Path $evidencePath -InputObject $openingRecord -Depth 6)

# ── المسابير ───────────────────────────────────────────────────────────────
# List[object] هنا مُراكِم أثناء القياس فقط. لا يخرج منها شيء إلى الوثيقة قبل
# التطبيع الصريح.

$probes = New-Object System.Collections.Generic.List[object]

# 1) سلسلة Node - موجودة أصلًا في الطور صفر، وتُقاس هنا على ويندوز لا على الجسر.
[void] $probes.Add((Invoke-CommandProbe -Id "node"  -Requirement "REQUIRED" -Executable "node" -Arguments @("--version")))
[void] $probes.Add((Invoke-CommandProbe -Id "npm"   -Requirement "REQUIRED" -Executable "npm"  -Arguments @("--version")))

# 2) سلسلة Rust - شرط ADR-018.
[void] $probes.Add((Invoke-CommandProbe -Id "rustc"  -Requirement "REQUIRED" -Executable "rustc"  -Arguments @("--version")))
[void] $probes.Add((Invoke-CommandProbe -Id "cargo"  -Requirement "REQUIRED" -Executable "cargo"  -Arguments @("--version")))
[void] $probes.Add((Invoke-CommandProbe -Id "rustup" -Requirement "OPTIONAL" -Executable "rustup" -Arguments @("show", "active-toolchain")))

# 3) أدوات بناء MSVC - رابط Rust على ويندوز يحتاجها. vswhere هو الطريق المعتمد
#    من مايكروسوفت؛ البحث عن cl.exe في PATH يفشل خارج صدفة المطوّر ولا يعني الغياب.
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path -LiteralPath $vswhere) {
  try {
    $vsVersion = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion 2>&1
    $vsPath    = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    $vsVersionText = ([string]::Join(" ", (ConvertTo-PolarisPlainArray $vsVersion))).Trim()
    $vsPathText    = ([string]::Join(" ", (ConvertTo-PolarisPlainArray $vsPath))).Trim()
    if ([string]::IsNullOrWhiteSpace($vsVersionText)) {
      [void] $probes.Add((New-ProbeResult -Id "msvc_build_tools" -Requirement "REQUIRED" -Status "ABSENT" -Version "" `
        -Detail "vswhere found no installation carrying VC.Tools.x86.x64" -Method "VSWHERE" `
        -Facts @{ component = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"; component_present = $false }))
    } else {
      $vcFacts = Get-VcToolsFacts -InstallationPath $vsPathText
      $vcFacts["component"] = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"
      $vcFacts["component_present"] = $true
      [void] $probes.Add((New-ProbeResult -Id "msvc_build_tools" -Requirement "REQUIRED" -Status "PRESENT" -Version $vsVersionText `
        -Detail $vsPathText -Method "VSWHERE" -Facts $vcFacts))
    }
  } catch {
    [void] $probes.Add((New-ProbeResult -Id "msvc_build_tools" -Requirement "REQUIRED" -Status "ERROR" -Version "" `
      -Detail ([string] $_.Exception.Message) -Method "VSWHERE" `
      -Facts @{ component = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64" }))
  }
} else {
  [void] $probes.Add((New-ProbeResult -Id "msvc_build_tools" -Requirement "REQUIRED" -Status "ABSENT" -Version "" `
    -Detail "vswhere.exe not present at '$vswhere'" -Method "VSWHERE" `
    -Facts @{ component = "Microsoft.VisualStudio.Component.VC.Tools.x86.x64"; component_present = $false }))
}

# 4) زمن تشغيل WebView2 - مضيف العرض. غيابه يعني نافذة فارغة، لا خطأ بناء،
#    ولذلك يُقاس صراحةً بدل افتراض أن ويندوز 11 يحمله دائمًا. المفتاح هو عميل
#    EdgeUpdate لزمن تشغيل WebView2 نفسه، لا Edge.
$webview2Clsid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
$webview2Paths = @(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$webview2Clsid",
  "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webview2Clsid",
  "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$webview2Clsid"
)
$webview2Version = $null
$webview2Source  = ""
foreach ($path in $webview2Paths) {
  $value = Get-RegistryValueOrNull -Path $path -Name "pv"
  if (-not [string]::IsNullOrWhiteSpace($value)) { $webview2Version = $value; $webview2Source = $path; break }
}
if ([string]::IsNullOrWhiteSpace($webview2Version)) {
  [void] $probes.Add((New-ProbeResult -Id "webview2_runtime" -Requirement "REQUIRED" -Status "ABSENT" -Version "" `
    -Detail "no EdgeUpdate client entry for $webview2Clsid" -Method "REGISTRY" `
    -Facts @{ product = "WebView2 Evergreen Runtime"; client_id = $webview2Clsid }))
} else {
  [void] $probes.Add((New-ProbeResult -Id "webview2_runtime" -Requirement "REQUIRED" -Status "PRESENT" -Version $webview2Version `
    -Detail $webview2Source -Method "REGISTRY" `
    -Facts @{ product = "WebView2 Evergreen Runtime"; client_id = $webview2Clsid; source = $webview2Source }))
}

# 5) Windows SDK - اختياري بذاته لأنه يأتي مع أدوات MSVC، ويُسجَّل للتشخيص.
#    الإصدار وحده رقم في السجل؛ يُضاف إليه وجود مجلد التثبيت كحقيقة مرصودة،
#    ولا يُرفع ذلك إلى شرط إلزامي جديد.
$sdkKey = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SDKs\Windows\v10.0"
$sdkVersion = Get-RegistryValueOrNull -Path $sdkKey -Name "ProductVersion"
if ([string]::IsNullOrWhiteSpace($sdkVersion)) {
  [void] $probes.Add((New-ProbeResult -Id "windows_sdk" -Requirement "OPTIONAL" -Status "ABSENT" -Version "" `
    -Detail "no v10.0 ProductVersion in registry" -Method "REGISTRY" -Facts @{ registry_key = $sdkKey }))
} else {
  $sdkFolder = Get-RegistryValueOrNull -Path $sdkKey -Name "InstallationFolder"
  $sdkFolderText = ""
  $sdkFolderPresent = $false
  if (-not [string]::IsNullOrWhiteSpace($sdkFolder)) {
    $sdkFolderText = $sdkFolder
    $sdkFolderPresent = (Test-Path -LiteralPath $sdkFolder -PathType Container)
  }
  [void] $probes.Add((New-ProbeResult -Id "windows_sdk" -Requirement "OPTIONAL" -Status "PRESENT" -Version $sdkVersion `
    -Detail "HKLM SDKs\Windows\v10.0" -Method "REGISTRY" `
    -Facts @{ registry_key = $sdkKey; installation_folder = $sdkFolderText; installation_folder_present = $sdkFolderPresent }))
}

# 6) واجهة Tauri - اختيارية: تُثبَّت كتبعية مشروع لا كأداة عامة، وغيابها الآن
#    ليس عائقًا ولا يُبلَّغ عنه كعائق. ADR-018 يشترط cargo وأدوات MSVC و
#    WebView2 ولا يشترط cargo-tauri؛ فلا يُخترع شرط لم يُعلَن.
[void] $probes.Add((Invoke-CommandProbe -Id "tauri_cli" -Requirement "OPTIONAL" -Executable "cargo" -Arguments @("tauri", "--version")))

# ── التطبيع ثم الحكم ───────────────────────────────────────────────────────
# التحويل يقع هنا، مرة واحدة، قبل أي قراءة. كل ما بعد هذا السطر يرى
# System.Object[] لا List[object]، فلا يبقى في السكربت مسار ضمني إلى JSON.

$probeRecords = ConvertTo-PolarisPlainArray $probes

$requiredAccumulator = New-Object System.Collections.Generic.List[object]
$missingAccumulator  = New-Object System.Collections.Generic.List[object]
foreach ($record in $probeRecords) {
  if ($record.requirement -ne "REQUIRED") { continue }
  [void] $requiredAccumulator.Add($record)
  if ($record.status -ne "PRESENT") { [void] $missingAccumulator.Add($record) }
}
$required = ConvertTo-PolarisPlainArray $requiredAccumulator
$missing  = ConvertTo-PolarisPlainArray $missingAccumulator

# المعرّفات الناقصة: مصفوفة نصوص مبنية بالفهرسة لا بالأنبوب، فتبقى مصفوفة عند
# صفر وواحد وكثير. عنصر واحد يُفلت من الأنبوب كقيمة مفردة، وذلك يغيّر شكل JSON.
$missingIds = [object[]]::new($missing.Count)
for ($index = 0; $index -lt $missing.Count; $index += 1) {
  $missingIds[$index] = [string] $missing[$index].id
}

$verdict = "PASS"
$reasonCodes = [object[]]::new(0)
if ($missing.Count -gt 0) {
  $verdict = "FAIL"
  $reasonCodes = [object[]] @("P01_TOOLCHAIN_INCOMPLETE")
}
$reasonCode = ""
if ($reasonCodes.Count -gt 0) { $reasonCode = [string] $reasonCodes[0] }

$osInfo = Get-CimInstance -ClassName Win32_OperatingSystem
$csInfo = Get-CimInstance -ClassName Win32_ComputerSystem

$document = [pscustomobject] @{
  schema_version         = $script:SchemaVersion
  tool                   = $script:ToolName
  phase                  = "PHASE-01"
  claim_id               = "P01-B1"
  platform               = "win32"
  native                 = $true
  run_id                 = $script:RunId
  run_started            = $script:RunStarted
  measured_at            = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  repository_root        = $root.path
  root_resolution_method = $root.method
  host = [pscustomobject] @{
    powershell_version   = $PSVersionTable.PSVersion.ToString()
    powershell_edition   = [string] $PSVersionTable.PSEdition
    os_caption           = [string] $osInfo.Caption
    os_build             = [string] $osInfo.BuildNumber
    os_architecture      = [string] $osInfo.OSArchitecture
    logical_processors   = [int] $csInfo.NumberOfLogicalProcessors
    total_memory_bytes   = [long] $csInfo.TotalPhysicalMemory
  }
  probes  = $probeRecords
  summary = [pscustomobject] @{
    total            = $probeRecords.Count
    required         = $required.Count
    required_present = ($required.Count - $missing.Count)
    required_missing = $missing.Count
    missing_ids      = $missingIds
  }
  rules = @(
    "this document records a measurement of the host, never an installation",
    "an OPTIONAL probe never changes the verdict",
    "a REQUIRED probe that is ABSENT or ERROR makes the verdict FAIL",
    "downstream Phase-01 conditions that need a missing tool are BLOCKED, never NOT_TESTED and never PASS"
  )
  canonical         = $true
  evidence_complete = $true
  verdict           = $verdict
  reason_code       = $reasonCode
  reason_codes      = $reasonCodes
}

[void] (Write-PolarisJsonFile -Path $evidencePath -InputObject $document -Depth 8)

Write-Host ""
Write-Host "POLARIS  P01-B1  Phase-01 toolchain baseline"
Write-Host "--------------------------------------------"
foreach ($probe in $probeRecords) {
  $mark = " MISS "
  if ($probe.status -eq "PRESENT") { $mark = "  ok  " } elseif ($probe.requirement -eq "OPTIONAL") { $mark = " skip " }
  Write-Host ("{0} {1,-18} {2,-8} {3}" -f $mark, $probe.id, $probe.requirement, $probe.version)
}
Write-Host "--------------------------------------------"
Write-Host ("run_id  : {0}" -f $script:RunId)
Write-Host ("verdict : {0}" -f $verdict)
if ($missing.Count -gt 0) {
  Write-Host ("missing : {0}" -f ($missingIds -join ", "))
}
Write-Host ("evidence: {0}" -f $evidencePath)
Write-Host ""

if ($verdict -ne "PASS") { exit 2 }
exit 0
