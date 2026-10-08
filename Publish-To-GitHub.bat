@echo off
title Publish Lofan website changes
cd /d "%~dp0"
set GIT=git
where git >nul 2>nul || set GIT="C:\Program Files\Git\cmd\git.exe"
echo.
echo  This saves your latest edits and uploads them to GitHub.
echo  Then, in cPanel:  Git Version Control ^> Manage ^> "Update from Remote" ^> "Deploy HEAD Commit".
echo.
%GIT% remote get-url origin >nul 2>nul
if errorlevel 1 (
  echo  GitHub is not connected to this folder yet.
  echo  Open hosting\README-HOSTING.txt, Part 3, step A - or ask Claude to connect it.
  echo.
  pause
  exit /b 1
)
set /p MSG=What did you change? (short note, e.g. new banner photo):
if "%MSG%"=="" set MSG=Website update
%GIT% add -A
%GIT% commit -m "%MSG%"
%GIT% push -u origin HEAD
echo.
echo  Done. If you saw an error above, take a screenshot and send it to me.
echo  Next: cPanel ^> Git Version Control ^> Manage ^> Update from Remote ^> Deploy HEAD Commit.
pause
