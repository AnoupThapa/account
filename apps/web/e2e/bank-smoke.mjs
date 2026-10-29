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

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.DEMO_PASSWORD || 'Demo-Ledger-2026!';
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
const ts = Date.now().toString(36).toUpperCase();
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
const csv = `Date,Description,Reference,Debit,Credit,Balance\n${dd}/${mm}/${yy},Deposit ${ts},BK-${ts},,"7,777.77",\n${dd}/${mm}/${yy},SMS charge ${ts},,12.34,,\n`;
await page.setInputFiles('[data-testid="stmt-file"]', { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.waitForSelector('text=2 transactions readable');
await page.click('[data-testid="stmt-import"]');
await page.waitForSelector('text=lines imported');
must(true, 'statement imported (columns guessed, preview shown)');
await page.click('text=Start matching');
await page.waitForSelector(`text=Deposit ${ts}`);

// 3. books side shows the receipt with its description; auto-match picks it up
await page.waitForSelector(`[data-testid="book-pane"] >> text=BK-${ts}`);
must(true, 'books pane lists the receipt with its reference');
await page.click('[data-testid="auto-match"]');
await page.waitForSelector('text=Auto-match matched 1 line');
must((await page.locator('[data-testid="stmt-pane"]').innerText()).includes(`Deposit ${ts}`) === false, 'matched deposit leaves the to-match list');

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

// 5. finish: type the expected balance, lock, open the printable statement
await page.click('[data-testid="finish-btn"]');
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
