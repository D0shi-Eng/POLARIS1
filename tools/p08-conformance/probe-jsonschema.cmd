@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File D:\POLARIS\tools\p08-conformance\probe-jsonschema.ps1 > D:\POLARIS\evidence\p08-native\jsonschema-probe.local.txt 2>&1
