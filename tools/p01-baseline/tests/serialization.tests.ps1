#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS P01-B1 - the Windows PowerShell 5.1 serialization regression suite.

.DESCRIPTION
  SER-001 .. SER-020. It exists because of one proven defect:

      POWERSHELL_5_1_GENERIC_LIST_JSON_BINDER_FAILURE
      System.ArgumentException: Argument types do not match
      Expression.Condition <- PSEnumerableBinder.MaybeDebase <- PSToObjectArrayBinder.Bind

  The suite proves the defect still exists on this host (or, failing that,
  reads the frozen diagnostic fixture that recorded it), proves the selected
  normalization produces a true System.Object[] at zero, one and many, proves
  the whole evidence document survives ConvertTo-Json and comes back through
  ConvertFrom-Json, proves the canonical byte contract, and reads the baseline
  source itself to prove no implicit generic-list-to-JSON path survives in it.

  It tests the production function, not a copy: ConvertTo-PolarisPlainArray is
  lifted out of baseline.ps1 by the PowerShell parser and defined here from
  that exact text. A copy in a test proves the copy.

  PowerShell 7 passing alone is not sufficient. This suite refuses to report a
  pass unless it ran under Windows PowerShell 5.1 Desktop.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-baseline\tests\serialization.tests.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$global:LASTEXITCODE = 0

$script:DefaultRepositoryRoot = "D:\POLARIS"
$script:ToolName = "polaris.p01.baseline.serialization"
$script:SchemaVersion = "1.0.0"
$script:SerializationErrorCode = "P01_BASELINE_SERIALIZATION_CONTRACT"

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
      throw "explicit RepositoryRoot '$Explicit' is not a POLARIS repository root."
    }
    return (Resolve-Path -LiteralPath $Explicit).ProviderPath
  }
  if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $current = $PSScriptRoot
    for ($depth = 0; $depth -lt 8; $depth += 1) {
      if (Test-PolarisRepositoryRoot -Candidate $current) { return (Resolve-Path -LiteralPath $current).ProviderPath }
      $parent = Split-Path -Parent $current
      if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) { break }
      $current = $parent
    }
  }
  if (Test-PolarisRepositoryRoot -Candidate $script:DefaultRepositoryRoot) {
    return (Resolve-Path -LiteralPath $script:DefaultRepositoryRoot).ProviderPath
  }
  throw "repository root could not be resolved."
}

$root = Resolve-PolarisRepositoryRoot -Explicit $RepositoryRoot
$baselinePath = Join-Path $root "tools\p01-baseline\baseline.ps1"
$fixturePath  = Join-Path $root "evidence\p01-b1-diagnostics.local.txt"
$resultsPath  = Join-Path $root "evidence\p01-b1-serialization-selftest.json"
$probePath    = Join-Path $root "evidence\p01-b1-serialization-writer-probe.local.json"

. (Join-Path $root "tools\evidence-contract\json-evidence.ps1")

# ── رفع الدالة الإنتاجية من مصدر baseline.ps1 ─────────────────────────────
# لا نسخة في الاختبار: النصّ نفسه يُنتزع بالمحلّل اللغوي ويُعرَّف هنا. نسخةٌ
# في الاختبار تُثبت النسخة لا المُنتَج.
$script:ParseTokens = $null
$script:ParseErrors = $null
$script:BaselineAst = [System.Management.Automation.Language.Parser]::ParseFile(
  $baselinePath, [ref] $script:ParseTokens, [ref] $script:ParseErrors)

function Get-BaselineFunctionText {
  param([Parameter(Mandatory = $true)][string] $Name)
  $found = $script:BaselineAst.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $Name
  }, $true)
  # لا تحويل إلى مصفوفة هنا: هذه الدالة تعمل قبل تعريف المُطبِّع، وتحويل
  # Collection[Ast] بـ@() هو العيب نفسه. العدّ والفهرسة يكفيان.
  if ($found.Count -ne 1) {
    throw "expected exactly one definition of '$Name' in baseline.ps1, found $($found.Count)."
  }
  return [string] $found[0].Extent.Text
}

