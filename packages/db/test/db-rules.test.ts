/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/**
 * Database-level guarantees (docs/02 §2, phases.md Phase 0/1 acceptance):
 * these tests talk to PostgreSQL directly as the app role — i.e. they BYPASS the API —
 * and prove the database itself refuses to corrupt the books.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'pg';
import { runMigrations, seedGlobal } from '../src';

const ADMIN = process.env.TEST_DATABASE_ADMIN_URL!;
const APP = process.env.TEST_DATABASE_URL!;

let admin: Client;
let app: Client;
const ids: Record<string, string> = {};

async function asTenant<T>(company: string, user: string, fn: (c: Client) => Promise<T>, ledgerWriter = true): Promise<T> {
  await app.query('BEGIN');
  try {
    await app.query("SELECT set_config('app.company_id', $1, true), set_config('app.user_id', $2, true)", [company, user]);
    if (ledgerWriter) await app.query("SELECT set_config('app.ledger_writer', 'on', true)");
    const r = await fn(app);
    await app.query('COMMIT');
    return r;
  } catch (e) {
    await app.query('ROLLBACK');
    throw e;
  }
}

async function expectError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toThrow(new RegExp(code));
}

async function makeCompany(name: string): Promise<{ company: string; period: string; lockedPeriod: string; cash: string; sales: string; ar: string }> {
  const r = await admin.query(
    `INSERT INTO companies (name, country, base_currency, calendar_mode, fy_start_month, business_type)
     VALUES ($1, 'NP', 'NPR', 'BS', 4, 'SERVICE') RETURNING id`,
    [name],
  );
  const company = r.rows[0].id;
  const fy = (
    await admin.query(
      `INSERT INTO fiscal_years (company_id, label, start_date, end_date) VALUES ($1, '2083/84', '2026-07-17', '2027-07-16') RETURNING id`,
      [company],
    )
  ).rows[0].id;
  const period = (
    await admin.query(
      `INSERT INTO accounting_periods (company_id, fiscal_year_id, period_no, name, start_date, end_date)
       VALUES ($1,$2,3,'Ashwin 2083','2026-09-17','2026-10-17') RETURNING id`,
      [company, fy],
    )
  ).rows[0].id;
  const lockedPeriod = (
    await admin.query(
      `INSERT INTO accounting_periods (company_id, fiscal_year_id, period_no, name, start_date, end_date, is_locked)
       VALUES ($1,$2,1,'Shrawan 2083','2026-07-17','2026-08-16', true) RETURNING id`,
      [company, fy],
    )
  ).rows[0].id;
  const acct = async (code: string, name: string, cls: string, extra = '') =>
    (
      await admin.query(
        `INSERT INTO accounts (company_id, code, name, class ${extra ? ', requires_contact, is_control' : ''})
         VALUES ($1,$2,$3,$4 ${extra ? ', true, true' : ''}) RETURNING id`,
        [company, code, name, cls],
      )
    ).rows[0].id;
  return {
    company,
    period,
    lockedPeriod,
    cash: await acct('1110', 'Cash', 'ASSET'),
    sales: await acct('4200', 'Sales', 'INCOME'),
    ar: await acct('1140', 'AR', 'ASSET', 'control'),
  };
}

function insertEntry(c: Client, company: string, period: string, user: string, date = '2026-10-01', total = '100.00') {
  return c.query(
    `INSERT INTO journal_entries (company_id, entry_no, entry_date, period_id, source_type, total, posted_by)
     VALUES ($1, 'JE-' || substr(md5(random()::text), 1, 10), $2, $3, 'MANUAL', $4, $5) RETURNING id`,
    [company, date, period, total, user],
  );
}
function insertLine(c: Client, entry: string, company: string, n: number, account: string, dr: string, cr: string, contact: string | null = null) {
  return c.query(
    `INSERT INTO journal_lines (entry_id, company_id, line_no, account_id, debit, credit, currency_code, contact_id, entry_date)
     VALUES ($1,$2,$3,$4,$5,$6,'NPR',$7,'2026-10-01')`,
    [entry, company, n, account, dr, cr, contact],
  );
}

let A: Awaited<ReturnType<typeof makeCompany>>;
let B: Awaited<ReturnType<typeof makeCompany>>;

beforeAll(async () => {
  admin = new Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await runMigrations(ADMIN, () => undefined);
  await seedGlobal(ADMIN);
  app = new Client({ connectionString: APP });
  await app.connect();
  ids.maker = (await admin.query(`INSERT INTO users (email, full_name, password_hash) VALUES ('maker@t.test','Maker','x') RETURNING id`)).rows[0].id;
  ids.checker = (await admin.query(`INSERT INTO users (email, full_name, password_hash) VALUES ('checker@t.test','Checker','x') RETURNING id`)).rows[0].id;
  A = await makeCompany('Company A');
  B = await makeCompany('Company B');
  ids.custA = (await admin.query(`INSERT INTO contacts (company_id, type, code, name) VALUES ($1,'CUSTOMER','C1','Cust') RETURNING id`, [A.company])).rows[0].id;
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
});

describe('balanced entries (enforced by the database)', () => {
  it('accepts a balanced entry', async () => {
    await asTenant(A.company, ids.maker, async (c) => {
      const e = (await insertEntry(c, A.company, A.period, ids.maker)).rows[0].id;
      await insertLine(c, e, A.company, 1, A.cash, '100.00', '0');
      await insertLine(c, e, A.company, 2, A.sales, '0', '100.00');
    });
  });

  it('rejects an unbalanced entry at COMMIT even when the API is bypassed', async () => {
    await expectError(
      asTenant(A.company, ids.maker, async (c) => {
        const e = (await insertEntry(c, A.company, A.period, ids.maker)).rows[0].id;
        await insertLine(c, e, A.company, 1, A.cash, '100.00', '0');
        await insertLine(c, e, A.company, 2, A.sales, '0', '99.99');
      }),
      'ACC_UNBALANCED',
    );
  });

  it('rejects an entry with a single line or no lines', async () => {
    await expectError(asTenant(A.company, ids.maker, async (c) => { await insertEntry(c, A.company, A.period, ids.maker); }), 'ACC_UNBALANCED');
  });

  it('rejects a line that is both debit and credit, or negative', async () => {
    await expect(
      asTenant(A.company, ids.maker, async (c) => {
        const e = (await insertEntry(c, A.company, A.period, ids.maker)).rows[0].id;
        await insertLine(c, e, A.company, 1, A.cash, '100.00', '100.00');
      }),
    ).rejects.toThrow(/check constraint/);
    await expect(
      asTenant(A.company, ids.maker, async (c) => {
        const e = (await insertEntry(c, A.company, A.period, ids.maker)).rows[0].id;
        await insertLine(c, e, A.company, 1, A.cash, '-5', '0');
      }),
    ).rejects.toThrow(/check constraint/);
  });

  it('rejects journal writes from outside the ledger service', async () => {
    await expectError(
      asTenant(A.company, ids.maker, async (c) => { await insertEntry(c, A.company, A.period, ids.maker); }, false),
      'ACC_IMMUTABLE',
    );
  });
});

describe('immutability of posted ledger rows', () => {
  let entryId: string;
  beforeAll(async () => {
    entryId = await asTenant(A.company, ids.maker, async (c) => {
      const e = (await insertEntry(c, A.company, A.period, ids.maker, '2026-10-01', '50.00')).rows[0].id;
      await insertLine(c, e, A.company, 1, A.cash, '50.00', '0');
      await insertLine(c, e, A.company, 2, A.sales, '0', '50.00');
      return e;
    });
  });

  it('app role cannot UPDATE or DELETE journal lines (no privilege)', async () => {
    await expect(asTenant(A.company, ids.maker, (c) => c.query('UPDATE journal_lines SET debit = 1 WHERE entry_id = $1', [entryId]))).rejects.toThrow(/permission denied/);
    await expect(asTenant(A.company, ids.maker, (c) => c.query('DELETE FROM journal_lines WHERE entry_id = $1', [entryId]))).rejects.toThrow(/permission denied/);
  });

  it('even the schema owner cannot UPDATE/DELETE posted lines (trigger)', async () => {
    await expectError(admin.query('UPDATE journal_lines SET description = $2 WHERE entry_id = $1', [entryId, 'x']), 'ACC_IMMUTABLE');
    await expectError(admin.query('DELETE FROM journal_lines WHERE entry_id = $1', [entryId]), 'ACC_IMMUTABLE');
    await expectError(admin.query('DELETE FROM journal_entries WHERE id = $1', [entryId]), 'ACC_IMMUTABLE');
  });

  it('cannot change an entry except POSTED → REVERSED, and cannot add lines later', async () => {
    await expect(asTenant(A.company, ids.maker, (c) => c.query(`UPDATE journal_entries SET narration = 'edited' WHERE id = $1`, [entryId]))).rejects.toThrow(/permission denied/);
    await expectError(
      asTenant(A.company, ids.maker, async (c) => {
        await insertLine(c, entryId, A.company, 3, A.cash, '10', '0');
        await insertLine(c, entryId, A.company, 4, A.sales, '0', '10');
      }),
      'ACC_IMMUTABLE',
    );
  });
});

describe('period locks', () => {
  it('rejects posting into a locked period', async () => {
    await expectError(
      asTenant(A.company, ids.maker, async (c) => {
        const e = (await insertEntry(c, A.company, A.lockedPeriod, ids.maker, '2026-08-01')).rows[0].id;
        await insertLine(c, e, A.company, 1, A.cash, '100.00', '0');
        await insertLine(c, e, A.company, 2, A.sales, '0', '100.00');
      }),
      'ACC_PERIOD_LOCKED',
    );
  });
  it('rejects an entry dated outside its period', async () => {
    await expectError(asTenant(A.company, ids.maker, (c) => insertEntry(c, A.company, A.period, ids.maker, '2026-12-01')), 'ACC_NO_FISCAL_YEAR');
  });
});

describe('control accounts', () => {
  it('requires a contact on AR control lines', async () => {
    await expectError(
      asTenant(A.company, ids.maker, async (c) => {
        const e = (await insertEntry(c, A.company, A.period, ids.maker)).rows[0].id;
        await insertLine(c, e, A.company, 1, A.ar, '100.00', '0');
        await insertLine(c, e, A.company, 2, A.sales, '0', '100.00');
      }),
      'ACC_CONTROL_ACCOUNT',
    );
    await asTenant(A.company, ids.maker, async (c) => {
      const e = (await insertEntry(c, A.company, A.period, ids.maker)).rows[0].id;
      await insertLine(c, e, A.company, 1, A.ar, '100.00', '0', ids.custA);
      await insertLine(c, e, A.company, 2, A.sales, '0', '100.00');
    });
  });
});

describe('maker ≠ checker (database)', () => {
  it('rejects a document approved by its creator', async () => {
    await expectError(
      asTenant(A.company, ids.maker, (c) =>
        c.query(`INSERT INTO manual_journals (company_id, journal_date, narration, created_by, approved_by, status)
                 VALUES ($1, '2026-10-01', 'x', $2, $2, 'APPROVED')`, [A.company, ids.maker]),
      ),
      'APR_SELF_APPROVAL',
    );
  });
  it('accepts approval by a different user', async () => {
    await asTenant(A.company, ids.maker, (c) =>
      c.query(`INSERT INTO manual_journals (company_id, journal_date, narration, created_by, approved_by, status)
               VALUES ($1, '2026-10-01', 'x', $2, $3, 'APPROVED')`, [A.company, ids.maker, ids.checker]),
    );
  });
  it('allows self-approval only when the company enables it', async () => {
    await admin.query('UPDATE companies SET self_approval_allowed = true WHERE id = $1', [B.company]);
    await asTenant(B.company, ids.maker, (c) =>
      c.query(`INSERT INTO manual_journals (company_id, journal_date, narration, created_by, approved_by, status)
               VALUES ($1, '2026-10-01', 'x', $2, $2, 'APPROVED')`, [B.company, ids.maker]),
    );
  });
});

describe('posted documents are immutable', () => {
  it('blocks edits and deletion of a posted document, allows status → CANCELLED with reason', async () => {
    const id = await asTenant(A.company, ids.maker, async (c) => {
      const r = await c.query(
        `INSERT INTO manual_journals (company_id, journal_date, narration, created_by, approved_by, status, doc_no)
         VALUES ($1, '2026-10-01', 'posted', $2, $3, 'POSTED', 'JV-T-1') RETURNING id`,
        [A.company, ids.maker, ids.checker],
      );
      return r.rows[0].id;
    });
    await expectError(asTenant(A.company, ids.maker, (c) => c.query(`UPDATE manual_journals SET narration = 'changed' WHERE id = $1`, [id])), 'ACC_IMMUTABLE');
    await expectError(asTenant(A.company, ids.maker, (c) => c.query(`DELETE FROM manual_journals WHERE id = $1`, [id])), 'ACC_IMMUTABLE');
    await expectError(asTenant(A.company, ids.maker, (c) => c.query(`UPDATE manual_journals SET status = 'CANCELLED' WHERE id = $1`, [id])), 'VAL_FIELD');
    await asTenant(A.company, ids.maker, (c) => c.query(`UPDATE manual_journals SET status = 'CANCELLED', cancel_reason = 'dup' WHERE id = $1`, [id]));
    await expectError(asTenant(A.company, ids.maker, (c) => c.query(`UPDATE manual_journals SET status = 'POSTED' WHERE id = $1`, [id])), 'APR_INVALID_STATE');
  });
});

describe('tenant isolation (RLS)', () => {
  it('company A context cannot see company B rows', async () => {
    const rows = await asTenant(A.company, ids.maker, async (c) => (await c.query('SELECT company_id FROM accounts')).rows);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.company_id === A.company)).toBe(true);
    const bAccounts = await asTenant(A.company, ids.maker, async (c) => (await c.query('SELECT * FROM accounts WHERE company_id = $1', [B.company])).rows);
    expect(bAccounts).toHaveLength(0);
  });
  it('company A context cannot insert rows for company B', async () => {
    await expect(
      asTenant(A.company, ids.maker, (c) => c.query(`INSERT INTO contacts (company_id, type, code, name) VALUES ($1,'CUSTOMER','X','X')`, [B.company])),
    ).rejects.toThrow(/row-level security/);
  });
  it('no tenant context = no rows', async () => {
    const r = await app.query('SELECT count(*)::int AS n FROM journal_lines');
    expect(r.rows[0].n).toBe(0);
  });
  it('every table with company_id has RLS enabled', async () => {
    const r = await admin.query(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_name = c.relname AND col.column_name = 'company_id')
        AND NOT c.relrowsecurity`);
    expect(r.rows.map((x) => x.relname)).toEqual([]);
  });
});

describe('audit log hash chain', () => {
  it('chains rows, verifies, and is append-only', async () => {
    await asTenant(A.company, ids.maker, async (c) => {
      for (let i = 0; i < 5; i++) {
        await c.query(`INSERT INTO audit_logs (company_id, user_id, action, entity, after, hash) VALUES ($1,$2,'CREATE','test',$3,'')`, [
          A.company, ids.maker, JSON.stringify({ i }),
        ]);
      }
    });
    const v = await asTenant(A.company, ids.maker, async (c) => (await c.query('SELECT * FROM verify_audit_chain($1)', [A.company])).rows[0]);
    expect(Number(v.rows_checked)).toBeGreaterThanOrEqual(5);
    expect(v.first_broken_id).toBeNull();
    await expect(asTenant(A.company, ids.maker, (c) => c.query('UPDATE audit_logs SET action = $1', ['X']))).rejects.toThrow(/permission denied/);
    await expectError(admin.query(`UPDATE audit_logs SET action = 'TAMPER'`), 'ACC_IMMUTABLE');
    await expectError(admin.query('DELETE FROM audit_logs'), 'ACC_IMMUTABLE');
  });

  it('detects tampering (simulated by disabling the guard as superuser-equivalent owner)', async () => {
    await admin.query('ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_immutable');
    await admin.query(`UPDATE audit_logs SET after = '{"i":999}' WHERE id = (SELECT min(id) FROM audit_logs WHERE company_id = $1)`, [A.company]);
    await admin.query('ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_immutable');
    const v = await asTenant(A.company, ids.maker, async (c) => (await c.query('SELECT * FROM verify_audit_chain($1)', [A.company])).rows[0]);
    expect(v.first_broken_id).not.toBeNull();
  });
});

describe('tax rates', () => {
  it('rejects overlapping effective-dated rates for the same tax code', async () => {
    const code = (await admin.query(`INSERT INTO tax_codes (company_id, code, name, type) VALUES ($1,'VAT13','VAT','STANDARD') RETURNING id`, [A.company])).rows[0].id;
    await admin.query(`INSERT INTO tax_rates (company_id, tax_code_id, rate, effective_from, effective_to) VALUES ($1,$2,13,'2020-01-01','2026-12-31')`, [A.company, code]);
    await expect(admin.query(`INSERT INTO tax_rates (company_id, tax_code_id, rate, effective_from) VALUES ($1,$2,15,'2026-06-01')`, [A.company, code])).rejects.toThrow(/conflicting key/);
    await admin.query(`INSERT INTO tax_rates (company_id, tax_code_id, rate, effective_from) VALUES ($1,$2,15,'2027-01-01')`, [A.company, code]);
  });
});

describe('account period balances', () => {
  it('snapshot equals the sum of ledger lines', async () => {
    const r = await admin.query(`
      SELECT (SELECT coalesce(sum(debit),0) - coalesce(sum(credit),0) FROM journal_lines WHERE company_id = $1 AND account_id = $2) AS lines,
             (SELECT coalesce(sum(debit_total),0) - coalesce(sum(credit_total),0) FROM account_period_balances WHERE company_id = $1 AND account_id = $2) AS apb`,
      [A.company, A.cash]);
    expect(r.rows[0].lines).toBe(r.rows[0].apb);
    expect(r.rows[0].lines).toBe('150.00');
  });
});
