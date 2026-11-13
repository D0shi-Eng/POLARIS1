#requires -Version 5.1
<#
    بناء ثنائيات spike باستخدام مُصرِّف C# المدمج في ويندوز.
    لا نعتمد على Visual Studio أو أي حزمة خارجية، حتى يبقى الاختبار قابلًا للتكرار على أي Windows 11.
#>
[CmdletBinding()]
param(
    [string]$Root
)

$ErrorActionPreference = 'Stop'

if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }

$spike   = Join-Path $Root 'tools\confinement-spike'
$shared  = Join-Path $spike 'shared'
$child   = Join-Path $spike 'adversarial-child'
$launcher= Join-Path $spike 'launcher'
$bin     = Join-Path $spike 'build\bin'

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) {
    throw "BLOCKED: in-box C# compiler not found at $csc. Cannot build without installing a toolchain."
}

New-Item -ItemType Directory -Force -Path $bin | Out-Null

function Invoke-Compile {
    param([string]$OutputName, [string[]]$SourceDirectories)

    $sources = @()
    foreach ($directory in $SourceDirectories) {
        $sources += (Get-ChildItem -Path $directory -Filter *.cs -Recurse | Select-Object -ExpandProperty FullName)
    }
    if ($sources.Count -eq 0) { throw "BLOCKED: no sources found for $OutputName" }

    $output = Join-Path $bin $OutputName
    $arguments = @(
        '/nologo'
        '/target:exe'
        '/platform:x64'
        '/optimize+'
        '/utf8output'
        "/out:$output"
        '/r:System.dll'
        '/r:System.Core.dll'
    ) + $sources

    Write-Host "compiling $OutputName from $($sources.Count) files"

    # نخفض صرامة الأخطاء مؤقتًا لأن مخرجات المُصرِّف على stderr ليست فشلًا بحد ذاتها
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $compilerOutput = & $csc @arguments 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous

    if ($exitCode -ne 0) {
        $compilerOutput | ForEach-Object { Write-Host $_ }
        throw "BLOCKED: compilation of $OutputName failed with exit code $exitCode"
    }
    $compilerOutput | Where-Object { "$_" -match 'warning' } | ForEach-Object { Write-Host $_ }
}

Invoke-Compile -OutputName 'polaris-adversarial-child.exe' -SourceDirectories @($shared, $child)
Invoke-Compile -OutputName 'polaris-confinement-launcher.exe' -SourceDirectories @($shared, $launcher)

Write-Host "build output: $bin"
Get-ChildItem $bin -Filter *.exe | ForEach-Object { Write-Host ("  {0}  {1} bytes" -f $_.Name, $_.Length) }
