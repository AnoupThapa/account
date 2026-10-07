/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Phase 1 acceptance (docs/phases.md): core ledger, maker–checker, opening balances, TB/GL/Day Book. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addMember, closeApp, setupCompany, TestClient } from './helpers';

afterAll(closeApp);

let admin: TestClient;
let maker: TestClient;
let checker: TestClient;
let fm: TestClient;
let acct: Record<string, { id: string; code: string }>;

const byCode = (code: string) => Object.values(acct).find((a) => a.code === code)!.id;

async function journal(c: TestClient, lines: [string, string, string, string?][], date = '2026-10-01', narration = 'Test journal') {
  return c.post('/journals', {
    journalDate: date,
    narration,
    lines: lines.map(([code, debit, credit, contactId]) => ({ accountId: byCode(code), debit, credit, contactId })),
  });
}
async function submitAndApprove(id: string, approver = checker) {
  const s = await maker.post(`/documents/MANUAL_JOURNAL/${id}/submit`);
  if (s.status !== 201) throw new Error('submit failed ' + JSON.stringify(s.body));
  const q = (await approver.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === id);
  return approver.post(`/approvals/${q.id}/approve`, { comment: 'ok' });
}

beforeAll(async () => {
  ({ admin } = await setupCompany('NP', 'MIXED'));
  maker = await addMember(admin, ['ACCOUNTANT'], 'Maya Maker');
  checker = await addMember(admin, ['CHECKER'], 'Chandra Checker');
  fm = await addMember(admin, ['FINANCE_MANAGER'], 'Fatima FinanceMgr');
  const list = (await admin.get('/accounts')).body as { id: string; code: string; system_key: string }[];
  acct = Object.fromEntries(list.map((a) => [a.code, { id: a.id, code: a.code }]));
});

describe('chart of accounts & templates', () => {
  it('Mixed Nepal template has protected system accounts', async () => {
    const list = (await admin.get('/accounts')).body as { code: string; system_key: string; is_system: boolean; version: number; id: string }[];
    for (const k of ['AR_CONTROL', 'AP_CONTROL', 'OUTPUT_TAX', 'INPUT_TAX', 'RETAINED_EARNINGS', 'SUSPENSE_RECEIPTS', 'OPENING_BALANCE_EQUITY']) {
      expect(list.find((a) => a.system_key === k)?.is_system).toBe(true);
    }
    const ar = list.find((a) => a.system_key === 'AR_CONTROL')!;
    const r = await admin.patch(`/accounts/${ar.id}`, { name: 'Renamed', version: ar.version });
    expect(r.body.code).toBe('VAL_FIELD');
  });

  it('new account code must match its class range', async () => {
    const r = await admin.post('/accounts', { code: '4999', name: 'Wrong class', class: 'EXPENSE' });
    expect(r.body.code).toBe('VAL_FIELD');
    const ok = await admin.post('/accounts', { code: '5495', name: 'Software subscriptions', class: 'EXPENSE', parentId: byCode('5400') });
    expect(ok.status).toBe(201);
  });

  it('Nepal tax codes seeded: VAT 13% / 0% / Exempt; Admin-only rate changes with no overlap', async () => {
    const codes = (await admin.get('/tax-codes')).body as { id: string; code: string; rates: { rate: string }[] }[];
    expect(codes.find((c) => c.code === 'VAT13')!.rates[0].rate).toBe('13.0000');
    expect(codes.map((c) => c.code)).toEqual(expect.arrayContaining(['VAT13', 'VAT0', 'EXEMPT']));
    expect((await maker.post('/tax-codes', { code: 'X', name: 'x', type: 'STANDARD', rate: '5', effectiveFrom: '2026-01-01' })).status).toBe(403);
    await admin.stepUp();
    const vat = codes.find((c) => c.code === 'VAT13')!;
    const r = await admin.post(`/tax-codes/${vat.id}/rates`, { rate: '15', effectiveFrom: '2030-07-17' });
    expect(r.status).toBe(201);
    const after = (await admin.get('/tax-codes')).body.find((c: { code: string }) => c.code === 'VAT13');
    expect(after.rates).toHaveLength(2);
    expect(after.rates[1].effective_to).toBe('2030-07-16');
  });
});

