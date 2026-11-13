#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-00 / W5 - path contract for the runner's package refresh.

.DESCRIPTION
  هذا الملف لا يُشغَّل وحده. يُنقَّط (dot-source) داخل مشغّل W5 قبل أي عمل على
  نظام الملفات في مرحلة تحديث الحزم.

  العيب الذي يغلقه، حرفيًا: بُني مسار الحزمة المثبَّتة من نصّ حرفي واحد حمل
  محرف سطر جديد داخله، فوصل إلى Test-Path قيمةً تحوي 0x0A:

      Test-Path : Illegal characters in path.

  الدرس ليس "نظّف القيمة قبل Test-Path". الدرس أن مسارًا يُمرَّر إلى
  Remove-Item -Recurse -Force يجب أن يُثبَت قبل استعماله: نوعه، وعدده،
  وقانونيته، وموضعه. التنظيف بعد الفساد يجعل الحذف يعمل على قيمة لم يقصدها
  أحد؛ والإثبات قبل الاستعمال يمنع أن تُبنى أصلًا.

  كل دالة هنا تُعيد قيمة واحدة على مجرى النجاح ولا شيء غيرها. التشخيص يخرج
  على Write-Verbose، لأن سطرًا نصّيًا واحدًا يُكتب سهوًا على مجرى النجاح
  يحوّل مسارًا مفردًا إلى مصفوفة من قيمتين عند المستدعي — وهو صنف العيب نفسه
  من باب آخر.
#>

Set-StrictMode -Version Latest

$script:PathContractErrorPrefix        = "PATH CONTRACT"
$script:PackageRefreshUnsafePrefix     = "DESTINATION UNSAFE"
$script:PackageRefreshUnsafeReasonCode = "PACKAGE_REFRESH_DESTINATION_UNSAFE"
$script:PathContractReasonCode         = "W5_PACKAGE_REFRESH_PATH_DEFECT"

<#
  تمثيل تشخيصي آمن لقيمة يُشتبه بها.

  لا يُطبع الخام أبدًا: القيمة التي كسرت التشغيل تحوي محارف تحكّم، وطباعتها
  كما هي تُخفي بالضبط ما يجب أن يُرى. النوع والطول والتهريب ورموز المحارف
  هي الدليل، لا النصّ.
#>
function Get-PathDiagnostic {
  param([Parameter(Mandatory = $false)] $Value)

  $typeName = if ($null -eq $Value) { "null" } else { $Value.GetType().FullName }
  $text = if ($null -eq $Value) { "" } else { [string] $Value }
  $escaped = New-Object System.Text.StringBuilder
  $codes = New-Object System.Text.StringBuilder
  $limit = [Math]::Min($text.Length, 240)
  for ($index = 0; $index -lt $limit; $index++) {
    $char = $text[$index]
    $code = [int] $char
    switch ($code) {
      0  { [void] $escaped.Append('\0'); break }
      9  { [void] $escaped.Append('\t'); break }
      10 { [void] $escaped.Append('\n'); break }
      13 { [void] $escaped.Append('\r'); break }
      default {
        if ($code -lt 32 -or $code -eq 127) { [void] $escaped.Append('\x{0:x2}' -f $code) }
        else { [void] $escaped.Append($char) }
      }
    }
    if ($codes.Length -gt 0) { [void] $codes.Append(',') }
    [void] $codes.Append('0x{0:x2}' -f $code)
  }

  return [ordered] @{
    type          = $typeName
    length        = $text.Length
    escaped_value = $escaped.ToString()
    char_codes    = $codes.ToString()
    truncated     = ($text.Length -gt $limit)
  }
}

function Format-PathDiagnostic {
  param([Parameter(Mandatory = $true)] $Diagnostic)
  return ("type={0} length={1} escaped='{2}' codes=[{3}]" -f `
    $Diagnostic.type, $Diagnostic.length, $Diagnostic.escaped_value, $Diagnostic.char_codes)
}

function New-PathContractError {
  param(
    [Parameter(Mandatory = $true)][string] $Label,
    [Parameter(Mandatory = $true)][string] $Rule,
    [Parameter(Mandatory = $false)] $Value
  )
  $diagnostic = Get-PathDiagnostic -Value $Value
  return ("{0}: '{1}' violates {2}. {3}" -f `
    $script:PathContractErrorPrefix, $Label, $Rule, (Format-PathDiagnostic -Diagnostic $diagnostic))
}