Invoke-Expression (Get-BaselineFunctionText -Name "ConvertTo-PolarisPlainArray")

# ── مُشغّل الاختبارات ──────────────────────────────────────────────────────

$script:Results = New-Object System.Collections.Generic.List[object]

function Add-TestResult {
  param(
    [Parameter(Mandatory = $true)][string] $Id,
    [Parameter(Mandatory = $true)][string] $Name,
    [Parameter(Mandatory = $true)][bool] $Passed,
    [Parameter(Mandatory = $true)][string] $Observed
  )
  $status = "FAIL"
  if ($Passed) { $status = "PASS" }
  [void] $script:Results.Add([pscustomobject] @{
    id = $Id; name = $Name; status = $status; observed = $Observed
  })
  Write-Host ("{0,-4} {1,-8} {2,-46} {3}" -f $status, $Id, $Name, $Observed)
}

function Invoke-Test {
  param(
    [Parameter(Mandatory = $true)][string] $Id,
    [Parameter(Mandatory = $true)][string] $Name,
    [Parameter(Mandatory = $true)][scriptblock] $Body
  )
  # الجسم يُعيد نصًّا عند النجاح، ويرمي عند الفشل. الاستثناء غير المتوقّع فشلٌ
  # يُسجَّل بنصّه، لا انهيارٌ يُنهي المجموعة ويترك بقيتها غير مقيسة.
  try {
    $observed = [string] (& $Body)
    Add-TestResult -Id $Id -Name $Name -Passed $true -Observed $observed
  } catch {
    Add-TestResult -Id $Id -Name $Name -Passed $false -Observed ("[" + $_.Exception.GetType().FullName + "] " + $_.Exception.Message)
  }
}

function Assert-True {
  param([Parameter(Mandatory = $true)][bool] $Condition, [Parameter(Mandatory = $true)][string] $Message)
  if (-not $Condition) { throw $Message }
}

function New-ListOfObject {
  param([Parameter(Mandatory = $true)][int] $Count)
  $list = New-Object System.Collections.Generic.List[object]
  for ($index = 0; $index -lt $Count; $index += 1) {
    [void] $list.Add([pscustomobject] @{ id = ("probe-" + $index); status = "PRESENT" })
  }
  return ,$list
}

# ── الماسح العميق ─────────────────────────────────────────────────────────
# يمشي في الوثيقة النهائية عنصرًا عنصرًا ويُبلّغ عن كل نوع غنيّ نجا فيها.

function Get-RichTypeLeaks {
  param([AllowNull()] $Node, [int] $Depth = 0)

  $leaks = New-Object System.Collections.Generic.List[object]
  if ($null -eq $Node -or $Depth -gt 24) { return ,$leaks.ToArray() }

  $typeName = $Node.GetType().FullName
  $forbidden = @(
    "System.Collections.Generic.List",
    "System.Collections.ArrayList",
    "System.Management.Automation.ErrorRecord",
    "System.Management.Automation.CommandInfo",
    "System.Management.Automation.ApplicationInfo",
    "System.Management.Automation.CmdletInfo",
    "Microsoft.Win32.RegistryKey",
    "Microsoft.Management.Infrastructure.CimInstance",
    "System.Diagnostics.Process",
    "System.Version"
  )
  foreach ($bad in $forbidden) {
    if ($typeName.StartsWith($bad)) { [void] $leaks.Add($typeName) }
  }

  if ($Node -is [string] -or $Node -is [System.ValueType]) { return ,$leaks.ToArray() }

  if ($Node -is [System.Collections.IDictionary]) {
    foreach ($key in $Node.Keys) {
      foreach ($leak in (Get-RichTypeLeaks -Node $Node[$key] -Depth ($Depth + 1))) { [void] $leaks.Add($leak) }
    }
    return ,$leaks.ToArray()
  }

  if ($Node -is [System.Collections.ICollection]) {
    $plain = ConvertTo-PolarisPlainArray $Node
    for ($index = 0; $index -lt $plain.Count; $index += 1) {
      foreach ($leak in (Get-RichTypeLeaks -Node $plain[$index] -Depth ($Depth + 1))) { [void] $leaks.Add($leak) }
    }
    return ,$leaks.ToArray()
  }

  # ما بقي: كائن بخصائص. لا يُشترط pscustomobject صراحةً لأن الهدف كشف كل نوع
  # غنيّ نجا، لا التحقّق من شكل متوقَّع.
  foreach ($property in $Node.PSObject.Properties) {
    foreach ($leak in (Get-RichTypeLeaks -Node $property.Value -Depth ($Depth + 1))) { [void] $leaks.Add($leak) }
  }

  return ,$leaks.ToArray()
}

