<#
  عقد بايتات دليل POLARIS — الكاتب الوحيد المعتمد لملفات JSON من PowerShell.

  العيب الذي يغلقه هذا الملف وقع فعلًا في التشغيل الأصلي الثالث: سبعة اختبارات
  في طبقة التشغيل سقطت بـ

      SyntaxError: Unexpected token 'ي╗┐'

  عند JSON.parse على أدلة كتبها مشغّل PowerShell. البايتات الثلاثة الأولى في
  تلك الملفات كانت EF BB BF — أي علامة ترتيب بايتات UTF-8.

  السبب المباشر: Windows PowerShell 5.1 يكتب مع BOM حين يُطلب منه UTF8:

      Set-Content -Encoding UTF8   →  UTF-8 WITH BOM   (5.1)
      Out-File    -Encoding utf8   →  UTF-8 WITH BOM   (5.1)

  هذا سلوك 5.1 نفسه لا خطأ في السكربت، ولا يجوز الاعتماد على سلوك PowerShell 7
  (حيث utf8 صار بلا BOM). لذلك لا يُترك للمضيف أن يختار الترميز ضمنًا: الترميز
  يُصرَّح به هنا صراحةً عبر .NET.

  العقد:
      UTF-8، بلا BOM
      وثيقة JSON صالحة
      نهايات أسطر LF بالضبط
      لا بايتات تنسيق طرفية
      لا ترميز يعتمد على لغة النظام

  الإصلاح المعتمد هو في الكاتب. المستهلك يشخّص ولا يتسامح: EVIDENCE_UTF8_BOM_PRESENT
  عيبٌ يُبلَّغ عنه، لا محرفٌ يُقشَّر بصمت.
#>

$script:PolarisEvidenceContractVersion = "1.0.0"

# رموز الأسباب. أسماء ثابتة يقرؤها المستهلكون على الجانبين.
$script:PolarisEvidenceReasonOk        = "EVIDENCE_UTF8_NO_BOM"
$script:PolarisEvidenceReasonUtf8Bom   = "EVIDENCE_UTF8_BOM_PRESENT"
$script:PolarisEvidenceReasonUtf16Bom  = "EVIDENCE_UTF16_BOM_PRESENT"
$script:PolarisEvidenceReasonEmpty     = "EVIDENCE_FILE_EMPTY"
$script:PolarisEvidenceReasonMissing   = "EVIDENCE_FILE_MISSING"

function Get-PolarisEvidenceContractVersion {
  return $script:PolarisEvidenceContractVersion
}

<#
  المُرمِّز الوحيد: UTF-8 مع تعطيل BOM صراحةً.

  New-Object System.Text.UTF8Encoding($false) — الوسيط $false هو
  encoderShouldEmitUTF8Identifier. [System.Text.Encoding]::UTF8 يُصدر BOM،
  فلا يُستعمل هنا.
#>
function Get-PolarisJsonEncoding {
  return (New-Object System.Text.UTF8Encoding($false))
}

<#
  حارس المسار: قيمة واحدة، نصّ، بلا محارف تحكّم.

  نفس صنف الحارس الذي أغلق عيب مسار تحديث الحزم، مكرَّرًا هنا عمدًا لأن هذه
  الوحدة تُنقَّط أيضًا من سكربتات بناء لا تحمل عقد المسارات.
#>
function Assert-PolarisEvidencePath {
  param([Parameter(Mandatory = $true)][AllowNull()] $Value)
  $items = @($Value)
  if ($items.Count -ne 1) {
    throw "EVIDENCE_PATH_CONTRACT: SINGLE_VALUE violated (count=$($items.Count))."
  }
  $single = $items[0]
  if ($single -isnot [string]) {
    throw "EVIDENCE_PATH_CONTRACT: IS_STRING violated (type=$(if ($null -eq $single) { 'null' } else { $single.GetType().FullName }))."
  }
  if ([string]::IsNullOrWhiteSpace($single)) {
    throw "EVIDENCE_PATH_CONTRACT: NON_EMPTY violated."
  }
  $codes = New-Object System.Collections.Generic.List[string]
  foreach ($character in $single.ToCharArray()) {
    $code = [int] $character
    if ($code -lt 32 -or $code -eq 127) { [void] $codes.Add([string] $code) }
  }
  if ($codes.Count -gt 0) {
    throw "EVIDENCE_PATH_CONTRACT: NO_ILLEGAL_CHARACTERS violated (codes=[$($codes -join ',')])."
  }
  return $single
}

<#
  التسلسل: نصّ JSON واحد، نهايات LF، سطر أخير واحد.

  ConvertTo-Json على 5.1 يُصدر CRLF. التطبيع هنا يجعل بايتات الملف نفسها على
  أي مضيف، فمقارنة البصمات بين تشغيلين تبقى ذات معنى.