<#
  المحارف التي لا يجوز أن تظهر في مسار وجهة.

  محارف التحكّم كلها مرفوضة، لا 0x0A وحده: القيمة التي كسرت التشغيل حملت
  0x0A، ورفضُه وحده يترك الباب مفتوحًا لأخواته. ويُضاف إليها ما يعدّه .NET
  غير قانوني أصلًا، وحرفا البدل، فوجهة حذف لا تُبنى للتوسّع.
#>
function Test-IllegalPathCharacter {
  param([Parameter(Mandatory = $true)][char] $Character)
  $code = [int] $Character
  if ($code -lt 32 -or $code -eq 127) { return $true }
  if ($Character -eq '*' -or $Character -eq '?') { return $true }
  foreach ($invalid in [System.IO.Path]::GetInvalidPathChars()) {
    if ($Character -eq $invalid) { return $true }
  }
  return $false
}

<#
  العقد نفسه.

  يُثبت، بالترتيب: عدم الغياب، ثم العدد المفرد، ثم النوع، ثم عدم الفراغ، ثم
  خلوّه من محارف غير قانونية، ثم غياب '..'، ثم أن التقنين ينجح، ثم الجذرية.
  الترتيب مقصود: كل فحص يفترض أن ما قبله ثبت.

  يُعيد المسار المقنَّن — قيمة واحدة من نوع String — أو يرمي.
