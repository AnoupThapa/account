@echo off
rem LedgerPro - Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved. PROPRIETARY AND CONFIDENTIAL. See LICENSE.
rem Double-click to run LedgerPro on this PC without Docker. Add -Rebuild after receiving new code.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start-ledgerpro.ps1" %*
if errorlevel 1 pause
