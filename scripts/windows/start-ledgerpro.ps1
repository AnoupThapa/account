# LedgerPro
# Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
# PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
# of this file, via any medium, is strictly prohibited. See LICENSE.
#
# Runs LedgerPro on a Windows PC WITHOUT Docker. For local use/demos only.
# Needs: Node.js 22 LTS and PostgreSQL 16 (or 17) installed.
# Start it by double-clicking "Start LedgerPro.cmd" in the ledgerpro folder.
# Add -Rebuild to force a fresh build after you receive new code.
# Add -UseNeon to use a free Neon (neon.tech) online database instead of installing PostgreSQL.

param([switch]$Rebuild, [switch]$UseNeon)

# 'Continue': Windows PowerShell 5.1 turns harmless warnings from programs into fatal errors under 'Stop'.
# Every program step is checked through its exit code instead (see Run).
$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Root
$LocalDir = Join-Path $Root '.local'
if (-not (Test-Path $LocalDir)) { New-Item -ItemType Directory -Path $LocalDir | Out-Null }

function Say($msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Cyan }
function Fail($msg) {
  Write-Host ''
  Write-Host "PROBLEM: $msg" -ForegroundColor Red
  Write-Host ''
  Read-Host 'Press Enter to close this window'
  exit 1
}
function Run($exe, [string[]]$argList, $what) {
  & $exe @argList
  if ($LASTEXITCODE -ne 0) { Fail "$what failed (see the messages above). Copy them into a Claude session for help." }
}
function PortOpen([int]$port) {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Close() }
}
function Utf8NoBom() { New-Object System.Text.UTF8Encoding($false) }

Write-Host '=============================================' -ForegroundColor Green
Write-Host '   LedgerPro - local start (no Docker)' -ForegroundColor Green
Write-Host '=============================================' -ForegroundColor Green

# ---------------------------------------------------------------- already running?
if ((PortOpen 3000) -and (PortOpen 4000)) {
  Say 'LedgerPro is already running - opening it in your browser.'
  Start-Process 'http://localhost:3000'
  exit 0
}

# ---------------------------------------------------------------- 1. Node.js
Say 'Checking Node.js ...'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js is not installed. Install "Node.js 22 LTS" from https://nodejs.org , then double-click Start LedgerPro again.' }
$nodeVer = (& node -v).Trim()
$major = [int]($nodeVer.TrimStart('v').Split('.')[0])
if ($major -lt 22) { Fail "Node.js $nodeVer is too old. Install Node.js 22 LTS from https://nodejs.org ." }
Write-Host "    Node.js $nodeVer - OK"

