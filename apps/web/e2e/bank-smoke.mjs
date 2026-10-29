/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
// Bank reconciliation smoke test through the real UI: upload a CSV statement, auto-match a receipt, add a bank charge
// from a statement line (approved by the checker), finish the reconciliation and open the printable statement.
// Usage: BASE_URL=http://localhost:3000 CHROMIUM_PATH=... node e2e/bank-smoke.mjs   (needs demo data: pnpm seed:demo)
import { chromium } from 'playwright-core';
import * as XLSX from '@e965/xlsx';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.DEMO_PASSWORD || 'Demo-Ledger-2026!';
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const ts = 'T' + Date.now(); // digits in the reference let the matcher find it inside the bank narration
const day = new Date().toISOString().slice(0, 10);
const [yy, mm, dd] = day.split('-');

async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(`${email} console: ${m.text()}`));
  await page.goto(BASE + '/login');
  await page.fill('#email', email);
  await page.fill('#pw', PW);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await page.waitForSelector('select[aria-label="Company"]');
  const opt = await page.$eval('select[aria-label="Company"]', (s) => [...s.options].find((o) => o.text.includes('Nepal'))?.value);
  await page.selectOption('select[aria-label="Company"]', opt);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  const company = await page.evaluate(() => localStorage.getItem('lp.company'));
  const csrf = (await (await page.request.get(BASE + '/api/auth/csrf')).json()).csrfToken;
  const h = { 'x-csrf-token': csrf, 'x-company-id': company };
  const api = {
    get: async (p) => (await page.request.get(BASE + '/api' + p, { headers: h })).json(),
    post: async (p, data = {}) => { const r = await page.request.post(BASE + '/api' + p, { headers: h, data }); return { status: r.status(), body: await r.json() }; },
  };
  return { page, api };
}
const must = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('  ok -', msg); };

const maker = await login('accountant.np@ledgerpro.local');
const checker = await login('checker.np@ledgerpro.local');
const approve = async (docId) => {
  const list = await checker.api.get('/approvals');
  if (!Array.isArray(list)) throw new Error('approvals: ' + JSON.stringify(list));
  const req = list.find((r) => r.doc_id === docId);
  must(!!req, 'checker sees the approval request');
  const r = await checker.api.post(`/approvals/${req.id}/approve`, {});
  must(r.body.status === 'POSTED', 'checker approves and it posts');
};

// 1. a receipt in the books (2 users: maker submits, checker approves)
const accts = await maker.api.get('/accounts');
const bank = accts.find((a) => a.code === '1121').id;
const cust = (await maker.api.get('/contacts?type=CUSTOMER'))[0];
const rc = await maker.api.post('/receipts', { date: day, contactId: cust.id, accountId: bank, amount: '7777.77', reference: `BK-${ts}` });
must(rc.status === 201, 'receipt drafted');
const sub = await maker.api.post(`/documents/RECEIPT/${rc.body.id}/submit`);
if (sub.body.status !== 'POSTED') await approve(rc.body.id);

// 2. upload a statement CSV
const page = maker.page;
await page.goto(BASE + '/banking');
await page.waitForSelector('[data-testid="bank-card-1121"]');
await page.click('[data-testid="bank-card-1121"] >> text=Upload statement');
// an .xls exactly in the layout of a Nepali bank export: title lines, opening/closing balance rows, footer
const blank = () => Array(22).fill('');
const mk = (cells) => { const r = blank(); for (const [i, v] of Object.entries(cells)) r[i] = v; return r; };
const aoa = [
  blank(), blank(), mk({ 2: 'Statement of Account' }), mk({ 14: 'Account Number', 16: ':', 17: '1234567890123456' }),
  mk({ 3: 'From', 4: `${yy}-${mm}-01`, 8: 'To', 10: day, 14: 'Account Type', 16: ':', 17: 'CACUR' }),
  mk({ 3: '   Account Name', 6: ':', 14: 'Opening Balance', 16: ':', 17: 1000 }), mk({ 3: '   Address', 6: ':', 14: 'Closing Balance', 16: ':', 17: 1234.56 }), blank(),
  mk({ 3: 'Date', 5: 'Value Date', 9: 'Chq. No.', 11: 'Transaction Detail', 15: 'Debit', 16: 'Credit', 18: 'Balance' }),
  mk({ 3: '-', 5: '-', 9: '-', 11: 'Opening Balance', 15: 0, 16: 0, 18: 1000 }),
  mk({ 3: day, 5: day, 9: '-', 11: `CHQ DEP BK-${ts} from customer`, 15: 0, 16: 7777.77, 18: 8777.77 }),
  mk({ 3: day, 5: day, 9: '-', 11: `SMS charge ${ts}`, 15: 12.34, 16: 0, 18: 8765.43 }),
  mk({ 3: '-', 5: '-', 9: '-', 11: 'Closing Balance', 15: 0, 16: 0, 18: 1234.56 }), blank(),
  mk({ 3: 'Record', 4: 2, 5: 'of', 7: 2, 13: 'Total', 14: 12.34, 16: 7777.77, 18: 'Page', 19: 1, 20: 'of', 21: 1 }),
  mk({ 2: 'This statement is for reconciliation purpose only.' }),
];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'account_statement');
const xls = XLSX.write(wb, { bookType: 'biff8', type: 'buffer' });
await page.setInputFiles('[data-testid="stmt-file"]', { name: 'statement.xls', mimeType: 'application/vnd.ms-excel', buffer: xls });
await page.waitForSelector('text=2 transactions readable');
await page.waitForSelector('text=closing balance');
await page.click('[data-testid="stmt-import"]');
await page.waitForSelector('text=lines imported');
must(true, 'statement imported (columns guessed, preview shown)');
await page.click('text=Start matching');
await page.waitForSelector(`text=CHQ DEP BK-${ts}`);