describe('manual journals & maker–checker', () => {
  it('unbalanced journal is refused by the API with the difference', async () => {
    const r = await journal(maker, [['5410', '1000', '0'], ['1110', '0', '999.99']]);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('ACC_UNBALANCED');
    expect(r.body.detail).toContain('0.01');
  });

  it('maker cannot approve own journal (API); a checker can; number is gapless JV-2083/84-00001', async () => {
    const j = (await journal(maker, [['5410', '25000', '0'], ['1110', '0', '25000']], '2026-10-01', 'Rent for Ashwin')).body;
    await maker.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
    const queue = (await checker.get('/approvals')).body;
    const req = queue.find((r: { doc_id: string }) => r.doc_id === j.id);
    expect(req.canApprove).toBe(true);
    // the maker (no approve permission) and even an admin who created it cannot self-approve
    expect((await maker.post(`/approvals/${req.id}/approve`, {})).body.code).toBe('PERM_DENIED');
    const r = await checker.post(`/approvals/${req.id}/approve`, {});
    expect(r.body.status).toBe('POSTED');
    expect(r.body.docNo).toBe('JV-2083/84-00001');
    const posted = (await maker.get(`/journals/${j.id}`)).body;
    expect(posted.status).toBe('POSTED');
    expect(posted.journal_entry_id).toBeTruthy();
  });

  it('admin who is maker cannot approve their own entry (APR_SELF_APPROVAL)', async () => {
    const j = (await journal(admin, [['5420', '500', '0'], ['1110', '0', '500']])).body;
    await admin.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
    const req = (await admin.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === j.id);
    expect(req.canApprove).toBe(false);
    const r = await admin.post(`/approvals/${req.id}/approve`, {});
    expect(r.body.code).toBe('APR_SELF_APPROVAL');
    expect((await checker.post(`/approvals/${req.id}/approve`, {})).body.status).toBe('POSTED');
  });

  it('reject needs a reason; rejected → edit → back to draft → resubmit', async () => {
    const j = (await journal(maker, [['5430', '300', '0'], ['1110', '0', '300']])).body;
    await maker.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
    const req = (await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === j.id);
    expect((await checker.post(`/approvals/${req.id}/reject`, { reason: '' })).status).toBe(422);
    expect((await checker.post(`/approvals/${req.id}/reject`, { reason: 'Attach the receipt' })).body.status).toBe('REJECTED');
    const cur = (await maker.get(`/journals/${j.id}`)).body;
    const upd = await maker.patch(`/journals/${j.id}`, { journalDate: '2026-10-01', narration: 'Stationery (receipt attached)', version: cur.version, lines: [{ accountId: byCode('5430'), debit: '300', credit: '0' }, { accountId: byCode('1110'), debit: '0', credit: '300' }] });
    expect(upd.body.status).toBe('DRAFT');
    expect((await submitAndApprove(j.id)).body.status).toBe('POSTED');
    const hist = (await checker.get(`/documents/MANUAL_JOURNAL/${j.id}/history`)).body.map((h: { action: string }) => h.action);
    expect(hist).toEqual(['SUBMIT', 'REJECT', 'SUBMIT', 'APPROVE']);
  });

  it('editing a submitted journal sends it back to Draft', async () => {
    const j = (await journal(maker, [['5430', '10', '0'], ['1110', '0', '10']])).body;
    await maker.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
    const cur = (await maker.get(`/journals/${j.id}`)).body;
    expect(cur.status).toBe('SUBMITTED');
    const upd = await maker.patch(`/journals/${j.id}`, { journalDate: '2026-10-01', narration: 'changed', version: cur.version, lines: [{ accountId: byCode('5430'), debit: '11', credit: '0' }, { accountId: byCode('1110'), debit: '0', credit: '11' }] });
    expect(upd.body.status).toBe('DRAFT');
    expect((await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === j.id)).toBeUndefined();
  });

  it('posted journal cannot be edited or deleted; reversal works and links to the original', async () => {
    const j = (await journal(maker, [['5460', '1200', '0'], ['1110', '0', '1200']])).body;
    await submitAndApprove(j.id);
    const posted = (await maker.get(`/journals/${j.id}`)).body;
    const edit = await maker.patch(`/journals/${j.id}`, { journalDate: '2026-10-01', narration: 'x', version: posted.version, lines: [{ accountId: byCode('5460'), debit: '1', credit: '0' }, { accountId: byCode('1110'), debit: '0', credit: '1' }] });
    expect(edit.body.code).toBe('ACC_IMMUTABLE');
    expect((await maker.del(`/journals/${j.id}`)).body.code).toBe('ACC_IMMUTABLE');
    const corr = await maker.post('/corrections', { targetType: 'MANUAL_JOURNAL', targetId: j.id, correctionDate: '2026-10-02', reason: 'Booked to wrong account' });
    expect(corr.body.status).toBe('SUBMITTED');
    const req = (await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === corr.body.id);
    expect((await checker.post(`/approvals/${req.id}/approve`, {})).body.status).toBe('POSTED');
    const after = (await maker.get(`/journals/${j.id}`)).body;
    expect(after.status).toBe('REVERSED');
    const orig = (await checker.get(`/reports/entries/${posted.journal_entry_id}`)).body;
    expect(orig.status).toBe('REVERSED');
    const rev = (await checker.get(`/reports/entries/${orig.reversed_by_entry_id}`)).body;
    expect(rev.reversal_of).toBe(orig.id);
    expect(rev.lines[0].credit).toBe(orig.lines[0].debit);
  });

  it('posting into a locked period fails — and the failed attempt consumes no number (gapless)', async () => {
    const fy = (await admin.get('/fiscal-years')).body[0];
    const ashwin = fy.periods.find((p: { name: string }) => p.name === 'Ashwin 2083');
    const j = (await journal(maker, [['5410', '100', '0'], ['1110', '0', '100']], '2026-10-05')).body;
    await maker.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
    await fm.post(`/periods/${ashwin.id}/lock`);
    const req = (await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === j.id);
    const r = await checker.post(`/approvals/${req.id}/approve`, {});
    expect(r.body.code).toBe('ACC_PERIOD_LOCKED');
    expect(r.body.detail).toContain('Ashwin 2083');
    // submitting into a locked period is refused up-front too
    const j2 = (await journal(maker, [['5410', '100', '0'], ['1110', '0', '100']], '2026-10-06')).body;
    expect((await maker.post(`/documents/MANUAL_JOURNAL/${j2.id}/submit`)).body.code).toBe('ACC_PERIOD_LOCKED');
    await admin.stepUp();
    await admin.post(`/periods/${ashwin.id}/unlock`);
    const ok = await checker.post(`/approvals/${req.id}/approve`, {});
    expect(ok.body.status).toBe('POSTED');
    const nums = (await maker.get('/journals')).body.map((x: { doc_no: string }) => x.doc_no).filter(Boolean).sort();
    const n = nums.map((x: string) => Number(x.slice(-5)));
    expect(n).toEqual(Array.from({ length: n.length }, (_, i) => i + 1)); // 1..N, no gaps
  });

  it('control accounts need special permission and a contact', async () => {
    const r = await journal(maker, [['1140', '100', '0'], ['4200', '0', '100']]);
    expect(r.body.code).toBe('ACC_CONTROL_ACCOUNT');
    const heading = await journal(maker, [['5400', '100', '0'], ['1110', '0', '100']]);
    expect(heading.body.code).toBe('ACC_NOT_POSTABLE');
  });

  it('large amounts need a second step by Finance Manager; checker cannot do both steps', async () => {
    const j = (await journal(maker, [['1512', '750000', '0'], ['1121', '0', '750000']], '2026-10-03', 'Laptops')).body;
    await maker.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
    let req = (await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === j.id);
    expect(req.total_steps).toBe(2);
    // FM cannot take step 1? Step 1 has no role restriction, but step 2 requires the Finance Manager role
    const s1 = await checker.post(`/approvals/${req.id}/approve`, {});
    expect(s1.body).toMatchObject({ status: 'SUBMITTED', nextStep: 2 });
    req = (await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === j.id);
    expect(req.canApprove).toBe(false);
    expect((await checker.post(`/approvals/${req.id}/approve`, {})).body.code).toBe('APR_NOT_APPROVER');
    expect((await fm.post(`/approvals/${req.id}/approve`, {})).body.status).toBe('POSTED');
  });

  it('approval limit on a role blocks approvals above it (APR_LIMIT_EXCEEDED)', async () => {
    await admin.stepUp();
    const roles = (await admin.get('/roles')).body;
    const chk = roles.find((r: { key: string }) => r.key === 'CHECKER');
    await admin.patch(`/roles/${chk.id}`, { approvalLimit: '1000' });
    const j = (await journal(maker, [['5410', '5000', '0'], ['1110', '0', '5000']])).body;
    await maker.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
    const req = (await checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === j.id);
    expect((await checker.post(`/approvals/${req.id}/approve`, {})).body.code).toBe('APR_LIMIT_EXCEEDED');
    expect((await fm.post(`/approvals/${req.id}/approve`, {})).body.status).toBe('POSTED');
    await admin.patch(`/roles/${chk.id}`, { approvalLimit: null });
  });

  it('concurrent approvals get unique consecutive numbers', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const j = (await journal(maker, [['5420', String(10 + i), '0'], ['1110', '0', String(10 + i)]])).body;
      await maker.post(`/documents/MANUAL_JOURNAL/${j.id}/submit`);
      ids.push(j.id);
    }
    const queue = (await checker.get('/approvals')).body;
    const reqs = ids.map((id) => queue.find((r: { doc_id: string }) => r.doc_id === id).id);
    const results = await Promise.all(reqs.map((r) => checker.post(`/approvals/${r}/approve`, {})));
    const nos = results.map((r) => r.body.docNo).sort();
    expect(new Set(nos).size).toBe(5);
    const all = (await maker.get('/journals')).body.filter((x: { doc_no: string | null }) => x.doc_no).map((x: { doc_no: string }) => Number(x.doc_no.slice(-5))).sort((a: number, b: number) => a - b);
    expect(all).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
  });
});

