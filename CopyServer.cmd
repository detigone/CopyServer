@echo off
setlocal
call "%~dp0build-and-inject.cmd" %*
exit /b %ERRORLEVEL%