# ── وثيقة اختبار على شكل الوثيقة القانونية ────────────────────────────────

function New-EvidenceLikeDocument {
  param([Parameter(Mandatory = $true)][int] $ProbeCount, [Parameter(Mandatory = $true)][int] $MissingCount)

  $probes = New-ListOfObject -Count $ProbeCount
  $probeRecords = ConvertTo-PolarisPlainArray $probes

  $missingIds = [object[]]::new($MissingCount)
  for ($index = 0; $index -lt $MissingCount; $index += 1) { $missingIds[$index] = ("missing-" + $index) }

  $reasonCodes = [object[]]::new(0)
  if ($MissingCount -gt 0) { $reasonCodes = [object[]] @("P01_TOOLCHAIN_INCOMPLETE") }

  return [pscustomobject] @{
    schema_version    = $script:SchemaVersion
    claim_id          = "P01-B1"
    platform          = "win32"
    native            = $true
    probes            = $probeRecords
    summary           = [pscustomobject] @{
      total            = $probeRecords.Count
      required_missing = $MissingCount
      missing_ids      = $missingIds
    }
    canonical         = $true
    evidence_complete = $true
    verdict           = "PASS"
    reason_codes      = $reasonCodes
  }
}

# ── الحقائق عن المضيف ─────────────────────────────────────────────────────

$hostVersion = $PSVersionTable.PSVersion.ToString()
$hostEdition = [string] $PSVersionTable.PSEdition
# CLRVersion موجود في 5.1 وغائب في 7. القراءة تُحرَس بدل أن تُفترض.
$hostClrVersion = ""
if ($PSVersionTable.PSObject.Properties.Name -contains "CLRVersion") {
  $hostClrVersion = [string] $PSVersionTable.CLRVersion
}
$isWindowsPowerShell51 = ($PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1 -and $hostEdition -eq "Desktop")

Write-Host ""
Write-Host "POLARIS  P01-B1  serialization regression suite"
Write-Host ("host    : PowerShell {0} ({1})   CLR {2}" -f $hostVersion, $hostEdition, $hostClrVersion)
Write-Host ("baseline: {0}" -f $baselinePath)
Write-Host "-----------------------------------------------------------------------------------"

# ── SER-001 - عيب التحكّم ─────────────────────────────────────────────────
# @() على List[object] هو البدائي الساقط. يُستدعى هنا عمدًا. إن لم يسقط على
# هذا المضيف، تُقرأ اللقطة المجمّدة التي سجّلته.

$script:ControlDefectMode = "NOT_ESTABLISHED"
Invoke-Test -Id "SER-001" -Name "control defect is established" -Body {
  # نفس الشكل الذي كان في baseline.ps1 بالضبط: New-Object يُنتج List[object]
  # ملفوفة بـPSObject، وهي وحدها ما يسقط. لا يُستعان بمساعد قد يغيّر اللفّ.
  $list = New-Object System.Collections.Generic.List[object]
  [void] $list.Add([pscustomobject] @{ id = "probe-0"; status = "PRESENT" })
  $threw = $false
  $detail = ""
  try {
    $null = @($list)
  } catch {
    $threw = $true
    $detail = "[" + $_.Exception.GetType().FullName + "] " + $_.Exception.Message
  }
  if ($threw) {
    $script:ControlDefectMode = "CONFIRMED_ON_HOST"
    return ("CONFIRMED_ON_HOST " + $detail)
  }
  Assert-True (Test-Path -LiteralPath $fixturePath) "control defect did not reproduce and the frozen fixture '$fixturePath' is absent."
  $fixture = [string]::Join("`n", (Get-Content -LiteralPath $fixturePath -Encoding UTF8))
  Assert-True ($fixture -match "FAIL\s+convertto-json-with-list") "control defect did not reproduce and the frozen fixture does not record it."
  $script:ControlDefectMode = "FIXTURE_CONFIRMED"
  return "FIXTURE_CONFIRMED evidence/p01-b1-diagnostics.local.txt records FAIL convertto-json-with-list"
}

