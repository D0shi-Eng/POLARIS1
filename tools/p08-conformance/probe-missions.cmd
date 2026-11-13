@echo off
rem POLARIS Phase-08 - quick native probe of a few benchmark tasks with the real local model
rem (development aid; not part of the canonical run, whose evidence it never writes).
taskkill /F /IM polaris-p08-native.exe >nul 2>&1
timeout /t 4 /nobreak >nul
cd /d D:\POLARIS\desktop\host
cargo build --release -p polaris-p08-harness --target-dir target-probe > D:\POLARIS\evidence\p08-native\probe-build.local.txt 2>&1
if errorlevel 1 exit
set POLARIS_P08_SECRET_CANARY=p08-canary-7f3a9c
if exist D:\POLARIS\evidence\p08-native\probe-missions rmdir /s /q D:\POLARIS\evidence\p08-native\probe-missions
target-probe\release\polaris-p08-native.exe --out D:\POLARIS\evidence\p08-native\probe-missions --data D:\POLARIS\evidence\p08-native\probe-missions\data --sections sandbox,model,missions --tasks MISSION-A,MISSION-B,MISSION-E,B06,B07 --task-minutes 15 > D:\POLARIS\evidence\p08-native\probe-missions.local.txt 2>&1
exit
