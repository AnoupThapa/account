@echo off
rem LedgerPro - Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved. PROPRIETARY AND CONFIDENTIAL. See LICENSE.
rem Double-click to use a free Neon (neon.tech) online database instead of PostgreSQL on this PC.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\start-ledgerpro.ps1" -UseNeon
if errorlevel 1 pause