# ── SER-002 .. SER-004 - التطبيع ينتج System.Object[] حقًّا ───────────────

Invoke-Test -Id "SER-002" -Name "normalized zero-item collection is System.Object[]" -Body {
  $plain = ConvertTo-PolarisPlainArray (New-ListOfObject -Count 0)
  Assert-True ($plain.GetType().FullName -eq "System.Object[]") "type was $($plain.GetType().FullName)"
  Assert-True ($plain.Count -eq 0) "count was $($plain.Count)"
  # المرشّحان يُقاسان هنا لا يُفترضان: CopyTo هو المُختار، وToArray يُسجَّل
  # للمقارنة لأنه يُعيد النوع العام لا object[] دائمًا.
  $viaToArray = (New-ListOfObject -Count 0).ToArray()
  return ("CopyTo=System.Object[] count=0  ToArray=" + $viaToArray.GetType().FullName)
}

Invoke-Test -Id "SER-003" -Name "normalized one-item collection is System.Object[]" -Body {
  $plain = ConvertTo-PolarisPlainArray (New-ListOfObject -Count 1)
  Assert-True ($plain.GetType().FullName -eq "System.Object[]") "type was $($plain.GetType().FullName)"
  Assert-True ($plain.Count -eq 1) "count was $($plain.Count)"
  # المرشّحان يُقاسان هنا لا يُفترضان: CopyTo هو المُختار، وToArray يُسجَّل
  # للمقارنة لأنه يُعيد النوع العام لا object[] دائمًا.
  $viaToArray = (New-ListOfObject -Count 1).ToArray()
  return ("CopyTo=System.Object[] count=1  ToArray=" + $viaToArray.GetType().FullName)
}

Invoke-Test -Id "SER-004" -Name "normalized many-item collection is System.Object[]" -Body {
  $plain = ConvertTo-PolarisPlainArray (New-ListOfObject -Count 7)
  Assert-True ($plain.GetType().FullName -eq "System.Object[]") "type was $($plain.GetType().FullName)"
  Assert-True ($plain.Count -eq 7) "count was $($plain.Count)"
  Assert-True ($plain[6].id -eq "probe-6") "last element was $($plain[6].id)"
  # المرشّحان يُقاسان هنا لا يُفترضان: CopyTo هو المُختار، وToArray يُسجَّل
  # للمقارنة لأنه يُعيد النوع العام لا object[] دائمًا.
  $viaToArray = (New-ListOfObject -Count 7).ToArray()
  return ("CopyTo=System.Object[] count=7  ToArray=" + $viaToArray.GetType().FullName)
}

# ── SER-005 .. SER-007 - ConvertTo-Json ينجح على المُطبَّع ────────────────

Invoke-Test -Id "SER-005" -Name "ConvertTo-Json over normalized zero collection" -Body {
  $document = [pscustomobject] @{ probes = (ConvertTo-PolarisPlainArray (New-ListOfObject -Count 0)) }
  $json = $document | ConvertTo-Json -Depth 8
  Assert-True ($json.Length -gt 0) "empty json"
  return ("json_len=" + $json.Length)
}

Invoke-Test -Id "SER-006" -Name "ConvertTo-Json over normalized one collection" -Body {
  $document = [pscustomobject] @{ probes = (ConvertTo-PolarisPlainArray (New-ListOfObject -Count 1)) }
  $json = $document | ConvertTo-Json -Depth 8
  Assert-True ($json -match "probe-0") "element missing from json"
  return ("json_len=" + $json.Length)
}