#>
function Assert-ScalarPathString {
  param(
    [Parameter(Mandatory = $true)][string] $Label,
    [Parameter(Mandatory = $false)] $Value,
    [switch] $AllowRelative
  )

  if ($null -eq $Value) { throw (New-PathContractError -Label $Label -Rule "NOT_NULL" -Value $Value) }

  # التعداد على المعامل لا يمرّ بالمجرى، فـ@() هنا تقيس العدد الحقيقي الواصل.
  $items = @($Value)
  if ($items.Count -ne 1) {
    throw ("{0}: '{1}' violates SINGLE_VALUE. count={2} first_type={3}" -f `
      $script:PathContractErrorPrefix, $Label, $items.Count,
      $(if ($items.Count -gt 0 -and $null -ne $items[0]) { $items[0].GetType().FullName } else { "null" }))
  }

  $single = $items[0]
  if ($null -eq $single) { throw (New-PathContractError -Label $Label -Rule "NOT_NULL" -Value $single) }
  if (-not ($single -is [string])) { throw (New-PathContractError -Label $Label -Rule "IS_STRING" -Value $single) }
  if ([string]::IsNullOrWhiteSpace($single)) { throw (New-PathContractError -Label $Label -Rule "NOT_EMPTY" -Value $single) }

  foreach ($char in $single.ToCharArray()) {
    if (Test-IllegalPathCharacter -Character $char) {
      throw (New-PathContractError -Label $Label -Rule "NO_ILLEGAL_CHARACTERS" -Value $single)
    }
  }

  foreach ($segment in ($single -split '[\\/]')) {
    if ($segment -eq '..') { throw (New-PathContractError -Label $Label -Rule "NO_PARENT_SEGMENT" -Value $single) }
  }

  $full = ""
  try { $full = [System.IO.Path]::GetFullPath($single) }
  catch { throw (New-PathContractError -Label $Label -Rule "CANONICALISABLE" -Value $single) }

  if (-not $AllowRelative -and -not [System.IO.Path]::IsPathRooted($single)) {
    throw (New-PathContractError -Label $Label -Rule "ROOTED" -Value $single)
  }

  Write-Verbose ("path contract ok: {0} -> {1}" -f $Label, (Format-PathDiagnostic -Diagnostic (Get-PathDiagnostic -Value $full)))
  return $full
}

<#
  بناء مسار من مقاطع مُعلنة، لا من نصّ حرفي واحد.

  هذا هو الإصلاح البنيوي: النصّ الحرفي الواحد هو ما استقبل محرف السطر الجديد
  ومرّ دون أن يراه أحد. المقاطع تُفحص واحدًا واحدًا، فلا يعبر مقطع يحمل
  فاصل مسار أو محرف تحكّم.
#>
function Join-PathSegment {
  param(
    [Parameter(Mandatory = $true)][string] $Label,
    [Parameter(Mandatory = $true)] $Root,
    [Parameter(Mandatory = $true)] $Segments
  )
  $path = Assert-ScalarPathString -Label ("{0}.root" -f $Label) -Value $Root
  $ordered = @($Segments)
  if ($ordered.Count -eq 0) { throw (New-PathContractError -Label $Label -Rule "NON_EMPTY_SEGMENTS" -Value "") }
  foreach ($segment in $ordered) {
    if ($null -eq $segment -or -not ($segment -is [string]) -or [string]::IsNullOrWhiteSpace($segment)) {
      throw (New-PathContractError -Label ("{0}.segment" -f $Label) -Rule "IS_NON_EMPTY_STRING" -Value $segment)
    }
    foreach ($char in ([string] $segment).ToCharArray()) {
      if ((Test-IllegalPathCharacter -Character $char) -or $char -eq '\' -or $char -eq '/') {
        throw (New-PathContractError -Label ("{0}.segment" -f $Label) -Rule "NO_SEPARATOR_OR_ILLEGAL_CHARACTER" -Value $segment)
      }
    }
    if ($segment -eq '..' -or $segment -eq '.') {
      throw (New-PathContractError -Label ("{0}.segment" -f $Label) -Rule "NO_RELATIVE_SEGMENT" -Value $segment)
    }
    $path = Join-Path $path $segment
  }
  return (Assert-ScalarPathString -Label $Label -Value $path)
}

<#
  الاحتواء بدلالة نظام الملفات، لا بدلالة النص.

  المقارنة على مسارين مقنَّنين وبفاصل ختامي، فلا يُعدّ 'node_modules_old'
  داخل 'node_modules'. والمقارنة بلا حساسية لحالة الأحرف لأن الوجهة ويندوزية.
#>
function Test-PathContainment {
  param(
    [Parameter(Mandatory = $true)][string] $Parent,
    [Parameter(Mandatory = $true)][string] $Child
  )
  $separator = [System.IO.Path]::DirectorySeparatorChar
  $parentFull = [System.IO.Path]::GetFullPath($Parent).TrimEnd($separator) + $separator
  $childFull = [System.IO.Path]::GetFullPath($Child).TrimEnd($separator)
  return $childFull.StartsWith($parentFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-SamePath {
  param(
    [Parameter(Mandatory = $true)][string] $Left,
    [Parameter(Mandatory = $true)][string] $Right
  )
  $separator = [System.IO.Path]::DirectorySeparatorChar
  $leftFull = [System.IO.Path]::GetFullPath($Left).TrimEnd($separator)
  $rightFull = [System.IO.Path]::GetFullPath($Right).TrimEnd($separator)
  return [string]::Equals($leftFull, $rightFull, [System.StringComparison]::OrdinalIgnoreCase)
}

<#
  اسم الحزمة يُترجم إلى مقاطع عمدًا.

  '@polaris/contracts' ليس مسارًا: هو معرّف حزمة يتحوّل إلى مجلدين تحت
  node_modules. الترجمة معلنة هنا ومحصورة بنمط، فلا يصل اسم غريب إلى وجهة حذف.
#>
function ConvertTo-PackagePathSegment {
  param([Parameter(Mandatory = $true)][string] $PackageName)
  if ($PackageName -cnotmatch '^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$') {
    throw (New-PathContractError -Label "package_name" -Rule "NPM_PACKAGE_NAME" -Value $PackageName)
  }
  return ,@($PackageName -split '/')
}

function Get-RuntimeNodeModulesRoot {
  param([Parameter(Mandatory = $true)][string] $RepositoryRoot)
  return (Join-PathSegment -Label "node_modules_root" -Root $RepositoryRoot -Segments @('runtime', 'node_modules'))
}

<#
  وجهة الحزمة المثبَّتة داخل runtime. نفس الوجهة التي تفحصها بوابة الحزم:
  runtime/node_modules/@polaris/contracts، بلا رابط ولا وصلة.
#>
function Get-InstalledPackagePath {
  param(
    [Parameter(Mandatory = $true)][string] $RepositoryRoot,
    [Parameter(Mandatory = $true)][string] $PackageName
  )
  $root = Assert-ScalarPathString -Label "repository_root" -Value $RepositoryRoot
  $segments = ConvertTo-PackagePathSegment -PackageName $PackageName
  $modules = Get-RuntimeNodeModulesRoot -RepositoryRoot $root
  return (Join-PathSegment -Label "installed" -Root $modules -Segments $segments)
}

<#
  إثبات سلامة الحذف.

  Remove-Item -Recurse -Force لا يُستدعى على قيمة "بدت صحيحة". يُستدعى بعد
  أن يثبت أن الوجهة هي بالضبط مكان الحزمة المثبَّتة، وأنها تحت node_modules
  الخاصة بـruntime، وأنها ليست جذر المستودع ولا جذر runtime ولا جذر
  node_modules ولا جذر النطاق ولا مصدر العقود.

  يُعيد حالة التحقق لتُكتب في الدليل: ما فُحص، لا أنه "مرّ".
#>
function Assert-PackageRefreshDestinationSafe {
  param(
    [Parameter(Mandatory = $true)][string] $RepositoryRoot,
    [Parameter(Mandatory = $true)] $Destination,
    [Parameter(Mandatory = $true)][string] $PackageName
  )

  $root = Assert-ScalarPathString -Label "repository_root" -Value $RepositoryRoot
  $installed = Assert-ScalarPathString -Label "installed" -Value $Destination
  $runtimeRoot = Join-PathSegment -Label "runtime_root" -Root $root -Segments @('runtime')
  $modules = Get-RuntimeNodeModulesRoot -RepositoryRoot $root
  $contractsRoot = Join-PathSegment -Label "contracts_root" -Root $root -Segments @('contracts')
  $expected = Get-InstalledPackagePath -RepositoryRoot $root -PackageName $PackageName
  $segments = ConvertTo-PackagePathSegment -PackageName $PackageName
  $scopeRoot = if ($segments.Count -gt 1) { Join-PathSegment -Label "scope_root" -Root $modules -Segments @($segments[0]) } else { $modules }

  $state = [ordered] @{
    package_name          = $PackageName
    repository_root       = $root
    runtime_root          = $runtimeRoot
    node_modules_root     = $modules
    contracts_source_root = $contractsRoot
    scope_root            = $scopeRoot
    expected_destination  = $expected
    destination           = $installed
    checks                = [ordered] @{
      canonical                = $true
      equals_expected          = (Test-SamePath -Left $installed -Right $expected)
      inside_node_modules      = (Test-PathContainment -Parent $modules -Child $installed)
      not_repository_root      = (-not (Test-SamePath -Left $installed -Right $root))
      not_runtime_root         = (-not (Test-SamePath -Left $installed -Right $runtimeRoot))
      not_node_modules_root    = (-not (Test-SamePath -Left $installed -Right $modules))
      not_scope_root           = (-not (Test-SamePath -Left $installed -Right $scopeRoot))
      not_contracts_source     = (-not (Test-SamePath -Left $installed -Right $contractsRoot))
      outside_contracts_source = (-not (Test-PathContainment -Parent $contractsRoot -Child $installed))
    }
    safe                  = $false
    reason_code           = ""
  }

  $failed = New-Object System.Collections.Generic.List[string]
  foreach ($name in @($state.checks.Keys)) {
    if (-not $state.checks[$name]) { [void] $failed.Add($name) }
  }

  if ($failed.Count -gt 0) {
    $state.reason_code = $script:PackageRefreshUnsafeReasonCode
    throw ("{0}: {1}. failed_checks={2}. destination={3}" -f `
      $script:PackageRefreshUnsafePrefix, $script:PackageRefreshUnsafeReasonCode,
      ($failed -join ', '), (Format-PathDiagnostic -Diagnostic (Get-PathDiagnostic -Value $installed)))
  }

  $state.safe = $true
  return $state
}

<#
  تصنيف الاستثناء إلى رمز سبب. لا رمز عامّ واحد: عيب بناء المسار ليس وجهة
  غير آمنة، وكلاهما ليس فشل npm.
#>
function Get-PackageRefreshReasonCode {
  param([Parameter(Mandatory = $true)][string] $Message)
  if ($Message.StartsWith($script:PathContractErrorPrefix)) { return $script:PathContractReasonCode }
  if ($Message.StartsWith($script:PackageRefreshUnsafePrefix)) { return $script:PackageRefreshUnsafeReasonCode }
  return "W5_PACKAGE_REFRESH_FAILED"
}
