# POLARIS remediation 2026-10-12 - real-model acceptance of the 300 agents (section 6 of the brief).
#
# Runs desktop/host/core/tests/agents300_real.rs (ignored by default) against the provider and model the OWNER names.
# It calls a real model 900 times or more; run it only with the owner's explicit permission for that model and budget.
# Results are appended to evidence\remediation-2026-10-12\agents\real-<model>.jsonl; already recorded cases are skipped,
# so the run can be stopped and resumed. The API key, if any, is read from the environment variable POLARIS_EVAL_API_KEY
# set by the owner in this window; it is never written to disk by this script.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $Provider,
  [Parameter(Mandatory = $true)] [string] $Model,
  [string] $Endpoint = '',
  [string] $Range = '0-300',
  [int] $MaxCases = 900,
  # Product revision tag (e.g. x16): results of a tree after a fix go to their own file and never mix with earlier ones.
  [string] $Tag = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..\..\..')).Path
$safe = ($Model -replace '[^A-Za-z0-9._-]', '_')
if ($Tag -ne '') { $safe = $safe + '-' + ($Tag -replace '[^A-Za-z0-9._-]', '_') }
$out = Join-Path $root ("evidence\remediation-2026-10-12\agents\real-" + $safe + ".jsonl")
$env:POLARIS_EVAL_TAG = $Tag
$env:POLARIS_EVAL_PROVIDER = $Provider
$env:POLARIS_EVAL_MODEL = $Model
$env:POLARIS_EVAL_OUT = $out
$env:POLARIS_AGENTS_RANGE = $Range
$env:POLARIS_EVAL_MAX_CASES = [string] $MaxCases
if ($Endpoint -ne '') { $env:POLARIS_EVAL_ENDPOINT = $Endpoint }
$env:CARGO_BUILD_JOBS = '2'
Push-Location (Join-Path $root 'desktop\host')
try {
  & cargo test -p polaris-host-core --test agents300_real -- --ignored --test-threads=1
  Write-Host ("exit {0}; results: {1}" -f $LASTEXITCODE, $out)
} finally { Pop-Location }
