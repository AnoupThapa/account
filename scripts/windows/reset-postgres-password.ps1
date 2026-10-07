# LedgerPro
# Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
# PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
# of this file, via any medium, is strictly prohibited. See LICENSE.
#
# Sets a NEW password for the PostgreSQL "postgres" user when the old one is forgotten.
# How: briefly lets local connections in without a password, sets the new password,
# then puts the original security file back. No databases or data are touched.

$ErrorActionPreference = 'Continue'

function Fail($msg) {
  Write-Host ''
  Write-Host "PROBLEM: $msg" -ForegroundColor Red
  Read-Host 'Press Enter to close this window'
  exit 1
}

# ---- needs Administrator rights (to edit PostgreSQL's settings and restart it)
$me = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host 'Asking Windows for administrator permission - click Yes on the box that appears.'
  Start-Process powershell -Verb RunAs -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  exit 0
}

Write-Host '=============================================' -ForegroundColor Green
Write-Host '   Reset the PostgreSQL "postgres" password' -ForegroundColor Green
Write-Host '=============================================' -ForegroundColor Green

# ---- find the PostgreSQL service, its data folder and psql.exe
$svc = Get-CimInstance Win32_Service | Where-Object { $_.Name -like 'postgresql*' } | Select-Object -First 1
if (-not $svc) { Fail 'No PostgreSQL service found on this PC. Install PostgreSQL 16 first.' }
if ($svc.PathName -notmatch '-D\s+"([^"]+)"') { Fail "Could not find the PostgreSQL data folder (service: $($svc.Name))." }
$dataDir = $Matches[1]
if ($svc.PathName -notmatch '^"?([^"]+\\bin)\\pg_ctl\.exe') { Fail 'Could not find the PostgreSQL program folder.' }
$psql = Join-Path $Matches[1] 'psql.exe'
$hba = Join-Path $dataDir 'pg_hba.conf'
if (-not (Test-Path $hba)) { Fail "Settings file not found: $hba" }
if (-not (Test-Path $psql)) { Fail "psql.exe not found: $psql" }
Write-Host "    Service: $($svc.Name)"
Write-Host "    Data folder: $dataDir"

# ---- ask for the new password (twice)
Write-Host ''
Write-Host 'Choose a NEW password for the "postgres" user and write it down somewhere safe.'
Write-Host '(Typing is hidden - that is normal.)'
function ReadPlain($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
$p1 = ReadPlain '    New password'
$p2 = ReadPlain '    Type it again'
if ($p1 -ne $p2) { Fail 'The two passwords were different. Run this again.' }
if ($p1.Length -lt 6) { Fail 'Please use at least 6 characters.' }

# ---- temporarily allow local connections without a password
$backup = "$hba.ledgerpro-backup"
Copy-Item $hba $backup -Force
$sqlFile = Join-Path $env:TEMP ("lp-reset-" + [guid]::NewGuid().ToString('N') + '.sql')
$ok = $false
try {
  $trust = "# TEMPORARY (LedgerPro password reset) - original saved as pg_hba.conf.ledgerpro-backup`r`nhost all all 127.0.0.1/32 trust`r`nhost all all ::1/128 trust`r`n"
  [IO.File]::WriteAllText($hba, $trust, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host ''
  Write-Host '==> Restarting PostgreSQL ...' -ForegroundColor Cyan
  Restart-Service -Name $svc.Name -Force
  Start-Sleep -Seconds 3

  $escaped = $p1.Replace("'", "''")
  [IO.File]::WriteAllText($sqlFile, "ALTER USER postgres WITH PASSWORD '$escaped';`n", (New-Object System.Text.UTF8Encoding($false)))
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  & $psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f $sqlFile
  $ok = ($LASTEXITCODE -eq 0)
}
finally {
  # ---- always put the original security file back
  if (Test-Path $sqlFile) { Remove-Item $sqlFile -Force }
  Copy-Item $backup $hba -Force
  Remove-Item $backup -Force
  Write-Host '==> Restoring PostgreSQL security settings and restarting ...' -ForegroundColor Cyan
  Restart-Service -Name $svc.Name -Force
}

if (-not $ok) { Fail 'Setting the new password did not work (see messages above). Your original settings have been restored.' }
Write-Host ''
Write-Host 'Done. The "postgres" password has been changed.' -ForegroundColor Green
Write-Host 'Now double-click "Start LedgerPro.cmd" and type the NEW password when asked.'
Write-Host ''
Read-Host 'Press Enter to close this window'
