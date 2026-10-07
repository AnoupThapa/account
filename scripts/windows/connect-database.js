/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
// Prepares a hosted PostgreSQL database (e.g. Neon) for LedgerPro.
// Input:  DATABASE_ADMIN_URL = the owner connection string from the provider.
// Does:   tidies the URL, checks the connection, creates/refreshes the restricted
//         "ledger_app" login (row-level security applies to it) with a new random password.
// Output: one JSON line {"adminUrl": ..., "appUrl": ...} on stdout.
'use strict';
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..', '..');
const { Client } = require(require.resolve('pg', { paths: [path.join(root, 'packages', 'db')] }));

function tidy(raw) {
  const u = new URL(raw.trim());
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('This is not a PostgreSQL connection string.');
  // LedgerPro needs a direct connection (not the "-pooler" address) for its per-transaction security settings.
  u.hostname = u.hostname.replace('-pooler.', '.');
  u.searchParams.delete('channel_binding');
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname);
  if (!local) u.searchParams.set('sslmode', 'verify-full');
  return u;
}

async function main() {
  const admin = tidy(process.env.DATABASE_ADMIN_URL || '');
  const c = new Client({ connectionString: admin.toString(), connectionTimeoutMillis: 30000 });
  await c.connect();
  try {
    const me = await c.query(
      "select current_user as u, r.rolcreaterole as cr, current_setting('server_version_num')::int as v from pg_roles r where r.rolname = current_user",
    );
    const { u, cr, v } = me.rows[0];
    if (v < 160000) throw new Error(`The database is PostgreSQL ${Math.floor(v / 10000)}; LedgerPro needs version 16 or newer.`);
    if (!cr) throw new Error(`The user "${u}" in this connection string cannot create logins. Use the owner connection string (e.g. neondb_owner).`);

    const pw = crypto.randomBytes(24).toString('base64url');
    const exists = await c.query("select 1 from pg_roles where rolname = 'ledger_app'");
    // password is base64url (letters, digits, - and _) so it is safe inside the quoted literal
    if (exists.rowCount) await c.query(`ALTER ROLE ledger_app WITH LOGIN PASSWORD '${pw}'`);
    else await c.query(`CREATE ROLE ledger_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${pw}'`);
    const bad = await c.query("select 1 from pg_roles where rolname = 'ledger_app' and (rolsuper or rolbypassrls)");
    if (bad.rowCount) throw new Error('The ledger_app login must not bypass row-level security. Remove that setting in the database first.');

    const app = new URL(admin.toString());
    app.username = 'ledger_app';
    app.password = pw;
    process.stdout.write(JSON.stringify({ adminUrl: admin.toString(), appUrl: app.toString() }) + '\n');
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error('Database connection problem: ' + e.message);
  process.exit(1);
});
