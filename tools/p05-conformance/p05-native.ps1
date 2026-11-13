# Phase-05 native launch probe.
#
# Reuses the Phase-04 launch probe as it is (Invoke-P04Launch, the child-process
# identity check, the memory sampler): that part was measured and is sound. What
# Phase-05 adds is two TEST FIXTURES the harness owns:
#
#   - a loopback model provider and a loopback web fixture (one node process);
#   - a desktop window (one PowerShell process) that is the only window the
#     computer-use E2E ever touches. It writes its own state, so what happened
#     on the screen is measured independently of what POLARIS reports.
#
# It ends only processes it started, by handle - never by name.
#
# Encoding: ASCII in every executable line. tools\p01-conformance\
# ascii-discipline.mjs enforces the rule for every PowerShell instrument.

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '..\p04-conformance\p04-native.ps1')

function Start-P05Fixture {
  param(
    [Parameter(Mandatory = $true)][string] $NodeCommand,
    [Parameter(Mandatory = $true)][string] $Script,
    [Parameter(Mandatory = $true)][string] $StatePath,
    [Parameter(Mandatory = $true)][string] $LogPath
  )
  foreach ($old in @($StatePath, $LogPath)) {
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
  }
  $arguments = @($Script, '--state', $StatePath, '--log', $LogPath, '--max-seconds', '3000')
  $quoted = @($arguments | ForEach-Object { '"' + $_ + '"' })
  $process = Start-Process -FilePath $NodeCommand -ArgumentList $quoted -PassThru -WindowStyle Hidden
  $state = Wait-P04JsonFile -Path $StatePath -TimeoutSeconds 30 -Process $process
  return [pscustomobject] @{ process = $process; state = $state }
}

function Stop-P05Fixture {
  param([Parameter(Mandatory = $true)] $Fixture, [Parameter(Mandatory = $true)][string] $LogPath)
  if ($null -eq $Fixture.state) {
    try { if (-not $Fixture.process.HasExited) { $Fixture.process.Kill() } } catch { }
    return $null
  }
  return (Stop-P04Fixture -Fixture $Fixture -LogPath $LogPath)
}

function Start-P05DesktopFixture {
  param(
    [Parameter(Mandatory = $true)][string] $Script,
    [Parameter(Mandatory = $true)][string] $StatePath,
    [int] $LifetimeSeconds = 2400
  )
  if (Test-Path -LiteralPath $StatePath) { Remove-Item -LiteralPath $StatePath -Force }
  # The runbook step "minimise every window (Windows+D)" is done here, just before the fixture window
  # opens: a window the user left maximised (measured 2026-09-30: the maximised Claude window) otherwise
  # covers the fixture and the product correctly refuses the click with TARGET_OBSCURED. Nothing is
  # closed; the fixture stays an ordinary, non-topmost window, so a real occlusion is still refused.
  try { (New-Object -ComObject Shell.Application).MinimizeAll(); Start-Sleep -Milliseconds 800 } catch { Write-Host ("desktop could not be cleared: " + $_.Exception.Message) }
  # the window must stay visible to be observed and clicked; only the console is hidden,
  # by PowerShell itself. Start-Process -WindowStyle Hidden would hide the form as well.
  $arguments = @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $Script + '"'),
    '-StatePath', ('"' + $StatePath + '"'), '-LifetimeSeconds', [string] $LifetimeSeconds)
  $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -PassThru
  $deadline = (Get-Date).AddSeconds(45)
  $state = $null
  while ((Get-Date) -lt $deadline) {
    $candidate = Wait-P04JsonFile -Path $StatePath -TimeoutSeconds 2 -Process $process
    if ($null -ne $candidate -and $candidate.ready -eq $true) { $state = $candidate; break }
    $process.Refresh()
    if ($process.HasExited) { break }
  }
  return [pscustomobject] @{ process = $process; state = $state }
}

function Read-P05DesktopState {
  param([Parameter(Mandatory = $true)][string] $StatePath)
  return (Wait-P04JsonFile -Path $StatePath -TimeoutSeconds 5)
}

function Stop-P05DesktopFixture {
  param([Parameter(Mandatory = $true)] $Fixture, [Parameter(Mandatory = $true)][string] $StatePath)
  $closed = $false
  try {
    $Fixture.process.Refresh()
    if (-not $Fixture.process.HasExited) { $closed = $Fixture.process.CloseMainWindow() }
  }
  catch { $closed = $false }
  if ($closed) { [void] $Fixture.process.WaitForExit(15000) }
  $Fixture.process.Refresh()
  if (-not $Fixture.process.HasExited) {
    # only the process this probe started, by its handle
    try { $Fixture.process.Kill() } catch { }
    [void] $Fixture.process.WaitForExit(10000)
  }
  $final = Read-P05DesktopState -StatePath $StatePath
  return [pscustomobject] @{ closed_gracefully = $closed; exited = $Fixture.process.HasExited; state = $final }
}
