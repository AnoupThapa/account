import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types } from 'pg';
import type { DB } from './generated';

// Keep NUMERIC as strings (never floats) and DATE as 'YYYY-MM-DD' strings (AD, no timezone shifts).
types.setTypeParser(1700, (v) => v); // numeric
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(20, (v) => v); // int8 (bigint) as string

export function createDb(connectionString: string, max = 10): { db: Kysely<DB>; pool: Pool } {
  const pool = new Pool({ connectionString, max });
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
  return { db, pool };
}
