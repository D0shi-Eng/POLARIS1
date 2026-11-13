# POLARIS remediation 2026-10-12 - per-agent table from the real-model JSONL files (section C.1 of the brief).
#
# Reads every evidence\remediation-2026-10-12\agents\real-*.jsonl, keeps GRADED lines only (BLOCKED lines were never graded),
# and for each case the LAST graded line (a reclassification line supersedes the line it corrects). An agent is
# "accepted on the real model" only when all three of its cases are graded and passed. Nothing is extrapolated:
# agents with no graded case stay NOT_RUN. Writes agents-300-real-table.md and .json next to the inputs.
# Encoding: ASCII in every executable line.

[CmdletBinding()]
param([string] $RepositoryRoot = '')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrEmpty($RepositoryRoot)) {
  $RepositoryRoot = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\..\..')).Path
}
$dir = Join-Path $RepositoryRoot 'evidence\remediation-2026-10-12\agents'
$cases = @{}
$blocked = 0
foreach ($file in @(Get-ChildItem -LiteralPath $dir -Filter 'real-*.jsonl' -File)) {
  # Shared read: the runner may still hold the file open for append.
  $stream = New-Object System.IO.FileStream($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
  $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
  $text = $reader.ReadToEnd()
  $reader.Dispose()
  foreach ($line in ($text -split "`n")) {
    if ($line.Trim() -eq '') { continue }
    $v = $line | ConvertFrom-Json
    $status = if ($v.PSObject.Properties.Name -contains 'status') { $v.status } else { 'GRADED' }
    if ($status -ne 'GRADED') { $blocked++; continue }
    $v | Add-Member -NotePropertyName run_file -NotePropertyValue $file.BaseName -Force; $cases[$file.BaseName + '|' + $v.case_id] = $v
  }
}
$agents = [ordered] @{}
foreach ($v in ($cases.Values | Sort-Object agent_id, kind)) {
  $key = $v.run_file + '|' + $v.agent_id
  if (-not $agents.Contains($key)) {
    $agents[$key] = [ordered] @{ agent_id = $v.agent_id; model_id = $(if ($v.PSObject.Properties.Name -contains 'run_tag' -and $v.run_tag) { $v.model_id + ' [' + $v.run_tag + ']' } else { $v.model_id }); version = $v.agent_version; SPECIALIZED = 'NOT_RUN'; MULTI_STEP = 'NOT_RUN'; ADVERSARIAL = 'NOT_RUN'; failures = @(); tokens = 0 }
  }
  $a = $agents[$key]
  $a[[string] $v.kind] = $(if ($v.passed) { 'PASS' } else { 'FAIL' })
  if (-not $v.passed) { $a.failures += ([string] $v.kind + ': ' + ($v.failures -join '; ')) }
  if ($null -ne $v.total_tokens) { $a.tokens += [int64] $v.total_tokens }
}
$rows = @()
foreach ($a in $agents.Values) {
  $all = @($a.SPECIALIZED, $a.MULTI_STEP, $a.ADVERSARIAL)
  $a.verdict = if (@($all | Where-Object { $_ -eq 'PASS' }).Count -eq 3) { 'ACCEPTED_REAL_MODEL' } elseif (@($all | Where-Object { $_ -eq 'FAIL' }).Count -gt 0) { 'REJECTED_REAL_MODEL' } else { 'INCOMPLETE' }
  $rows += [pscustomobject] $a
}
$accepted = @($rows | Where-Object { $_.verdict -eq 'ACCEPTED_REAL_MODEL' }).Count
$rejected = @($rows | Where-Object { $_.verdict -eq 'REJECTED_REAL_MODEL' }).Count
$incomplete = @($rows | Where-Object { $_.verdict -eq 'INCOMPLETE' }).Count
$graded = $cases.Count
$passed = @($cases.Values | Where-Object { $_.passed }).Count

$md = New-Object System.Text.StringBuilder
[void] $md.AppendLine('# Agents 300 - real-model results (generated from real-*.jsonl; do not edit by hand)')
[void] $md.AppendLine('')
[void] $md.AppendLine(('- All files: graded cases {0} (passed {1}); blocked lines not graded: {2}. Each file is one model and one product revision; results are never merged across files.' -f $graded, $passed, $blocked))
[void] $md.AppendLine('')
[void] $md.AppendLine('| Run (model [revision]) | Agents with results | Accepted | Rejected | Incomplete | NOT_RUN of 300 |')
[void] $md.AppendLine('|---|---:|---:|---:|---:|---:|')
$perRun = @()
foreach ($grp in ($rows | Group-Object model_id | Sort-Object Name)) {
  $acc = @($grp.Group | Where-Object { $_.verdict -eq 'ACCEPTED_REAL_MODEL' }).Count
  $rej = @($grp.Group | Where-Object { $_.verdict -eq 'REJECTED_REAL_MODEL' }).Count
  $inc = @($grp.Group | Where-Object { $_.verdict -eq 'INCOMPLETE' }).Count
  $perRun += [ordered] @{ run = $grp.Name; agents = $grp.Count; accepted = $acc; rejected = $rej; incomplete = $inc; not_run = 300 - $grp.Count }
  [void] $md.AppendLine(('| `{0}` | {1} | {2} | {3} | {4} | {5} |' -f $grp.Name, $grp.Count, $acc, $rej, $inc, (300 - $grp.Count)))
}
[void] $md.AppendLine('')
[void] $md.AppendLine('| Agent | Model | Specialized | Multi-step | Adversarial | Verdict | Tokens | Failure reasons |')
[void] $md.AppendLine('|---|---|---|---|---|---|---:|---|')
foreach ($r in $rows) {
  [void] $md.AppendLine(('| `{0}` | `{1}` | {2} | {3} | {4} | {5} | {6} | {7} |' -f $r.agent_id, $r.model_id, $r.SPECIALIZED, $r.MULTI_STEP, $r.ADVERSARIAL, $r.verdict, $r.tokens, (($r.failures -join ' / ') -replace '\|', '/')))
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $dir 'agents-300-real-table.md'), $md.ToString(), $utf8)
$summary = [ordered] @{ graded_cases = $graded; passed_cases = $passed; blocked_lines = $blocked; runs = $perRun; agents = $rows }
[System.IO.File]::WriteAllText((Join-Path $dir 'agents-300-real-table.json'), ($summary | ConvertTo-Json -Depth 6), $utf8)
Write-Host ('graded {0} passed {1} blocked {2}' -f $graded, $passed, $blocked)
foreach ($r in $perRun) { Write-Host ('{0}: agents {1} accepted {2} rejected {3} incomplete {4} not_run {5}' -f $r.run, $r.agents, $r.accepted, $r.rejected, $r.incomplete, $r.not_run) }