Invoke-Test -Id "SER-007" -Name "ConvertTo-Json over normalized many collection" -Body {
  $document = [pscustomobject] @{ probes = (ConvertTo-PolarisPlainArray (New-ListOfObject -Count 7)) }
  $json = $document | ConvertTo-Json -Depth 8
  Assert-True ($json -match "probe-6") "last element missing from json"
  return ("json_len=" + $json.Length)
}

# ── SER-008 / SER-009 - الوثيقة الكاملة ثم الرحلة العائدة ─────────────────

Invoke-Test -Id "SER-008" -Name "nested normalized probes inside the evidence DTO serialize" -Body {
  $document = New-EvidenceLikeDocument -ProbeCount 7 -MissingCount 2
  $json = $document | ConvertTo-Json -Depth 8
  Assert-True ($json -match "probe-6") "nested probe missing"
  Assert-True ($json -match "missing-1") "nested missing id missing"
  return ("json_len=" + $json.Length)
}

Invoke-Test -Id "SER-009" -Name "ConvertFrom-Json round-trip succeeds" -Body {
  $document = New-EvidenceLikeDocument -ProbeCount 7 -MissingCount 2
  $json = $document | ConvertTo-Json -Depth 8
  $back = $json | ConvertFrom-Json
  Assert-True ($back.claim_id -eq "P01-B1") "claim_id came back as $($back.claim_id)"
  Assert-True ($back.summary.total -eq 7) "total came back as $($back.summary.total)"
  Assert-True ((ConvertTo-PolarisPlainArray $back.probes).Count -eq 7) "probe count changed across the round trip"
  return "round-trip ok probes=7 missing=2"
}

# ── SER-010 .. SER-012 - عقد البايتات عبر الكاتب القانوني ─────────────────

Invoke-Test -Id "SER-010" -Name "canonical writer emits first byte 0x7B" -Body {
  $document = New-EvidenceLikeDocument -ProbeCount 3 -MissingCount 1
  [void] (Write-PolarisJsonFile -Path $probePath -InputObject $document -Depth 8)
  $bytes = [System.IO.File]::ReadAllBytes($probePath)
  Assert-True ($bytes.Length -gt 0) "writer produced an empty file"
  Assert-True ($bytes[0] -eq 0x7B) ("first byte was 0x{0:x2}" -f $bytes[0])
  return "first byte 0x7b"
}

Invoke-Test -Id "SER-011" -Name "canonical writer emits no BOM" -Body {
  $bytes = [System.IO.File]::ReadAllBytes($probePath)
  $isUtf8Bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $isUtf16Bom = ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF)))
  Assert-True (-not $isUtf8Bom) "UTF-8 BOM present"
  Assert-True (-not $isUtf16Bom) "UTF-16 BOM present"
  return ("no BOM, {0} bytes" -f $bytes.Length)
}

Invoke-Test -Id "SER-012" -Name "canonical writer emits exactly one trailing LF" -Body {
  $bytes = [System.IO.File]::ReadAllBytes($probePath)
  Assert-True ($bytes[$bytes.Length - 1] -eq 0x0A) ("last byte was 0x{0:x2}" -f $bytes[$bytes.Length - 1])
  Assert-True ($bytes[$bytes.Length - 2] -ne 0x0A) "a second trailing LF is present"
  $crCount = 0
  foreach ($byte in $bytes) { if ($byte -eq 0x0D) { $crCount += 1 } }
  Assert-True ($crCount -eq 0) "file carries $crCount CR bytes"
  return "one trailing LF, zero CR"
}

# ── SER-013 .. SER-015 - لا نوع غنيّ نجا في الوثيقة ───────────────────────

