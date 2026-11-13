@echo off
if not "%~1"=="min" (
  start "POLARIS Phase-03..08 chain" /min "%~f0" min
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File D:\POLARIS\tools\p08-conformance\run-chain.ps1 -RepositoryRoot D:\POLARIS > D:\POLARIS\evidence\p08-native\runner-chain.local.txt 2>&1
echo.
echo POLARIS chain finished. This window can be closed.
pause
