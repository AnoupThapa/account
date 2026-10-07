@echo off
rem LedgerPro - Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved. PROPRIETARY AND CONFIDENTIAL. See LICENSE.
rem Double-click after you receive a new version of LedgerPro: reinstalls packages and rebuilds, then starts.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start-ledgerpro.ps1" -Rebuild
if errorlevel 1 pause
