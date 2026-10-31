@echo off
rem Starts the Oro Valley Council Dashboard from source (for staff PCs without the installer, or for development).
rem First run: installs dependencies (needs internet). Later runs start in a few seconds.
setlocal
cd /d "%~dp0review-app"
set ELECTRON_RUN_AS_NODE=
where node >/dev/null 2>/dev/null || (echo Node.js is required. Install it from https://nodejs.org and run this again. & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies, this takes a few minutes the first time...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
if not exist node_modules\electron\dist\electron.exe (
  echo Downloading Electron...
  call node node_modules\electron\install.js || (pause & exit /b 1)
)
echo Starting Oro Valley Council Dashboard...
call npm start
if errorlevel 1 pause
