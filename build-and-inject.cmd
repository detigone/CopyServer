@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-and-inject.ps1"
echo.
pause
