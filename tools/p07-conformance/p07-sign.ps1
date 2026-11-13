# Phase-07 signing pipeline.
#
# Signs release files with Authenticode (signtool, SHA-256, RFC 3161 timestamp)
# only when a real code-signing certificate is available: its thumbprint is
# given in POLARIS_SIGNING_CERT_THUMBPRINT and the certificate, with its private
# key and the Code Signing usage, is in the current user's store. Without one the
# files stay unsigned and the status says SIGNING_READY_UNSIGNED. No certificate
# is ever created here, and nothing is signed with a test certificate.
#
# Every file's Authenticode status is read back with Get-AuthenticodeSignature,
# so the recorded status is what Windows reports, not what this script intended.
#
# Encoding: ASCII in every executable line.

Set-StrictMode -Version Latest

$script:CodeSigningOid = '1.3.6.1.5.5.7.3.3'

function Find-P07SignTool {
  $roots = @()
  foreach ($variable in @('ProgramFiles(x86)', 'ProgramFiles')) {
    $value = [System.Environment]::GetEnvironmentVariable($variable)
    if (-not [string]::IsNullOrWhiteSpace($value)) { $roots += (Join-Path $value 'Windows Kits\10\bin') }
  }
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $found = @(Get-ChildItem -LiteralPath $root -Recurse -Filter 'signtool.exe' -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending)
    if ($found.Count -gt 0) { return $found[0].FullName }
  }
  $onPath = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue
  if ($null -ne $onPath) { return $onPath.Source }
  return $null
}

function Get-P07SigningCertificate {
  param([string] $Thumbprint)
  if ([string]::IsNullOrWhiteSpace($Thumbprint)) { return $null }
  $clean = ($Thumbprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
  $certificate = Get-ChildItem -Path 'Cert:\CurrentUser\My' -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $clean } | Select-Object -First 1
  if ($null -eq $certificate) { return $null }
  $usages = @($certificate.EnhancedKeyUsageList | ForEach-Object { $_.ObjectId })
  if (-not $certificate.HasPrivateKey -or ($usages -notcontains $script:CodeSigningOid)) { return $null }
  return $certificate
}

function Invoke-P07Signing {
  param(
    [Parameter(Mandatory = $true)][string[]] $Files,
    [string] $TimestampUrl = 'http://timestamp.digicert.com'
  )
  $thumbprint = [System.Environment]::GetEnvironmentVariable('POLARIS_SIGNING_CERT_THUMBPRINT', 'Process')
  $signtool = Find-P07SignTool
  $certificate = Get-P07SigningCertificate -Thumbprint $thumbprint
  $record = [ordered] @{
    pipeline = 'signtool sign /fd SHA256 /tr <timestamp> /td SHA256 /sha1 <thumbprint>, then Get-AuthenticodeSignature'
    signtool = $signtool
    certificate_configured = (-not [string]::IsNullOrWhiteSpace($thumbprint))
    certificate_usable = ($null -ne $certificate)
    attempted = $false
    files = @()
    status = ''
    reason = ''
  }
  if ($null -ne $certificate -and $null -ne $signtool) {
    $record.attempted = $true
    foreach ($file in $Files) {
      & $signtool 'sign' '/fd' 'SHA256' '/tr' $TimestampUrl '/td' 'SHA256' '/sha1' $certificate.Thumbprint $file
    }
  }
  foreach ($file in $Files) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    $record.files += [ordered] @{ file = [System.IO.Path]::GetFileName($file); authenticode = [string] $signature.Status; signer = $(if ($null -eq $signature.SignerCertificate) { $null } else { $signature.SignerCertificate.Subject }) }
  }
  $valid = @($record.files | Where-Object { $_.authenticode -eq 'Valid' }).Count
  $unsigned = @($record.files | Where-Object { $_.authenticode -eq 'NotSigned' }).Count
  if ($record.attempted -and $valid -eq $Files.Count) { $record.status = 'SIGNED'; $record.reason = 'every file carries a valid Authenticode signature' }
  elseif (-not $record.certificate_configured -and $unsigned -eq $Files.Count -and $null -ne $signtool) {
    $record.status = 'SIGNING_READY_UNSIGNED'
    $record.reason = 'signtool is present and the pipeline is wired, but no code-signing certificate is configured (POLARIS_SIGNING_CERT_THUMBPRINT unset); the files are unsigned and Windows reports NotSigned'
  }
  elseif (-not $record.certificate_configured -and $unsigned -eq $Files.Count) {
    $record.status = 'UNSIGNED_SIGNTOOL_MISSING'
    $record.reason = 'no code-signing certificate is configured and signtool.exe (Windows SDK) was not found, so the signing step could not run even with a certificate'
  }
  elseif ($record.certificate_configured -and -not $record.certificate_usable) { $record.status = 'SIGNING_NOT_READY'; $record.reason = 'a thumbprint is configured but no usable code-signing certificate with a private key matches it' }
  else { $record.status = 'SIGNING_INCONSISTENT'; $record.reason = 'the signatures Windows reports do not match what was attempted' }
  return $record
}
