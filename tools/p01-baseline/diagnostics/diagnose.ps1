#Requires -Version 5.1
<#
  P01-B1 diagnostic harness. NOT canonical evidence.

  Three parts, in order:
    1. host identity  - PowerShell build, CLR, OS, culture
    2. micro-probes   - every PowerShell/.NET interop boundary baseline.ps1
                        touches, each isolated and each caught, so that a single
                        failing primitive is named instead of inferred
    3. runs           - baseline.ps1 as a child process (console + exit code)
                        and through trap-run.ps1 (full exception identity)

  Writes evidence\p01-b1-diagnostics.local.txt. The .local. suffix is the
  repository convention for a non-canonical local artefact.
#>
[CmdletBinding()]
param(
  [string] $RepositoryRoot = "D:\POLARIS"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'
$global:LASTEXITCODE = 0

$lines = New-Object System.Collections.Generic.List[string]
function Emit { param([string] $Text) [void] $lines.Add($Text); Write-Host $Text }

function Invoke-Probe {
  param([string] $Name, [scriptblock] $Body)
  try {
    $result = & $Body
    $text = (@($result) | ForEach-Object { "$_" }) -join ' | '
    Emit ("OK    {0,-34} => {1}" -f $Name, $text)
  }
  catch {
    Emit ("FAIL  {0,-34} => [{1}] {2}" -f $Name, $_.Exception.GetType().FullName, $_.Exception.Message)
  }
}

Emit "==== P01-B1 DIAGNOSTICS ===="
Emit ("generated_utc       : " + (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))
Emit ""
Emit "---- 1. HOST ----"
Emit ("ps_version          : " + $PSVersionTable.PSVersion.ToString())
Emit ("ps_edition          : " + $PSVersionTable.PSEdition)
Emit ("clr_version         : " + $PSVersionTable.CLRVersion)
Emit ("environment_version : " + [System.Environment]::Version.ToString())
Emit ("os                  : " + [System.Environment]::OSVersion.VersionString)
Emit ("is_64bit_process    : " + [System.Environment]::Is64BitProcess)
Emit ("current_culture     : " + (Get-Culture).Name)
Emit ("strictmode          : Latest")
Emit ""

Emit "---- 2. MICRO-PROBES ----"

Invoke-Probe 'generic-list-object-add' {
  $l = New-Object System.Collections.Generic.List[object]
  [void] $l.Add([pscustomobject] @{ a = 1 })
  [void] $l.Add([pscustomobject] @{ a = 2 })
  "count=$($l.Count)"
}

Invoke-Probe 'string-join-object-array' { '[' + [string]::Join(" ", @("a", 1)) + ']' }
Invoke-Probe 'string-join-single-null'  { '[' + [string]::Join(" ", @($null)) + ']' }
Invoke-Probe 'string-join-empty-array'  { '[' + [string]::Join(" ", @()) + ']' }
Invoke-Probe 'string-join-scalar'       { '[' + [string]::Join(" ", @("solo")) + ']' }

Invoke-Probe 'string-join-errorrecords' {
  $o = & cmd.exe /c "echo to-stderr 1>&2" 2>&1
  'types=' + ((@($o) | ForEach-Object { $_.GetType().Name }) -join ',') + ' text=[' + [string]::Join(" ", @($o)) + ']'
}

Invoke-Probe 'format-operator-mixed' { "{0} {1,-18} {2,-8} {3}" -f " ok ", "node", "REQUIRED", "v20.0.0" }
Invoke-Probe 'byte-array-new'        { $b = [byte[]]::new(4); "len=$($b.Length)" }

Invoke-Probe 'env-programfiles-x86'  { "value=[" + ${env:ProgramFiles(x86)} + "]" }
Invoke-Probe 'joinpath-vswhere'      { Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe" }

foreach ($exe in @('node', 'npm', 'rustc', 'cargo', 'rustup')) {
  Invoke-Probe ("getcommand-" + $exe) ({
    $c = Get-Command -Name $exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $c) { return "ABSENT" }
    "source=" + $c.Source + " type=" + $c.GetType().Name
  }.GetNewClosure())
}

# النسخة الحرفية من جسم Invoke-CommandProbe: نفس الاستدعاء، نفس التجميع، نفس الربط.
foreach ($pair in @(
    @{ exe = 'node';   argv = @('--version') },
    @{ exe = 'npm';    argv = @('--version') },
    @{ exe = 'rustc';  argv = @('--version') },
    @{ exe = 'cargo';  argv = @('--version') },
    @{ exe = 'rustup'; argv = @('show', 'active-toolchain') },
    @{ exe = 'cargo';  argv = @('tauri', '--version') }
  )) {
  Invoke-Probe ("probe-body-" + $pair.exe + "-" + ($pair.argv -join '_')) ({
    $exeName = $pair.exe
    [string[]] $argumentList = $pair.argv
    $resolved = Get-Command -Name $exeName -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $resolved) { return "ABSENT_ON_PATH" }
    $out = & $resolved.Source @argumentList 2>&1
    $txt = ([string]::Join(" ", @($out))).Trim()
    "exit=$LASTEXITCODE text=[$txt]"
  }.GetNewClosure())
}

