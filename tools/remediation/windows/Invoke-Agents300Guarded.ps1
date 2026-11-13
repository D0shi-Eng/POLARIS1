# POLARIS remediation 2026-10-12 - hardware-guarded driver for the real-model acceptance run on a LOCAL model.
#
# The owner's rule: test safely, never load the machine beyond its capacity. This driver runs Invoke-Agents300Real.ps1
# in small batches and guards the hardware around and during each batch:
#   - before a batch: GPU temperature must be at or below -ResumeGpuC (waits for it), free RAM above -MinFreeRamMB
#     (stops otherwise), the model server healthy (stops otherwise), and no cargo/rustc build running (waits).
#   - during a batch: polls the GPU every 15 s; at or above -MaxGpuC it stops ONLY its own test process (the case in
#     flight is not recorded and is re-run on resume) and cools down before continuing.
#   - after a batch: a cool-down pause. A BLOCKED case is resumed once; the same case blocked twice stops the run.
# It never stops the model server or any process it did not start. Progress lines go to <out>.guard.log.
# Encoding: ASCII in every executable line.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Provider,
  [Parameter(Mandatory = $true)] [string] $Model,
  [string] $Endpoint = '',
  [int] $From = 0,
  [int] $To = 300,
  [int] $BatchAgents = 5,
  [int] $CooldownSec = 120,
  [int] $MaxGpuC = 83,
  [int] $ResumeGpuC = 65,
  [int] $MinFreeRamMB = 3000,
  [string] $Tag = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = (Resolve-Path (Join-Path $here '..\..\..')).Path
$safe = ($Model -replace '[^A-Za-z0-9._-]', '_')
if ($Tag -ne '') { $safe = $safe + '-' + ($Tag -replace '[^A-Za-z0-9._-]', '_') }
$jsonl = Join-Path $root ("evidence\remediation-2026-10-12\agents\real-" + $safe + ".jsonl")
$glog = $jsonl + '.guard.log'
$runner = Join-Path $here 'Invoke-Agents300Real.ps1'

function Log([string] $text) {
  $line = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + $text
  Write-Host $line
  [System.IO.File]::AppendAllText($glog, $line + "`r`n")
}
function GpuTemp { [int] ((& nvidia-smi --query-gpu=temperature.gpu --format=csv,noheader,nounits) | Select-Object -First 1) }
function GpuPower { [string] ((& nvidia-smi --query-gpu=power.draw --format=csv,noheader) | Select-Object -First 1) }
function FreeRamMB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }
function ServerHealthy {
  if ($Endpoint -eq '') { return $true }
  try { $null = Invoke-RestMethod ($Endpoint.TrimEnd('/') + '/health') -TimeoutSec 10; return $true } catch { return $false }
}
function LastLine {
  if (-not (Test-Path -LiteralPath $jsonl)) { return $null }
  $s = New-Object System.IO.FileStream($jsonl, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $r = New-Object System.IO.StreamReader($s); $t = $r.ReadToEnd(); $r.Dispose()
  $lines = @($t -split "`n" | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -eq 0) { return $null }
  return ($lines[-1] | ConvertFrom-Json)
}
function CoolTo([int] $limit) {
  $t = GpuTemp
  while ($t -gt $limit) { Log ("cooling: GPU {0}C > {1}C, waiting" -f $t, $limit); Start-Sleep -Seconds 30; $t = GpuTemp }
}

Log ("start {0} {1} agents {2}-{3} batch {4}" -f $Provider, $Model, $From, $To, $BatchAgents)
$lastBlocked = ''
$a = $From
while ($a -lt $To) {
  $b = [math]::Min($a + $BatchAgents, $To)
  # Guards before the batch.
  while (@(Get-Process -Name cargo, rustc -ErrorAction SilentlyContinue).Count -gt 0) { Log 'waiting: a cargo/rustc build is running'; Start-Sleep -Seconds 60 }
  CoolTo $ResumeGpuC
  $ram = FreeRamMB
  if ($ram -lt $MinFreeRamMB) { Log ("STOP BLOCKED_RESOURCE_LIMIT: free RAM {0} MB < {1} MB" -f $ram, $MinFreeRamMB); exit 2 }
  if (-not (ServerHealthy)) { Log 'STOP BLOCKED: the model server is not healthy'; exit 3 }
  Log ("batch {0}-{1}: GPU {2}C {3}, free RAM {4} MB" -f $a, $b, (GpuTemp), (GpuPower), $ram)
  $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $runner, '-Provider', $Provider, '-Model', $Model, '-Range', ("{0}-{1}" -f $a, $b))
  if ($Endpoint -ne '') { $argv += @('-Endpoint', $Endpoint) }
  if ($Tag -ne '') { $argv += @('-Tag', $Tag) }
  $p = Start-Process -FilePath 'powershell.exe' -ArgumentList $argv -NoNewWindow -PassThru
  $hot = $false
  while (-not $p.HasExited) {
    Start-Sleep -Seconds 15
    $t = GpuTemp
    if ($t -ge $MaxGpuC) {
      Log ("HOT: GPU {0}C >= {1}C during batch; stopping this driver's own test process" -f $t, $MaxGpuC)
      & taskkill.exe /PID $p.Id /T /F | Out-Null
      $hot = $true
      break
    }
  }
  if ($hot) { CoolTo $ResumeGpuC; continue }
  $last = LastLine
  if ($null -ne $last -and $last.status -ne 'GRADED') {
    if ($last.case_id -eq $lastBlocked) { Log ("STOP {0}: {1} blocked twice ({2})" -f $last.status, $last.case_id, ($last.chat_failures -join ',')); exit 4 }
    $lastBlocked = $last.case_id
    Log ("blocked once: {0} {1} ({2}); cooling and resuming the same batch" -f $last.status, $last.case_id, ($last.chat_failures -join ','))
    Start-Sleep -Seconds $CooldownSec
    continue
  }
  Log ("batch {0}-{1} done; cool-down {2}s" -f $a, $b, $CooldownSec)
  $a = $b
  if ($a -lt $To) { Start-Sleep -Seconds $CooldownSec }
}
Log 'finished: all batches done'
