# Phase-07 Windows packaging: the NSIS installer from the release configuration,
# an older-version installer used only as the upgrade test fixture, and the
# signing status.
#
# The installer is built by the Tauri bundler that is already a pinned dev
# dependency of the renderer (@tauri-apps/cli). On first use the bundler fetches
# its NSIS toolchain and verifies it against hashes pinned in the bundler; if
# that fetch is impossible the packaging stage fails and says so.
#
# Nothing is published, uploaded or signed with an invented certificate.
#
# Encoding: ASCII in every executable line.

Set-StrictMode -Version Latest

function Invoke-P07TauriBuild {
  param(
    [Parameter(Mandatory = $true)][string] $RepositoryRoot,
    [Parameter(Mandatory = $true)][string] $NodeCommand,
    [Parameter(Mandatory = $true)][string[]] $ConfigFiles
  )
  $cli = Join-Path $RepositoryRoot 'desktop\renderer\node_modules\@tauri-apps\cli\tauri.js'
  if (-not (Test-Path -LiteralPath $cli)) { throw ("tauri CLI missing: " + $cli) }
  $arguments = @($cli, 'build', '--bundles', 'nsis', '--ci')
  foreach ($config in $ConfigFiles) { $arguments += @('--config', $config) }
  Push-Location -LiteralPath (Join-Path $RepositoryRoot 'desktop\host\app')
  try {
    & $NodeCommand @arguments
    if ($LASTEXITCODE -ne 0) { throw ("tauri build exited " + $LASTEXITCODE) }
  }
  finally { Pop-Location }
}

function Find-P07Installer {
  param([Parameter(Mandatory = $true)][string] $RepositoryRoot, [Parameter(Mandatory = $true)][string] $Version)
  $folder = Join-Path $RepositoryRoot 'desktop\host\target\release\bundle\nsis'
  $found = @(Get-ChildItem -LiteralPath $folder -Filter ('*_' + $Version + '_x64-setup.exe') -File -ErrorAction SilentlyContinue)
  if ($found.Count -eq 0) { return $null }
  return $found[0].FullName
}

# Builds the fixture installer (an older version number, for the upgrade test)
# and then the release installer. Returns the record the runner stores raw.
function Invoke-P07Packaging {
  param(
    [Parameter(Mandatory = $true)][string] $RepositoryRoot,
    [Parameter(Mandatory = $true)][string] $NodeCommand,
    [Parameter(Mandatory = $true)][string] $CargoCommand,
    [Parameter(Mandatory = $true)][string] $RawDirectory,
    [Parameter(Mandatory = $true)][string] $ReleaseDirectory
  )
  $conf = Get-Content -LiteralPath (Join-Path $RepositoryRoot 'desktop\host\app\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $version = [string] $conf.version
  $fixtureVersion = '0.0.9'
  $releaseConfig = Join-Path $RepositoryRoot 'desktop\host\app\tauri.release.conf.json'
  $packagingDir = Join-Path $RawDirectory 'packaging'
  if (-not (Test-Path -LiteralPath $packagingDir)) { [void] (New-Item -ItemType Directory -Path $packagingDir) }
  if (-not (Test-Path -LiteralPath $ReleaseDirectory)) { [void] (New-Item -ItemType Directory -Path $ReleaseDirectory -Force) }
  $record = [ordered] @{ version = $version; fixture_version = $fixtureVersion; builds = @(); release_installer = $null; fixture_installer = $null }

  # the maintenance tool is a bundled resource: it must exist before the bundler reads the config
  Push-Location -LiteralPath (Join-Path $RepositoryRoot 'desktop\host')
  try {
    & $CargoCommand 'build' '--release' '-p' 'polaris-maint'
    if ($LASTEXITCODE -ne 0) { throw "polaris-maint release build failed" }
  }
  finally { Pop-Location }

  $versionFile = Join-Path $packagingDir 'fixture-version.conf.json'
  [System.IO.File]::WriteAllText($versionFile, ('{"version":"' + $fixtureVersion + '"}'), (New-Object System.Text.UTF8Encoding($false)))

  foreach ($plan in @(
      @{ label = 'upgrade-fixture'; version = $fixtureVersion; configs = @($releaseConfig, $versionFile); destination = $packagingDir },
      @{ label = 'release'; version = $version; configs = @($releaseConfig); destination = $ReleaseDirectory })) {
    $stale = Find-P07Installer -RepositoryRoot $RepositoryRoot -Version $plan.version
    if ($null -ne $stale) { Remove-Item -LiteralPath $stale -Force }
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    Invoke-P07TauriBuild -RepositoryRoot $RepositoryRoot -NodeCommand $NodeCommand -ConfigFiles $plan.configs
    $built = Find-P07Installer -RepositoryRoot $RepositoryRoot -Version $plan.version
    if ($null -eq $built) { throw ("no installer for version " + $plan.version) }
    $target = Join-Path $plan.destination ([System.IO.Path]::GetFileName($built))
    Copy-Item -LiteralPath $built -Destination $target -Force
    $record.builds += [ordered] @{
      label = $plan.label; version = $plan.version; file = [System.IO.Path]::GetFileName($built); bytes = (Get-Item -LiteralPath $target).Length
      sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant(); duration_ms = [int] $clock.Elapsed.TotalMilliseconds
    }
    if ($plan.label -eq 'release') { $record.release_installer = $target } else { $record.fixture_installer = $target }
  }
  return $record
}