#>
function ConvertTo-PolarisEvidenceText {
  param(
    [Parameter(Mandatory = $true)][AllowNull()] $InputObject,
    [int] $Depth = 8
  )
  $json = $InputObject | ConvertTo-Json -Depth $Depth
  $text = [string] ($json -join "`n")
  $text = $text.Replace("`r`n", "`n").Replace("`r", "`n")
  if (-not $text.EndsWith("`n")) { $text = $text + "`n" }
  return $text
}

<#
  قراءة أول بايتات الملف دون تحميله كاملًا ودون أي فكّ ترميز.

  التشخيص يقع على البايتات لا على المحارف: قارئٌ يفكّ الترميز أولًا قد يبتلع
  الـBOM ويقول إن الملف سليم.
#>
function Get-PolarisEvidenceLeadingBytes {
  param([Parameter(Mandatory = $true)][string] $Path, [int] $Count = 4)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $buffer = [byte[]]::new($Count)
    $read = $stream.Read($buffer, 0, $Count)
    if ($read -le 0) { return ,@() }
    return ,@($buffer[0..($read - 1)])
  } finally { $stream.Dispose() }
}

function ConvertTo-PolarisHexString {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][array] $Bytes)
  $parts = @($Bytes | ForEach-Object { '{0:x2}' -f $_ })
  return [string] ($parts -join ' ')
}

<#
  المشخِّص. يُبلّغ ولا يُصلح.

  ok = $true فقط حين تطابق البايتات العقد. أي BOM — UTF-8 أو UTF-16 — عيب
  مُسمّى، لا تفصيل يُتسامح معه.
#>
function Test-PolarisJsonEncoding {
  param([Parameter(Mandatory = $true)][string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject] @{
      path = $Path; ok = $false; reason_code = $script:PolarisEvidenceReasonMissing
      first_bytes = ""; length = 0
    }
  }
  $length = (Get-Item -LiteralPath $Path).Length
  $bytes = ConvertTo-CountableEvidenceArray (Get-PolarisEvidenceLeadingBytes -Path $Path -Count 4)
  if ($bytes.Count -eq 0) {
    return [pscustomobject] @{
      path = $Path; ok = $false; reason_code = $script:PolarisEvidenceReasonEmpty
      first_bytes = ""; length = $length
    }
  }
  $hex = ConvertTo-PolarisHexString -Bytes $bytes
  $reason = $script:PolarisEvidenceReasonOk
  if ($bytes.Count -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $reason = $script:PolarisEvidenceReasonUtf8Bom
  } elseif ($bytes.Count -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF))) {
    $reason = $script:PolarisEvidenceReasonUtf16Bom
  }
  return [pscustomobject] @{
    path = $Path; ok = ($reason -eq $script:PolarisEvidenceReasonOk); reason_code = $reason
    first_bytes = $hex; length = $length
  }
}

# التطبيع المحلي: نفس صنف ConvertTo-CountableArray، مكرَّر لأن هذه الوحدة
# تُنقَّط من سكربتات لا تحمل مشغّل W5.
function ConvertTo-CountableEvidenceArray {
  param([AllowNull()] $Value)
  if ($null -eq $Value) { return ,@() }
  return ,@($Value)
}

<#
  الكاتب القانوني الوحيد.

  [System.IO.File]::WriteAllText مع مُرمِّز مُصرَّح به. لا Set-Content ولا
  Out-File: كلاهما يترك اختيار الترميز لسلوك المضيف.

  ثم يُعاد فتح الملف ويُتحقَّق من بايتاته. كاتبٌ يدّعي النجاح دون أن يقرأ ما
  كتبه ليس إثباتًا.
#>
function Write-PolarisJsonFile {
  param(
    [Parameter(Mandatory = $true)] $Path,
    [Parameter(Mandatory = $true)][AllowNull()] $InputObject,
    [int] $Depth = 8
  )
  $target = Assert-PolarisEvidencePath -Value $Path
  $text = ConvertTo-PolarisEvidenceText -InputObject $InputObject -Depth $Depth
  [System.IO.File]::WriteAllText($target, $text, (Get-PolarisJsonEncoding))
  $check = Test-PolarisJsonEncoding -Path $target
  if (-not $check.ok) {
    throw "EVIDENCE_BYTE_CONTRACT: $($check.reason_code) at '$target' (first bytes: $($check.first_bytes))."
  }
  return $target
}

<#
  تقرير ترميز على مجموعة ملفات. يُستعمل قبل الحكم: دليل قانوني بـBOM ليس
  دليلًا مقبولًا، وإخفاؤه بتقشير المحرف عند القراءة يُبقي المُنتِج الفاسد حيًّا.
#>
function Get-PolarisEvidenceEncodingReport {
  param([Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]] $Paths)
  $report = New-Object System.Collections.Generic.List[object]
  foreach ($path in $Paths) {
    if (-not (Test-Path -LiteralPath $path)) { continue }
    [void] $report.Add((Test-PolarisJsonEncoding -Path $path))
  }
  return ,$report.ToArray()
}
