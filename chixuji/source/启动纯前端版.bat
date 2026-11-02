@echo off
title Xiao Shou Ji
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node --no-warnings=ExperimentalWarning server\launch.mjs --local
echo.
echo   Stopped. Press any key to close this window.
pause >nul
exit /b 0
:nonode
echo   Node.js was not found. Please install Node.js LTS from https://nodejs.org
pause
