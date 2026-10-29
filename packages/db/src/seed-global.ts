/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Client } from 'pg';
import { ALL_PERMISSIONS, PERMISSIONS, DEFAULT_ROLES, BS_MONTH_DAYS, BS_MIN_YEAR, BS_MAX_YEAR, BS_PROVISIONAL_FROM, toAD } from '@ledgerpro/shared';
import { DEFAULT_POSTING_RULES } from './coa-templates';

const CURRENCIES = [
  ['NPR', 'Nepalese Rupee', 'Rs.'],
  ['AUD', 'Australian Dollar', 'A$'],
  ['USD', 'US Dollar', '$'],
  ['INR', 'Indian Rupee', '₹'],
  ['EUR', 'Euro', '€'],
  ['GBP', 'Pound Sterling', '£'],
  ['CNY', 'Chinese Yuan', '¥'],
  ['NZD', 'New Zealand Dollar', 'NZ$'], ['SGD', 'Singapore Dollar', 'S$'], ['CAD', 'Canadian Dollar', 'C$'], ['AED', 'UAE Dirham', 'AED'],
  ['ZAR', 'South African Rand', 'R'], ['SEK', 'Swedish Krona', 'kr'], ['DKK', 'Danish Krone', 'kr'], ['NOK', 'Norwegian Krone', 'kr'],
  ['PLN', 'Polish Zloty', 'zł'], ['CHF', 'Swiss Franc', 'CHF'], ['TRY', 'Turkish Lira', '₺'], ['MYR', 'Malaysian Ringgit', 'RM'],
  ['IDR', 'Indonesian Rupiah', 'Rp'], ['THB', 'Thai Baht', '฿'], ['PHP', 'Philippine Peso', '₱'], ['VND', 'Vietnamese Dong', '₫'],
  ['LKR', 'Sri Lankan Rupee', 'Rs'], ['BDT', 'Bangladeshi Taka', '৳'], ['PKR', 'Pakistani Rupee', 'Rs'], ['BTN', 'Bhutanese Ngultrum', 'Nu.'],
  ['JPY', 'Japanese Yen', '¥'], ['KRW', 'South Korean Won', '₩'], ['HKD', 'Hong Kong Dollar', 'HK$'], ['SAR', 'Saudi Riyal', 'SAR'],
  ['QAR', 'Qatari Riyal', 'QAR'], ['KWD', 'Kuwaiti Dinar', 'KWD'], ['OMR', 'Omani Rial', 'OMR'], ['BHD', 'Bahraini Dinar', 'BHD'],
  ['EGP', 'Egyptian Pound', 'E£'], ['NGN', 'Nigerian Naira', '₦'], ['KES', 'Kenyan Shilling', 'KSh'], ['GHS', 'Ghanaian Cedi', 'GH₵'],
  ['TZS', 'Tanzanian Shilling', 'TSh'], ['MXN', 'Mexican Peso', 'MX$'], ['BRL', 'Brazilian Real', 'R$'], ['ARS', 'Argentine Peso', 'AR$'],
  ['CLP', 'Chilean Peso', 'CLP$'], ['COP', 'Colombian Peso', 'COL$'],
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
    // Roles added after a company was created (HR Manager, Staff) are added to existing companies — never changed once present
    for (const key of ['HR_MANAGER', 'STAFF']) {
      const tpl = DEFAULT_ROLES.find((r) => r.key === key);
      if (!tpl) continue;
      const missing = await c.query('SELECT id FROM companies WHERE id NOT IN (SELECT company_id FROM roles WHERE key = $1)', [key]);
      for (const co of missing.rows) {
        const r = await c.query('INSERT INTO roles (company_id, key, name, description, requires_2fa, is_system) VALUES ($1,$2,$3,$4,$5,true) RETURNING id', [co.id, key, tpl.name, tpl.description, tpl.requires2fa]);
        for (const perm of tpl.permissions) await c.query('INSERT INTO role_permissions (company_id, role_id, permission_code) VALUES ($1,$2,$3)', [co.id, r.rows[0].id, perm]);
      }
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
