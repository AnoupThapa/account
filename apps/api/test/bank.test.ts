/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Bank reconciliation (docs/16): statement import, matching rules, create-from-statement, finishing, locking, permissions. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addMember, adminDb, closeApp, setupCompany, TestClient } from './helpers';

afterAll(closeApp);

let admin: TestClient, maker: TestClient, checker: TestClient, hr: TestClient, auditor: TestClient;
let bank: string, cash: string, sales: string;
let cust: { id: string }, sup: { id: string };
const ids: Record<string, string> = {};

async function post(type: string, id: string) {
  const s = await maker.post(`/documents/${type}/${id}/submit`);
  if (s.status !== 201) throw new Error(`submit failed: ${JSON.stringify(s.body)}`);
  if (s.body.status === 'POSTED') return;
  const req = (await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === id);
  const a = await checker.post(`/approvals/${req.id}/approve`, {});
  if (a.body.status !== 'POSTED') throw new Error(`approve failed: ${JSON.stringify(a.body)}`);
}
const receipt = async (amount: string, date: string, reference?: string) => {
  const r = await maker.post('/receipts', { date, contactId: cust.id, accountId: bank, amount, reference });
  expect(r.status).toBe(201);
  await post('RECEIPT', r.body.id);
  return r.body.id as string;
};
const L = (txnDate: string, description: string, moneyIn: string, moneyOut: string, extra: object = {}) => ({ txnDate, description, moneyIn, moneyOut, ...extra });
const lines = async (status = 'UNMATCHED') => (await maker.get(`/bank/accounts/${bank}/statement-lines?status=${status}`)).body as { id: string; description: string; amount: string; status: string }[];
const books = async (status = 'unmatched') => (await maker.get(`/bank/accounts/${bank}/book-lines?status=${status}`)).body as { id: string; amount: string; sourceNo: string | null; description: string; contactName: string | null }[];
const stmtId = async (desc: string, status = 'UNMATCHED') => (await lines(status)).find((l) => l.description.includes(desc))!.id;

beforeAll(async () => {
  ({ admin } = await setupCompany('NP', 'MIXED'));
  maker = await addMember(admin, ['ACCOUNTANT'], 'Mira Maker');
  checker = await addMember(admin, ['CHECKER'], 'Kiran Checker');
  hr = await addMember(admin, ['HR_MANAGER'], 'Hari HR');
  auditor = await addMember(admin, ['AUDITOR'], 'Asha Auditor');
  const accts = (await admin.get('/accounts')).body as { id: string; code: string }[];
  bank = accts.find((a) => a.code === '1121')!.id;
  cash = accts.find((a) => a.code === '1110')!.id;
  sales = accts.find((a) => a.code === '4100')!.id;
  cust = (await maker.post('/contacts', { type: 'CUSTOMER', name: 'Alpha Traders', pan: '600111222' })).body;
  sup = (await maker.post('/contacts', { type: 'SUPPLIER', name: 'Himal Supplies', pan: '600333444' })).body;
});

describe('books side: payments and receipts with descriptions', () => {
  it('lists posted receipts, payments and expenses that touched the bank account, with numbers, contacts and descriptions', async () => {
    ids.r1 = await receipt('5000', '2026-10-05', 'CHQ 778');
    const p = await maker.post('/payments', { date: '2026-10-06', contactId: sup.id, accountId: bank, amount: '1200', reference: 'Bill settlement' });
    await post('PAYMENT', p.body.id);
    const e = await maker.post('/expenses', { date: '2026-10-07', expenseKind: 'PAID', paidFromAccountId: bank, notes: 'Office tea', lines: [{ accountId: (await admin.get('/accounts')).body.find((a: { code: string }) => a.code === '5460').id, quantity: '1', unitPrice: '800' }] });
    await post('EXPENSE', e.body.id);
    ids.r2 = await receipt('300', '2026-10-20');
    ids.r3 = await receipt('400', '2026-10-21');
    ids.r4 = await receipt('600', '2026-10-21');
    const b = await books();
    expect(b.map((x) => x.amount).sort()).toEqual(['-1200.00', '-800.00', '300.00', '400.00', '5000.00', '600.00']);
    const r1 = b.find((x) => x.amount === '5000.00')!;
    expect(r1).toMatchObject({ contactName: 'Alpha Traders', sourceType: 'RECEIPT' });
    expect(r1.description).toContain('CHQ 778');
    expect(r1.sourceNo).toMatch(/^RV/);
  });
  it('a cancelled receipt and its reversal disappear from the books list', async () => {
    const id = await receipt('77', '2026-10-08');
    expect((await books()).some((x) => x.amount === '77.00')).toBe(true);
    const corr = await maker.post('/corrections', { targetType: 'RECEIPT', targetId: id, correctionDate: '2026-10-08', reason: 'Entered twice' });
    const req = (await checker.get('/approvals')).body.find((x: { doc_id: string }) => x.doc_id === corr.body.id);
    await checker.post(`/approvals/${req.id}/approve`, {});
    expect((await books()).some((x) => x.amount === '77.00' || x.amount === '-77.00')).toBe(false);
  });
});

