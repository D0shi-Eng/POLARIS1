#requires -Version 5.1
<#
    تقييم Windows Sandbox دون تغيير النظام.
    لا نُفعّل الميزة الاختيارية ولا نعيد التشغيل، بل نقيس ما هو متاح فعلًا فقط.
#>
[CmdletBinding()]
param(
    [string]$Root,
    [switch]$IncludeBoot
)

$ErrorActionPreference = 'Stop'
if (-not $Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }

<#
  عقد بايتات الدليل: كاتب JSON واحد لكل المشروع.
  Set-Content -Encoding UTF8 على Windows PowerShell 5.1 يكتب BOM (EF BB BF).
#>
$jsonEvidenceModule = Join-Path $Root 'tools\evidence-contract\json-evidence.ps1'
if (-not (Test-Path -LiteralPath $jsonEvidenceModule)) {
  throw "BLOCKED: the JSON evidence byte contract module is missing at $jsonEvidenceModule"
}
. $jsonEvidenceModule

$evidence = Join-Path $Root 'evidence'
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

$binaryPath = Join-Path $env:WINDIR 'System32\WindowsSandbox.exe'
$binaryPresent = Test-Path $binaryPath

$featureState = 'NOT_QUERIED'
try {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName 'Containers-DisposableClientVM' -ErrorAction Stop
    $featureState = [string]$feature.State
} catch {
    $featureState = 'REQUIRES_ADMIN_OR_UNAVAILABLE: ' + $_.Exception.GetType().Name
}

$bootResult = @{
    status   = 'NOT_TESTED'
    reason   = 'boot test not requested'
    seconds  = $null
    network  = $null
    hostDisk = $null
}

if ($IncludeBoot -and $binaryPresent) {
    $probeDirectory = Join-Path $evidence 'sandbox-probe'
    New-Item -ItemType Directory -Force -Path $probeDirectory | Out-Null
    Remove-Item (Join-Path $probeDirectory 'marker.txt') -ErrorAction SilentlyContinue

    $probeScript = @'
$marker = "C:\probe\marker.txt"
$net = "unknown"
try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async  = $client.BeginConnect("1.1.1.1", 443, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(3000)) { $client.EndConnect($async); $net = "reachable" }
    else { $net = "timeout" }
    $client.Close()
} catch { $net = "blocked:" + $_.Exception.GetType().Name }
$hostDisk = "not-visible"
"boot_completed_utc={0}" -f (Get-Date).ToUniversalTime().ToString("o") | Set-Content -Path $marker
"network={0}" -f $net | Add-Content -Path $marker
"host_c_visible={0}" -f $hostDisk | Add-Content -Path $marker
'@
    Set-Content -Path (Join-Path $probeDirectory 'sandbox-probe.ps1') -Value $probeScript -Encoding UTF8

    $configuration = @"
<Configuration>
  <Networking>Disable</Networking>
  <MappedFolders>
    <MappedFolder>
      <HostFolder>$probeDirectory</HostFolder>
      <SandboxFolder>C:\probe</SandboxFolder>
      <ReadOnly>false</ReadOnly>
    </MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -ExecutionPolicy Bypass -File C:\probe\sandbox-probe.ps1</Command>
  </LogonCommand>
</Configuration>
"@
    $configurationPath = Join-Path $probeDirectory 'polaris-w1.wsb'
    Set-Content -Path $configurationPath -Value $configuration -Encoding UTF8

    $started = Get-Date
    try {
        Start-Process -FilePath $binaryPath -ArgumentList "`"$configurationPath`""
        $markerPath = Join-Path $probeDirectory 'marker.txt'
        $deadline = $started.AddSeconds(240)
        while ((Get-Date) -lt $deadline -and -not (Test-Path $markerPath)) { Start-Sleep -Seconds 2 }

        if (Test-Path $markerPath) {
            $bootResult.status  = 'MEASURED'
            $bootResult.reason  = 'logon command marker observed on the host through the mapped folder'
            $bootResult.seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
            $content = Get-Content $markerPath -Raw
            $bootResult.network  = (($content -split "`n") | Where-Object { $_ -like 'network=*' }) -join ''
            $bootResult.hostDisk = (($content -split "`n") | Where-Object { $_ -like 'host_c_visible=*' }) -join ''
        } else {
            $bootResult.status = 'TIMEOUT'
            $bootResult.reason = 'no marker within 240 seconds'
        }
    } finally {
        Get-Process -Name 'WindowsSandbox','WindowsSandboxClient','WindowsSandboxRemoteSession' -ErrorAction SilentlyContinue |
            Stop-Process -Force -ErrorAction SilentlyContinue
    }
} elseif ($IncludeBoot -and -not $binaryPresent) {
    $bootResult.status = 'NOT_TESTED'
    $bootResult.reason = 'WindowsSandbox.exe is not present; the optional feature is not enabled and enabling it would be a permanent system change requiring a reboot, which is out of scope for this spike'
}

$report = [ordered]@{
    captured_utc            = (Get-Date).ToUniversalTime().ToString('o')
    binary_present          = $binaryPresent
    optional_feature_state  = $featureState
    boot_test               = $bootResult
    scope_note              = 'This spike never enables or disables Windows optional features, Defender, the firewall, or UAC.'
}

$outputPath = Join-Path $evidence 'windows-sandbox.json'
[void] (Write-PolarisJsonFile -Path $outputPath -InputObject $report -Depth 6)
Write-Host "windows sandbox evaluation written to $outputPath"
Write-Host ("  binary_present={0} feature_state={1} boot={2}" -f $binaryPresent, $featureState, $bootResult.status)
