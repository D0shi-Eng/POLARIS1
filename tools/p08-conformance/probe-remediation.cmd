@echo off
rem POLARIS Phase-08 remediation - native probe of the six failed conditions' missions with the real local model
rem (development aid between fixes; not the canonical run, whose evidence it never writes).
set OUT=D:\POLARIS\evidence\p08-native\remediation-probe
set LOG=D:\POLARIS\evidence\p08-native\remediation-probe.local.txt
taskkill /F /IM polaris-p08-native.exe >nul 2>&1
timeout /t 3 /nobreak >nul
cd /d D:\POLARIS\desktop\host
echo [%date% %time%] build started > %LOG%
cargo build --release -p polaris-p08-harness --target-dir target-probe >> %LOG% 2>&1
if errorlevel 1 (
  echo [%date% %time%] BUILD FAILED >> %LOG%
  exit /b 1
)
set POLARIS_P08_SECRET_CANARY=p08-canary-7f3a9c
if exist %OUT% rmdir /s /q %OUT%
echo [%date% %time%] harness started >> %LOG%
target-probe\release\polaris-p08-native.exe --out %OUT% --data %OUT%\data --sections sandbox,model,missions --tasks %~1 --task-minutes 20 >> %LOG% 2>&1
echo [%date% %time%] harness finished exit %errorlevel% >> %LOG%
