@echo off
rem POLARIS Phase-08 - development launcher: re-run the Phase-07 runner (it re-runs Phase-06..00) so the Phase-08 prerequisite reflects the current tree.
if not "%~1"=="min" (
  start "POLARIS Phase-07 run" /min "%~f0" min
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "& D:\POLARIS\tools\p07-conformance\run.ps1 -RepositoryRoot D:\POLARIS *>&1 | Tee-Object -FilePath D:\POLARIS\evidence\p08-native\runner-console-p07.local.txt"
echo.
echo POLARIS Phase-07 run finished. This window can be closed.
pause