describe('statement import', () => {
  it('imports lines, then skips duplicates when the same file is uploaded again', async () => {
    const file = [
      L('2026-10-05', 'CHQ DEP 778 Alpha', '5000.00', '0.00', { chequeNo: '778' }),
      L('2026-10-06', 'IPS to Himal Supplies', '0.00', '1200.00'),
      L('2026-10-07', 'POS Office tea', '0.00', '800.00'),
      L('2026-10-25', 'Deposit', '300.00', '0.00'),
      L('2026-10-22', 'Online deposit 1000', '1000.00', '0.00'),
      L('2026-10-28', 'SMS charges', '0.00', '75.00'),
      L('2026-10-28', 'Unknown deposit', '10.00', '0.00'),
      L('2026-10-29', 'Bank fee', '0.00', '5.00'),
      L('2026-10-29', 'Bank fee', '0.00', '5.00'),
    ];
    const r = await maker.post(`/bank/accounts/${bank}/import`, { fileName: 'oct.csv', lines: file });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ total: 9, imported: 9, skipped: 0 });
    const again = await maker.post(`/bank/accounts/${bank}/import`, { fileName: 'oct.csv', lines: file });
    expect(again.body).toMatchObject({ imported: 0, skipped: 9 });
    expect((await lines()).length).toBe(9); // two identical fees on one day are both kept
  });
  it('rejects a line with both money in and out, and non-bank accounts', async () => {
    const bad = await maker.post(`/bank/accounts/${bank}/import`, { lines: [L('2026-10-30', 'x', '5', '5')] });
    expect(bad.body.code).toBe('BANK_IMPORT_FORMAT');
    const notBank = await maker.post(`/bank/accounts/${sales}/import`, { lines: [L('2026-10-30', 'x', '5', '0')] });
    expect(notBank.body.code).toBe('BANK_NOT_BANK_ACCOUNT');
  });
});

describe('matching', () => {
  it('auto-match applies reference and date+amount matches but only suggests amount-only ones', async () => {
    const a = await maker.post(`/bank/accounts/${bank}/auto-match`);
    expect(a.body).toMatchObject({ applied: 3 }); // cheque 778, Himal payment, office tea
    const left = (await lines()).map((l) => l.description);
    expect(left).not.toContain('CHQ DEP 778 Alpha');
    const sug = (await maker.get(`/bank/accounts/${bank}/suggestions`)).body as { tier: string; auto: boolean }[];
    expect(sug.some((s) => s.tier === 'AMOUNT' && !s.auto)).toBe(true);
    expect(sug.every((s) => !s.auto)).toBe(true);
  });
  it('manual one-to-one match, and unequal totals are refused', async () => {
    const b = await books();
    const s300 = await stmtId('Deposit');
    const wrong = b.find((x) => x.amount === '400.00')!;
    const bad = await maker.post(`/bank/accounts/${bank}/match`, { statementLineIds: [s300], journalLineIds: [wrong.id] });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('BANK_MATCH_UNBALANCED');
    const ok = await maker.post(`/bank/accounts/${bank}/match`, { statementLineIds: [s300], journalLineIds: [b.find((x) => x.amount === '300.00')!.id] });
    expect(ok.status).toBe(201);
  });
  it('many-to-one: two receipts (400 + 600) match one bank deposit of 1000', async () => {
    const b = await books();
    const s = await stmtId('Online deposit');
    const ok = await maker.post(`/bank/accounts/${bank}/match`, { statementLineIds: [s], journalLineIds: b.filter((x) => ['400.00', '600.00'].includes(x.amount)).map((x) => x.id) });
    expect(ok.status).toBe(201);
    expect(ok.body.total).toBe('1000.00');
  });
  it('a line cannot be matched twice', async () => {
    const m = (await maker.get(`/bank/accounts/${bank}/matches`)).body as { statement: { id: string }[]; books: { id: string }[] }[];
    const used = m[0];
    const again = await maker.post(`/bank/accounts/${bank}/match`, { statementLineIds: [used.statement[0].id], journalLineIds: [used.books[0].id] });
    expect(again.body.code).toBe('BANK_ALREADY_MATCHED');
  });
  it('the database itself refuses an unbalanced match, even if the API is bypassed', async () => {
    const db = await adminDb();
    try {
      const co = (await db.query('SELECT company_id, id FROM bank_match_groups LIMIT 1')).rows[0];
      await db.query('BEGIN');
      const g = (await db.query('INSERT INTO bank_match_groups (company_id, account_id, method, created_by) SELECT company_id, account_id, $2, created_by FROM bank_match_groups WHERE id = $1 RETURNING id', [co.id, 'MANUAL'])).rows[0];
      const sl = (await db.query("SELECT id, money_in - money_out AS amt FROM bank_statement_lines WHERE status = 'UNMATCHED' AND company_id = $1 LIMIT 1", [co.company_id])).rows[0];
      await db.query('INSERT INTO reconciliation_matches (company_id, group_id, statement_line_id, amount) VALUES ($1,$2,$3,$4)', [co.company_id, g.id, sl.id, sl.amt]);
      await expect(db.query('COMMIT')).rejects.toThrow(/BANK_MATCH_UNBALANCED/);
    } finally {
      await db.query('ROLLBACK').catch(() => undefined);
      await db.end();
    }
  });
});

