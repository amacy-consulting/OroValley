@echo off
rem Starts the Oro Valley Council Dashboard from source (for staff PCs without the installer, or for development).
rem First run: installs dependencies (needs internet). Later runs start in a few seconds.
setlocal
cd /d "%~dp0review-app" || (echo Could not find the review-app folder next to this script. & pause & exit /b 1)
set "ELECTRON_RUN_AS_NODE="
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist "node_modules\" (
  echo Installing dependencies. This takes a few minutes the first time...
  call npm install --no-audit --no-fund
  if errorlevel 1 (pause & exit /b 1)
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Downloading Electron...
  call node node_modules\electron\install.js
  if errorlevel 1 (pause & exit /b 1)
)
echo Starting Oro Valley Council Dashboard...
call npm start
if errorlevel 1 pause
