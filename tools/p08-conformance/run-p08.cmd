@echo off
rem POLARIS Phase-08 - one-click launcher for the canonical native run.
rem It runs tools\p08-conformance\run.ps1 minimised (so no window covers the desktop fixtures of the
rem regression E2E) and keeps a console copy under evidence\p08-native.
if not "%~1"=="min" (
  start "POLARIS Phase-08 run" /min "%~f0" min
  exit /b
)
if not exist "D:\POLARIS\evidence\p08-native" mkdir "D:\POLARIS\evidence\p08-native"
powershell -NoProfile -ExecutionPolicy Bypass -Command "& D:\POLARIS\tools\p08-conformance\run.ps1 -RepositoryRoot D:\POLARIS *>&1 | Tee-Object -FilePath D:\POLARIS\evidence\p08-native\runner-console.local.txt"
echo.
echo POLARIS Phase-08 run finished. This window can be closed.
pause
