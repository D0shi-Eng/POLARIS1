@echo off
rem POLARIS Phase-08 - the final repository step (private GitHub repository only).
powershell -NoProfile -ExecutionPolicy Bypass -File D:\POLARIS\tools\p08-conformance\p08-repository-publish.ps1 -RepositoryRoot D:\POLARIS
echo.
echo Repository step finished. This window can be closed.
pause
