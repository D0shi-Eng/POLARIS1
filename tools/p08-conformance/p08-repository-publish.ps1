#Requires -Version 5.1
<#
.SYNOPSIS
  POLARIS Phase-08 - the final repository step: a local Git history (main and develop)
  pushed to the PRIVATE GitHub repository D0shi-Eng/POLARIS.

.DESCRIPTION
  Safety rules, in order. Any failed rule stops the step and nothing is pushed.
    1  The Phase-08 final gate exists (its verdict is reported, not changed here).
    2  Git and the GitHub CLI are present and the CLI is signed in. No token is read,
       printed or stored by this script; the CLI and Git use the user's own sign-in.
    3  A Git identity is already configured. None is invented.
    4  The target repository is PRIVATE. If it does not exist it is created PRIVATE.
       A public repository stops the step; visibility is never changed here.
    5  A non-empty remote is never overwritten: if it has commits, the step stops.
    6  Only files .gitignore allows are committed; the secret scan (patterns, entropy,
       personal paths, forbidden files, full history) must be CLEAN before the push.
    7  No force push, ever.
  The record is written to evidence\p08-native\repository-publish.local.json.

  Encoding: ASCII in every executable line.
#>

[CmdletBinding()]
param(
  [string] $RepositoryRoot = "D:\POLARIS",
  [string] $Owner = "D0shi-Eng",
  [string] $Name = "POLARIS"
)

Set-StrictMode -Version Latest
# native tools write to stderr; exit codes decide, never stderr text
$ErrorActionPreference = "Continue"
Set-Location -LiteralPath $RepositoryRoot

$target = $Owner + "/" + $Name
$raw = Join-Path $RepositoryRoot 'evidence\p08-native'
if (-not (Test-Path -LiteralPath $raw)) { [void] (New-Item -ItemType Directory -Path $raw -Force) }
$record = [ordered] @{
  tool = 'polaris.p08.repository-publish'; target = $target; started = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  gate_verdict = $null; git = $null; gh_signed_in = $false; gh_account = $null; identity_configured = $false
  repository_existed = $null; visibility_before = $null; created_private = $false; remote_empty = $null
  commits = @(); branches = @(); secret_scan = $null; pushed = $false; visibility_after = $null; remote_branches = @()
  outcome = 'NOT_STARTED'; reason = $null
}

function Save-Record {
  $json = ($record | ConvertTo-Json -Depth 10).Replace("`r`n", "`n")
  [System.IO.File]::WriteAllText((Join-Path $raw 'repository-publish.local.json'), ($json + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}

function Stop-Publish {
  param([string] $Outcome, [string] $Reason)
  $record.outcome = $Outcome
  $record.reason = $Reason
  Save-Record
  Write-Host ("REPOSITORY STEP " + $Outcome + ": " + $Reason)
  exit 1
}

function Invoke-Git {
  param([string[]] $Arguments)
  $output = & git @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw ("git " + ($Arguments -join ' ') + " failed: " + (($output | Out-String).Trim())) }
  return $output
}

trap { Stop-Publish 'FAILED' $_.Exception.Message }

# 1 the gate
$gatePath = Join-Path $RepositoryRoot 'evidence\phase-08-final-gate.json'
if (-not (Test-Path -LiteralPath $gatePath)) { Stop-Publish 'BLOCKED' 'the Phase-08 final gate has not been written' }
$record.gate_verdict = (Get-Content -LiteralPath $gatePath -Raw -Encoding UTF8 | ConvertFrom-Json).verdict

# 2 tools and sign-in
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Stop-Publish 'BLOCKED' 'git is not installed' }
$record.git = ((& git --version) | Select-Object -First 1) -as [string]
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Stop-Publish 'BLOCKED' 'the GitHub CLI (gh) is not installed, so the repository visibility cannot be verified' }
$status = (& gh auth status 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { Stop-Publish 'BLOCKED' 'the GitHub CLI is not signed in (run: gh auth login)' }
$record.gh_signed_in = $true
$m = [regex]::Match($status, 'account\s+(\S+)')
if ($m.Success) { $record.gh_account = $m.Groups[1].Value }

# 3 identity
$userName = "$(& git config user.name 2>$null)"
$userEmail = "$(& git config user.email 2>$null)"
if ([string]::IsNullOrWhiteSpace($userName) -or [string]::IsNullOrWhiteSpace($userEmail)) { Stop-Publish 'BLOCKED' 'no Git identity is configured (git config --global user.name / user.email)' }
$record.identity_configured = $true

# 4 the target must be private
$view = & gh repo view $target --json visibility,isEmpty 2>$null
if ($LASTEXITCODE -eq 0 -and $view) {
  $info = $view | ConvertFrom-Json
  $record.repository_existed = $true
  $record.visibility_before = [string] $info.visibility
  if ($info.visibility -ne 'PRIVATE') { Stop-Publish 'STOPPED' ('the repository is ' + $info.visibility + '; this step never publishes to a non-private repository and never changes visibility') }
  $record.remote_empty = [bool] $info.isEmpty
}
else {
  $record.repository_existed = $false
  & gh repo create $target --private --description "POLARIS - local-first governed agentic work environment (private, pre-release)" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Publish 'BLOCKED' 'the private repository could not be created (no access to the owner?)' }
  $record.created_private = $true
  $info = (& gh repo view $target --json visibility,isEmpty) | ConvertFrom-Json
  $record.visibility_before = [string] $info.visibility
  if ($info.visibility -ne 'PRIVATE') { Stop-Publish 'STOPPED' 'the created repository is not private' }
  $record.remote_empty = [bool] $info.isEmpty
}

