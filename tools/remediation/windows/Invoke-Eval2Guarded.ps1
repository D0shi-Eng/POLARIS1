# POLARIS QA 2026-10-15 - hardware-guarded driver for the full agents-300-eval/2.2 run on the owner's local model.
#
# Owner approval 2026-10-15: full eval/2.2 (792 cases) on Bonsai, one worker, with the hardware safety rules
# (memory: polaris-hardware-load-safety). This driver runs the PREBUILT test binary directly (no cargo during inference),
# in batches of agents, and guards the machine around and during each batch:
#   before a batch : no cargo/rustc running (waits); GPU at or below -ResumeGpuC (waits); free RAM >= -MinFreeRamMB and
#                    free disk on the temp drive >= -MinFreeDiskGB (stops otherwise); the model server healthy (stops);
#                    exactly one GPU compute process and no Ollama model loaded (stops: one model at a time).
#   during a batch : every 15 s reads GPU temperature and power; at or above -MaxGpuC, or power above -MaxPowerW for three
#                    readings in a row, it kills ONLY its own test process (the case in flight is not recorded and is re-run
#                    on resume) and cools down; a second process on the GPU stops the run.
#   after a batch  : a cool-down pause. The same case BLOCKED twice stops the run.
# A file named STOP next to the output ends the run after the current batch. It never stops the model server or any
# process it did not start. Progress goes to <out>.guard.log, test output to <out>.batches.log.
# ASCII only (Windows PowerShell 5.1).

