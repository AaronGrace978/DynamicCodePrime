@echo off
title DynamicCodePrime
cd /d "%~dp0"

echo.
echo   DynamicCodePrime - Word to Code
echo   ================================
echo.

if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    echo.
)

echo   Starting...
echo.
call npx electron .

if errorlevel 1 (
    echo.
    echo   Failed to start. Press any key to exit.
    pause >nul
)
