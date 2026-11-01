@echo off
rem Aethelgard web prototype: starts the dev server and opens the browser.
rem Close this window to stop the server.
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing packages...
  call npm install || goto :fail
)
call npm run play -- --open
if errorlevel 1 goto :fail
exit /b 0
:fail
echo Failed to start. Check that Node.js is installed.
pause
exit /b 1
