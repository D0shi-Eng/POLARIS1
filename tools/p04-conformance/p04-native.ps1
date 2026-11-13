# Phase-04 native launch probe.
#
# Launches the measurement binary with a Phase-04 suite stage, waits for the
# host startup report and the in-window E2E report, samples memory of the host
# process and of its WebView2 children, closes the window politely, and proves
# that no process it started survives. It ends only processes it started, by
# handle or by recorded process id - never by name.
#
# Shape and process handling follow the Phase-03 probe deliberately: that part
# was measured and is sound. What differs is the Phase-04 fixture, which opens
# three loopback ports - a model provider, an MCP tool server, and a server that
# listens and never answers so a timeout can be measured on the real path - and
# the two Phase-04 suite stages.
#
# Encoding: ASCII in every executable line. tools\p01-conformance\
# ascii-discipline.mjs enforces the rule for every PowerShell instrument.

Set-StrictMode -Version Latest

function Wait-P04JsonFile {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [int] $TimeoutSeconds = 60,
    $Process = $null
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
        if (-not [string]::IsNullOrWhiteSpace($raw)) { return ($raw | ConvertFrom-Json) }
      }
      catch { }
    }
    if ($null -ne $Process) {
      $Process.Refresh()
      if ($Process.HasExited) { return $null }
    }
    Start-Sleep -Milliseconds 250
  }
  return $null
}

function Get-P04ChildProcesses {
  param([Parameter(Mandatory = $true)][int] $ParentId)
  $result = New-Object System.Collections.Generic.List[object]
  try {
    $all = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
  }
  catch {
    return ,@()
  }
  $frontier = New-Object System.Collections.Generic.Queue[int]
  $frontier.Enqueue($ParentId)
  $seen = New-Object System.Collections.Generic.HashSet[int]
  while ($frontier.Count -gt 0) {
    $current = $frontier.Dequeue()
    foreach ($entry in $all) {
      if ([int] $entry.ParentProcessId -eq $current -and $seen.Add([int] $entry.ProcessId)) {
        # وقت الإنشاء جزء من الهوية: Windows يعيد استعمال معرّفات العمليات، ورقمٌ
        # وحده لا يميّز ابنًا نجا من عمليةٍ أخرى وُلدت بعده فورثت رقمه.
        [void] $result.Add([pscustomobject] @{ pid = [int] $entry.ProcessId; name = [string] $entry.Name; working_set = [int64] $entry.WorkingSetSize; started_at = $entry.CreationDate })
        $frontier.Enqueue([int] $entry.ProcessId)
      }
    }
  }
  return ,@($result.ToArray())
}

function Measure-P04Memory {
  param([Parameter(Mandatory = $true)] $Process)
  $Process.Refresh()
  if ($Process.HasExited) { return $null }
  $children = Get-P04ChildProcesses -ParentId $Process.Id
  $childBytes = [int64] 0
  foreach ($child in $children) { $childBytes += $child.working_set }
  return [ordered] @{
    host_working_set_bytes      = [int64] $Process.WorkingSet64
    host_peak_working_set_bytes = [int64] $Process.PeakWorkingSet64
    host_private_bytes          = [int64] $Process.PrivateMemorySize64
    child_processes             = $children.Count
    child_working_set_bytes     = $childBytes
    provenance                  = 'LOCALLY_MEASURED'
    method                      = 'System.Diagnostics.Process and Win32_Process working sets at the sample instant'
  }
}

