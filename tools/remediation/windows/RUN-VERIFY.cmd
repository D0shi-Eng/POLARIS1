@echo off
rem POLARIS remediation 2026-10-12: one double-click runs the Windows verification and packaging (see Invoke-RemediationVerify.ps1).
rem Nothing is published, pushed, signed or uploaded. No model is loaded. Results: D:\POLARIS\evidence\remediation-2026-10-12\windows\
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Invoke-RemediationVerify.ps1" -Smoke
echo.
echo Finished. Exit code %ERRORLEVEL%. You can close this window.
pause