describe('create from a statement line', () => {
  it('bank charge: drafts a journal to Bank Charges, goes through maker–checker, then matches itself', async () => {
    const id = await stmtId('SMS charges');
    const r = await maker.post(`/bank/lines/${id}/journal`, { kind: 'CHARGE' });
    expect(r.status).toBe(201);
    expect(r.body.submit.status).toBe('SUBMITTED');
    // still waiting for the checker
    expect((await lines()).find((l) => l.id === id)).toMatchObject({ status: 'UNMATCHED', pendingDoc: { type: 'MANUAL_JOURNAL', status: 'SUBMITTED' } });
    const req = (await checker.get('/approvals')).body.find((x: { doc_id: string }) => x.doc_id === r.body.journalId);
    expect((await maker.post(`/approvals/${req.id}/approve`, {})).status).toBeGreaterThanOrEqual(400); // maker cannot approve own entry
    await checker.post(`/approvals/${req.id}/approve`, {});
    expect((await lines('ALL')).find((l) => l.id === id)).toMatchObject({ status: 'MATCHED' });
    const gl = (await admin.get(`/journals/${r.body.journalId}`)).body;
    expect(gl.lines.map((x: { account_code: string }) => x.account_code).sort()).toEqual(['1121', '5620']);
  });
  it('unidentified deposit goes to the Suspense account', async () => {
    const id = await stmtId('Unknown deposit');
    const r = await maker.post(`/bank/lines/${id}/journal`, { kind: 'UNIDENTIFIED' });
    const req = (await checker.get('/approvals')).body.find((x: { doc_id: string }) => x.doc_id === r.body.journalId);
    await checker.post(`/approvals/${req.id}/approve`, {});
    expect((await lines('ALL')).find((l) => l.id === id)).toMatchObject({ status: 'MATCHED' });
    const gl = (await admin.get(`/journals/${r.body.journalId}`)).body;
    expect(gl.lines.map((x: { account_code: string }) => x.account_code).sort()).toEqual(['1121', '9100']);
  });
  it('link a receipt made for the line: wrong amount refused, right amount matches once posted', async () => {
    await maker.post(`/bank/accounts/${bank}/import`, { lines: [L('2026-10-30', 'NEFT Alpha Traders', '2500.00', '0.00')] });
    const id = await stmtId('NEFT Alpha');
    const wrong = await maker.post('/receipts', { date: '2026-10-30', contactId: cust.id, accountId: bank, amount: '2400' });
    expect((await maker.post(`/bank/lines/${id}/link-doc`, { docType: 'RECEIPT', docId: wrong.body.id })).status).toBe(422);
    const good = await maker.post('/receipts', { date: '2026-10-30', contactId: cust.id, accountId: bank, amount: '2500' });
    const linked = await maker.post(`/bank/lines/${id}/link-doc`, { docType: 'RECEIPT', docId: good.body.id });
    expect(linked.body).toMatchObject({ linked: true, matched: false });
    await post('RECEIPT', good.body.id);
    expect((await lines('ALL')).find((l) => l.id === id)).toMatchObject({ status: 'MATCHED' });
  });
});

