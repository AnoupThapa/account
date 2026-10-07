/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './generated';

// Keep NUMERIC as strings (never floats) and DATE as 'YYYY-MM-DD' strings (AD, no timezone shifts).
types.setTypeParser(1700, (v) => v); // numeric
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(20, (v) => v); // int8 (bigint) as string

export function createDb(connectionString: string, max = 10): { db: Kysely<DB>; pool: Pool } {
  // Short idle timeout + error handler: hosted databases (e.g. Neon) close idle connections when
  // they scale to zero; without a handler that would crash the process instead of just reconnecting.
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 20_000 });
  pool.on('error', (err) => console.warn('[db] idle connection closed by server:', err.message));
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool };
}
