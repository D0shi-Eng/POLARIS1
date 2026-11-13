# POLARIS 2026-10-15 - driver for an agents-300-eval/2.2 SAMPLE on a remote provider (owner request: OpenCode Zen,
# deepseek-v4.1-flash-free then Claude Haiku 5.5). A remote model puts no load on the GPU, so the local guards of
# Invoke-Eval2Guarded.ps1 (GPU temperature, one model on the GPU, /health of the local server) do not apply here.
# This driver instead:
#   - reads the provider key from the environment (process, then the owner's User scope) and passes it to the test
#     process only; the key is never printed or written, and is scrubbed from the captured test output;
#   - runs the PREBUILT test binary once with the chosen agents and kinds, and saves a transcript per case
#     (POLARIS_EVAL_TRANSCRIPTS) next to the results;
#   - stops its own test process when -MaxRateLimited cases were rate limited (the provider is refusing, so the run
#     would only record resource blocks), or when a file named STOP appears next to the output.
# It never stops a process it did not start. ASCII only (Windows PowerShell 5.1).

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Exe,
  [Parameter(Mandatory = $true)] [string] $Model,
  [Parameter(Mandatory = $true)] [string] $Out,
  [Parameter(Mandatory = $true)] [string] $AgentsFile,
  [string] $Provider = 'opencode',
  [string] $KeyEnv = 'OPENCODE_API_KEY',
  [string] $Kinds = '',
  [string] $Tag = '',
  [int] $Workers = 3,
  [int] $MaxRateLimited = 8
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $Out
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$glog = $Out + '.guard.log'
$blog = $Out + '.batches.log'
$stop = Join-Path $dir 'STOP'
$transcripts = $Out + '.transcripts'

function Log([string] $text) {
  $line = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + ' ' + $text
  Write-Host $line
  [System.IO.File]::AppendAllText($glog, $line + "`r`n")
}
function Rows {
  if (-not (Test-Path -LiteralPath $Out)) { return @() }
  $s = New-Object System.IO.FileStream($Out, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $r = New-Object System.IO.StreamReader($s); $t = $r.ReadToEnd(); $r.Dispose()
  return @($t -split "`n" | Where-Object { $_.Trim() -ne '' } | ForEach-Object { $_ | ConvertFrom-Json })
}

$key = [Environment]::GetEnvironmentVariable($KeyEnv, 'Process')
if ([string]::IsNullOrWhiteSpace($key)) { $key = [Environment]::GetEnvironmentVariable($KeyEnv, 'User') }
if ([string]::IsNullOrWhiteSpace($key)) { Log ("STOP NO_KEY: {0} is not set in the process or User environment" -f $KeyEnv); exit 7 }
$key = $key.Trim()
$agents = (Get-Content -LiteralPath $AgentsFile -Raw).Trim()
if ($Tag -eq '') { $Tag = [System.IO.Path]::GetFileNameWithoutExtension($Out) }

$exeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Exe).Hash
Log ("start eval/2.2 sample {0} via {1}, {2} agents, kinds [{3}], {4} workers, exe {5}, out {6}" -f $Model, $Provider, @($agents -split ',').Count, $Kinds, $Workers, $exeHash, $Out)
$before = @(Rows).Count
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = $Exe
$info.Arguments = 'eval2_on_the_owners_real_model --ignored --exact --test-threads=1 --nocapture'
$info.UseShellExecute = $false
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$info.WorkingDirectory = 'D:\POLARIS\desktop\host\win'
foreach ($n in @('POLARIS_EVAL_ENDPOINT', 'POLARIS_AGENTS_RANGE', 'POLARIS_EVAL_MAX_CASES', 'POLARIS_EVAL_KINDS')) { [void] $info.EnvironmentVariables.Remove($n) }
$info.EnvironmentVariables['POLARIS_EVAL_PROVIDER'] = $Provider
$info.EnvironmentVariables['POLARIS_EVAL_MODEL'] = $Model
$info.EnvironmentVariables['POLARIS_EVAL_API_KEY'] = $key
$info.EnvironmentVariables['POLARIS_EVAL_OUT'] = $Out
$info.EnvironmentVariables['POLARIS_EVAL_TAG'] = $Tag
$info.EnvironmentVariables['POLARIS_EVAL_WORKERS'] = [string] $Workers
$info.EnvironmentVariables['POLARIS_EVAL_TRANSCRIPTS'] = $transcripts
$info.EnvironmentVariables['POLARIS_AGENTS_LIST'] = $agents
if ($Kinds -ne '') { $info.EnvironmentVariables['POLARIS_EVAL_KINDS'] = $Kinds }
$p = New-Object System.Diagnostics.Process
$p.StartInfo = $info
$null = $p.Start()
$stdout = $p.StandardOutput.ReadToEndAsync()
$stderr = $p.StandardError.ReadToEndAsync()
$reason = ''
while (-not $p.HasExited) {
  Start-Sleep -Seconds 15
  $new = @(Rows | Select-Object -Skip $before)
  $limited = @($new | Where-Object { $_.rate_limited_calls -gt 0 -or $_.status -eq 'BLOCKED_RESOURCE_LIMIT' }).Count
  if ($limited -ge $MaxRateLimited) { $reason = "RATE_LIMITED: $limited cases"; break }
  if (Test-Path -LiteralPath $stop) { $reason = 'STOP file present'; break }
}
if ($reason -ne '') {
  Log ("STOP {0}; stopping this driver's own test process" -f $reason)
  & taskkill.exe /PID $p.Id /T /F | Out-Null
}
$p.WaitForExit()
$text = ("==== sample {0} exit {1}`r`n{2}`r`n{3}`r`n" -f $Model, $p.ExitCode, $stdout.Result, $stderr.Result).Replace($key, '[REDACTED]')
[System.IO.File]::AppendAllText($blog, $text)
$new = @(Rows | Select-Object -Skip $before)
Log ("finished: exit {0}, +{1} cases, {2} passed, {3} rate limited" -f $p.ExitCode, $new.Count, @($new | Where-Object { $_.passed }).Count, @($new | Where-Object { $_.rate_limited_calls -gt 0 }).Count)
if ($reason -ne '') { exit 4 }
exit $p.ExitCode