describe('reports: Trial Balance, General Ledger, Journal, Day Book', () => {
  it('TB totals agree and drill down TB → GL → journal entry', async () => {
    const tb = (await checker.get('/reports/trial-balance?from=2026-07-17&to=2027-07-16')).body;
    expect(tb.balanced).toBe(true);
    expect(tb.totals.closingDebit).toBe(tb.totals.closingCredit);
    expect(tb.period.fromBs).toBe('2083-04-01');
    const rent = tb.rows.find((r: { code: string }) => r.code === '5410');
    expect(Number(rent.closingDebit)).toBeGreaterThan(0);
    const gl = (await checker.get(`/reports/general-ledger?accountId=${rent.accountId}&from=2026-07-17&to=2027-07-16`)).body;
    expect(gl.closingBalance).toBe(rent.closingDebit);
    expect(gl.lines[0].dateBs).toMatch(/^2083-/);
    const e = (await checker.get(`/reports/entries/${gl.lines[0].entry_id}`)).body;
    expect(e.source_type).toBe('MANUAL_JOURNAL');
    expect(e.lines.length).toBeGreaterThanOrEqual(2);
  });

  it('Journal register and Day Book list posted vouchers with BS dates', async () => {
    const jr = (await checker.get('/reports/journal?from=2026-07-17&to=2027-07-16')).body;
    expect(jr.entries.length).toBeGreaterThan(5);
    const db = (await checker.get('/reports/day-book?from=2026-10-01&to=2026-10-01')).body;
    expect(db.days[0]).toMatchObject({ date: '2026-10-01', dateBs: '2083-06-15' });
  });

  it('report access is permission-controlled and CSV export is watermarked + logged', async () => {
    const viewer = await addMember(admin, ['VIEWER'], 'Vee Viewer');
    expect((await viewer.get('/reports/general-ledger?accountId=' + byCode('1110') + '&from=2026-07-17&to=2027-07-16')).status).toBe(403);
    expect((await viewer.get('/reports/trial-balance?from=2026-07-17&to=2027-07-16&format=csv')).status).toBe(403);
    const csv = await checker.get('/reports/trial-balance?from=2026-07-17&to=2027-07-16&format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Chandra Checker');
    const logs = (await admin.get('/audit-logs?action=EXPORT')).body;
    expect(logs[0].entity).toBe('report.trial_balance');
  });
});

