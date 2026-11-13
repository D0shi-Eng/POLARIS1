#requires -Version 5.1
<#
    بناء محوّل ويندوز لـW5 بمُصرِّف C# المدمج في ويندوز.
    لا Visual Studio، ولا حزم، ولا شبكة: أي Windows 11 يكفي.

    الثنائي منفصل عن ثنائي W4 عمدًا. المصادر مشتركة — تُصرَّف مصادر محوّل W4
    داخل هذا الثنائي عدا نقطة دخوله Program.cs — والمخرجان منفصلان، فلا يُسقط
    فشلُ تصريف في شيفرة W5 ثنائيَّ W4 المُغلق.
#>
[CmdletBinding()]
param([string] $RepositoryRoot)

$ErrorActionPreference = 'Stop'
if (-not $RepositoryRoot) { $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
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


$w5Adapter = Join-Path $RepositoryRoot 'tools\w5-windows-adapter'
$w4Adapter = Join-Path $RepositoryRoot 'tools\w4-windows-adapter'
$w1Native  = Join-Path $RepositoryRoot 'tools\confinement-spike\launcher\Native'
$bin       = Join-Path $w5Adapter 'bin'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    throw "BLOCKED: in-box C# compiler not found at $csc"
}

New-Item -ItemType Directory -Force -Path $bin | Out-Null

$sources = @()
$sources += (Get-ChildItem -Path $w5Adapter -Filter *.cs | Select-Object -ExpandProperty FullName)
# نقطة دخول W4 تُستبعد: نقطة دخول واحدة لكل ثنائي.
$sources += (Get-ChildItem -Path $w4Adapter -Filter *.cs |
    Where-Object { $_.Name -ne 'Program.cs' } | Select-Object -ExpandProperty FullName)
$sources += (Get-ChildItem -Path $w1Native -Filter *.cs | Select-Object -ExpandProperty FullName)
if ($sources.Count -eq 0) { throw "BLOCKED: no W5 adapter sources found" }

$output = Join-Path $bin 'polaris-w5-windows-adapter.exe'
$arguments = @(
    '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/utf8output',
    "/out:$output", '/r:System.dll', '/r:System.Core.dll'
) + $sources

Write-Host "compiling polaris-w5-windows-adapter.exe from $($sources.Count) files"
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$compilerOutput = & $csc @arguments 2>&1
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previous

<#
    سجل البناء. العيب الذي يغلقه هو نفسه الذي أغلقه سجل بناء W4: ثنائي لم
    يُصرَّف قط لا يظهر في أي دليل. من الآن يوجد ملف يقول صراحةً هل وُجد الثنائي،
    ولماذا لم يوجد، وبأي رسائل مُصرِّف.
#>
$record = [ordered] @{
    tool            = 'polaris.w5.windows-adapter.build'
    built_at        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
    compiler        = $csc
    source_count    = $sources.Count
    output          = $output
    exit_code       = $exitCode
    compiler_output = @($compilerOutput | ForEach-Object { "$_" })
    binary_present  = (Test-Path -LiteralPath $output)
    binary_sha256   = if (Test-Path -LiteralPath $output) { (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash } else { "" }
    error_code      = if ($exitCode -ne 0) { 'W5_ADAPTER_COMPILATION_FAILED' } else { '' }
}
$evidence = Join-Path $RepositoryRoot 'evidence'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
[void] (Write-PolarisJsonFile -Path (Join-Path $evidence 'w5-windows-adapter-build.json') -InputObject $record -Depth 5)

if ($exitCode -ne 0) {
    $compilerOutput | ForEach-Object { Write-Host $_ }
    throw "BLOCKED: W5 adapter compilation failed with exit code $exitCode (error_code W5_ADAPTER_COMPILATION_FAILED). See evidence\w5-windows-adapter-build.json"
}
if (-not (Test-Path -LiteralPath $output)) {
    throw "BLOCKED: the compiler reported success but produced no binary at $output"
}
$compilerOutput | Where-Object { "$_" -match 'warning' } | ForEach-Object { Write-Host $_ }
Write-Host "built: $output"
