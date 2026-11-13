@echo off
call D:\POLARIS\tools\p08-conformance\stop-probe.cmd >nul 2>&1
timeout /t 5 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -File D:\POLARIS\tools\p08-conformance\probe-reasoning.ps1 > D:\POLARIS\evidence\p08-native\reasoning-probe.local.txt 2>&1