describe('ignore, finish and lock', () => {
  it('ignore needs a reason and can be undone', async () => {
    const id = await stmtId('Bank fee');
    expect((await maker.post(`/bank/lines/${id}/ignore`, { reason: '' })).status).toBe(422);
    expect((await maker.post(`/bank/lines/${id}/ignore`, { reason: 'Bank will refund' })).status).toBe(201);
    expect((await lines('IGNORED')).length).toBe(1);
    expect((await maker.post(`/bank/lines/${id}/unignore`)).status).toBe(201);
    await maker.post(`/bank/lines/${id}/ignore`, { reason: 'Bank will refund' });
  });
  it('cannot finish while a statement line is unmatched, or with a wrong closing balance', async () => {
    const open = await maker.post(`/bank/accounts/${bank}/finish`, { statementDate: '2026-10-30', statementBalance: '1' });
    expect(open.body.code).toBe('BANK_RECON_DIFFERENCE');
    const ignored = (await lines('IGNORED'))[0];
    await maker.post(`/bank/lines/${(await lines()).find((l) => l.description === 'Bank fee')!.id}/ignore`, { reason: 'Bank will refund' });
    expect(ignored).toBeTruthy();
    expect((await lines()).length).toBe(0);
    const wrong = await maker.post(`/bank/accounts/${bank}/finish`, { statementDate: '2026-10-30', statementBalance: '1.00' });
    expect(wrong.body.code).toBe('BANK_RECON_DIFFERENCE');
  });
  it('preview shows the maths; finishing at the right balance saves a reconciliation and locks the matches', async () => {
    // books: 5000-1200-800+300+400+600-75+10+2500 = 6735 ; the two ignored 5.00 fees are on the statement only → statement = 6735 - 10
    const p = await maker.get(`/bank/accounts/${bank}/reconcile-preview?date=2026-10-30&balance=6725.00`);
    expect(p.body).toMatchObject({ bookBalance: '6735.00', unmatchedStatementNet: '-10.00', difference: '0.00', canFinish: true });
    const f = await maker.post(`/bank/accounts/${bank}/finish`, { statementDate: '2026-10-30', statementBalance: '6725.00', note: 'October' });
    expect(f.status).toBe(201);
    expect(f.body.groupsLocked).toBeGreaterThan(5);
    const stmt = await maker.get(`/bank/reconciliations/${f.body.id}`);
    expect(stmt.body).toMatchObject({ statement_balance: '6725.00', difference: '0.00', note: 'October' });
    const h = (await maker.get(`/bank/accounts/${bank}/reconciliations`)).body;
    expect(h.length).toBe(1);
  });
  it('matches in a finished reconciliation are locked: un-matching needs bank.unreconcile', async () => {
    const m = (await maker.get(`/bank/accounts/${bank}/matches`)).body as { id: string; reconciled: boolean }[];
    expect(m.every((x) => x.reconciled)).toBe(true);
    const denied = await maker.post(`/bank/matches/${m[0].id}/unmatch`);
    expect(denied.body.code).toBe('BANK_ALREADY_RECONCILED');
    // even a direct database delete is refused
    const db = await adminDb();
    await expect(db.query('DELETE FROM reconciliation_matches WHERE group_id = $1', [m[0].id])).rejects.toThrow(/BANK_ALREADY_RECONCILED/);
    await db.end();
    const ok = await admin.post(`/bank/matches/${m[0].id}/unmatch`);
    expect(ok.body).toMatchObject({ ok: true, wasReconciled: true });
    expect((await lines()).length).toBe(1); // the un-matched line is open again
  });
});

describe('permissions and isolation', () => {
  it('HR manager and users without bank permissions are refused', async () => {
    for (const c of [hr]) {
      expect((await c.get('/bank/accounts')).status).toBe(403);
      expect((await c.get(`/bank/accounts/${bank}/statement-lines`)).status).toBe(403);
      expect((await c.post(`/bank/accounts/${bank}/import`, { lines: [L('2026-10-30', 'x', '5', '0')] })).status).toBe(403);
    }
  });
  it('auditor can look but not change', async () => {
    expect((await auditor.get('/bank/accounts')).status).toBe(200);
    expect((await auditor.post(`/bank/accounts/${bank}/auto-match`)).status).toBe(403);
    expect((await auditor.post(`/bank/accounts/${bank}/import`, { lines: [L('2026-10-30', 'x', '5', '0')] })).status).toBe(403);
  });
  it("another company cannot see or touch this company's bank data", async () => {
    const { admin: other } = await setupCompany('AU', 'MIXED');
    const mine = (await other.get('/bank/accounts')).body as { id: string; unmatchedStatement: number }[];
    expect(mine.every((a) => a.unmatchedStatement === 0)).toBe(true);
    expect((await other.get(`/bank/accounts/${bank}/statement-lines`)).status).toBe(404);
    const anId = (await lines('ALL'))[0].id;
    expect((await other.post(`/bank/lines/${anId}/ignore`, { reason: 'trying it' })).status).toBe(404);
  });
  it('overview lists bank, cash and wallet accounts with balances', async () => {
    const o = (await maker.get('/bank/accounts')).body as { id: string; bookBalance: string; lastReconciled: { date: string } | null }[];
    const b = o.find((a) => a.id === bank)!;
    expect(b.bookBalance).toBe('6735.00');
    expect(b.lastReconciled?.date).toBe('2026-10-30');
    expect(o.some((a) => a.id === cash)).toBe(true);
  });
});
