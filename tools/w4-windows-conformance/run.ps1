#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-00 / W4 - Windows native conformance run.

.DESCRIPTION
  One runnable step. Resolves the repository root robustly, builds and verifies
  the contracts and runtime packages, then runs the Windows-only probes.

  Nothing in W4 claims a Windows result until this script has actually run on
  Windows and produced evidence\w4-windows-conformance.json.

  BOOTSTRAP CONTRACT
  ------------------
  Repository-root discovery never depends on a single mechanism, and never on
  $PSScriptRoot alone. $PSScriptRoot is populated only when the engine has a
  script FILE context. It is empty - or, under Set-StrictMode, undefined - when
  the script text is evaluated without one: piped to "powershell -Command -",
  passed through Invoke-Expression, dot-sourced from a string, run in an ISE
  immediate window, or executed by a wrapper host that does not set it.

  A previous revision used it inside a param() default:

      param([string] $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path)

  That fails during PARAMETER BINDING, before the body runs, with
  "Cannot bind argument to parameter 'Path' because it is an empty string." -
  and in some hosts the binding error does not stop the script, so it continues
  with an EMPTY root and reports failures that were never really tested.

  This revision therefore:
    - takes no computed parameter defaults at all;
    - tries an ordered list of root sources, each labelled;
    - validates every candidate against POLARIS repository markers;
    - canonicalises the winner;
    - fails with a typed, actionable error rather than continuing blind.

.PARAMETER RepositoryRoot
  Explicit repository root. When supplied it is used and validated, and no
  fallback is attempted: an explicit wrong answer must fail loudly.

.PARAMETER SelfCheck
  Resolve and validate the repository root, report the result, and exit without
  running any test. Use this to diagnose a bootstrap problem.

.PARAMETER Json
  Emit the machine-readable bootstrap record to stdout as well as to disk.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w4-windows-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w4-windows-conformance\run.ps1" -RepositoryRoot "D:\POLARIS" -SelfCheck
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot,
  [switch] $SelfCheck,
  [switch] $Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# The workspace this phase is mandated to run in. It is the LAST resort in the
# candidate order, never the only implementation path.
$script:DefaultRepositoryRoot = "D:\POLARIS"

# A directory is a POLARIS repository only if all of these exist. Markers are
# spread across packages, docs and this very harness, so a partial or unrelated
# tree cannot pass by accident.
$script:RepositoryMarkers = @(
  "contracts\package.json",
  "contracts\schemas",
  "runtime\package.json",
  "docs\phases\PHASE-00",
  "tools\w4-windows-conformance\windows-probes.mjs"
)

$script:BootstrapErrorCode = "WINDOWS_RUNNER_BOOTSTRAP_DEFECT"

function Get-SafeVariableValue {
  <#
    Reads an automatic variable without assuming it exists. Under Set-StrictMode
    a bare reference to an undefined variable throws, which is exactly the class
    of failure this function exists to avoid.
  #>
  param([Parameter(Mandatory = $true)][string] $Name)

  $variable = Get-Variable -Name $Name -Scope Script -ErrorAction SilentlyContinue
  if ($null -eq $variable) {
    $variable = Get-Variable -Name $Name -ErrorAction SilentlyContinue
  }
  if ($null -eq $variable) { return $null }
  return $variable.Value
}

function Get-NonEmptyString {
  param($Value)
  if ($null -eq $Value) { return $null }
  $text = [string] $Value
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  return $text
}

function Join-MarkerPath {
  <#
    Builds a marker path one segment at a time. The markers are written with
    Windows separators because that is the target platform, but they are split
    on either separator so the resolver itself stays testable off Windows.
  #>
  param([Parameter(Mandatory = $true)][string] $Root, [Parameter(Mandatory = $true)][string] $Marker)

  $path = $Root
  foreach ($segment in ($Marker -split '[\\/]')) {
    if ([string]::IsNullOrWhiteSpace($segment)) { continue }
    $path = Join-Path $path $segment
  }
  return $path
}

function Test-PolarisRepository {
  <# Returns the list of markers that are MISSING. Empty means valid. #>
  param([Parameter(Mandatory = $true)][string] $Path)

  $missing = New-Object System.Collections.Generic.List[string]
  foreach ($marker in $script:RepositoryMarkers) {
    $candidate = Join-MarkerPath -Root $Path -Marker $marker
    if (-not (Test-Path -LiteralPath $candidate)) { [void] $missing.Add($marker) }
  }
  return $missing.ToArray()
}

