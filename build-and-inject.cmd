@echo off
setlocal EnableExtensions
title CopyServer - Vencord Installer

rem If arguments were supplied, keep command-line usage available.
if not "%~1"=="" goto direct

:menu
cls
echo ==========================================
echo          COPYSERVER - VENCORD
echo ==========================================
echo.
echo   1. Install / update CopyServer
echo   2. Install Development build
echo   3. Roll back last installation
echo   4. Install without launching Discord
echo   5. Development build without launch
echo.
echo   0. Exit
echo.
choice /c 123450 /n /m "Select an action: "

if errorlevel 6 goto end
if errorlevel 5 (
    call :run -Dev -NoLaunch
    goto menu
)
if errorlevel 4 (
    call :run -NoLaunch
    goto menu
)
if errorlevel 3 (
    call :run -Rollback
    goto menu
)
if errorlevel 2 (
    call :run -Dev
    goto menu
)
if errorlevel 1 (
    call :run
    goto menu
)
goto menu

:run
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-and-inject.ps1" %*
set "exitCode=%ERRORLEVEL%"
echo.
if "%exitCode%"=="0" (
    echo [OK] Operation completed.
) else (
    echo [ERROR] Operation failed with exit code %exitCode%.
)
echo.
pause
exit /b %exitCode%

:direct
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-and-inject.ps1" %*
set "exitCode=%ERRORLEVEL%"
if not "%exitCode%"=="0" (
    echo.
    echo [ERROR] Operation failed with exit code %exitCode%.
    pause
)
exit /b %exitCode%

:end
exit /b 0