Invoke-Test -Id "SER-013" -Name "no generic List survives anywhere in the evidence DTO" -Body {
  $document = New-EvidenceLikeDocument -ProbeCount 5 -MissingCount 2
  $leaks = Get-RichTypeLeaks -Node $document
  $listLeaks = 0
  foreach ($leak in $leaks) { if ($leak.StartsWith("System.Collections.Generic.List") -or $leak.StartsWith("System.Collections.ArrayList")) { $listLeaks += 1 } }
  Assert-True ($listLeaks -eq 0) "generic list leaks: $($leaks -join ', ')"
  return "0 list leaks in a fully walked DTO"
}

Invoke-Test -Id "SER-014" -Name "no ErrorRecord survives in the evidence DTO" -Body {
  $document = New-EvidenceLikeDocument -ProbeCount 5 -MissingCount 0
  $leaks = Get-RichTypeLeaks -Node $document
  $recordLeaks = 0
  foreach ($leak in $leaks) { if ($leak.StartsWith("System.Management.Automation.ErrorRecord")) { $recordLeaks += 1 } }
  Assert-True ($recordLeaks -eq 0) "ErrorRecord leaks: $($leaks -join ', ')"
  return "0 ErrorRecord leaks"
}

Invoke-Test -Id "SER-015" -Name "no CommandInfo/ApplicationInfo survives in the evidence DTO" -Body {
  $document = New-EvidenceLikeDocument -ProbeCount 5 -MissingCount 0
  $leaks = Get-RichTypeLeaks -Node $document
  $commandLeaks = 0
  foreach ($leak in $leaks) {
    if ($leak.StartsWith("System.Management.Automation.CommandInfo") -or
        $leak.StartsWith("System.Management.Automation.ApplicationInfo") -or
        $leak.StartsWith("System.Management.Automation.CmdletInfo")) { $commandLeaks += 1 }
  }
  Assert-True ($commandLeaks -eq 0) "command-object leaks: $($leaks -join ', ')"
  return "0 CommandInfo/ApplicationInfo leaks"
}

# ── SER-016 .. SER-019 - شكل المصفوفة يصمد عند صفر وواحد وكثير ────────────
# الفحص على نصّ JSON نفسه لا على الكائن: انهيار مصفوفة إلى قيمة مفردة عيبٌ
# يقع في التسلسل، ولا يظهر لمن يفحص الكائن قبله.

Invoke-Test -Id "SER-016" -Name "missing_ids with zero entries serializes as []" -Body {
  $json = (New-EvidenceLikeDocument -ProbeCount 3 -MissingCount 0) | ConvertTo-Json -Depth 8
  Assert-True ($json -match '"missing_ids"\s*:\s*\[') "missing_ids did not serialize as an array: $json"
  $back = ($json | ConvertFrom-Json).summary.missing_ids
  Assert-True ((ConvertTo-PolarisPlainArray $back).Count -eq 0) "round-trip count was not zero"
  return "missing_ids = []"
}

Invoke-Test -Id "SER-017" -Name "missing_ids with one entry stays an array" -Body {
  $json = (New-EvidenceLikeDocument -ProbeCount 3 -MissingCount 1) | ConvertTo-Json -Depth 8
  Assert-True ($json -match '"missing_ids"\s*:\s*\[') "missing_ids collapsed to a scalar: $json"
  $back = ($json | ConvertFrom-Json).summary.missing_ids
  Assert-True ((ConvertTo-PolarisPlainArray $back).Count -eq 1) "round-trip count was not one"
  return "missing_ids = [1 entry], array shape held"
}

Invoke-Test -Id "SER-018" -Name "missing_ids with many entries stays an array" -Body {
  $json = (New-EvidenceLikeDocument -ProbeCount 5 -MissingCount 3) | ConvertTo-Json -Depth 8
  Assert-True ($json -match '"missing_ids"\s*:\s*\[') "missing_ids did not serialize as an array"
  $back = ($json | ConvertFrom-Json).summary.missing_ids
  Assert-True ((ConvertTo-PolarisPlainArray $back).Count -eq 3) "round-trip count was not three"
  return "missing_ids = [3 entries]"
}

