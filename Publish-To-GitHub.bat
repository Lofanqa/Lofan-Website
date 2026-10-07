@echo off
title Publish Lofan website changes
cd /d "%~dp0"
set GIT=git
where git >nul 2>nul || set GIT="C:\Program Files\Git\cmd\git.exe"
echo.
echo  This saves your latest edits and uploads them to GitHub.
echo  Afterwards, in cPanel:  Git Version Control ^> Manage ^> "Update from Remote" ^> "Deploy HEAD Commit".
echo.
set /p MSG=What did you change? (short note, e.g. new banner photo):
if "%MSG%"=="" set MSG=Website update
%GIT% add -A
%GIT% commit -m "%MSG%"
%GIT% push
echo.
echo  Done. If you saw an error above, take a screenshot and send it to me.
pause
