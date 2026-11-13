@echo off
taskkill /F /IM polaris-p08-native.exe
taskkill /F /T /FI "WINDOWTITLE eq POLARIS P08 remediation probe*"