Invoke-Test -Id "SER-019" -Name "reason_codes retain array shape at zero, one and many" -Body {
  $zero = ([pscustomobject] @{ reason_codes = [object[]]::new(0) }) | ConvertTo-Json -Depth 4
  $one  = ([pscustomobject] @{ reason_codes = [object[]] @("P01_TOOLCHAIN_INCOMPLETE") }) | ConvertTo-Json -Depth 4
  $many = ([pscustomobject] @{ reason_codes = [object[]] @("A", "B", "C") }) | ConvertTo-Json -Depth 4
  Assert-True ($zero -match '"reason_codes"\s*:\s*\[') "zero collapsed: $zero"
  Assert-True ($one  -match '"reason_codes"\s*:\s*\[') "one collapsed: $one"
  Assert-True ($many -match '"reason_codes"\s*:\s*\[') "many collapsed: $many"
  return "array shape held at 0, 1 and 3"
}

# ── SER-020 - مصدر baseline.ps1 نفسه ─────────────────────────────────────
# المحلّل اللغوي لا التعبير النمطي: كل متغيّر أُسند إليه List عام يُجمع، ثم
# يُبحث عن أي @() أو تحويل صريح إلى مصفوفة يقع عليه، وعن أي ظهور له داخل
# شجرة إسناد الوثيقة القانونية.

Invoke-Test -Id "SER-020" -Name "baseline source has no implicit generic-list-to-JSON path" -Body {
  Assert-True ($script:ParseErrors.Count -eq 0) "baseline.ps1 does not parse: $($script:ParseErrors.Count) errors"

  $assignments = $script:BaselineAst.FindAll({
    param($node) $node -is [System.Management.Automation.Language.AssignmentStatementAst]
  }, $true)

  $listVariables = New-Object System.Collections.Generic.List[string]
  $documentAssignments = New-Object System.Collections.Generic.List[object]
  for ($index = 0; $index -lt $assignments.Count; $index += 1) {
    $assignment = $assignments[$index]
    $leftText = [string] $assignment.Left.Extent.Text
    $rightText = [string] $assignment.Right.Extent.Text
    if ($rightText -match "System\.Collections\.Generic\.List") {
      [void] $listVariables.Add($leftText.TrimStart('$').ToLowerInvariant())
    }
    if ($leftText -eq '$document' -or $leftText -eq '$openingRecord') {
      [void] $documentAssignments.Add($assignment)
    }
  }
  Assert-True ($listVariables.Count -gt 0) "no generic list accumulator found in baseline.ps1 - the scan would prove nothing"
  Assert-True ($documentAssignments.Count -eq 2) "expected the opening record and the final document, found $($documentAssignments.Count)"

  # 1) لا @($accumulator) ولا تحويل صريح إلى مصفوفة عليه.
  #    [void] $accumulator.Add(...) تحويلٌ أيضًا، لكنه تعديل مشروع للمُراكِم لا
  #    مسار إلى JSON؛ الفحص يقع على وجهة التحويل لا على كونه تحويلًا.
  $violations = New-Object System.Collections.Generic.List[string]

  $arrayExpressions = $script:BaselineAst.FindAll({
    param($node) $node -is [System.Management.Automation.Language.ArrayExpressionAst]
  }, $true)
  for ($index = 0; $index -lt $arrayExpressions.Count; $index += 1) {
    $expression = $arrayExpressions[$index]
    $bare = ([string] $expression.Extent.Text).Trim()
    for ($nameIndex = 0; $nameIndex -lt $listVariables.Count; $nameIndex += 1) {
      $candidate = "@($" + $listVariables[$nameIndex] + ")"
      if ($bare.ToLowerInvariant() -eq $candidate) {
        [void] $violations.Add("line " + $expression.Extent.StartLineNumber + ": " + $bare)
      }
    }
  }

  $conversions = $script:BaselineAst.FindAll({
    param($node) $node -is [System.Management.Automation.Language.ConvertExpressionAst]
  }, $true)
  for ($index = 0; $index -lt $conversions.Count; $index += 1) {
    $conversion = $conversions[$index]
    $targetType = ([string] $conversion.Type.TypeName.FullName).ToLowerInvariant()
    if (-not ($targetType.EndsWith("[]") -or $targetType -eq "array")) { continue }
    if ($conversion.Child -isnot [System.Management.Automation.Language.VariableExpressionAst]) { continue }
    $name = ([string] $conversion.Child.VariablePath.UserPath).ToLowerInvariant()
    if ($listVariables.Contains($name)) {
      [void] $violations.Add("line " + $conversion.Extent.StartLineNumber + ": " + $conversion.Extent.Text)
    }
  }

  # 2) لا ظهور لمتغيّر مُراكِم داخل شجرة إسناد الوثيقة.
  for ($index = 0; $index -lt $documentAssignments.Count; $index += 1) {
    $assignment = $documentAssignments[$index]
    $inner = $assignment.Right.FindAll({
      param($node) $node -is [System.Management.Automation.Language.VariableExpressionAst]
    }, $true)
    for ($inner_index = 0; $inner_index -lt $inner.Count; $inner_index += 1) {
      $name = ([string] $inner[$inner_index].VariablePath.UserPath).ToLowerInvariant()
      if ($listVariables.Contains($name)) {
        [void] $violations.Add("evidence document line " + $assignment.Extent.StartLineNumber + " reads accumulator $" + $name)
      }
    }
  }

  Assert-True ($violations.Count -eq 0) ("implicit generic-list path(s): " + ($violations.ToArray() -join " | "))
  return ("accumulators=" + ($listVariables.ToArray() -join ",") + " violations=0")
}