// 3. books side shows the receipt with its description; auto-match picks it up
await page.waitForSelector(`[data-testid="book-pane"] >> text=BK-${ts}`);
must(true, 'books pane lists the receipt with its reference');
await page.click('[data-testid="auto-match"]');
await page.waitForSelector('text=/Auto-match matched \\d+ line/');
await page.waitForFunction((t) => !document.querySelector('[data-testid="stmt-pane"]').innerText.includes(t), `CHQ DEP BK-${ts}`);
must(true, 'matched deposit leaves the to-match list');

// 4. add a bank charge from the statement line, checker approves, line matches itself
await page.locator('[data-testid="stmt-row"]', { hasText: `SMS charge ${ts}` }).locator('[data-testid="add-tx"]').click();
await page.selectOption('[data-testid="addtx-kind"]', 'CHARGE');
await page.click('[data-testid="addtx-save"]');
await page.waitForSelector('text=Sent for approval');
await page.waitForSelector('text=Waiting for approval');
const jr = (await maker.api.get('/journals?status=SUBMITTED')).find((j) => (j.narration || '').includes(`SMS charge ${ts}`));
must(!!jr, 'a bank charge journal was drafted and submitted');
await approve(jr.id);
await page.reload();
await page.waitForSelector('[data-testid="stmt-pane"]');
await page.waitForTimeout(800);
must((await page.locator('[data-testid="stmt-pane"]').innerText()).includes(`SMS charge ${ts}`) === false, 'approved charge matched itself');

// leftovers from earlier runs of this smoke test would block finishing: ignore them first
for (const l of await maker.api.get(`/bank/accounts/${bank}/statement-lines?status=UNMATCHED`)) await maker.api.post(`/bank/lines/${l.id}/ignore`, { reason: 'smoke test cleanup' });
await page.reload();

// 5. finish: type the expected balance, lock, open the printable statement
await page.click('[data-testid="finish-btn"]');
await page.waitForFunction(() => document.querySelector('[data-testid="finish-balance"]').value === '1234.56', null, { timeout: 8000 });
must(true, 'closing balance is pre-filled from the statement file');
await page.fill('[data-testid="finish-balance"]', '1');
await page.waitForSelector('[data-testid="finish-math"]');
must(await page.locator('[data-testid="finish-save"]').isDisabled(), 'finish is blocked while the balance does not agree');
const pv = await maker.api.get(`/bank/accounts/${bank}/reconcile-preview?date=${day}&balance=1`);
await page.fill('[data-testid="finish-balance"]', pv.expectedStatementBalance);
await page.waitForFunction(() => !document.querySelector('[data-testid="finish-save"]').disabled);
await page.click('[data-testid="finish-save"]');
await page.waitForSelector('[data-testid="brs"]');
must((await page.locator('[data-testid="brs"]').innerText()).includes('Bank Reconciliation Statement'), 'Bank Reconciliation Statement opens');

// 6. people without bank access cannot open Banking
const hr = await login('hr.np@ledgerpro.local');
await hr.page.goto(BASE + '/banking');
await hr.page.waitForTimeout(1500);
must(!(await hr.page.locator('[data-testid^="bank-card"]').count()), 'HR manager sees no bank accounts');

await browser.close();
if (errors.length) {
  console.error('Browser errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('BANK SMOKE PASSED');