function Invoke-P04Launch {
  param(
    [Parameter(Mandatory = $true)][string] $ExecutablePath,
    [Parameter(Mandatory = $true)][string] $ReportPath,
    [hashtable] $Environment = @{},
    [int] $StartupTimeoutSeconds = 90,
    [int] $SuiteTimeoutSeconds = 900
  )

  $record = [ordered] @{
    executable            = $ExecutablePath
    started               = $false
    window_appeared       = $false
    startup_report        = $null
    e2e_report            = $null
    memory_after_startup  = $null
    memory_after_suite    = $null
    closed_gracefully     = $false
    process_exited        = $false
    exit_code             = $null
    started_children      = @()
    surviving_children    = @()
    child_names           = [ordered] @{}
    reused_process_ids    = @()
    orphan_processes      = 0
    measurements          = [ordered] @{}
    reason_codes          = @()
  }

  if (-not (Test-Path -LiteralPath $ExecutablePath)) {
    $record.reason_codes += 'EXECUTABLE_MISSING'
    return $record
  }

  $e2ePath = [System.IO.Path]::Combine(
    [System.IO.Path]::GetDirectoryName($ReportPath),
    ([System.IO.Path]::GetFileNameWithoutExtension($ReportPath) + '-e2e.json'))
  foreach ($old in @($ReportPath, $e2ePath)) {
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
  }

  $previous = @{}
  foreach ($key in $Environment.Keys) {
    $previous[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
    [System.Environment]::SetEnvironmentVariable($key, [string] $Environment[$key], 'Process')
  }

  try {
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $ExecutablePath -PassThru
    $record.started = $true

    $windowDeadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
    while ((Get-Date) -lt $windowDeadline) {
      $process.Refresh()
      if ($process.HasExited) { break }
      if ($process.MainWindowHandle -ne [System.IntPtr]::Zero) {
        $record.window_appeared = $true
        $record.measurements.window_visible_ms = [int] $clock.Elapsed.TotalMilliseconds
        break
      }
      Start-Sleep -Milliseconds 100
    }

    $startup = Wait-P04JsonFile -Path $ReportPath -TimeoutSeconds $StartupTimeoutSeconds -Process $process
    if ($null -ne $startup) {
      $record.startup_report = $startup
      $record.measurements.cold_start_to_bootstrap_ms = [int] $clock.Elapsed.TotalMilliseconds
      Start-Sleep -Milliseconds 500
      $record.memory_after_startup = Measure-P04Memory -Process $process
    }
    else {
      $record.reason_codes += 'STARTUP_REPORT_ABSENT'
    }

    $identities = @{}
    $children = Get-P04ChildProcesses -ParentId $process.Id
    foreach ($child in $children) { $identities[[int] $child.pid] = $child.started_at; $record.child_names[[string] $child.pid] = $child.name }
    $record.started_children = @($children | ForEach-Object { $_.pid })

    $e2e = Wait-P04JsonFile -Path $e2ePath -TimeoutSeconds $SuiteTimeoutSeconds -Process $process
    if ($null -ne $e2e) {
      $record.e2e_report = $e2e
      $record.measurements.suite_complete_ms = [int] $clock.Elapsed.TotalMilliseconds
      $record.memory_after_suite = Measure-P04Memory -Process $process
    }
    else {
      $record.reason_codes += 'E2E_REPORT_ABSENT'
    }

    # the children known at the end of the run, to prove they end with the host
    $late = Get-P04ChildProcesses -ParentId $process.Id
    $known = New-Object System.Collections.Generic.HashSet[int]
    foreach ($id in $record.started_children) { [void] $known.Add([int] $id) }
    foreach ($child in $late) {
      [void] $known.Add([int] $child.pid)
      $identities[[int] $child.pid] = $child.started_at
      $record.child_names[[string] $child.pid] = $child.name
    }
    $record.started_children = @($known)

    $closed = $false
    try { $closed = $process.CloseMainWindow() } catch { $closed = $false }
    if ($closed) { [void] $process.WaitForExit(20000) }
    $process.Refresh()
    if ($process.HasExited) {
      $record.closed_gracefully = $true
    }
    else {
      $record.reason_codes += 'WINDOW_CLOSE_DID_NOT_EXIT'
      try { $process.Kill() } catch { }
      [void] $process.WaitForExit(10000)
    }
    $process.Refresh()
    $record.process_exited = $process.HasExited
    if ($process.HasExited) {
      try { $record.exit_code = $process.ExitCode } catch { $record.exit_code = $null }
      $record.measurements.exit_ms = [int] $clock.Elapsed.TotalMilliseconds
    }

    # WebView2 ends its helper processes after the host exits, not at the same instant (measured in Phase-08:
    # 5 helpers alive 1.5 s after one exit, none in the next run). A child is an orphan only if it is still
    # alive after a bounded grace of 10 s; the time the last child needed is recorded.
    Start-Sleep -Milliseconds 1500
    $graceClock = [System.Diagnostics.Stopwatch]::StartNew()
    while ($graceClock.Elapsed.TotalMilliseconds -lt 8500) {
      $anyAlive = $false
      foreach ($id in $record.started_children) {
        $probe = $null
        try { $probe = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = " + [int] $id) -ErrorAction Stop } catch { $probe = $null }
        if ($null -ne $probe -and ($null -eq $identities[[int] $id] -or $probe.CreationDate -eq $identities[[int] $id])) { $anyAlive = $true; break }
      }
      if (-not $anyAlive) { break }
      Start-Sleep -Milliseconds 250
    }
    $record.measurements.children_exit_after_host_ms = 1500 + [int] $graceClock.Elapsed.TotalMilliseconds
    $survivors = New-Object System.Collections.Generic.List[int]
    $reused = New-Object System.Collections.Generic.List[int]
    foreach ($id in $record.started_children) {
      $live = $null
      try { $live = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = " + [int] $id) -ErrorAction Stop } catch { $live = $null }
      if ($null -eq $live) { continue }
      # الهوية لا الرقم: عملية حيّة بالرقم نفسه ووقت إنشاء مختلف ليست ابننا،
      # بل عملية أخرى ورثت الرقم بعد موته. عدّها ناجيًا إنذارٌ كاذب.
      $expected = $identities[[int] $id]
      if ($null -ne $expected -and $live.CreationDate -ne $expected) { [void] $reused.Add([int] $id); continue }
      [void] $survivors.Add([int] $id)
    }
    $record.reused_process_ids = @($reused.ToArray())
    $selfAlive = Get-Process -Id $process.Id -ErrorAction SilentlyContinue
    if ($null -ne $selfAlive) { [void] $survivors.Add([int] $process.Id) }
    $record.surviving_children = @($survivors.ToArray())
    $record.orphan_processes = $survivors.Count
    if ($survivors.Count -gt 0) { $record.reason_codes += 'ORPHAN_PROCESS_SURVIVED' }
  }
  finally {
    foreach ($key in $Environment.Keys) {
      [System.Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process')
    }
  }
  return $record
}

function Start-P04Fixture {
  param(
    [Parameter(Mandatory = $true)][string] $NodeCommand,
    [Parameter(Mandatory = $true)][string] $Script,
    [Parameter(Mandatory = $true)][string] $StatePath,
    [Parameter(Mandatory = $true)][string] $LogPath
  )
  foreach ($old in @($StatePath, $LogPath)) {
    if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Force }
  }
  $arguments = @($Script, '--state', $StatePath, '--log', $LogPath, '--max-seconds', '2400')
  $quoted = @($arguments | ForEach-Object { '"' + $_ + '"' })
  $process = Start-Process -FilePath $NodeCommand -ArgumentList $quoted -PassThru -WindowStyle Hidden
  $state = Wait-P04JsonFile -Path $StatePath -TimeoutSeconds 30 -Process $process
  return [pscustomobject] @{ process = $process; state = $state }
}

function Stop-P04Fixture {
  param([Parameter(Mandatory = $true)] $Fixture, [Parameter(Mandatory = $true)][string] $LogPath)
  if ($null -eq $Fixture.state) { return $null }
  $port = [int] $Fixture.state.port
  try {
    # a direct loopback request: no system proxy may sit between the probe and its own fixture
    $request = [System.Net.WebRequest]::Create("http://127.0.0.1:" + $port + "/__fixture/stop")
    $request.Proxy = $null
    $request.Timeout = 10000
    $response = $request.GetResponse()
    $response.Close()
  }
  catch { }
  [void] $Fixture.process.WaitForExit(15000)
  $Fixture.process.Refresh()
  if (-not $Fixture.process.HasExited) {
    # only the process this probe started, by its handle
    try { $Fixture.process.Kill() } catch { }
  }
  return (Wait-P04JsonFile -Path $LogPath -TimeoutSeconds 10)
}