describe('opening balances & go-live', () => {
  it('go-live is blocked until Opening Balance Equity = 0; customer open items feed aging', async () => {
    const { admin: a2 } = await setupCompany('NP', 'TRADING');
    const m2 = await addMember(a2, ['ACCOUNTANT'], 'OB Maker');
    const c2 = await addMember(a2, ['CHECKER'], 'OB Checker');
    const accts = (await a2.get('/accounts')).body as { id: string; code: string }[];
    const id = (code: string) => accts.find((x) => x.code === code)!.id;
    const cust = (await m2.post('/contacts', { type: 'CUSTOMER', name: 'Himalayan Traders', pan: '301234567', paymentTermsDays: 30 })).body;
    const ob = await m2.post('/opening-balances', {
      asOfDate: '2026-07-17',
      lines: [
        { kind: 'ACCOUNT', accountId: id('1121'), debit: '500000', credit: '0' },
        { kind: 'ACCOUNT', accountId: id('3100'), debit: '0', credit: '600000' },
        { kind: 'CUSTOMER', contactId: cust.id, reference: 'SI-2082/83-00999', docDate: '2026-06-20', dueDate: '2026-07-20', debit: '90000', credit: '0' },
      ],
    });
    expect(ob.status).toBe(201);
    expect(ob.body.obe).toBe('-10000.00');
    await m2.post(`/documents/OPENING_BALANCE/${ob.body.id}/submit`);
    const req = (await c2.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === ob.body.id);
    expect((await c2.post(`/approvals/${req.id}/approve`, {})).body.status).toBe('POSTED');
    const st = (await a2.get('/opening-balances')).body;
    expect(st.openingBalanceEquity).toBe('10000.00');
    expect(st.canGoLive).toBe(false);
    const gl = await a2.post('/opening-balances/go-live');
    expect(gl.body.code).toBe('ACC_OPENING_UNBALANCED');
    expect(gl.body.detail).toContain('10,000.00');
    // Admin accepts the difference → journal to Retained Earnings through maker–checker
    const t = await a2.post('/opening-balances/transfer-difference', { target: 'RETAINED_EARNINGS', date: '2026-07-17' });
    const treq = (await c2.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === t.body.journalId);
    expect((await c2.post(`/approvals/${treq.id}/approve`, {})).body.status).toBe('POSTED');
    expect((await a2.post('/opening-balances/go-live')).body.goLiveStatus).toBe('LIVE');
    expect((await m2.post('/opening-balances', { asOfDate: '2026-07-17', lines: [{ kind: 'ACCOUNT', accountId: id('1110'), debit: '1', credit: '0' }] })).body.code).toBe('ACC_ALREADY_LIVE');
    const aging = (await c2.get('/reports/aging/AR?asOf=2026-10-01')).body;
    expect(aging.contacts[0]).toMatchObject({ contactName: 'Himalayan Traders', d61_90: '90000.00', total: '90000.00' });
    const tb = (await c2.get('/reports/trial-balance?from=2026-07-17&to=2026-07-17')).body;
    expect(tb.balanced).toBe(true);
    expect(tb.rows.find((r: { code: string }) => r.code === '3900')).toMatchObject({ closingDebit: '0.00', closingCredit: '0.00' });
    const integ = (await a2.get('/reports/integrity')).body;
    expect(integ.ok).toBe(true);
  });
});
