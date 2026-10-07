@echo off
title Build Lofan hosting package
cd /d "%~dp0"
python build_hosting_package.py %*
echo.
echo The ZIP is in the "dist" folder:  dist\lofan-cpanel.zip
pause
