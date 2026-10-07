@echo off
rem LedgerPro - Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved. PROPRIETARY AND CONFIDENTIAL. See LICENSE.
rem Double-click if you forgot the PostgreSQL "postgres" password. Sets a new one; no data is changed.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\reset-postgres-password.ps1"
