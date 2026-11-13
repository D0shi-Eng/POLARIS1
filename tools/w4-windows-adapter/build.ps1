#requires -Version 5.1
<#
    بناء محوّل ويندوز لـW4 بمُصرِّف C# المدمج في ويندوز.
    لا Visual Studio ولا حزم خارجية: أي Windows 11 يكفي.

    يُعاد استخدام طبقة P/Invoke من مشروع W1 كما هي بدل كتابة نسخة أضعف منها.
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


$adapter = Join-Path $RepositoryRoot 'tools\w4-windows-adapter'
$w1Native = Join-Path $RepositoryRoot 'tools\confinement-spike\launcher\Native'
$bin = Join-Path $adapter 'bin'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    throw "BLOCKED: in-box C# compiler not found at $csc"
}

New-Item -ItemType Directory -Force -Path $bin | Out-Null

$sources = @()
$sources += (Get-ChildItem -Path $adapter -Filter *.cs | Select-Object -ExpandProperty FullName)
$sources += (Get-ChildItem -Path $w1Native -Filter *.cs | Select-Object -ExpandProperty FullName)
if ($sources.Count -eq 0) { throw "BLOCKED: no adapter sources found" }

$output = Join-Path $bin 'polaris-w4-windows-adapter.exe'
$arguments = @(
    '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/utf8output',
    "/out:$output", '/r:System.dll', '/r:System.Core.dll'
) + $sources

Write-Host "compiling polaris-w4-windows-adapter.exe from $($sources.Count) files"
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$compilerOutput = & $csc @arguments 2>&1
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previous

<#
    سجل البناء. العيب الذي يغلقه: المحوّل لم يُصرَّف قط، ولم يظهر ذلك في أي دليل
    لأن المشغّل كان يموت قبل هذه الخطوة أصلًا. من الآن يوجد ملف يقول صراحةً هل
    وُجد الثنائي، ولماذا لم يوجد، وبأي رسائل مُصرِّف.
#>
$record = [ordered] @{
    tool            = 'polaris.w4.windows-adapter.build'
    built_at        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ", [System.Globalization.CultureInfo]::InvariantCulture)
    compiler        = $csc
    source_count    = $sources.Count
    sources         = @($sources | ForEach-Object { $_ })
    output          = $output
    exit_code       = $exitCode
    compiler_output = @($compilerOutput | ForEach-Object { "$_" })
    binary_present  = (Test-Path -LiteralPath $output)
    binary_sha256   = if (Test-Path -LiteralPath $output) { (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash } else { "" }
    error_code      = if ($exitCode -ne 0) { 'ADAPTER_COMPILATION_FAILED' } else { '' }
}
$evidence = Join-Path $RepositoryRoot 'evidence'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null
[void] (Write-PolarisJsonFile -Path (Join-Path $evidence 'w4-windows-adapter-build.json') -InputObject $record -Depth 5)

if ($exitCode -ne 0) {
    $compilerOutput | ForEach-Object { Write-Host $_ }
    throw "BLOCKED: adapter compilation failed with exit code $exitCode (error_code ADAPTER_COMPILATION_FAILED). See evidence\w4-windows-adapter-build.json"
}
if (-not (Test-Path -LiteralPath $output)) {
    throw "BLOCKED: the compiler reported success but produced no binary at $output"
}
$compilerOutput | Where-Object { "$_" -match 'warning' } | ForEach-Object { Write-Host $_ }
Write-Host "built: $output"
