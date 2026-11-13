#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-01 - remediation sequence for the two-defect prompt.

.DESCRIPTION
  Runs, in this order, and stops at the first failure:
    1  runtime verify            (W6-D12 regression lane: typecheck, build, 505+ tests)
    2  frontend-lane.ps1         (STARTUP_REPORT_ABSENT affected lane)
    3  run.ps1                   (the canonical Phase-01 runner, once)
  Every step writes its full output to evidence\p01-native\sequence-<step>.local.log
  and the sequence writes evidence\p01-native\sequence.local.json. These files are
  local, non-canonical, and never replace canonical evidence.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "D:\POLARIS\tools\p01-conformance\p01-remediation-sequence.ps1" -RepositoryRoot "D:\POLARIS"
#>

[CmdletBinding()]
param([string] $RepositoryRoot = "D:\POLARIS")

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepositoryRoot = [System.IO.Path]::GetFullPath($RepositoryRoot)
$logDirectory = Join-Path $RepositoryRoot 'evidence\p01-native'
if (-not (Test-Path -LiteralPath $logDirectory)) { [void] (New-Item -ItemType Directory -Path $logDirectory) }
$npm = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { 'npm.cmd' } else { 'npm' }
$shell = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $shell)) { $shell = 'powershell' }

$steps = New-Object System.Collections.ArrayList

# -- one step: output is shown live and kept in its own log; judged by exit code only
function Invoke-SequenceStep {
  param([string] $Id, [string] $Name, [scriptblock] $Body)
  $log = Join-Path $logDirectory ("sequence-" + $Id + ".local.log")
  Write-Host ""
  Write-Host ("=== " + $Name)
  $started = Get-Date
  $global:LASTEXITCODE = 0
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Body 2>&1 | ForEach-Object {
      if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { [string] $_ }
    } | Tee-Object -FilePath $log | Out-Host
  }
  finally { $ErrorActionPreference = $previous }
  $code = $LASTEXITCODE
  [void] $steps.Add([ordered] @{
    id          = $Id
    name        = $Name
    exit_code   = $code
    duration_ms = [int]((Get-Date) - $started).TotalMilliseconds
    log         = $log
  })
  Write-Host ("=== " + $Name + " -> exit " + $code)
  return $code
}

function Write-SequenceDocument {
  param([string] $Verdict, [string] $StoppedAt)
  $document = [ordered] @{
    kind        = 'POLARIS_P01_REMEDIATION_SEQUENCE'
    canonical   = $false
    measured_at = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    verdict     = $Verdict
    stopped_at  = $StoppedAt
    steps       = $steps
  }
  $json = ($document | ConvertTo-Json -Depth 8).Replace("`r`n", "`n")
  $out = Join-Path $logDirectory 'sequence.local.json'
  [System.IO.File]::WriteAllText($out, ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ("wrote " + $out)
}

# -- 1 runtime verify -----------------------------------------------------------
$code = Invoke-SequenceStep 'runtime' 'runtime verify (W6-D12 lane)' {
  Push-Location -LiteralPath (Join-Path $RepositoryRoot 'runtime')
  try { & $npm 'run' 'verify' } finally { Pop-Location }
}
if ($code -ne 0) { Write-SequenceDocument 'FAIL' 'runtime'; Write-Host "SEQUENCE = FAIL (runtime)"; exit 1 }

# -- 2 frontend lane ------------------------------------------------------------
$code = Invoke-SequenceStep 'frontend-lane' 'frontend lane (STARTUP_REPORT_ABSENT)' {
  & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p01-conformance\frontend-lane.ps1') -RepositoryRoot $RepositoryRoot
}
if ($code -ne 0) { Write-SequenceDocument 'FAIL' 'frontend-lane'; Write-Host "SEQUENCE = FAIL (frontend lane)"; exit 1 }

# -- 3 canonical Phase-01 runner, once ------------------------------------------
$code = Invoke-SequenceStep 'phase-01' 'canonical Phase-01 runner' {
  & $shell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepositoryRoot 'tools\p01-conformance\run.ps1') -RepositoryRoot $RepositoryRoot
}
if ($code -ne 0) { Write-SequenceDocument 'FAIL' 'phase-01'; Write-Host "SEQUENCE = FAIL (Phase-01 runner)"; exit 1 }

Write-SequenceDocument 'COMPLETED' ''
Write-Host "SEQUENCE = COMPLETED (read evidence\phase-01-final-gate.json for the verdict)"
exit 0
