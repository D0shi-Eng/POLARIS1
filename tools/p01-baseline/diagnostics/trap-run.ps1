#Requires -Version 5.1
<#
  P01-B1 reproduction trap. NOT canonical evidence, NOT part of the measurement.

  Invokes baseline.ps1 in-process under the exact harness the owner command uses
  (StrictMode Latest, ErrorActionPreference Stop) and prints the full identity of
  any terminating error: type, message, position, script stack, .NET stack, inner
  chain. Run as a child process so that "exit" inside baseline.ps1 cannot end the
  diagnostic run.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $RepositoryRoot,
  [Parameter(Mandatory = $true)][string] $ScriptPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:LASTEXITCODE = 0

try {
  & $ScriptPath -RepositoryRoot $RepositoryRoot
  Write-Output "TRAP_RESULT: NO_EXCEPTION"
  Write-Output ("last_exit_code      : " + $global:LASTEXITCODE)
}
catch {
  $e = $_
  Write-Output "TRAP_RESULT: EXCEPTION"
  Write-Output ("exception_type      : " + $e.Exception.GetType().FullName)
  Write-Output ("exception_message   : " + $e.Exception.Message)
  Write-Output ("fq_error_id         : " + $e.FullyQualifiedErrorId)
  Write-Output ("category_info       : " + $e.CategoryInfo.ToString())

  if ($null -ne $e.InvocationInfo) {
    Write-Output ("script_name         : " + $e.InvocationInfo.ScriptName)
    Write-Output ("line_number         : " + $e.InvocationInfo.ScriptLineNumber)
    Write-Output ("offset_in_line      : " + $e.InvocationInfo.OffsetInLine)
    Write-Output ("command_name        : " + $e.InvocationInfo.MyCommand)
    Write-Output ("offending_line      : " + ($e.InvocationInfo.Line -replace "`r", "" -replace "`n", ""))
    Write-Output "position_message    :"
    Write-Output $e.InvocationInfo.PositionMessage
  }

  Write-Output "script_stack_trace  :"
  Write-Output $e.ScriptStackTrace
  Write-Output "dotnet_stack_trace  :"
  Write-Output ([string] $e.Exception.StackTrace)

  $inner = $e.Exception.InnerException
  $depth = 0
  while (($null -ne $inner) -and ($depth -lt 5)) {
    Write-Output ("inner[$depth]_type       : " + $inner.GetType().FullName)
    Write-Output ("inner[$depth]_message    : " + $inner.Message)
    Write-Output ("inner[$depth]_stack      : " + [string] $inner.StackTrace)
    $inner = $inner.InnerException
    $depth = $depth + 1
  }
}