[CmdletBinding()]
param(
  [string] $Exe = 'D:\POLARIS\desktop\host\target\debug\deps\agents300_eval2-29775b36f95c685f.exe',
  [string] $Out = 'D:\POLARIS\evidence\remediation-2026-10-15\agents\eval2.2-a677b35-w1.jsonl',
  [string] $Provider = 'local-openai-compatible',
  [string] $Model = 'local-openai-compatible:bonsai-2-27b',
  [string] $Endpoint = 'http://127.0.0.1:8080',
  [string] $Tag = 'eval2.2-a677b35-w1',
  [int] $From = 0,
  [int] $To = 300,
  [int] $BatchAgents = 10,
  [int] $CooldownSec = 60,
  [int] $MaxGpuC = 80,
  [int] $ResumeGpuC = 65,
  [int] $MaxPowerW = 178,
  [int] $MinFreeRamMB = 4000,
  [int] $MinFreeDiskGB = 20
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $Out
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$glog = $Out + '.guard.log'
$blog = $Out + '.batches.log'
$stop = Join-Path $dir 'STOP'

function Log([string] $text) {
  $line = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + $text
  Write-Host $line
  [System.IO.File]::AppendAllText($glog, $line + "`r`n")
}
function Gpu {
  $row = (& nvidia-smi --query-gpu=temperature.gpu,power.draw,memory.used --format=csv,noheader,nounits | Select-Object -First 1) -split ','
  return [pscustomobject] @{ temp = [int] $row[0].Trim(); power = [double] $row[1].Trim(); mem = [int] $row[2].Trim() }
}
function GpuApps { @(& nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader 2>$null | Where-Object { $_.Trim() -ne '' }) }
function OllamaLoaded {
  try { $r = Invoke-RestMethod 'http://127.0.0.1:11434/api/ps' -TimeoutSec 5; return @($r.models).Count } catch { return 0 }
}
function FreeRamMB { [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024) }
function FreeDiskGB { $q = Split-Path -Qualifier $env:TEMP; [math]::Round((Get-PSDrive -Name $q.TrimEnd(':')).Free / 1GB, 1) }
function Healthy { try { $null = Invoke-RestMethod ($Endpoint.TrimEnd('/') + '/health') -TimeoutSec 10; return $true } catch { return $false } }
function LastLine {
  if (-not (Test-Path -LiteralPath $Out)) { return $null }
  $s = New-Object System.IO.FileStream($Out, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $r = New-Object System.IO.StreamReader($s); $t = $r.ReadToEnd(); $r.Dispose()
  $lines = @($t -split "`n" | Where-Object { $_.Trim() -ne '' })
  if ($lines.Count -eq 0) { return $null }
  return ($lines[-1] | ConvertFrom-Json)
}
function Lines { if (Test-Path -LiteralPath $Out) { @(Get-Content -LiteralPath $Out | Where-Object { $_.Trim() -ne '' }).Count } else { 0 } }
function CoolTo([int] $limit) {
  $g = Gpu
  while ($g.temp -gt $limit) { Log ("cooling: GPU {0}C > {1}C" -f $g.temp, $limit); Start-Sleep -Seconds 30; $g = Gpu }
}
function OneModelOnly {
  $apps = @(GpuApps)
  $loaded = OllamaLoaded
  if ($apps.Count -gt 1 -or $loaded -gt 0) { Log ("STOP SECOND_MODEL: gpu apps [{0}], ollama models {1}" -f ($apps -join ' | '), $loaded); exit 5 }
}

$exeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Exe).Hash
Log ("start eval/2.2 {0} agents {1}-{2} batch {3} exe {4} out {5}" -f $Model, $From, $To, $BatchAgents, $exeHash, $Out)
$lastBlocked = ''
$a = $From
while ($a -lt $To) {
  if (Test-Path -LiteralPath $stop) { Log 'STOP file present; ending before the next batch'; exit 0 }
  $b = [math]::Min($a + $BatchAgents, $To)
  while (@(Get-Process -Name cargo, rustc -ErrorAction SilentlyContinue).Count -gt 0) { Log 'waiting: a cargo/rustc build is running'; Start-Sleep -Seconds 60 }
  CoolTo $ResumeGpuC
  $ram = FreeRamMB; $disk = FreeDiskGB
  if ($ram -lt $MinFreeRamMB) { Log ("STOP BLOCKED_RESOURCE_LIMIT: free RAM {0} MB < {1}" -f $ram, $MinFreeRamMB); exit 2 }
  if ($disk -lt $MinFreeDiskGB) { Log ("STOP BLOCKED_RESOURCE_LIMIT: free disk {0} GB < {1}" -f $disk, $MinFreeDiskGB); exit 2 }
  if (-not (Healthy)) { Log 'STOP BLOCKED: the model server is not healthy'; exit 3 }
  OneModelOnly
  $g = Gpu
  $before = Lines
  Log ("batch {0}-{1}: GPU {2}C {3}W {4}MiB, free RAM {5} MB, disk {6} GB, lines {7}" -f $a, $b, $g.temp, $g.power, $g.mem, $ram, $disk, $before)
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $Exe
  $info.Arguments = 'eval2_on_the_owners_real_model --ignored --exact --test-threads=1 --nocapture'
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.WorkingDirectory = 'D:\POLARIS\desktop\host\win'
  $info.EnvironmentVariables['POLARIS_EVAL_PROVIDER'] = $Provider
  $info.EnvironmentVariables['POLARIS_EVAL_MODEL'] = $Model
  $info.EnvironmentVariables['POLARIS_EVAL_ENDPOINT'] = $Endpoint
  $info.EnvironmentVariables['POLARIS_EVAL_OUT'] = $Out
  $info.EnvironmentVariables['POLARIS_EVAL_TAG'] = $Tag
  $info.EnvironmentVariables['POLARIS_EVAL_WORKERS'] = '1'
  $info.EnvironmentVariables['POLARIS_AGENTS_RANGE'] = ("{0}-{1}" -f $a, $b)
  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $info
  $null = $p.Start()
  $stdout = $p.StandardOutput.ReadToEndAsync()
  $stderr = $p.StandardError.ReadToEndAsync()
  $hot = $false; $highPower = 0
  while (-not $p.HasExited) {
    Start-Sleep -Seconds 15
    $g = Gpu
    if ($g.power -gt $MaxPowerW) { $highPower++ } else { $highPower = 0 }
    if ($g.temp -ge $MaxGpuC -or $highPower -ge 3) {
      Log ("HOT: GPU {0}C {1}W (limits {2}C / {3}W x3); stopping this driver's own test process" -f $g.temp, $g.power, $MaxGpuC, $MaxPowerW)
      & taskkill.exe /PID $p.Id /T /F | Out-Null
      $hot = $true
      break
    }
    if (@(GpuApps).Count -gt 1) { & taskkill.exe /PID $p.Id /T /F | Out-Null; OneModelOnly }
  }
  $p.WaitForExit()
  [System.IO.File]::AppendAllText($blog, ("==== batch {0}-{1} exit {2}`r`n{3}`r`n{4}`r`n" -f $a, $b, $p.ExitCode, $stdout.Result, $stderr.Result))
  if ($hot) { CoolTo $ResumeGpuC; continue }
  $last = LastLine
  if ($null -ne $last -and $last.status -ne 'GRADED') {
    if ($last.case_id -eq $lastBlocked) { Log ("STOP {0}: {1} blocked twice ({2})" -f $last.status, $last.case_id, (@($last.chat_failures) -join ',')); exit 4 }
    $lastBlocked = $last.case_id
    Log ("blocked once: {0} {1}; cooling and resuming the same batch" -f $last.status, $last.case_id)
    Start-Sleep -Seconds $CooldownSec
    continue
  }
  if ($p.ExitCode -ne 0) { Log ("STOP: the test process exited {0} (see batches.log)" -f $p.ExitCode); exit 6 }
  Log ("batch {0}-{1} done: +{2} lines, total {3}; cool-down {4}s" -f $a, $b, ((Lines) - $before), (Lines), $CooldownSec)
  $a = $b
  if ($a -lt $To) { Start-Sleep -Seconds $CooldownSec }
}
Log 'finished: all batches done'
