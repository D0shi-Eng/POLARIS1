@echo off
rem POLARIS Phase-08 - re-derive the evidence and the gate over the raw records (stages 11-12),
rem measuring nothing again. Used after documentation-only changes.
if not "%~1"=="min" (
  start "POLARIS Phase-08 derive" /min "%~f0" min
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "& D:\POLARIS\tools\p08-conformance\run.ps1 -RepositoryRoot D:\POLARIS -DeriveOnly *>&1 | Tee-Object -FilePath D:\POLARIS\evidence\p08-native\runner-console-derive.local.txt"
exit