# ---------------------------------------------------------------- 3. .env settings file
$envFile = Join-Path $Root '.env'
if (-not (Test-Path $envFile)) {
  Say 'Creating your settings file (.env) with new random secret keys ...'
  $text = [IO.File]::ReadAllText((Join-Path $Root '.env.example'))
  $jwt = (& node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64url'))")
  $key = (& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64'))")
  $edge = $null
  foreach ($e in @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe")) {
    if ($e -and (Test-Path $e)) { $edge = $e; break }
  }
  $text = $text -replace '(?m)^JWT_ACCESS_SECRET=.*$', "JWT_ACCESS_SECRET=$jwt"
  $text = $text -replace '(?m)^ENCRYPTION_KEY=.*$', "ENCRYPTION_KEY=$key"
  # Local PC only: demo users can sign in without an authenticator app; plain http cookies.
  $text = $text -replace '(?m)^ENFORCE_2FA=.*$', 'ENFORCE_2FA=false'
  $text = $text -replace '(?m)^COOKIE_SECURE=.*$', 'COOKIE_SECURE=false'
  if ($edge) { $text = $text -replace '(?m)^CHROMIUM_PATH=.*$', ("CHROMIUM_PATH=" + $edge.Replace('$', '$$')) }
  [IO.File]::WriteAllText($envFile, $text, (Utf8NoBom))
  Write-Host '    Saved .env (keep this file private).'
}

# ---------------------------------------------------------------- 2b. Neon (online database) - only with -UseNeon
if ($UseNeon) {
  Say 'Connect LedgerPro to your Neon database'
  Write-Host '    In the Neon website: open your project -> click "Connect" -> copy the connection string.'
  Write-Host '    (It starts with postgresql://neondb_owner:...)'
  $neonUrl = (Read-Host '    Paste it here and press Enter').Trim().Trim('"').Trim("'")
  if ($neonUrl -notmatch '^postgres(ql)?://[^:/@]+:[^@]+@[^/]+/.+') { Fail 'That does not look like a Neon connection string. Copy the whole line from Neon -> Connect, then run "Use Neon Database.cmd" again.' }
  $text = [IO.File]::ReadAllText($envFile)
  $text = $text -replace '(?m)^DATABASE_ADMIN_URL=.*$', ('DATABASE_ADMIN_URL=' + $neonUrl.Replace('$', '$$'))
  $text = $text -replace '(?m)^DATABASE_URL=.*$', 'DATABASE_URL='
  [IO.File]::WriteAllText($envFile, $text, (Utf8NoBom))
  Write-Host '    Saved. From now on "Start LedgerPro.cmd" uses Neon.'
}

# Load .env into this window (and the windows started from it)
foreach ($line in [IO.File]::ReadAllLines($envFile)) {
  $t = $line.Trim()
  if ($t -eq '' -or $t.StartsWith('#')) { continue }
  $i = $t.IndexOf('=')
  if ($i -lt 1) { continue }
  $k = $t.Substring(0, $i).Trim()
  $v = $t.Substring($i + 1).Trim()
  if ($v.Length -ge 2 -and (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'")))) { $v = $v.Substring(1, $v.Length - 2) }
  Set-Item -Path "Env:$k" -Value $v
}
$env:NEXT_TELEMETRY_DISABLED = '1'

# Which database? localhost = PostgreSQL installed on this PC; anything else = online (e.g. Neon)
$localDb = ($env:DATABASE_ADMIN_URL -match '@(localhost|127\.0\.0\.1)[:/]')

# ---------------------------------------------------------------- 2. PostgreSQL on this PC (skipped when using Neon)
if ($localDb) {
  Say 'Checking PostgreSQL ...'
  $psql = $null
  foreach ($v in @('16', '17', '18')) {
    $p = "C:\Program Files\PostgreSQL\$v\bin\psql.exe"
    if (Test-Path $p) { $psql = $p; break }
  }
  if (-not $psql) {
    $cmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($cmd) { $psql = $cmd.Source }
  }
  if (-not $psql) { Fail 'PostgreSQL is not installed. Install PostgreSQL 16 for Windows from https://www.postgresql.org/download/windows/ (the EDB installer). Remember the password you choose for the "postgres" user.' }
  Write-Host "    Found $psql"
  if (-not (PortOpen 5432)) { Fail 'PostgreSQL is installed but not running. Open the Windows "Services" app, find "postgresql-x64-16" and click Start (or restart the PC).' }

  # Do the LedgerPro database users already exist? (test login with the local dev password)
  $env:PGPASSWORD = 'ledger_owner_dev'
  & $psql -h localhost -U ledger_owner -d ledgerpro -tAc 'select 1' 2>$null | Out-Null
  $dbReady = ($LASTEXITCODE -eq 0)
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

  if (-not $dbReady) {
    Say 'First run: creating the LedgerPro database (one time only).'
    Write-Host '    Type the password you chose for the "postgres" user when you installed PostgreSQL.'
    Write-Host '    (It is used once, right now, and is not saved anywhere.)'
    $sec = Read-Host '    postgres password' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    & $psql -h localhost -U postgres -d postgres -tAc 'select 1' | Out-Null
    if ($LASTEXITCODE -ne 0) { Remove-Item Env:PGPASSWORD; Fail 'Could not sign in to PostgreSQL as "postgres". Check the password and try again.' }
    & $psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f (Join-Path $Root 'infra\postgres\init.sql')
    $ok = ($LASTEXITCODE -eq 0)
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    if (-not $ok) { Fail 'Creating the LedgerPro database failed (see above).' }
    Write-Host '    Database created.'
  }
} else {
  Say 'Using the online database (not PostgreSQL on this PC).'
}

# ---------------------------------------------------------------- 4. install + build
$pnpm = @('--yes', 'pnpm@10.28.0')
# Markers in .local\ record that packages were installed / built ON THIS PC (copied files from elsewhere don't count)
$installMarker = Join-Path $LocalDir 'installed-windows'
$buildMarker = Join-Path $LocalDir 'built-windows'
if ($Rebuild -or -not (Test-Path $installMarker)) {
  Say 'Installing program packages (first time: 3-10 minutes, needs internet) ...'
  Run 'npx' ($pnpm + @('install', '--frozen-lockfile')) 'Installing packages'
  [IO.File]::WriteAllText($installMarker, (Get-Date).ToString('s'), (Utf8NoBom))
  if (Test-Path $buildMarker) { Remove-Item $buildMarker }
}
if ($Rebuild -or -not (Test-Path $buildMarker)) {
  Say 'Building LedgerPro (first time: 2-5 minutes) ...'
  $env:NODE_ENV = 'production'
  Run 'npx' ($pnpm + @('build')) 'Building'
  [IO.File]::WriteAllText($buildMarker, (Get-Date).ToString('s'), (Utf8NoBom))
}

# ---------------------------------------------------------------- 4b. prepare the online database (first time)
if (-not $localDb -and [string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  Say 'Preparing the online database (one time) ...'
  $out = & node (Join-Path $Root 'scripts\windows\connect-database.js')
  if ($LASTEXITCODE -ne 0) { Fail 'Could not use the online database (see the message above). Check the connection string and run "Use Neon Database.cmd" again.' }
  $res = ($out | Select-Object -Last 1) | ConvertFrom-Json
  $text = [IO.File]::ReadAllText($envFile)
  $text = $text -replace '(?m)^DATABASE_ADMIN_URL=.*$', ('DATABASE_ADMIN_URL=' + $res.adminUrl.Replace('$', '$$'))
  $text = $text -replace '(?m)^DATABASE_URL=.*$', ('DATABASE_URL=' + $res.appUrl.Replace('$', '$$'))
  [IO.File]::WriteAllText($envFile, $text, (Utf8NoBom))
  $env:DATABASE_ADMIN_URL = $res.adminUrl
  $env:DATABASE_URL = $res.appUrl
  Write-Host '    Online database ready.'
}

# ---------------------------------------------------------------- 5. database tables + demo data
Say 'Updating database tables ...'
$env:NODE_ENV = 'development'
Run 'node' @('-e', "const d=require('./packages/db/dist');d.runMigrations(process.env.DATABASE_ADMIN_URL).then(r=>{console.log('    '+r.applied.length+' new, '+r.skipped.length+' already applied');return d.seedGlobal(process.env.DATABASE_ADMIN_URL)}).then(()=>process.exit(0),e=>{console.error(e.message);process.exit(1)})") 'Updating the database'

$dbHost = ([regex]::Match($env:DATABASE_ADMIN_URL, '@([^:/?]+)')).Groups[1].Value
$demoMarker = Join-Path $LocalDir ('demo-loaded-' + $dbHost)
if (-not (Test-Path $demoMarker)) {
  Say 'Loading the demo companies and users (one time only) ...'
  Run 'node' @('apps\api\dist\scripts\seed-demo.js') 'Loading demo data'
  [IO.File]::WriteAllText($demoMarker, (Get-Date).ToString('s'), (Utf8NoBom))
}

# ---------------------------------------------------------------- 6. start API + website
Say 'Starting LedgerPro (two new windows will open - keep them open while you use it) ...'
if (-not (PortOpen 4000)) {
  Start-Process powershell -WorkingDirectory $Root -ArgumentList @('-NoExit', '-NoProfile', '-Command', "`$host.UI.RawUI.WindowTitle='LedgerPro API (keep open)'; `$env:NODE_ENV='development'; node apps\api\dist\main.js")
}
if (-not (PortOpen 3000)) {
  Start-Process powershell -WorkingDirectory (Join-Path $Root 'apps\web') -ArgumentList @('-NoExit', '-NoProfile', '-Command', "`$host.UI.RawUI.WindowTitle='LedgerPro Website (keep open)'; `$env:NODE_ENV='production'; node node_modules\next\dist\bin\next start -p 3000")
}

Write-Host '    Waiting for the website to be ready ...'
$ready = $false
for ($n = 0; $n -lt 90; $n++) {
  Start-Sleep -Seconds 2
  if ((PortOpen 3000) -and (PortOpen 4000)) { $ready = $true; break }
}
if (-not $ready) { Fail 'LedgerPro did not start in 3 minutes. Look at the two LedgerPro windows for error messages.' }
Start-Sleep -Seconds 2
Start-Process 'http://localhost:3000'

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host ' LedgerPro is running:  http://localhost:3000' -ForegroundColor Green
Write-Host ''
Write-Host ' Sign in with:  accountant.np@ledgerpro.local'
Write-Host '      password: Demo-Ledger-2026!'
Write-Host ' (also checker.np@, finance.np@, auditor.np@, the .au users, owner@ledgerpro.local)'
Write-Host ''
Write-Host ' To stop: close the two "LedgerPro" windows.'
Write-Host '=============================================' -ForegroundColor Green
Write-Host ''
Read-Host 'Press Enter to close this window (LedgerPro keeps running)'
