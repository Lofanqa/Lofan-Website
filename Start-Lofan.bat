@echo off
title Lofan Website Server
cd /d "%~dp0"
where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install it from https://www.python.org/downloads/ and tick "Add Python to PATH".
  pause
  exit /b
)
start "" http://localhost:8000
echo Starting Lofan website at http://localhost:8000   (keep this window open; close it to stop)
python server.py
pause
