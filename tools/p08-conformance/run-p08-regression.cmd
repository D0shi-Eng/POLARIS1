@echo off
rem POLARIS Phase-08 - one-click launcher that re-measures the Phase-00..07
rem regression (stage 10) over the raw records of the last full run, then re-derives the gate.
rem Before starting: minimise every window (Windows+D) and leave the desktop untouched until the
rem window says it has finished; the desktop E2E of Phase-05 refuses a covered fixture window.
if not "%~1"=="min" (
  start "POLARIS Phase-08 re-measure" /min "%~f0" min
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -Command "& D:\POLARIS\tools\p08-conformance\run.ps1 -RepositoryRoot D:\POLARIS -Remeasure regression -RemeasureReason 'regression re-run: uncovered desktop, and the Arabic PDF test now finds the system font itself (the first re-measure lacked the font variable)' *>&1 | Tee-Object -FilePath D:\POLARIS\evidence\p08-native\runner-console-regression.local.txt"
echo.
echo POLARIS Phase-08 re-measurement finished. This window can be closed.
pause
