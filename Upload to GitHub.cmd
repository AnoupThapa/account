@echo off
rem LedgerPro - Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved. PROPRIETARY AND CONFIDENTIAL. See LICENSE.
rem Double-click to upload the latest LedgerPro code to GitHub (Vercel and Render then update themselves).
cd /d "%~dp0"
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo PROBLEM: Git is not installed. Install "Git for Windows" from https://git-scm.com/download/win
  echo          ^(click Next on every screen^), then double-click this file again.
  echo.
  pause
  exit /b 1
)
echo Uploading LedgerPro to GitHub ...
echo ^(If a GitHub sign-in window opens, sign in and click Authorize.^)
echo.
git push origin main
if errorlevel 1 (
  echo.
  echo PROBLEM: the upload did not work. Copy the messages above into Claude.
) else (
  echo.
  echo DONE. Vercel and Render will now update themselves ^(Render: about 10-15 minutes^).
)
echo.
pause
