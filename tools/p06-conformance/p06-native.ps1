# Phase-06 native launch probe.
#
# Reuses the Phase-04 launch probe as it is (Invoke-P04Launch, the child-process
# identity check, the memory sampler): that part was measured and is sound. What
# Phase-06 adds is one TEST FIXTURE process the harness owns: a loopback model
# provider and a loopback REST connector service. The connector checks the bearer
# credential against a per-run canary it reads from its own environment, and logs
# only whether it matched.
#
# The canary never enters a log, a report or an evidence file written by this
# probe. After both launches the probe scans every file in the product data
# directory for the canary bytes and records counts only.
#
# It ends only processes it started, by handle - never by name.
#
# Encoding: ASCII in every executable line. tools\p01-conformance\
# ascii-discipline.mjs enforces the rule for every PowerShell instrument.

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '..\p04-conformance\p04-native.ps1')

function New-P06Canary {
  $bytes = New-Object byte[] 16
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return ('p06-canary-' + (($bytes | ForEach-Object { $_.ToString('x2') }) -join ''))
}

function Get-P06Sha256Hex {
  param([Parameter(Mandatory = $true)][string] $Text)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text))
    return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
  }
  finally { $sha.Dispose() }
}

function Start-P06Fixture {
  param(
    [Parameter(Mandatory = $true)][string] $NodeCommand,
    [Parameter(Mandatory = $true)][string] $Script,
    [Parameter(Mandatory = $true)][string] $StatePath,
    [Parameter(Mandatory = $true)][string] $LogPath,
    [Parameter(Mandatory = $true)][string] $Canary
  )
  foreach ($old in @($StatePath, $LogPath)) {
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
  }
  $arguments = @($Script, '--state', $StatePath, '--log', $LogPath, '--max-seconds', '3600')
  $quoted = @($arguments | ForEach-Object { '"' + $_ + '"' })
  # the fixture reads the expected credential from its environment; the variable is
  # set only for the moment the child inherits it, then removed from this process
  [System.Environment]::SetEnvironmentVariable('P06_FIXTURE_TOKEN', $Canary, 'Process')
  try {
    $process = Start-Process -FilePath $NodeCommand -ArgumentList $quoted -PassThru -WindowStyle Hidden
  }
  finally {
    [System.Environment]::SetEnvironmentVariable('P06_FIXTURE_TOKEN', $null, 'Process')
  }
  $state = Wait-P04JsonFile -Path $StatePath -TimeoutSeconds 30 -Process $process
  return [pscustomobject] @{ process = $process; state = $state }
}

function Stop-P06Fixture {
  param([Parameter(Mandatory = $true)] $Fixture, [Parameter(Mandatory = $true)][string] $LogPath)
  if ($null -eq $Fixture.state) {
    try { if (-not $Fixture.process.HasExited) { $Fixture.process.Kill() } } catch { }
    return $null
  }
  return (Stop-P04Fixture -Fixture $Fixture -LogPath $LogPath)
}

# Counts the files under a directory that contain the canary bytes, as UTF-8 and as
# UTF-16LE. Returns counts and relative names; never the canary and never content.
function Find-P06CanaryInFiles {
  param([Parameter(Mandatory = $true)][string] $Directory, [Parameter(Mandatory = $true)][string] $Canary)
  $result = [ordered] @{ directory_scanned = $false; files = 0; bytes = 0; files_with_canary = 0; names_with_canary = @(); unreadable = 0 }
  if (-not (Test-Path -LiteralPath $Directory)) { return $result }
  $result.directory_scanned = $true
  $needles = @([System.Text.Encoding]::UTF8.GetBytes($Canary), [System.Text.Encoding]::Unicode.GetBytes($Canary))
  foreach ($file in @(Get-ChildItem -LiteralPath $Directory -Recurse -File -Force -ErrorAction SilentlyContinue)) {
    $result.files += 1
    $bytes = $null
    try {
      $stream = New-Object System.IO.FileStream($file.FullName, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
      try {
        $bytes = New-Object byte[] $stream.Length
        [void] $stream.Read($bytes, 0, $bytes.Length)
      }
      finally { $stream.Dispose() }
    }
    catch { $result.unreadable += 1; continue }
    $result.bytes += $bytes.Length
    $text = [System.Text.Encoding]::GetEncoding(28591).GetString($bytes)
    $found = $false
    foreach ($needle in $needles) {
      $pattern = [System.Text.Encoding]::GetEncoding(28591).GetString($needle)
      if ($text.Contains($pattern)) { $found = $true; break }
    }
    if ($found) {
      $result.files_with_canary += 1
      $result.names_with_canary += $file.FullName.Substring($Directory.Length).TrimStart('\')
    }
  }
  return $result
}
