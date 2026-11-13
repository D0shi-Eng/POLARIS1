@echo off
rem POLARIS Phase-08 - quick native probe of the sandbox section only (development aid).
cd /d D:\POLARIS\desktop\host
cargo build --release -p polaris-p08-harness --target-dir target-probe > D:\POLARIS\evidence\p08-native\probe-build.local.txt 2>&1
set POLARIS_P08_SECRET_CANARY=p08-canary-7f3a9c
target-probe\release\polaris-p08-native.exe --out D:\POLARIS\evidence\p08-native\probe-sandbox --data D:\POLARIS\evidence\p08-native\probe-sandbox\data --sections sandbox > D:\POLARIS\evidence\p08-native\probe-sandbox.local.txt 2>&1
exit
