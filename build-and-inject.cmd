@echo off
setlocal

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-and-inject.ps1" %*
set "exitCode=%ERRORLEVEL%"

echo.
if not "%exitCode%"=="0" pause
exit /b %exitCode%