Invoke-Probe 'vswhere-present' {
  $p = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  "path=$p present=" + (Test-Path -LiteralPath $p)
}

Invoke-Probe 'vswhere-invoke-version' {
  $p = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $p)) { return "VSWHERE_ABSENT" }
  $v = & $p -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion 2>&1
  "raw_count=" + (@($v).Count) + " text=[" + ([string]::Join(" ", @($v))).Trim() + "]"
}

Invoke-Probe 'vswhere-invoke-path' {
  $p = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path -LiteralPath $p)) { return "VSWHERE_ABSENT" }
  $v = & $p -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
  "raw_count=" + (@($v).Count) + " text=[" + ([string]::Join(" ", @($v))).Trim() + "]"
}

foreach ($regPath in @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Microsoft SDKs\Windows\v10.0"
  )) {
  Invoke-Probe ("registry-" + ($regPath -replace '.*\\Clients\\', 'wv2-' -replace '.*Windows\\', 'sdk-') ) ({
    if (-not (Test-Path -LiteralPath $regPath)) { return "PATH_ABSENT: $regPath" }
    $item = Get-ItemProperty -LiteralPath $regPath -ErrorAction Stop
    $names = @($item.PSObject.Properties.Name) -join ','
    $pv = ''
    if (@($item.PSObject.Properties.Name) -contains 'pv') { $pv = [string] $item.pv }
    if (@($item.PSObject.Properties.Name) -contains 'ProductVersion') { $pv = [string] $item.ProductVersion }
    "names=[$names] value=[$pv]"
  }.GetNewClosure())
}

Invoke-Probe 'cim-os'  { $o = Get-CimInstance -ClassName Win32_OperatingSystem; "caption=" + $o.Caption + " build=" + $o.BuildNumber + " arch=" + $o.OSArchitecture }
Invoke-Probe 'cim-cs'  { $c = Get-CimInstance -ClassName Win32_ComputerSystem; "cpus=" + ([int] $c.NumberOfLogicalProcessors) + " mem=" + ([long] $c.TotalPhysicalMemory) }

Invoke-Probe 'convertto-json-with-list' {
  $l = New-Object System.Collections.Generic.List[object]
  [void] $l.Add([pscustomobject] @{ id = 'node'; status = 'PRESENT' })
  $doc = [pscustomobject] @{ probes = @($l); summary = [pscustomobject] @{ missing_ids = @() } }
  $j = $doc | ConvertTo-Json -Depth 8
  "json_len=" + $j.Length
}

Invoke-Probe 'evidence-writer-roundtrip' {
  . (Join-Path $RepositoryRoot "tools\evidence-contract\json-evidence.ps1")
  $tmp = Join-Path $RepositoryRoot "evidence\p01-b1-writer-probe.local.json"
  [void] (Write-PolarisJsonFile -Path $tmp -InputObject ([pscustomobject] @{ probe = $true }) -Depth 4)
  $bytes = [System.IO.File]::ReadAllBytes($tmp)
  Remove-Item -LiteralPath $tmp -Force
  "wrote_bytes=" + $bytes.Length + " first=" + ('{0:x2}' -f $bytes[0])
}

Emit ""
Emit "---- 3. RUNS ----"

$scriptPath = Join-Path $RepositoryRoot "tools\p01-baseline\baseline.ps1"
$trapPath   = Join-Path $RepositoryRoot "tools\p01-baseline\diagnostics\trap-run.ps1"

Emit ("baseline_path       : " + $scriptPath)
Emit ("baseline_present    : " + (Test-Path -LiteralPath $scriptPath))
Emit ""
Emit "3a. child process, exact owner invocation"
$childOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -RepositoryRoot $RepositoryRoot 2>&1
$childCode = $LASTEXITCODE
foreach ($line in @($childOut)) { Emit ("  " + $line) }
Emit ("child_exit_code     : " + $childCode)

Emit ""
Emit "3b. in-process under trap"
$trapOut = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $trapPath -RepositoryRoot $RepositoryRoot -ScriptPath $scriptPath 2>&1
foreach ($line in @($trapOut)) { Emit ("  " + $line) }

Emit ""
Emit "---- 4. EVIDENCE FILE STATE ----"
$evidence = Join-Path $RepositoryRoot "evidence\phase-01-baseline.json"
if (Test-Path -LiteralPath $evidence) {
  $fi = Get-Item -LiteralPath $evidence
  Emit ("evidence_present    : True  length=" + $fi.Length + " modified=" + $fi.LastWriteTimeUtc.ToString("yyyy-MM-ddTHH:mm:ssZ"))
} else {
  Emit "evidence_present    : False"
}

Emit ""
Emit "==== END ===="

$report = Join-Path $RepositoryRoot "evidence\p01-b1-diagnostics.local.txt"
$encoding = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($report, (($lines -join "`n") + "`n"), $encoding)
Write-Host ""
Write-Host ("report written: " + $report)
