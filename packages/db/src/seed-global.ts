/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Client } from 'pg';
import { ALL_PERMISSIONS, PERMISSIONS, BS_MONTH_DAYS, BS_MIN_YEAR, BS_MAX_YEAR, BS_PROVISIONAL_FROM, toAD } from '@ledgerpro/shared';
import { DEFAULT_POSTING_RULES } from './coa-templates';

const CURRENCIES = [
  ['NPR', 'Nepalese Rupee', 'Rs.'],
  ['AUD', 'Australian Dollar', 'A$'],
  ['USD', 'US Dollar', '$'],
  ['INR', 'Indian Rupee', '₹'],
  ['EUR', 'Euro', '€'],
  ['GBP', 'Pound Sterling', '£'],
  ['CNY', 'Chinese Yuan', '¥'],
];
const UOMS = [
  ['PCS', 'Pieces'], ['BOX', 'Box'], ['CTN', 'Carton'], ['PKT', 'Packet'], ['KG', 'Kilogram'], ['G', 'Gram'],
  ['L', 'Litre'], ['ML', 'Millilitre'], ['M', 'Metre'], ['HR', 'Hour'], ['DAY', 'Day'], ['MTH', 'Month'], ['SET', 'Set'], ['PAIR', 'Pair'],
];

/** Idempotent global reference data: currencies, UoMs, permissions, BS calendar 2000–2100, posting rules. */
export async function seedGlobal(adminUrl: string): Promise<void> {
  const c = new Client({ connectionString: adminUrl });
  await c.connect();
  try {
    await c.query('BEGIN');
    for (const [code, name, sym] of CURRENCIES) {
      await c.query('INSERT INTO currencies (code, name, symbol) VALUES ($1,$2,$3) ON CONFLICT (code) DO NOTHING', [code, name, sym]);
    }
    for (const [code, name] of UOMS) {
      await c.query('INSERT INTO uoms (code, name) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING', [code, name]);
    }
    for (const p of ALL_PERMISSIONS) {
      await c.query('INSERT INTO permissions (code, description) VALUES ($1,$2) ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description', [p, PERMISSIONS[p]]);
    }
    const existing = Number((await c.query('SELECT count(*) FROM bs_calendar')).rows[0].count);
    if (existing === 0) {
      for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR; y++) {
        for (let m = 1; m <= 12; m++) {
          await c.query('INSERT INTO bs_calendar (bs_year, bs_month, days, ad_start, is_provisional) VALUES ($1,$2,$3,$4,$5)', [
            y, m, BS_MONTH_DAYS[y][m - 1], toAD(y, m, 1), y >= BS_PROVISIONAL_FROM,
          ]);
        }
      }
    }
    for (const [src, role, side, ref, desc] of DEFAULT_POSTING_RULES) {
      await c.query(
        `INSERT INTO posting_rules (company_id, source_type, role, side, account_ref, description) VALUES (NULL,$1,$2,$3,$4,$5)
         ON CONFLICT (company_id, source_type, role) DO UPDATE SET side = EXCLUDED.side, account_ref = EXCLUDED.account_ref, description = EXCLUDED.description`,
        [src, role, side, ref, desc],
      );
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    await c.end();
  }
}