function ConvertTo-CanonicalPath {
  <#
    Canonicalises a path without requiring the provider to resolve wildcards.
    Get-Item is preferred because it returns the real on-disk casing and follows
    the filesystem, which is what "the same directory" has to mean here.
  #>
  param([Parameter(Mandatory = $true)][string] $Path)

  $expanded = [System.Environment]::ExpandEnvironmentVariables($Path)
  $full = $null
  try {
    if ([System.IO.Path]::IsPathRooted($expanded)) {
      $full = [System.IO.Path]::GetFullPath($expanded)
    } else {
      $full = [System.IO.Path]::GetFullPath((Join-Path (Get-Location).ProviderPath $expanded))
    }
  } catch {
    return $null
  }

  if (-not (Test-Path -LiteralPath $full -PathType Container)) { return $null }
  try {
    return (Get-Item -LiteralPath $full -Force).FullName.TrimEnd('\')
  } catch {
    return $full.TrimEnd('\')
  }
}

function Get-ScriptDirectoryCandidates {
  <#
    Every mechanism that can name this script's own location, in decreasing
    reliability. Each is read defensively; none is assumed to exist.
  #>
  $candidates = New-Object System.Collections.Generic.List[object]

  $fromScriptRoot = Get-NonEmptyString (Get-SafeVariableValue -Name "PSScriptRoot")
  if ($null -ne $fromScriptRoot) {
    [void] $candidates.Add([pscustomobject] @{ Source = 'PSScriptRoot'; Directory = $fromScriptRoot })
  }

  $fromCommandPath = Get-NonEmptyString (Get-SafeVariableValue -Name "PSCommandPath")
  if ($null -ne $fromCommandPath) {
    [void] $candidates.Add([pscustomobject] @{ Source = 'PSCommandPath'; Directory = (Split-Path -Parent $fromCommandPath) })
  }

  $invocation = Get-SafeVariableValue -Name "MyInvocation"
  if ($null -ne $invocation -and $null -ne $invocation.MyCommand) {
    $fromInvocationPath = $null
    try { $fromInvocationPath = Get-NonEmptyString $invocation.MyCommand.Path } catch { $fromInvocationPath = $null }
    if ($null -ne $fromInvocationPath) {
      [void] $candidates.Add([pscustomobject] @{ Source = 'MyInvocation.MyCommand.Path'; Directory = (Split-Path -Parent $fromInvocationPath) })
    }

    $fromDefinition = $null
    try { $fromDefinition = Get-NonEmptyString $invocation.MyCommand.Definition } catch { $fromDefinition = $null }
    # Definition is the script BODY when there is no file context, so it only
    # counts when it actually names an existing file.
    if ($null -ne $fromDefinition -and (Test-Path -LiteralPath $fromDefinition -PathType Leaf)) {
      [void] $candidates.Add([pscustomobject] @{ Source = 'MyInvocation.MyCommand.Definition'; Directory = (Split-Path -Parent $fromDefinition) })
    }
  }

  return $candidates.ToArray()
}

function Resolve-PolarisRepositoryRoot {
  <#
    Ordered, validated, canonicalising root discovery.

    Returns a record describing what was tried and what won. It never returns an
    unvalidated path, and it never returns an empty string.
  #>
  param([string] $Explicit)

  $attempts = New-Object System.Collections.Generic.List[object]

  function Add-Attempt {
    param([string] $Source, [string] $Candidate, [string] $Status, [string[]] $MissingMarkers)
    [void] $attempts.Add([pscustomobject] @{
      source          = $Source
      candidate       = $Candidate
      status          = $Status
      missing_markers = @($MissingMarkers)
    })
  }

  function Test-Candidate {
    param([string] $Source, [string] $Candidate)
    if ($null -eq (Get-NonEmptyString $Candidate)) {
      Add-Attempt -Source $Source -Candidate "" -Status "EMPTY" -MissingMarkers @()
      return $null
    }
    $canonical = ConvertTo-CanonicalPath -Path $Candidate
    if ($null -eq $canonical) {
      Add-Attempt -Source $Source -Candidate $Candidate -Status "NOT_A_DIRECTORY" -MissingMarkers @()
      return $null
    }
    # PowerShell يفكّ مصفوفة العنصر الواحد إلى قيمة مفردة ومصفوفة الصفر إلى $null.
    # الترشيح يتعامل مع الحالات الثلاث بلا حالة خاصة، ويجعل .Count صادقة.
    $missing = @(Test-PolarisRepository -Path $canonical | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($missing.Count -gt 0) {
      Add-Attempt -Source $Source -Candidate $canonical -Status "NOT_A_POLARIS_REPOSITORY" -MissingMarkers $missing
      return $null
    }
    Add-Attempt -Source $Source -Candidate $canonical -Status "ACCEPTED" -MissingMarkers @()
    return $canonical
  }

  # 1) An explicit argument is authoritative. If it is wrong we fail loudly
  #    rather than silently running somewhere else.
  $explicitText = Get-NonEmptyString $Explicit
  if ($null -ne $explicitText) {
    $resolved = Test-Candidate -Source "RepositoryRoot parameter" -Candidate $explicitText
    if ($null -ne $resolved) {
      return [pscustomobject] @{ root = $resolved; source = "RepositoryRoot parameter"; attempts = @($attempts.ToArray()) }
    }
    return [pscustomobject] @{ root = $null; source = $null; attempts = @($attempts.ToArray()) }
  }

  # 2-5) This script's own location, by every mechanism that can name it.
  foreach ($candidate in @(Get-ScriptDirectoryCandidates | Where-Object { $null -ne $_ })) {
    $directory = Get-NonEmptyString $candidate.Directory
    if ($null -eq $directory) {
      Add-Attempt -Source $candidate.Source -Candidate "" -Status "EMPTY" -MissingMarkers @()
      continue
    }
    # The harness lives at <root>\tools\w4-windows-conformance.
    $resolved = Test-Candidate -Source $candidate.Source -Candidate (Join-Path $directory "..\..")
    if ($null -ne $resolved) {
      return [pscustomobject] @{ root = $resolved; source = $candidate.Source; attempts = @($attempts.ToArray()) }
    }
  }

  # 6) An explicit environment override, for CI and wrapper hosts.
  $fromEnvironment = Get-NonEmptyString $env:POLARIS_ROOT
  if ($null -ne $fromEnvironment) {
    $resolved = Test-Candidate -Source "POLARIS_ROOT environment variable" -Candidate $fromEnvironment
    if ($null -ne $resolved) {
      return [pscustomobject] @{ root = $resolved; source = "POLARIS_ROOT environment variable"; attempts = @($attempts.ToArray()) }
    }
  }

  # 7) The current directory, if it happens to be a POLARIS repository.
  $resolved = Test-Candidate -Source "current directory" -Candidate (Get-Location).ProviderPath
  if ($null -ne $resolved) {
    return [pscustomobject] @{ root = $resolved; source = "current directory"; attempts = @($attempts.ToArray()) }
  }

  # 8) The mandated default workspace, last and still validated.
  $resolved = Test-Candidate -Source "mandated default workspace" -Candidate $script:DefaultRepositoryRoot
  if ($null -ne $resolved) {
    return [pscustomobject] @{ root = $resolved; source = "mandated default workspace"; attempts = @($attempts.ToArray()) }
  }

  return [pscustomobject] @{ root = $null; source = $null; attempts = @($attempts.ToArray()) }
}

function Write-BootstrapRecord {
  param([Parameter(Mandatory = $true)] $Record, [string] $Root)

  $target = $null
  if ($null -ne (Get-NonEmptyString $Root)) {
    try {
      # التسجيل مجهود أفضل: تعذّره لا يغيّر نتيجة الإقلاع ولا يُخفيها، ولا يجوز
      # أن يرمي فيحجب رسالة الفشل الحقيقية.
      $evidence = Join-Path $Root "evidence"
      if (-not (Test-Path -LiteralPath $evidence)) { New-Item -ItemType Directory -Path $evidence -Force | Out-Null }
      $target = Join-Path $evidence "w4-windows-runner-bootstrap.json"
      <#
        عقد البايتات: UTF-8 بلا BOM. الوحدة قد لا تكون محمَّلة بعد عند فشل
        إقلاع مبكر، والبديل أدناه يلتزم العقد نفسه حرفيًا.
      #>
      if (Get-Command Write-PolarisJsonFile -ErrorAction SilentlyContinue) {
        [void] (Write-PolarisJsonFile -Path $target -InputObject $Record -Depth 6)
      } else {
        $fallbackJson = ($Record | ConvertTo-Json -Depth 6)
        $fallbackText = ([string] ($fallbackJson -join "`n")).Replace("`r`n", "`n").Replace("`r", "`n")
        if (-not $fallbackText.EndsWith("`n")) { $fallbackText = $fallbackText + "`n" }
        [System.IO.File]::WriteAllText($target, $fallbackText, (New-Object System.Text.UTF8Encoding($false)))
      }
    } catch {
      $target = $null
    }
  }
  return $target
}

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

$resolution = Resolve-PolarisRepositoryRoot -Explicit $RepositoryRoot

$record = [ordered] @{
  harness           = "polaris.w4.windows-conformance.runner"
  harness_version   = "1.1.0"
  checked_at        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
  powershell        = $PSVersionTable.PSVersion.ToString()
  host              = $Host.Name
  platform          = [System.Environment]::OSVersion.VersionString
  script_root_variable_populated = ($null -ne (Get-NonEmptyString (Get-SafeVariableValue -Name "PSScriptRoot")))
  explicit_argument = (Get-NonEmptyString $RepositoryRoot)
  resolved_root     = $resolution.root
  resolved_from     = $resolution.source
  required_markers  = $script:RepositoryMarkers
  attempts          = $resolution.attempts
  status            = "RESOLVED"
  error_code        = $null
}

if ($null -eq $resolution.root) {
  $record.status = "FAILED"
  $record.error_code = $script:BootstrapErrorCode

  $written = Write-BootstrapRecord -Record $record -Root $script:DefaultRepositoryRoot
  # الاسم مختلف عن المعامل $Json عمدًا: أسماء المتغيرات هنا غير حسّاسة للحالة،
  # وإسناد نص إلى معامل [switch] يرمي قبل أن تصل رسالة الفشل إلى المستخدم.
  $recordJson = $record | ConvertTo-Json -Depth 6

  Write-Host ""
  Write-Host "POLARIS W4 Windows conformance - BOOTSTRAP FAILED" -ForegroundColor Red
  Write-Host "error_code : $($script:BootstrapErrorCode)"
  Write-Host "reason     : the repository root could not be determined or did not validate."
  Write-Host ""
  Write-Host "This is a RUNNER BOOTSTRAP defect. No security claim was tested, and no"
  Write-Host "confinement result is implied. Nothing about W4 conformance follows from it."
  Write-Host ""
  Write-Host "candidates tried:"
  foreach ($attempt in @($resolution.attempts)) {
    $missing = ""
    $missingMarkers = @($attempt.missing_markers | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($missingMarkers.Count -gt 0) {
      $missing = " (missing: " + ($missingMarkers -join ", ") + ")"
    }
    Write-Host ("  {0,-34} {1,-26} {2}{3}" -f $attempt.source, $attempt.status, $attempt.candidate, $missing)
  }
  Write-Host ""
  Write-Host "fix: pass the root explicitly."
  Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\w4-windows-conformance\run.ps1" -RepositoryRoot "D:\POLARIS"'
  if ($null -ne $written) { Write-Host ""; Write-Host "record: $written" }
  if ($Json) { Write-Output $recordJson }
  exit 2
}

$RepositoryRoot = $resolution.root
<#
  عقد بايتات الدليل: كاتب JSON واحد لكل المشروع.

  Set-Content -Encoding UTF8 على Windows PowerShell 5.1 يكتب BOM (EF BB BF)،
  وقد أسقط ذلك سبعة اختبارات JSON.parse في التشغيل الأصلي الثالث. الكتابة
  تمرّ من هنا فقط.
#>
$jsonEvidenceModule = Join-Path $RepositoryRoot 'tools\evidence-contract\json-evidence.ps1'
if (-not (Test-Path -LiteralPath $jsonEvidenceModule)) {
  throw "BLOCKED: the JSON evidence byte contract module is missing at $jsonEvidenceModule"
}
. $jsonEvidenceModule

$bootstrapRecordPath = Write-BootstrapRecord -Record $record -Root $RepositoryRoot

Write-Host "POLARIS W4 Windows conformance"
Write-Host "repository : $RepositoryRoot"
Write-Host "resolved by: $($resolution.source)"
Write-Host "powershell : $($PSVersionTable.PSVersion) ($($Host.Name))"
Write-Host "platform   : $([System.Environment]::OSVersion.VersionString)"
if ($Json) { Write-Output ($record | ConvertTo-Json -Depth 6) }

if ($SelfCheck) {
  Write-Host ""
  Write-Host "SELF-CHECK OK - repository root resolved and validated. No test was run."
  if ($null -ne $bootstrapRecordPath) { Write-Host "record: $bootstrapRecordPath" }
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "BOOTSTRAP FAILED: node is not on PATH." -ForegroundColor Red
  Write-Host "error_code : $($script:BootstrapErrorCode)"
  exit 2
}

# npm يُستدعى بـ npm.cmd على ويندوز. الاعتماد على npm.ps1 يخضع لسياسة التنفيذ
# ويكسر التشغيل الآلي بلا سبب، وهو ما لا نريده في مشغّل بأمر واحد.
$script:NpmCommand = $null
foreach ($candidate in @('npm.cmd', 'npm')) {
  $resolved = Get-Command $candidate -ErrorAction SilentlyContinue
  if ($null -ne $resolved) { $script:NpmCommand = $resolved.Source; break }
}
if ($null -eq $script:NpmCommand) {
  Write-Host ""
  Write-Host "BOOTSTRAP FAILED: npm is not on PATH." -ForegroundColor Red
  Write-Host "error_code : $($script:BootstrapErrorCode)"
  exit 2
}

# هويّة النظام كما يراها Node نفسه، فتُقارَن بما تكتبه البوابة والاختبارات.
# تُقاس مرة واحدة: نداء أمر أصلي داخل دالة يسرّب مخرجاته إلى مجرى الإخراج.
$platformLines = @(& node -p "process.platform")
if (($LASTEXITCODE -ne 0) -or ($platformLines.Count -eq 0)) {
  Write-Host ""
  Write-Host "BOOTSTRAP FAILED: node could not report its platform." -ForegroundColor Red
  Write-Host "error_code : $($script:BootstrapErrorCode)"
  exit 2
}
$script:HostPlatform = ([string] $platformLines[$platformLines.Count - 1]).Trim()
$script:HostStampName = '.polaris-host.json'

Write-Host "node       : $(node --version)"
Write-Host "npm        : $script:NpmCommand"
Write-Host "platform   : $script:HostPlatform"
Write-Host ""

<#
  نسخة نصية كاملة للتشغيل. الفشل الذي لا يُسجَّل لا يُشخَّص، وخطوة تفشل قبل
  كتابة الدليل المنظّم كانت تترك المالك وحده أمام شاشة الطرفية. Start-Transcript
  لا يمسّ أي أنبوب ولا يغيّر ErrorActionPreference، فهو أقل تدخّل ممكن.
#>
$script:TranscriptPath = Join-Path $RepositoryRoot 'evidence\w4-windows-run-transcript.log'
$script:TranscriptStarted = $false
try {
  $evidenceDirectory = Join-Path $RepositoryRoot 'evidence'
  if (-not (Test-Path -LiteralPath $evidenceDirectory)) { New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null }
  Start-Transcript -LiteralPath $script:TranscriptPath -Force | Out-Null
  $script:TranscriptStarted = $true
  Write-Host "transcript : $script:TranscriptPath"
  Write-Host ""
} catch {
  Write-Host "transcript : unavailable on this host ($($_.Exception.Message))"
  Write-Host ""
}

function Stop-RunTranscript {
  if (-not $script:TranscriptStarted) { return }
  try { Stop-Transcript | Out-Null } catch { }
  $script:TranscriptStarted = $false
}

Set-Location -LiteralPath $RepositoryRoot

# ---------------------------------------------------------------------------
# Conformance
# ---------------------------------------------------------------------------

$script:Steps = New-Object System.Collections.Generic.List[object]

function Invoke-Step {
  param([string] $Name, [scriptblock] $Body)
  Write-Host "--- $Name"
  $started = Get-Date
  $global:LASTEXITCODE = 0
  & $Body
  $code = $LASTEXITCODE
  [void] $script:Steps.Add([pscustomobject] @{
    name        = $Name
    exit_code   = $code
    duration_ms = [int]((Get-Date) - $started).TotalMilliseconds
  })
  if ($code -ne 0) { throw "$Name failed with exit code $code" }
}

<#
  خطوة تُسجَّل ولا توقف التشغيل. تُستعمل لما بعد بناء المحوّل: نتيجته يجب أن
  تُكتب في الدليل مهما كانت، لأن تقريرًا مفقودًا أسوأ من تقرير يقول "فشل".
#>
function Invoke-SoftStep {
  param([string] $Name, [scriptblock] $Body)
  Write-Host "--- $Name"
  $started = Get-Date
  $global:LASTEXITCODE = 0
  # المخرجات تذهب إلى المضيف مباشرة. لو بقيت في مجرى الإخراج لاختلطت بقيمة
  # الإرجاع، وهو العيب نفسه الذي حرست منه بوابة حلّ الحزم.
  & $Body 2>&1 | Out-Host
  $code = $LASTEXITCODE
  [void] $script:Steps.Add([pscustomobject] @{
    name        = $Name
    exit_code   = $code
    duration_ms = [int]((Get-Date) - $started).TotalMilliseconds
  })
  $script:LastSoftStepCode = $code
}

function Get-FileHashOrEmpty {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return "" }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

<#
  التبعيات: وجود مجلد node_modules ليس دليلًا على صحّته.

  العيب الذي أوقف التشغيل الأصلي الثالث: شجرة node_modules أنشأها نظام تشغيل
  آخر على نفس القرص، فحملت رابط ‎@polaris/contracts‎ بصيغة لا يجتازها ويندوز.
  المشغّل القديم كان يرى المجلد موجودًا فيتخطّى التثبيت، فيفشل tsc بـ TS2307
  بينما كل شيء يبدو مثبَّتًا. لذلك يُقاس هنا وجود كل تبعية مُعلَنة فعلًا، ثم
  يُقاس الحلّ نفسه في بوابة مستقلة بعد بناء العقود.

  npm ci يحترم ملف القفل ولا يعدّله — ويفشل إن كان غير متسق، وهو السلوك المطلوب.
  لا npm install، ولا npm audit fix، ولا ترقية تلقائية أثناء تشغيل المطابقة.
#>
<#
  ختم المضيف. node_modules ملك للنظام الذي كتبه: روابط .bin على لينكس ملفات
  رمزية، وعلى ويندوز ملفات .cmd/.ps1 — فشجرةٌ صالحة هناك عاجزة هنا حتى حين
  تُقرأ كل حزمة فيها. الختم يجعل ملكيّة الشجرة قابلة للقياس بدل الاستنتاج من
  فشل اجتياز رابط.
#>
function Write-HostStamp {
  param([string] $PackagePath)

  $stamp = [ordered] @{
    platform   = $script:HostPlatform
    node       = (@(& node --version)[-1])
    npm        = $script:NpmCommand
    written_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
  }
  $path = Join-Path (Join-Path $PackagePath 'node_modules') $script:HostStampName
  [void] (Write-PolarisJsonFile -Path $path -InputObject $stamp -Depth 3)
}

function Test-HostStamp {
  param([string] $PackagePath)

  $path = Join-Path (Join-Path $PackagePath 'node_modules') $script:HostStampName
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  try {
    $stamp = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $recorded = [string] $stamp.platform
  } catch {
    # ختم غير مقروء أو بلا حقل platform: شجرة لا نعرف من كتبها ليست شجرتنا.
    return $false
  }
  return ($recorded -eq $script:HostPlatform)
}

function Test-DeclaredDependenciesPresent {
  param([string] $PackagePath)

  $modules = Join-Path $PackagePath 'node_modules'
  if (-not (Test-Path -LiteralPath $modules)) { return $false }
  # شجرة بلا ختم، أو بختم نظام آخر، ليست شجرة هذا المضيف.
  if (-not (Test-HostStamp -PackagePath $PackagePath)) { return $false }

  $manifest = Get-Content -LiteralPath (Join-Path $PackagePath 'package.json') -Raw | ConvertFrom-Json
  $names = @()
  foreach ($section in @('dependencies', 'devDependencies')) {
    if (($manifest.PSObject.Properties.Name -contains $section) -and ($null -ne $manifest.$section)) {
      $names += @($manifest.$section.PSObject.Properties.Name)
    }
  }
  foreach ($name in $names) {
    # الرابط الذي لا يجتازه هذا النظام يفشل هنا تمامًا كما لو كان غائبًا،
    # وهو المطلوب: شجرة نظام آخر ليست شجرة صالحة.
    $candidate = Join-Path $modules ($name -replace '/', '\')
    if (-not (Test-Path -LiteralPath (Join-Path $candidate 'package.json'))) { return $false }
  }
  return $true
}

<#
  الروابط تُحذف أولًا وبمفردها، قبل أي حذف تعاودي. npm يضع الروابط في مستويين
  فقط: node_modules\<name> و node_modules\@scope\<name>، فيُمسحان بلا تعاود وبلا
  اجتياز — Directory::Delete بلا تعاود يحذف نقطة إعادة التحليل لا هدفها.
#>
function Remove-DependencyLinks {
  param([string] $Modules)

  $reparse = [System.IO.FileAttributes]::ReparsePoint
  foreach ($entry in @(Get-ChildItem -LiteralPath $Modules -Force -Directory -ErrorAction SilentlyContinue)) {
    if (($entry.Attributes -band $reparse) -eq $reparse) {
      try { [System.IO.Directory]::Delete($entry.FullName, $false) } catch { }
      continue
    }
    if ($entry.Name -notlike '@*') { continue }
    foreach ($scoped in @(Get-ChildItem -LiteralPath $entry.FullName -Force -Directory -ErrorAction SilentlyContinue)) {
      if (($scoped.Attributes -band $reparse) -eq $reparse) {
        try { [System.IO.Directory]::Delete($scoped.FullName, $false) } catch { }
      }
    }
  }
}

<#
  الحذف لا يجوز أن يتبع رابطًا. rmdir لا يتبع نقاط إعادة التحليل فيحذف الرابط
  لا هدفه، بينما Remove-Item -Recurse في PowerShell 5.1 قد يتبعه — والهدف هنا
  هو مجلد العقود نفسه. الروابط تُزال أولًا، ثم يُحذف الباقي، ثم يُتحقق أن
  العقود ما تزال قائمة.
#>
function Remove-NodeModules {
  param([string] $PackagePath)

  $modules = Join-Path $PackagePath 'node_modules'
  if (-not (Test-Path -LiteralPath $modules)) { return }

  Remove-DependencyLinks -Modules $modules

  # لا 2>&1 هنا: إعادة توجيه مجرى الخطأ من أمر أصلي تصنعه سجلات خطأ، ومع
  # ErrorActionPreference = Stop ترمي قبل أن يعمل الاحتياطي التالي.
  try { & cmd.exe /c "rmdir /s /q `"$modules`"" | Out-Null } catch { }
  if (Test-Path -LiteralPath $modules) {
    [System.IO.Directory]::Delete($modules, $true)
  }
  if (Test-Path -LiteralPath $modules) {
    throw "could not remove $modules; a stale dependency tree cannot be repaired while it is in use."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot 'contracts\package.json'))) {
    throw "FATAL: removing $modules followed a link into the contracts package. The source of truth is gone; restore it before running anything."
  }
}

function Initialize-Package {
  param([string] $PackageName, [switch] $Force)

  $packagePath = Join-Path $RepositoryRoot $PackageName
  $lockFile = Join-Path $packagePath 'package-lock.json'
  $before = Get-FileHashOrEmpty -Path $lockFile
  $healthy = Test-DeclaredDependenciesPresent -PackagePath $packagePath
  $installed = $false

  if ($Force -or (-not $healthy)) {
    if ($Force) {
      Write-Host "--- $PackageName : package resolution was not provable, reinstalling from the lockfile"
    } else {
      Write-Host "--- $PackageName : the dependency tree is absent, unreadable, or written by another host - running npm ci"
    }
    Remove-NodeModules -PackagePath $packagePath
    Push-Location -LiteralPath $packagePath
    try {
      & $script:NpmCommand 'ci'
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed for $PackageName with exit code $LASTEXITCODE" }
    } finally {
      Pop-Location
    }
    Write-HostStamp -PackagePath $packagePath
    $installed = $true
  } else {
    Write-Host "--- $PackageName : host-owned dependency tree, complete, no install"
  }

  $after = Get-FileHashOrEmpty -Path $lockFile
  if ($before -ne "" -and $before -ne $after) {
    throw "$PackageName package-lock.json changed during the conformance run. Dependency changes are a deliberate act, never a side effect of running the harness."
  }
  return [pscustomobject] @{ package = $PackageName; lockfile_sha256 = $after; installed = $installed; forced = [bool] $Force }
}

<#
  البوابة: هل تحلّ runtime حزمة العقود على هذا المضيف فعلًا — بناءً وتحميلًا
  وأنواعًا؟ تُشغَّل بعد بناء العقود وقبل التحقّق من runtime وقبل أي مسبار أصلي.
  فشلها عيب إقلاع مُصنَّف، ولا يقول شيئًا عن الحصر.
#>
$script:PackageResolutionGate = Join-Path $RepositoryRoot 'tools\package-resolution\check-package-graph.mjs'
$script:PackageResolutionEvidence = Join-Path $RepositoryRoot 'evidence\w4-package-resolution.json'
$script:PackageErrorClass = "WINDOWS_PACKAGE_RESOLUTION_BOOTSTRAP_DEFECT"

<#
  العيب الذي أوقف التشغيل الأصلي الرابع، وهو عيب لغة لا عيب حزم:

      & node ...            # stdout الأمر الأصلي يدخل مجرى إخراج الدالة
      return $LASTEXITCODE  # فتعود مصفوفة: كل سطر طُبع، ثم رمز الخروج

  عند المُنادي صار ‎$gateCode‎ من نوع Object[]، و‎-ne 0‎ على مصفوفة عمليةُ ترشيح
  لا مقارنة: تُرجع العناصر غير المساوية للصفر، وهي غير فارغة، فتُقرأ صوابًا.
  فأعلن المشغّل فشلًا بينما البوابة كتبت PASS 9/9، ولم يظهر أيٌّ من سطورها في
  النسخة النصية لأنها ابتُلعت في القيمة المُعادة.

  العلاج: مخرجات الأمر تذهب إلى المضيف مباشرة (فتُرى وتُسجَّل)، ولا يبقى في
  مجرى الإخراج إلا عدد صحيح واحد.
#>
function Invoke-PackageResolutionGate {
  $global:LASTEXITCODE = 0
  & node $script:PackageResolutionGate --root $RepositoryRoot | Out-Host
  return [int] $LASTEXITCODE
}

function Read-PackageResolutionRecord {
  if (-not (Test-Path -LiteralPath $script:PackageResolutionEvidence)) { return $null }
  try {
    return (Get-Content -LiteralPath $script:PackageResolutionEvidence -Raw | ConvertFrom-Json)
  } catch {
    return $null
  }
}

# ترتيب الاعتماد إلزامي. مع install-links يحزم npm مجلد العقود ويثبّت ناتجه،
# فتثبيت runtime قبل بناء العقود يُنتج حزمة بلا dist: ينجح التثبيت ولا يُحلّ
# شيء. العقود تُثبَّت وتُبنى أولًا، ثم تُحزَم وتُثبَّت داخل runtime.
$lockState = @()
$lockState += Initialize-Package -PackageName 'contracts'

Invoke-Step "contracts: verify" {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot "contracts")
  try { & $script:NpmCommand 'run' 'verify' } finally { Pop-Location }
}

$lockState += Initialize-Package -PackageName 'runtime'

# ── بوابة حلّ الحزم ─────────────────────────────────────────────────────────
# العقود بُنيت للتو، فالسؤال الآن مشروع: هل تصل runtime إليها؟

Write-Host "--- package resolution gate"
$gateStarted = Get-Date
$gateCode = Invoke-PackageResolutionGate
# حارس صريح: إن عاد يومًا شيء غير عدد صحيح، فقد سُرِّبت مخرجات إلى مجرى الإخراج
# من جديد. يفشل هنا بصوت عالٍ بدل أن يُقرأ كفشل بوابة.
if ($gateCode -isnot [int]) {
  throw "the package resolution gate returned $($gateCode.GetType().FullName), not an exit code. Native command output is leaking into the function's output stream."
}
$gateRepaired = $false

if ($gateCode -ne 0) {
  $record = Read-PackageResolutionRecord
  $failureCode = if ($null -ne $record) { [string] $record.error_code } else { "" }
  # ما لا يُصلحه تثبيت لا يُعاد تثبيته: عيب في الشجرة نفسها أو في البناء.
  $repairable = @(
    'POLARIS_DEPENDENCIES_NOT_INSTALLED',
    'POLARIS_PACKAGE_MATERIALIZATION_MISSING',
    'POLARIS_PACKAGE_MATERIALIZATION_FOREIGN',
    'POLARIS_PACKAGE_MATERIALIZATION_STALE',
    'POLARIS_PACKAGE_MATERIALIZATION_UNCLEAN',
    'POLARIS_PACKAGE_RESOLUTION_UNPROVEN',
    'POLARIS_PACKAGE_TYPES_UNRESOLVED'
  ) -contains $failureCode

  if ($repairable) {
    Write-Host ""
    Write-Host "package resolution is not provable on this host ($failureCode)." -ForegroundColor Yellow
    Write-Host "repairing the runtime dependency tree once, from the lockfile, then re-checking."
    $lockState += Initialize-Package -PackageName 'runtime' -Force
    $gateRepaired = $true
    $gateCode = Invoke-PackageResolutionGate
    if ($gateCode -isnot [int]) { throw "the package resolution gate returned a non-integer after repair." }
  }
}

[void] $script:Steps.Add([pscustomobject] @{
  name        = "package resolution gate"
  exit_code   = $gateCode
  duration_ms = [int]((Get-Date) - $gateStarted).TotalMilliseconds
})

if ($gateCode -ne 0) {
  $record = Read-PackageResolutionRecord
  $failureCode = if ($null -ne $record) { [string] $record.error_code } else { "unknown" }
  Write-Host ""
  Write-Host "POLARIS W4 Windows conformance - PACKAGE RESOLUTION FAILED" -ForegroundColor Red
  Write-Host "error_code : $failureCode"
  Write-Host "class      : $($script:PackageErrorClass)"
  Write-Host "repaired   : $gateRepaired (a reinstall from the lockfile was attempted and did not fix it)"
  Write-Host ""
  Write-Host "runtime cannot resolve @polaris/contracts on this machine. This is a PACKAGE"
  Write-Host "GRAPH defect. No security claim was tested, no probe ran, and no confinement"
  Write-Host "result is implied. W-11 and W-12 remain NOT_EXECUTED_THIS_RUN."
  Write-Host ""
  Write-Host "evidence: $($script:PackageResolutionEvidence)"
  Stop-RunTranscript
  exit 2
}

<#
  ترتيب هذه الخطوات ليس تفضيلًا، بل تصحيح جمود حقيقي.

  العيب: "runtime: verify" كان يسبق بناء المحوّل وتشغيل المسابر، بينما اختبار
  داخل حزمة runtime يقرأ دليل المسابر ويشترط نظافته. فكان المشغّل يموت عند
  اختبارات runtime بسبب دليل تشغيل سابق، فلا يصل أبدًا إلى بناء المحوّل ولا إلى
  المسابر التي تنتج الدليل الجديد. حلقة مغلقة: لا يمكن أن تصير خضراء أبدًا،
  ولا يظهر السبب الحقيقي في أي مخرَج.

  الترتيب الصحيح يتبع اتجاه الاعتماد:
    1) بناء runtime (typecheck + build) — المسابر تحتاج dist وفيه منفّذ W4.
    2) بناء المحوّل الأصلي — المسابر تحتاج الثنائي.
    3) المسابر — تنتج الدليل.
    4) اختبارات runtime — تستهلك الدليل الطازج الذي أنتجته الخطوة 3.
#>
Invoke-Step "runtime: build" {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot "runtime")
  try {
    & $script:NpmCommand 'run' 'typecheck'
    if ($LASTEXITCODE -ne 0) { return }
    & $script:NpmCommand 'run' 'build'
  } finally { Pop-Location }
}

# المحوّل الأصلي يُبنى بمُصرِّف C# المدمج في ويندوز. لا حزم، ولا شبكة.
# فشل البناء عائق مُصنَّف: بلا ثنائي لم يُقَس شيء عن المقابض ولا عن الحصر.
<#
  فحص ساكن لمصدر المحوّل قبل تصريفه: توازن الأقواس، وبنى لغة أحدث مما يفهمه
  المصرّف المدمج، واستدعاء عضو ساكن لم يعد معلنًا. ليس مصرّفًا ولا يُدّعى ذلك،
  لكنه يمنع صنفًا كاملًا من الأخطاء قبل أن يُهدر عليها تشغيل أصلي.
#>
Invoke-Step "windows adapter: static check" {
  & node (Join-Path $RepositoryRoot 'tools\w4-windows-adapter\static-check.mjs')
}

Invoke-Step "windows adapter: build" {
  & (Join-Path $RepositoryRoot 'tools\w4-windows-adapter\build.ps1') -RepositoryRoot $RepositoryRoot
  if (-not $?) { $global:LASTEXITCODE = 1 }
}

$script:AdapterPath = Join-Path $RepositoryRoot 'tools\w4-windows-adapter\bin\polaris-w4-windows-adapter.exe'
if (-not (Test-Path -LiteralPath $script:AdapterPath)) {
  Write-Host ""
  Write-Host "POLARIS W4 Windows conformance - ADAPTER_BUILD_FAILED" -ForegroundColor Red
  Write-Host "error_code : ADAPTER_BUILD_FAILED"
  Write-Host "the adapter build step reported success but produced no binary at:"
  Write-Host "  $script:AdapterPath"
  Write-Host "No security claim was tested, no probe ran, and no confinement result is implied."
  Write-Host "W-11 and W-12 remain NOT_EXECUTED_THIS_RUN."
  Stop-RunTranscript
  exit 4
}

<#
  بوابة شكل كتلة البيئة، قبل أي قياس.

  لماذا هنا: كتلة بيئة مشوّهة تُرجع من CreateProcessW أرقام Win32 لا تصف سببها —
  ERROR_ENVVAR_NOT_FOUND من بينها — فيُشخَّص العَرَض بدل العلة ويُهدر تشغيل أصلي
  كامل. الثنائي نفسه — المُصرَّف بـcsc.exe في الخطوة السابقة — يبني كتلة، ثم يقرأ
  الذاكرة التي حجزها، ثم يقارنها بالخريطة المقصودة.

  هذه بوابة شكل لا قياس حصر: نجاحها لا يُقرأ نتيجةً لـW-11 ولا لـW-12.
#>
Invoke-Step "windows adapter: environment block self-test" {
  & $script:AdapterPath '--mode' 'env-block-selftest' '--report' `
    (Join-Path $RepositoryRoot 'evidence\w4-windows-environment-block-selftest.json') | Out-Null
}

# العلامة التي تجعل الدليل القانوني ملكًا لهذا المشغّل وحده. أي تشغيل آخر
# للمسابر — من اختبار مثلًا — يكتب باسم ad-hoc ولا ينتحل الدليل الأصلي.
$env:POLARIS_W4_NATIVE_RUN = '1'

# المسابر واختبارات runtime لا تُوقف التشغيل برميّة: التقرير يجب أن يُكتب في كل
# الحالات، وإلا بقي evidence\w4-windows-run.json من تشغيل قديم يناقض ما جرى فعلًا.
Invoke-SoftStep "windows probes" {
  node (Join-Path $RepositoryRoot "tools\w4-windows-conformance\windows-probes.mjs") --root $RepositoryRoot
}
$probeCode = $script:LastSoftStepCode

# العلامة تُرفع فور انتهاء المسابر. لو بقيت في البيئة لورثتها اختبارات runtime،
# ولاستطاع اختبار يستدعي المسابر أن يكتب فوق الدليل القانوني من جديد — وهو العيب
# نفسه الذي عُولج، عائدًا من باب آخر.
Remove-Item Env:\POLARIS_W4_NATIVE_RUN -ErrorAction SilentlyContinue

Invoke-SoftStep "runtime: test" {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot "runtime")
  try { & $script:NpmCommand 'run' 'test' } finally { Pop-Location }
}
$runtimeTestCode = $script:LastSoftStepCode

# ---------------------------------------------------------------------------
# Teardown verification
# ---------------------------------------------------------------------------

# لا ناجين: المحوّل يهدم الـJob، وهذا فحص مستقل عنه.
$survivors = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*host-main.js*' })
$leftoverProfiles = @()
try {
  $profileRoot = Join-Path $env:LOCALAPPDATA 'Packages'
  if (Test-Path -LiteralPath $profileRoot) {
    $leftoverProfiles = @(Get-ChildItem -LiteralPath $profileRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like 'polaris-w4-exec*' } | Select-Object -ExpandProperty Name)
  }
} catch { $leftoverProfiles = @() }

$conformance = Join-Path $RepositoryRoot 'evidence\w4-windows-conformance.json'
$probeSummary = $null
if (Test-Path -LiteralPath $conformance) {
  $probeSummary = (Get-Content -LiteralPath $conformance -Raw | ConvertFrom-Json).summary
}

$runRecord = [ordered] @{
  harness         = 'polaris.w4.windows-conformance.runner'
  harness_version = '1.5.0'
  ran_at          = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
  repository_root = $RepositoryRoot
  powershell      = $PSVersionTable.PSVersion.ToString()
  node            = (node --version)
  npm             = $script:NpmCommand
  steps           = $script:Steps
  dependency_state = $lockState
  transcript      = $script:TranscriptPath
  package_resolution = [ordered] @{
    status          = 'PASS'
    repaired        = $gateRepaired
    materialization = 'PACKED_PACKAGE'
    evidence        = $script:PackageResolutionEvidence
    strategy        = 'npm local file: dependency with install-links=true - npm packs ../contracts and installs it as an ordinary node_modules package; no symlink, no junction, no cross-OS link'
  }
  probe_summary   = $probeSummary
  adapter = [ordered] @{
    path   = $script:AdapterPath
    built  = (Test-Path -LiteralPath $script:AdapterPath)
    sha256 = (Get-FileHashOrEmpty -Path $script:AdapterPath)
  }
  probe_exit_code        = $probeCode
  runtime_test_exit_code = $runtimeTestCode
  surviving_execution_hosts = @($survivors | ForEach-Object { $_.ProcessId })
  leftover_appcontainer_profiles = $leftoverProfiles
}
$runRecordPath = Join-Path $RepositoryRoot 'evidence\w4-windows-run.json'
[void] (Write-PolarisJsonFile -Path $runRecordPath -InputObject $runRecord -Depth 8)

Write-Host ""
Write-Host "evidence:"
Write-Host "  $conformance"
Write-Host "  $runRecordPath"
Write-Host "  $(Join-Path $RepositoryRoot 'evidence\w4-windows-x03.json')"
Write-Host "  $(Join-Path $RepositoryRoot 'evidence\w4-windows-confined-exec.json')"
Write-Host "  $(Join-Path $RepositoryRoot 'evidence\w4-windows-environment-block-selftest.json')"

if ($survivors.Count -gt 0) {
  Write-Host ""
  Write-Host "CLEANUP FAILED: $($survivors.Count) execution host process(es) survived." -ForegroundColor Red
  Stop-RunTranscript
  exit 3
}
<#
  ملف تعريف باقٍ ليس تحذيرًا. التنظيف جزء من الحكم: تشغيل ينجح تنفيذيًا ثم يترك
  ملف تعريف AppContainer خلفه لم يُنظَّف، والتشغيل التالي يبدأ في بيئة غير نظيفة.
#>
if ($leftoverProfiles.Count -gt 0) {
  Write-Host ""
  Write-Host "CLEANUP FAILED: leftover AppContainer profile(s): $($leftoverProfiles -join ', ')" -ForegroundColor Red
  Write-Host "error_code : CLEANUP_LEFTOVER_APPCONTAINER_PROFILE"
  Write-Host "Execution semantics are not the whole verdict. Remove the profile and run again."
  Stop-RunTranscript
  exit 3
}
$inconclusive = if ($null -ne $probeSummary -and $null -ne $probeSummary.inconclusive) { [int] $probeSummary.inconclusive } else { 0 }
$notTested = if ($null -ne $probeSummary -and $null -ne $probeSummary.not_tested) { [int] $probeSummary.not_tested } else { 0 }
if ($null -ne $probeSummary -and (($probeSummary.failed -gt 0) -or ($probeSummary.blocked -gt 0) -or ($inconclusive -gt 0) -or ($notTested -gt 0))) {
  Write-Host ""
  Write-Host "CONFORMANCE NOT CLEAN: failed=$($probeSummary.failed) blocked=$($probeSummary.blocked) inconclusive=$inconclusive not_tested=$notTested" -ForegroundColor Red
  foreach ($probe in (Get-Content -LiteralPath $conformance -Raw | ConvertFrom-Json).probes) {
    if ($probe.status -ne 'PASS' -and $probe.status -ne 'SKIPPED') {
      Write-Host ("  {0,-13} {1}  [{2}] {3}" -f $probe.status, $probe.probe_id, $probe.reason_code, $probe.detail)
    }
  }
  Stop-RunTranscript
  exit 1
}
if ($probeCode -ne 0) {
  Write-Host ""
  Write-Host "the probe process exited $probeCode without a matching summary. Treating the run as not clean." -ForegroundColor Red
  Stop-RunTranscript
  exit 1
}
if ($runtimeTestCode -ne 0) {
  Write-Host ""
  Write-Host "REGRESSION: the runtime test suite failed AFTER a clean probe run (exit $runtimeTestCode)." -ForegroundColor Red
  Write-Host "This is a runtime defect, not a Windows confinement defect - the probes above passed."
  Stop-RunTranscript
  exit 5
}
Write-Host ""
Write-Host "conformance run complete."
Stop-RunTranscript
