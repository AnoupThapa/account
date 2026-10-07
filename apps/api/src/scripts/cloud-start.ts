/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/**
 * Start-up for simple cloud hosts (e.g. Render + Neon) where the owner only pastes ONE value:
 *   DATABASE_ADMIN_URL = the database owner connection string (e.g. Neon "neondb_owner").
 * Before starting the API it:
 *   1. tidies the URL (direct connection, TLS),
 *   2. fills in missing secrets (JWT_ACCESS_SECRET, ENCRYPTION_KEY) derived from that URL,
 *   3. creates/refreshes the restricted `ledger_app` login (row-level security applies) when DATABASE_URL is not set,
 *   4. applies database migrations + reference data,
 *   5. loads demo data once if LOAD_DEMO_DATA=true,
 *   6. starts the API on $PORT.
 * With DATABASE_URL already set (docker-compose, own server) steps 3 and 5 are skipped / opt-in.
 */
import { createHmac } from 'crypto';
import { spawnSync } from 'child_process';
import { join } from 'path';
import { Client } from 'pg';
import { runMigrations, seedGlobal } from '@ledgerpro/db';

function log(msg: string) {
  console.log(`[start] ${msg}`);
}

function tidy(raw: string): URL {
  const u = new URL(raw.trim());
  u.hostname = u.hostname.replace('-pooler.', '.'); // LedgerPro needs a direct (non-pooled) connection
  u.searchParams.delete('channel_binding');
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname) && !u.searchParams.get('sslmode')) u.searchParams.set('sslmode', 'require');
  if (u.searchParams.get('sslmode') === 'require') u.searchParams.set('sslmode', 'verify-full');
  return u;
}

function userOf(url?: string): string | null {
  try {
    return url ? decodeURIComponent(new URL(url).username) : null;
  } catch {
    return null;
  }
}

async function main() {
  // The API must never connect as the database owner (the owner bypasses row-level security).
  // If only one connection string was pasted and it is the owner's, use it as the admin URL instead.
  const appUser = userOf(process.env.DATABASE_URL);
  if (process.env.DATABASE_URL && appUser !== 'ledger_app') {
    if (!process.env.DATABASE_ADMIN_URL) process.env.DATABASE_ADMIN_URL = process.env.DATABASE_URL;
    if (appUser === userOf(process.env.DATABASE_ADMIN_URL)) {
      log(`DATABASE_URL uses the owner login "${appUser}" - ignoring it; the restricted ledger_app login will be used`);
      delete process.env.DATABASE_URL;
    }
  }
  const raw = process.env.DATABASE_ADMIN_URL;
  if (!raw) {
    log('DATABASE_ADMIN_URL not set - starting the API directly');
    return start();
  }
  const admin = tidy(raw);
  process.env.DATABASE_ADMIN_URL = admin.toString();
  const derive = (purpose: string) => createHmac('sha256', decodeURIComponent(admin.password) + '|' + admin.hostname).update('ledgerpro:' + purpose).digest();

  if (!process.env.JWT_ACCESS_SECRET) {
    process.env.JWT_ACCESS_SECRET = Buffer.concat([derive('jwt-1'), derive('jwt-2')]).toString('base64url');
    log('JWT_ACCESS_SECRET not set - derived from the database password');
  }
  if (!process.env.ENCRYPTION_KEY) {
    process.env.ENCRYPTION_KEY = derive('encryption').toString('base64');
    log('ENCRYPTION_KEY not set - derived from the database password');
  }

  if (!process.env.DATABASE_URL) {
    const pw = derive('ledger_app').toString('base64url');
    const c = new Client({ connectionString: admin.toString(), connectionTimeoutMillis: 30000 });
    await c.connect();
    try {
      const exists = await c.query("select 1 from pg_roles where rolname = 'ledger_app'");
      // pw is base64url (letters, digits, - _) so it is safe inside the quoted literal
      if (exists.rowCount) await c.query(`ALTER ROLE ledger_app WITH LOGIN PASSWORD '${pw}'`);
      else await c.query(`CREATE ROLE ledger_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${pw}'`);
      const bad = await c.query("select 1 from pg_roles where rolname = 'ledger_app' and (rolsuper or rolbypassrls)");
      if (bad.rowCount) throw new Error('ledger_app must not bypass row-level security');
    } finally {
      await c.end();
    }
    const app = new URL(admin.toString());
    app.username = 'ledger_app';
    app.password = pw;
    process.env.DATABASE_URL = app.toString();
    log('database login ledger_app ready');
  }

  const r = await runMigrations(admin.toString());
  log(`migrations: ${r.applied.length} applied, ${r.skipped.length} already up to date`);
  await seedGlobal(admin.toString());
  log('reference data ready');

  if (process.env.LOAD_DEMO_DATA === 'true') {
    log('loading demo companies and users (LOAD_DEMO_DATA=true)');
    const res = spawnSync(process.execPath, [join(__dirname, 'seed-demo.js')], { stdio: 'inherit', env: process.env });
    if (res.status !== 0) throw new Error('loading demo data failed');
  }
  return start();
}

function start() {
  if (process.env.PORT && !process.env.API_PORT) process.env.API_PORT = process.env.PORT;
  require('../main');
}

main().catch((e) => {
  console.error('[start] failed: ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
