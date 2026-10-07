/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Kysely, Transaction, sql } from 'kysely';
import { Pool } from 'pg';
import { createDb, DB } from '@ledgerpro/db';
import { config } from '../config';

export type Tx = Transaction<DB>;

/**
 * All tenant data access runs inside a transaction with app.company_id / app.user_id set,
 * so PostgreSQL row-level security isolates companies even if a query forgets a filter.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Kysely<DB>;
  private readonly pool: Pool;

  constructor() {
    const { db, pool } = createDb(config().DATABASE_URL, 20);
    this.db = db;
    this.pool = pool;
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }

  /** Tenant-scoped transaction (RLS enforced for `companyId`). */
  tenant<T>(companyId: string, userId: string | null, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.company_id', ${companyId}, true), set_config('app.user_id', ${userId ?? ''}, true)`.execute(trx);
      return fn(trx);
    });
  }

  /** User-scoped transaction with no company selected (login, company list). */
  user<T>(userId: string | null, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.user_id', ${userId ?? ''}, true)`.execute(trx);
      return fn(trx);
    });
  }

  /** Platform (super admin) transaction — only for provisioning companies and platform jobs. */
  platform<T>(userId: string | null, companyId: string | null, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('app.platform', 'on', true), set_config('app.user_id', ${userId ?? ''}, true),
                       set_config('app.company_id', ${companyId ?? ''}, true)`.execute(trx);
      return fn(trx);
    });
  }
}

/** Switch tenant inside an existing platform transaction (used while provisioning a new company). */
export async function setTenant(trx: Tx, companyId: string) {
  await sql`SELECT set_config('app.company_id', ${companyId}, true)`.execute(trx);
}
