# Phase-07 release E2E on Windows: install, launch, upgrade, recover, restore,
# verify an update, check a policy, uninstall - with the real installer and the
# real installed product, in owned paths only.
#
# SAFETY
# ------
# Nothing here touches the user's own POLARIS data or installation:
#   - the product is installed to an owned folder under %LOCALAPPDATA%\POLARIS-P07-TEST
#     and launched with POLARIS_DATA_DIR pointing at an owned data folder;
#   - if a POLARIS installation is already registered for this user, the installer
#     steps are BLOCKED and skipped, because the test would replace it;
#   - the user's real data folder (%LOCALAPPDATA%\sa.polaris.desktop) is listed and
#     hashed before and after, and must be unchanged;
#   - every process started here is ended by handle, never by name.
#
# Encoding: ASCII in every executable line. tools\p01-conformance\
# ascii-discipline.mjs enforces the rule for every PowerShell instrument.

Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot '..\p04-conformance\p04-native.ps1')

$script:UninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\POLARIS'
$script:RealDataDir = Join-Path $env:LOCALAPPDATA 'sa.polaris.desktop'
$script:StartMenuLink = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\POLARIS.lnk'

function Get-P07FileSha256 {
  param([Parameter(Mandatory = $true)][string] $Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try { $hash = $sha.ComputeHash($stream) } finally { $stream.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-P07TreeSnapshot {
  param([Parameter(Mandatory = $true)][string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return [ordered] @{ exists = $false; files = 0; digest = '' } }
  $lines = New-Object System.Collections.Generic.List[string]
  $files = @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue | Sort-Object FullName)
  foreach ($file in $files) {
    $digest = ''
    try { $digest = Get-P07FileSha256 -Path $file.FullName } catch { $digest = 'UNREADABLE' }
    [void] $lines.Add($file.FullName.Substring($Path.Length) + '|' + $file.Length + '|' + $digest)
  }
  $text = [string]::Join("`n", $lines.ToArray())
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $digestAll = (($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '')
  return [ordered] @{ exists = $true; files = $files.Count; digest = $digestAll }
}

function Get-P07InstallState {
  $key = $null
  if (Test-Path -LiteralPath $script:UninstallKey) { $key = Get-ItemProperty -LiteralPath $script:UninstallKey -ErrorAction SilentlyContinue }
  $version = $null
  $location = $null
  if ($null -ne $key) {
    if ($null -ne $key.PSObject.Properties['DisplayVersion']) { $version = [string] $key.DisplayVersion }
    if ($null -ne $key.PSObject.Properties['InstallLocation']) { $location = [string] $key.InstallLocation }
  }
  return [ordered] @{
    uninstall_key       = ($null -ne $key)
    display_version     = $version
    install_location    = $location
    start_menu_shortcut = (Test-Path -LiteralPath $script:StartMenuLink)
  }
}

function Invoke-P07Process {
  param(
    [Parameter(Mandatory = $true)][string] $FilePath,
    [string[]] $Arguments = @(),
    [int] $TimeoutSeconds = 300
  )
  $quoted = @($Arguments | ForEach-Object {
      if ($_ -match '^/D=') { $_ } elseif ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    })
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = $FilePath
  $info.Arguments = [string]::Join(' ', $quoted)
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $info.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $process = [System.Diagnostics.Process]::Start($info)
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $finished = $process.WaitForExit($TimeoutSeconds * 1000)
  if (-not $finished) {
    try { $process.Kill() } catch { }
    [void] $process.WaitForExit(10000)
  }
  $stdout = $stdoutTask.Result
  $stderr = $stderrTask.Result
  $document = $null
  try { if (-not [string]::IsNullOrWhiteSpace($stdout)) { $document = $stdout | ConvertFrom-Json } } catch { $document = $null }
  return [pscustomobject] @{
    exit_code   = $(if ($finished) { $process.ExitCode } else { -1 })
    timed_out   = (-not $finished)
    duration_ms = [int] $clock.Elapsed.TotalMilliseconds
    document    = $document
    stderr_tail = $(if ($stderr.Length -gt 400) { $stderr.Substring($stderr.Length - 400) } else { $stderr })
  }
}

function Invoke-P07Maint {
  param([Parameter(Mandatory = $true)][string] $Maint, [string[]] $Arguments)
  $result = Invoke-P07Process -FilePath $Maint -Arguments $Arguments -TimeoutSeconds 120
  $ok = $false
  $code = ''
  if ($null -ne $result.document) {
    $ok = [bool] $result.document.ok
    if ($null -ne $result.document.PSObject.Properties['code']) { $code = [string] $result.document.code }
  }
  return [pscustomobject] @{ command = $Arguments[0]; exit_code = $result.exit_code; ok = $ok; code = $code; duration_ms = $result.duration_ms; document = $result.document }
}

# Launches the installed product binary (no measurement feature: there is no
# in-window suite), waits for the window and the host startup report, samples
# memory, closes the window politely and proves no started process survives.
function Invoke-P07ProductLaunch {
  param(
    [Parameter(Mandatory = $true)][string] $ExecutablePath,
    [Parameter(Mandatory = $true)][string] $DataDir,
    [Parameter(Mandatory = $true)][string] $ReportPath,
    [int] $TimeoutSeconds = 120
  )
  $record = [ordered] @{
    executable = $ExecutablePath; started = $false; window_appeared = $false; bootstrap_reached = $false
    closed_gracefully = $false; exit_code = $null; webview_profile_owned = $false; surviving_processes = 0; reused_process_ids = @()
    measurements = [ordered] @{}; memory = $null; reason_codes = @()
  }
  if (Test-Path -LiteralPath $ReportPath) { Remove-Item -LiteralPath $ReportPath -Force }
  $saved = @{}
  # POLARIS_DATA_DIR moves the store but not the WebView2 profile, which Tauri keeps
  # under %LOCALAPPDATA%\sa.polaris.desktop\EBWebView. WEBVIEW2_USER_DATA_FOLDER is the
  # WebView2 override that takes precedence over the folder the host passes, so the
  # test browser profile stays in the owned tree and the user's profile is not touched.
  $webview = Join-Path (Split-Path -Parent $DataDir) 'webview'
  $environment = @{ POLARIS_DATA_DIR = $DataDir; POLARIS_STARTUP_REPORT = $ReportPath; WEBVIEW2_USER_DATA_FOLDER = $webview }
  foreach ($key in $environment.Keys) {
    $saved[$key] = [System.Environment]::GetEnvironmentVariable($key, 'Process')
    [System.Environment]::SetEnvironmentVariable($key, [string] $environment[$key], 'Process')
  }
  try {
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $ExecutablePath -PassThru
    $record.started = $true
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
      $process.Refresh()
      if ($process.HasExited) { break }
      if ($process.MainWindowHandle -ne [System.IntPtr]::Zero) {
        $record.window_appeared = $true
        $record.measurements.window_visible_ms = [int] $clock.Elapsed.TotalMilliseconds
        break
      }
      Start-Sleep -Milliseconds 100
    }
    $startup = Wait-P04JsonFile -Path $ReportPath -TimeoutSeconds $TimeoutSeconds -Process $process
    if ($null -ne $startup -and $null -ne $startup.bootstrap_request_ms) {
      $record.bootstrap_reached = $true
      $record.measurements.cold_start_to_bootstrap_ms = [int] $clock.Elapsed.TotalMilliseconds
      $record.measurements.renderer_origin = [string] $startup.renderer_origin
      Start-Sleep -Milliseconds 2000
      $record.memory = Measure-P04Memory -Process $process
    }
    else { $record.reason_codes += 'BOOTSTRAP_NOT_REACHED' }
    $identities = @{}
    $children = Get-P04ChildProcesses -ParentId $process.Id
    foreach ($child in $children) { $identities[[int] $child.pid] = $child.started_at }
    $closed = $false
    try { $closed = $process.CloseMainWindow() } catch { $closed = $false }
    if ($closed) { [void] $process.WaitForExit(20000) }
    $process.Refresh()
    if ($process.HasExited) { $record.closed_gracefully = $true }
    else {
      $record.reason_codes += 'WINDOW_CLOSE_DID_NOT_EXIT'
      try { $process.Kill() } catch { }
      [void] $process.WaitForExit(10000)
    }
    $process.Refresh()
    if ($process.HasExited) { try { $record.exit_code = $process.ExitCode } catch { $record.exit_code = $null } }
    $record.webview_profile_owned = ((Test-Path -LiteralPath $webview) -and @(Get-ChildItem -LiteralPath $webview -Recurse -File -ErrorAction SilentlyContinue).Count -gt 0)
    Start-Sleep -Milliseconds 1500
    $survivors = 0
    $reused = New-Object System.Collections.Generic.List[int]
    foreach ($id in $identities.Keys) {
      $live = $null
      try { $live = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = " + [int] $id) -ErrorAction Stop } catch { $live = $null }
      if ($null -eq $live) { continue }
      if ($live.CreationDate -ne $identities[$id]) { [void] $reused.Add([int] $id); continue }
      $survivors += 1
      try { Stop-Process -Id ([int] $id) -Force -ErrorAction Stop } catch { }
    }
    if ($null -ne (Get-Process -Id $process.Id -ErrorAction SilentlyContinue)) { $survivors += 1 }
    $record.surviving_processes = $survivors
    $record.reused_process_ids = @($reused.ToArray())
    if ($survivors -gt 0) { $record.reason_codes += 'ORPHAN_PROCESS_SURVIVED' }
  }
  finally {
    foreach ($key in $environment.Keys) { [System.Environment]::SetEnvironmentVariable($key, $saved[$key], 'Process') }
  }
  return $record
}

function Set-P07CorruptPages {
  param([Parameter(Mandatory = $true)][string] $Path)
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  for ($i = 4096; $i -lt $bytes.Length; $i++) { $bytes[$i] = 0xA5 }
  [System.IO.File]::WriteAllBytes($Path, $bytes)
  return $bytes.Length
}

function Get-P07AclFacts {
  param([Parameter(Mandatory = $true)][string] $Path)
  $broad = @('S-1-1-0', 'S-1-5-32-545', 'S-1-5-11')
  $rights = [System.Security.AccessControl.FileSystemRights]
  $writeMask = [int] ($rights::Write -bor $rights::Modify -bor $rights::FullControl -bor $rights::CreateFiles -bor $rights::AppendData)
  $acl = Get-Acl -LiteralPath $Path
  $rules = @()
  $broadWrite = @()
  foreach ($rule in $acl.Access) {
    $sid = ''
    try { $sid = $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $sid = [string] $rule.IdentityReference }
    $writes = (([int] $rule.FileSystemRights) -band $writeMask) -ne 0
    $rules += [ordered] @{ sid = $sid; type = [string] $rule.AccessControlType; writes = $writes; inherited = $rule.IsInherited }
    if ($rule.AccessControlType -eq 'Allow' -and $writes -and ($broad -contains $sid)) { $broadWrite += $sid }
  }
  $owner = ''
  try { $owner = (New-Object System.Security.Principal.NTAccount($acl.Owner)).Translate([System.Security.Principal.SecurityIdentifier]).Value } catch { $owner = [string] $acl.Owner }
  return [ordered] @{ path_kind = 'owned data folder under %LOCALAPPDATA%'; owner_sid = $owner; rules = $rules; broad_write = $broadWrite }
}

# Where the installer actually put the program: the registered location when the
# installer recorded one, otherwise the folder that was requested with /D.
function Resolve-P07InstallDir {
  param([Parameter(Mandatory = $true)][string] $Requested)
  $state = Get-P07InstallState
  if (-not [string]::IsNullOrWhiteSpace($state.install_location)) { return $state.install_location.Trim('"').TrimEnd('\') }
  return $Requested
}

function Find-P07InstalledExe {
  param([Parameter(Mandatory = $true)][string] $AppDir)
  $candidates = @(Get-ChildItem -LiteralPath $AppDir -Filter '*.exe' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^(uninstall|polaris-maint)\.exe$' })
  if ($candidates.Count -eq 0) { return $null }
  return $candidates[0].FullName
}

function Get-P07FolderBytes {
  param([Parameter(Mandatory = $true)][string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return 0 }
  $sum = [int64] 0
  foreach ($file in @(Get-ChildItem -LiteralPath $Path -Recurse -File -Force -ErrorAction SilentlyContinue)) { $sum += $file.Length }
  return $sum
}

# The whole release E2E. Returns one record; the runner writes it raw and the
# derivation judges it.
function Invoke-P07ReleaseE2E {
  param(
    [Parameter(Mandatory = $true)][string] $RepositoryRoot,
    [Parameter(Mandatory = $true)][string] $NodeCommand,
    [Parameter(Mandatory = $true)][string] $FixtureInstaller,
    [Parameter(Mandatory = $true)][string] $ReleaseInstaller,
    [Parameter(Mandatory = $true)][string] $RawDirectory
  )
  $runId = [guid]::NewGuid().ToString('N').Substring(0, 12)
  $ownedRoot = Join-Path $env:LOCALAPPDATA ('POLARIS-P07-TEST\' + $runId)
  $appDir = Join-Path $ownedRoot 'app'
  $dataDir = Join-Path $ownedRoot 'data'
  $reportDir = Join-Path $RawDirectory 'release-e2e'
  if (-not (Test-Path -LiteralPath $reportDir)) { [void] (New-Item -ItemType Directory -Path $reportDir) }
  $tools = Join-Path $RepositoryRoot 'tools\p07-conformance'

  $record = [ordered] @{
    owned_root = $ownedRoot; steps = [ordered] @{}; launches = @(); maint = @(); reason_codes = @()
    before = [ordered] @{}; after = [ordered] @{}; sizes = [ordered] @{}; acl = $null; blocked = $null
  }
  $record.before.real_data = Get-P07TreeSnapshot -Path $script:RealDataDir
  $record.before.install = Get-P07InstallState
  if ($record.before.install.uninstall_key) {
    $record.blocked = 'A POLARIS installation is already registered for this user; the installer test would replace it.'
    $record.reason_codes += 'EXISTING_INSTALLATION_PRESENT'
    return $record
  }
  foreach ($installer in @($FixtureInstaller, $ReleaseInstaller)) {
    if (-not (Test-Path -LiteralPath $installer)) { $record.reason_codes += ('INSTALLER_MISSING:' + [System.IO.Path]::GetFileName($installer)); return $record }
  }
  [void] (New-Item -ItemType Directory -Path $dataDir -Force)

  try {
    # 1 install the previous-version fixture (per user, silent, owned folder)
    $install = Invoke-P07Process -FilePath $FixtureInstaller -Arguments @('/S', ('/D=' + $appDir)) -TimeoutSeconds 300
    $state = Get-P07InstallState
    $record.installed_by_test = $state.uninstall_key
    $installDir = Resolve-P07InstallDir -Requested $appDir
    $exe = Find-P07InstalledExe -AppDir $installDir
    $maint = Join-Path $installDir 'polaris-maint.exe'
    $record.steps.install_fixture = [ordered] @{
      exit_code = $install.exit_code; duration_ms = $install.duration_ms; registered_version = $state.display_version
      requested_dir_honoured = ([System.IO.Path]::GetFullPath($installDir).TrimEnd('\') -eq [System.IO.Path]::GetFullPath($appDir).TrimEnd('\'))
      executable = $(if ($null -eq $exe) { $null } else { [System.IO.Path]::GetFileName($exe) }); maint_present = (Test-Path -LiteralPath $maint)
      start_menu_shortcut = $state.start_menu_shortcut
    }
    if ($null -eq $exe -or -not (Test-Path -LiteralPath $maint)) { $record.reason_codes += 'FIXTURE_INSTALL_INCOMPLETE'; return $record }
    $record.sizes.installed_fixture_bytes = Get-P07FolderBytes -Path $installDir

    # 2 a real schema-v1 store, built from the product's own migration scripts
    $legacyOutput = & $NodeCommand (Join-Path $tools 'p07-legacy-db.mjs') --root $RepositoryRoot --out (Join-Path $dataDir 'polaris.db') --version 1 2>$null
    $legacy = $null
    try { $legacy = (@($legacyOutput) | Where-Object { $_ -like '{*' } | Select-Object -Last 1) | ConvertFrom-Json } catch { $legacy = $null }
    $record.steps.legacy_store = [ordered] @{ created = ($null -ne $legacy); schema_version = $(if ($null -eq $legacy) { $null } else { $legacy.schema_version }) }

    # 3 the installed previous version opens (and migrates) the v1 store
    $launch = Invoke-P07ProductLaunch -ExecutablePath $exe -DataDir $dataDir -ReportPath (Join-Path $reportDir 'fixture-startup.json')
    $launch.stage = 'fixture-on-legacy-store'
    $record.launches += $launch
    $verify = Invoke-P07Maint -Maint $maint -Arguments @('verify', '--data-dir', $dataDir, '--full')
    $record.maint += $verify
    $backup = Invoke-P07Maint -Maint $maint -Arguments @('backup', '--data-dir', $dataDir)
    $record.maint += $backup
    $projects = $null
    if ($backup.ok) { $projects = $backup.document.result.manifest.tables.projects }
    $record.steps.legacy_upgrade = [ordered] @{
      schema_after = $(if ($verify.ok) { $verify.document.result.schema.version } else { $null })
      matches_reference = $(if ($verify.ok) { [bool] $verify.document.result.schema.matches_reference } else { $false })
      pre_migration_copy = (Test-Path -LiteralPath (Join-Path $dataDir 'polaris.db.backup-v1'))
      projects_after = $projects
    }

    # 4 upgrade in place to the release installer
    $upgrade = Invoke-P07Process -FilePath $ReleaseInstaller -Arguments @('/S', ('/D=' + $installDir)) -TimeoutSeconds 300
    $state = Get-P07InstallState
    $installDir = Resolve-P07InstallDir -Requested $installDir
    $maint = Join-Path $installDir 'polaris-maint.exe'
    $exe = Find-P07InstalledExe -AppDir $installDir
    $fileVersion = $null
    if ($null -ne $exe) { $fileVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exe).ProductVersion }
    $record.steps.upgrade = [ordered] @{ exit_code = $upgrade.exit_code; duration_ms = $upgrade.duration_ms; registered_version = $state.display_version; product_version = $fileVersion }
    $record.sizes.installed_release_bytes = Get-P07FolderBytes -Path $installDir
    $launch = Invoke-P07ProductLaunch -ExecutablePath $exe -DataDir $dataDir -ReportPath (Join-Path $reportDir 'release-startup.json')
    $launch.stage = 'release-after-upgrade'
    $record.launches += $launch
    $after = Invoke-P07Maint -Maint $maint -Arguments @('backup', '--data-dir', $dataDir)
    $record.maint += $after
    $record.steps.upgrade.projects_after = $(if ($after.ok) { $after.document.result.manifest.tables.projects } else { $null })

    # 5 a damaged store is restored from the latest verified backup at launch
    $store = Join-Path $dataDir 'polaris.db'
    $corruptBytes = Set-P07CorruptPages -Path $store
    $damaged = Invoke-P07Maint -Maint $maint -Arguments @('verify', '--data-dir', $dataDir)
    $record.maint += $damaged
    $launch = Invoke-P07ProductLaunch -ExecutablePath $exe -DataDir $dataDir -ReportPath (Join-Path $reportDir 'recovery-startup.json')
    $launch.stage = 'release-on-damaged-store'
    $record.launches += $launch
    $recoveryPath = Join-Path $dataDir 'recovery\last-recovery.json'
    $recovery = $null
    if (Test-Path -LiteralPath $recoveryPath) { $recovery = Get-Content -LiteralPath $recoveryPath -Raw -Encoding UTF8 | ConvertFrom-Json }
    $healed = Invoke-P07Maint -Maint $maint -Arguments @('verify', '--data-dir', $dataDir, '--full')
    $record.maint += $healed
    $record.steps.recovery = [ordered] @{
      corrupted_bytes = $corruptBytes
      state_before = $(if ($damaged.ok) { $damaged.document.result.integrity.state } else { $null })
      action = $(if ($null -eq $recovery) { $null } else { [string] $recovery.action })
      restored_backup = $(if ($null -eq $recovery) { $null } else { [string] $recovery.restored_backup })
      state_after = $(if ($healed.ok) { $healed.document.result.integrity.state } else { $null })
      quarantine_kept = (Test-Path -LiteralPath (Join-Path $dataDir 'quarantine'))
    }

    # 6 restore from a backup with the maintenance tool while the product is closed
    $list = Invoke-P07Maint -Maint $maint -Arguments @('list-backups', '--data-dir', $dataDir)
    $record.maint += $list
    $target = $null
    if ($list.ok -and @($list.document.result.backups).Count -gt 0) { $target = [string] @($list.document.result.backups)[0].backup_id }
    $restored = $null
    if ($null -ne $target) {
      $restored = Invoke-P07Maint -Maint $maint -Arguments @('restore', '--data-dir', $dataDir, '--backup', $target)
      $record.maint += $restored
    }
    $final = Invoke-P07Maint -Maint $maint -Arguments @('verify', '--data-dir', $dataDir, '--full')
    $record.maint += $final
    $record.steps.restore = [ordered] @{
      backup = $target; ok = ($null -ne $restored -and $restored.ok)
      pre_restore_backup = $(if ($null -ne $restored -and $restored.ok) { [string] $restored.document.result.pre_restore_backup } else { $null })
      state_after = $(if ($final.ok) { $final.document.result.integrity.state } else { $null })
    }

    # 7 the update verifier: Node signs with a per-run TEST key, the installed tool verifies
    $updateDir = Join-Path $reportDir 'update'
    $fixtureOutput = & $NodeCommand (Join-Path $tools 'p07-update-fixture.mjs') --artifact $ReleaseInstaller --out $updateDir 2>$null
    $key = $null
    try { $key = (@($fixtureOutput) | Where-Object { $_ -like '{*' } | Select-Object -Last 1) | ConvertFrom-Json } catch { $key = $null }
    $signed = Join-Path $updateDir 'signed-update.json'
    $valid = $null; $untrusted = $null; $tampered = $null
    if ($null -ne $key) {
      $valid = Invoke-P07Maint -Maint $maint -Arguments @('update-verify', '--signed', $signed, '--artifact', $ReleaseInstaller, '--trusted-key-id', $key.key_id, '--trusted-key-hex', $key.public_key_hex)
      $untrusted = Invoke-P07Maint -Maint $maint -Arguments @('update-verify', '--signed', $signed)
      $tamperDir = Join-Path $updateDir 'tampered'
      [void] (New-Item -ItemType Directory -Path $tamperDir -Force)
      $copy = Join-Path $tamperDir ([System.IO.Path]::GetFileName($ReleaseInstaller))
      Copy-Item -LiteralPath $ReleaseInstaller -Destination $copy -Force
      $stream = [System.IO.File]::Open($copy, 'Append')
      try { $stream.WriteByte(0x00) } finally { $stream.Dispose() }
      $tampered = Invoke-P07Maint -Maint $maint -Arguments @('update-verify', '--signed', $signed, '--artifact', $copy, '--trusted-key-id', $key.key_id, '--trusted-key-hex', $key.public_key_hex)
      Remove-Item -LiteralPath $tamperDir -Recurse -Force
    }
    $record.steps.update = [ordered] @{
      fixture_signed = ($null -ne $key)
      valid_ok = ($null -ne $valid -and $valid.ok)
      product_keys_code = $(if ($null -ne $untrusted) { $untrusted.code } else { $null })
      tampered_code = $(if ($null -ne $tampered) { $tampered.code } else { $null })
    }

    # 8 managed policy check with the installed tool
    $policyDir = Join-Path $ownedRoot 'policy'
    [void] (New-Item -ItemType Directory -Path $policyDir -Force)
    $good = Join-Path $policyDir 'good.json'
    $bad = Join-Path $policyDir 'widening.json'
    [System.IO.File]::WriteAllText($good, '{"format":"polaris.managed-policy/1","policy_id":"p07-sample","settings":{"privacy.allow_connector_egress":false,"connectors.max_external_calls_per_mission":3}}', (New-Object System.Text.UTF8Encoding($false)))
    [System.IO.File]::WriteAllText($bad, '{"format":"polaris.managed-policy/1","policy_id":"p07-widen","settings":{"browser.private_network_allowed":true}}', (New-Object System.Text.UTF8Encoding($false)))
    $goodCheck = Invoke-P07Maint -Maint $maint -Arguments @('policy-check', '--file', $good)
    $badCheck = Invoke-P07Maint -Maint $maint -Arguments @('policy-check', '--file', $bad)
    $record.steps.policy = [ordered] @{
      valid_state = $(if ($goodCheck.ok) { [string] $goodCheck.document.result.state } else { $goodCheck.code })
      widening_code = $badCheck.code
    }

    # 9 the data folder is private to the user
    $record.acl = Get-P07AclFacts -Path $dataDir

    # 10 uninstall silently, in place, and check what it removed and what it kept
    $uninstaller = Join-Path $installDir 'uninstall.exe'
    $uninstall = $null
    if (Test-Path -LiteralPath $uninstaller) {
      $uninstall = Invoke-P07Process -FilePath $uninstaller -Arguments @('/S', ('_?=' + $installDir)) -TimeoutSeconds 300
    }
    $state = Get-P07InstallState
    $record.steps.uninstall = [ordered] @{
      exit_code = $(if ($null -eq $uninstall) { $null } else { $uninstall.exit_code })
      uninstall_key_removed = (-not $state.uninstall_key)
      product_removed = ($null -eq (Find-P07InstalledExe -AppDir $installDir))
      maint_removed = (-not (Test-Path -LiteralPath $maint))
      start_menu_shortcut_removed = (-not $state.start_menu_shortcut)
      data_preserved = (Test-Path -LiteralPath (Join-Path $dataDir 'polaris.db'))
    }
  }
  catch {
    $record.reason_codes += ('RELEASE_E2E_ERROR:' + $_.Exception.Message)
  }
  finally {
    # An installation this test registered and did not remove is removed here, so a
    # failure half way never leaves a POLARIS installation in the user's profile.
    $leftover = Get-P07InstallState
    if ($record.Contains('installed_by_test') -and $record.installed_by_test -and $leftover.uninstall_key) {
      $dir = Resolve-P07InstallDir -Requested $appDir
      $cleanup = Join-Path $dir 'uninstall.exe'
      if (Test-Path -LiteralPath $cleanup) {
        [void] (Invoke-P07Process -FilePath $cleanup -Arguments @('/S', ('_?=' + $dir)) -TimeoutSeconds 300)
        $record.reason_codes += 'CLEANUP_UNINSTALL_RAN'
      }
      if ($dir -ne $appDir -and (Test-Path -LiteralPath $dir) -and $dir.StartsWith($env:LOCALAPPDATA)) { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
    }
    # Owned paths only. The uninstaller keeps itself when run in place (_?=).
    if (Test-Path -LiteralPath $ownedRoot) { Remove-Item -LiteralPath $ownedRoot -Recurse -Force -ErrorAction SilentlyContinue }
    $parent = Split-Path -Parent $ownedRoot
    if ((Test-Path -LiteralPath $parent) -and @(Get-ChildItem -LiteralPath $parent -Force).Count -eq 0) { Remove-Item -LiteralPath $parent -Force -ErrorAction SilentlyContinue }
    $record.after.owned_root_removed = (-not (Test-Path -LiteralPath $ownedRoot))
    $record.after.real_data = Get-P07TreeSnapshot -Path $script:RealDataDir
    $record.after.install = Get-P07InstallState
  }
  return $record
}
