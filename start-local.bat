@echo off
cd /d "%~dp0"
echo Building My Finance Buddy...
call npm run build
if errorlevel 1 exit /b 1
echo.
echo Starting at http://127.0.0.1:4173/
echo Press Ctrl+C to stop.
call npm run start
