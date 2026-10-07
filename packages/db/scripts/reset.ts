/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Client } from 'pg';
import { runMigrations, seedGlobal } from '../src';

/** DEV/TEST ONLY: drop and recreate the public schema, then migrate + seed. Refuses in production. */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to reset a production database');
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await runMigrations(url);
  await seedGlobal(url);
  console.log('Database reset complete');
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