# 5 never overwrite a non-empty remote
if (-not $record.remote_empty) { Stop-Publish 'STOPPED' 'the remote repository already has commits; it is not overwritten (inspect it and decide how to merge)' }

# 6 local history: logical commits, then the scan
$trailer = "`n`nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`nClaude-Session: https://claude.ai/code/session_01EjeUMYoEKfzP5BaKZx3E6c"
if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot '.git'))) { Invoke-Git @('init', '-b', 'main') | Out-Null }
$existing = & git rev-parse --verify HEAD 2>$null
if ($LASTEXITCODE -eq 0 -and $existing) { Stop-Publish 'STOPPED' 'a local Git history already exists; it is not rewritten by this step' }
$groups = @(
  @{ paths = @('.gitignore', 'LICENSE', 'COPYRIGHT', 'NOTICE', 'TRADEMARK.md', 'THIRD_PARTY_NOTICES.md'); message = 'Licence (AGPL-3.0-or-later), notices, trademark policy and ignore rules' },
  @{ paths = @('contracts', 'runtime', 'tests'); message = 'Contracts (JSON Schemas, IPC registries up to envelope 1.7) and the governed runtime' },
  @{ paths = @('desktop/host'); message = 'Rust host: core services Phase-02..08, Windows ports, binding, maintenance tool and measurement harness' },
  @{ paths = @('desktop/renderer'); message = 'Renderer: Home composer, mission workspace, schedules, artifacts, settings, Arabic and English' },
  @{ paths = @('tools'); message = 'Verification runners and instruments, Phase-00 to Phase-08' },
  @{ paths = @('README.md', 'README.ar.md', 'docs'); message = 'README in English and Arabic, public documentation and architecture decisions' }
)
foreach ($g in $groups) {
  $present = @($g.paths | Where-Object { Test-Path -LiteralPath (Join-Path $RepositoryRoot $_) })
  if ($present.Count -eq 0) { continue }
  Invoke-Git (@('add', '--') + $present) | Out-Null
  & git diff --cached --quiet
  if ($LASTEXITCODE -eq 0) { continue }
  Invoke-Git @('commit', '-q', '-m', ($g.message + $trailer)) | Out-Null
  $record.commits += ((& git rev-parse --short HEAD) + ' ' + $g.message)
}
Invoke-Git @('add', '-A') | Out-Null
& git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  Invoke-Git @('commit', '-q', '-m', ('Remaining project files' + $trailer)) | Out-Null
  $record.commits += ((& git rev-parse --short HEAD) + ' Remaining project files')
}
Invoke-Git @('branch', 'develop') | Out-Null
$record.branches = @('main', 'develop')
& node (Join-Path $RepositoryRoot 'tools\p08-conformance\p08-secrets.mjs') --root $RepositoryRoot --history | ForEach-Object { Write-Host $_ }
$scanCode = $LASTEXITCODE
$record.secret_scan = if ($scanCode -eq 0) { 'CLEAN' } else { 'LEAK_FOUND' }
if ($scanCode -ne 0) { Stop-Publish 'STOPPED' 'the secret scan of the tracked files and history is not clean; nothing was pushed' }

# 7 push without force, then verify
$remote = "https://github.com/" + $target + ".git"
& git remote get-url origin 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Invoke-Git @('remote', 'add', 'origin', $remote) | Out-Null }
elseif ("$(& git remote get-url origin)" -ne $remote) { Stop-Publish 'STOPPED' 'origin points somewhere else' }
Invoke-Git @('push', '-u', 'origin', 'main', 'develop') | Out-Null
$record.pushed = $true
$after = (& gh repo view $target --json visibility,defaultBranchRef) | ConvertFrom-Json
$record.visibility_after = [string] $after.visibility
$record.remote_branches = @((& git ls-remote --heads origin) | ForEach-Object { ($_ -split "`t")[1] })
$record.outcome = if ($record.visibility_after -eq 'PRIVATE') { 'PUSHED_PRIVATE' } else { 'PUSHED_VISIBILITY_UNEXPECTED' }
Save-Record
Write-Host ("REPOSITORY STEP " + $record.outcome + ": " + $target + " branches " + ($record.remote_branches -join ', '))
exit 0
