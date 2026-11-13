#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-08 - read-only native environment probe.
.DESCRIPTION
  Reads, changes nothing. Records which local model servers answer on loopback,
  which Python and Chromium-family browsers exist, and the Git / GitHub CLI state,
  so that the Phase-08 native run can pick real components instead of guessing.
  No token, password or key is read or printed: GitHub authentication is recorded
  only as an account name and a boolean.
#>
param([string] $RepositoryRoot = "D:\POLARIS")

$ErrorActionPreference = 'Continue'
$out = Join-Path $RepositoryRoot 'evidence\p08-native'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Get-Json([string] $Url) {
  # Loopback request with a short timeout; absence is recorded, not hidden.
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return @{ reachable = $true; status = [int]$r.StatusCode; body = ($r.Content | ConvertFrom-Json) }
  } catch {
    return @{ reachable = $false; error = $_.Exception.GetType().Name }
  }
}

function Get-Version([string] $Exe, [string[]] $VersionArgs) {
  try {
    $cmd = Get-Command $Exe -ErrorAction Stop
    $v = & $cmd.Source @VersionArgs 2>&1 | Select-Object -First 1
    return @{ present = $true; path = $cmd.Source; version = "$v" }
  } catch { return @{ present = $false } }
}

$probe = [ordered]@{}
$probe.tool = 'polaris.p08.probe'
$probe.measured_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
$probe.os = @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; total_memory_gib = [math]::Round($cs.TotalPhysicalMemory / 1GB, 1); logical_processors = $cs.NumberOfLogicalProcessors }
try { $probe.gpu = @(Get-CimInstance Win32_VideoController | ForEach-Object { @{ name = $_.Name; ram_mib = [math]::Round($_.AdapterRAM / 1MB) } }) } catch { $probe.gpu = @() }
$probe.powershell = $PSVersionTable.PSVersion.ToString()
$probe.node = Get-Version 'node' @('-v')
$probe.cargo = Get-Version 'cargo' @('-V')
$probe.rustc = Get-Version 'rustc' @('-V')

# Local model servers on loopback.
$ollamaTags = Get-Json 'http://127.0.0.1:11434/api/tags'
$ollama = @{ reachable = $ollamaTags.reachable }
if ($ollamaTags.reachable) {
  $ollama.models = @($ollamaTags.body.models | ForEach-Object { @{ name = $_.name; size_gib = [math]::Round($_.size / 1GB, 2); family = $_.details.family; parameter_size = $_.details.parameter_size; quantization = $_.details.quantization_level } })
  $ver = Get-Json 'http://127.0.0.1:11434/api/version'
  if ($ver.reachable) { $ollama.version = $ver.body.version }
  $ps = Get-Json 'http://127.0.0.1:11434/api/ps'
  if ($ps.reachable) { $ollama.loaded = @($ps.body.models | ForEach-Object { $_.name }) }
}
$ollama.executable = Get-Version 'ollama' @('--version')
$probe.ollama = $ollama
$lms = Get-Json 'http://127.0.0.1:1234/v1/models'
$lm = @{ reachable = $lms.reachable }
if ($lms.reachable) { $lm.models = @($lms.body.data | ForEach-Object { $_.id }) }
$probe.lmstudio = $lm

# Python: base prefix and whether ALL APPLICATION PACKAGES may read it.
$py = @{}
foreach ($name in @('python', 'py')) {
  try {
    $c = Get-Command $name -ErrorAction Stop
    $py[$name] = @{ path = $c.Source }
  } catch { $py[$name] = @{ present = $false } }
}
try {
  $info = & python -c "import sys,json,platform;print(json.dumps({'version':platform.python_version(),'executable':sys.executable,'base_prefix':sys.base_prefix,'bits':platform.architecture()[0]}))" 2>$null
  if ($info) {
    $pinfo = $info | ConvertFrom-Json
    $py.info = $pinfo
    $acl = (& icacls $pinfo.base_prefix 2>$null) -join "`n"
    $py.base_prefix_all_application_packages = ($acl -match 'ALL APPLICATION PACKAGES')
    $mods = & python -c "import importlib.util as u,json;print(json.dumps({m:bool(u.find_spec(m)) for m in ['openpyxl','docx','pptx','reportlab','matplotlib','pandas','pypdf','venv','ensurepip']}))" 2>$null
    if ($mods) { $py.modules = ($mods | ConvertFrom-Json) }
  }
} catch { $py.error = $_.Exception.GetType().Name }
$probe.python = $py

# Chromium-family browsers: well-known paths only, no disk search.
$browsers = @()
foreach ($p in @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
  if ($p -and (Test-Path -LiteralPath $p)) {
    $browsers += @{ path = $p; version = (Get-Item -LiteralPath $p).VersionInfo.ProductVersion }
  }
}
$probe.browsers = $browsers
try {
  $wv = Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction Stop
  $probe.webview2 = $wv.pv
} catch { $probe.webview2 = $null }

# Git and GitHub: read only. No token is read or printed.
$probe.git = Get-Version 'git' @('--version')
$probe.repository_has_git_dir = Test-Path -LiteralPath (Join-Path $RepositoryRoot '.git')
if ($probe.git.present) {
  $probe.git.credential_helper = "$(& git config --global credential.helper 2>$null)"
  $probe.git.user_name_configured = [bool]("$(& git config --global user.name 2>$null)")
}
$gh = Get-Version 'gh' @('--version')
if ($gh.present) {
  $status = (& gh auth status 2>&1) -join "`n"
  $gh.authenticated = ($LASTEXITCODE -eq 0)
  $m = [regex]::Match($status, 'account\s+(\S+)')
  if ($m.Success) { $gh.account = $m.Groups[1].Value }
  $view = & gh repo view D0shi-Eng/POLARIS --json nameWithOwner,visibility,isPrivate,isEmpty,defaultBranchRef 2>$null
  if ($LASTEXITCODE -eq 0 -and $view) { $gh.target_repository = ($view | ConvertFrom-Json) } else { $gh.target_repository = 'NOT_READABLE' }
}
$probe.gh = $gh

$json = $probe | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $out 'probe.local.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "POLARIS P08 probe written: $(Join-Path $out 'probe.local.json')"
