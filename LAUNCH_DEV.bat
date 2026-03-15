@echo off
title DynamicCodePrime (Dev)
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
)

echo Starting with DevTools...
call npx electron . --dev
