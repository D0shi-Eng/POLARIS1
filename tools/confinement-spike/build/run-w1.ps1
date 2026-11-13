#requires -Version 5.1
<#
    نقطة التشغيل الوحيدة لـ W1.
    الترتيب: بناء، ثم تنفيذ الأنماط، ثم تقييم Windows Sandbox، ثم طباعة ملخص.
    كل المخرجات تبقى داخل جذر المشروع.
#>
[CmdletBinding()]
param(
    [string]$Root,
    [switch]$SkipBuild,
    [switch]$IncludeSandboxBoot
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }

$elevated = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
            ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host '=============================================='
Write-Host ' POLARIS PHASE-00 / W1 confinement spike'
Write-Host '=============================================='
Write-Host ("root      : {0}" -f $Root)
Write-Host ("elevated  : {0}" -f $elevated)
Write-Host ("os build  : {0}" -f (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuild)
Write-Host ''

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot 'build.ps1') -Root $Root
    Write-Host ''
}

$launcherExe = Join-Path $Root 'tools\confinement-spike\build\bin\polaris-confinement-launcher.exe'
if (-not (Test-Path $launcherExe)) { throw "BLOCKED: launcher binary missing at $launcherExe" }

Write-Host '--- running confinement variants (sequential, CPU hard capped) ---'
& $launcherExe --root $Root
$launcherExit = $LASTEXITCODE
Write-Host ("launcher exit code: {0}" -f $launcherExit)
Write-Host ''

Write-Host '--- evaluating Windows Sandbox ---'
& (Join-Path $PSScriptRoot 'Evaluate-WindowsSandbox.ps1') -Root $Root -IncludeBoot:$IncludeSandboxBoot
Write-Host ''

$evidence = Join-Path $Root 'evidence'
Write-Host '--- evidence produced ---'
Get-ChildItem -Path $evidence -Recurse -File |
    Select-Object @{n='file';e={$_.FullName.Substring($Root.Length + 1)}}, @{n='bytes';e={$_.Length}} |
    Format-Table -AutoSize | Out-String | Write-Host

if (-not $elevated) {
    Write-Host 'NOTE: this run was not elevated.'
    Write-Host '      The loopback-exemption variant (V5) and the optional-feature query were skipped and are recorded as REQUIRES_ADMIN.'
}

Write-Host 'W1 execution finished. Nothing was installed, no system policy was changed.'
exit $launcherExit