# ── الحصيلة ───────────────────────────────────────────────────────────────

$results = ConvertTo-PolarisPlainArray $script:Results
$passed = 0
$failed = 0
$failedIds = New-Object System.Collections.Generic.List[object]
foreach ($result in $results) {
  if ($result.status -eq "PASS") { $passed += 1 } else { $failed += 1; [void] $failedIds.Add([string] $result.id) }
}

$suiteVerdict = "PASS"
$suiteReasons = New-Object System.Collections.Generic.List[object]
if ($failed -gt 0) { $suiteVerdict = "FAIL"; [void] $suiteReasons.Add("SERIALIZATION_REGRESSION_FAILED") }
if (-not $isWindowsPowerShell51) { $suiteVerdict = "FAIL"; [void] $suiteReasons.Add("NOT_WINDOWS_POWERSHELL_5_1") }

$suiteDocument = [pscustomobject] @{
  schema_version    = $script:SchemaVersion
  tool              = $script:ToolName
  phase             = "PHASE-01"
  claim_id          = "P01-B1"
  platform          = "win32"
  native            = $true
  ran_at            = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  repository_root   = $root
  baseline_path     = $baselinePath
  host = [pscustomobject] @{
    powershell_version         = $hostVersion
    powershell_edition         = $hostEdition
    clr_version                = $hostClrVersion
    is_windows_powershell_5_1  = $isWindowsPowerShell51
  }
  defect_class       = "POWERSHELL_5_1_GENERIC_LIST_JSON_BINDER_FAILURE"
  control_mode       = $script:ControlDefectMode
  tests              = $results
  summary = [pscustomobject] @{
    total      = $results.Count
    passed     = $passed
    failed     = $failed
    failed_ids = (ConvertTo-PolarisPlainArray $failedIds)
  }
  canonical         = $true
  evidence_complete = $true
  verdict           = $suiteVerdict
  reason_codes      = (ConvertTo-PolarisPlainArray $suiteReasons)
}

[void] (Write-PolarisJsonFile -Path $resultsPath -InputObject $suiteDocument -Depth 8)

Write-Host "-----------------------------------------------------------------------------------"
Write-Host ("total   : {0}    passed: {1}    failed: {2}" -f $results.Count, $passed, $failed)
Write-Host ("control : {0}" -f $script:ControlDefectMode)
Write-Host ("host 5.1: {0}" -f $isWindowsPowerShell51)
Write-Host ("verdict : {0}" -f $suiteVerdict)
Write-Host ("evidence: {0}" -f $resultsPath)
Write-Host ""

if ($suiteVerdict -ne "PASS") { exit 1 }
exit 0
