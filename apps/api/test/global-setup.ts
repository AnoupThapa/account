/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Client } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export default async function setup() {
  const p = join(__dirname, '..', '..', '..', '.env');
  const src = existsSync(p) ? readFileSync(p, 'utf8') : readFileSync(p + '.example', 'utf8');
  for (const line of src.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
  const { runMigrations, seedGlobal } = await import('@ledgerpro/db');
  const url = process.env.TEST_DATABASE_ADMIN_URL!;
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await runMigrations(url, () => undefined);
  await seedGlobal(url);
}
