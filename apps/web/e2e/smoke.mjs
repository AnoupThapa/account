// End-to-end smoke test of the main flow through the real UI (Phase 9 expands this into a full suite).
// Usage: BASE_URL=http://localhost:3000 CHROMIUM_PATH=... node e2e/smoke.mjs   (needs demo data: pnpm seed:demo)
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.DEMO_PASSWORD || 'Demo-Ledger-2026!';
const shots = process.env.SHOTS_DIR;
const errors = [];

async function session(browser, email) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
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
  await page.waitForSelector('text=Cash & bank');
  return page;
}
const shot = async (page, name) => shots && page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const maker = await session(browser, 'accountant.np@ledgerpro.local');
  await shot(maker, '01-home');
  await maker.goto(BASE + '/docs/sales-invoices/new');
  await maker.waitForSelector('text=Customer *');
  const custOpt = await maker.$eval('select >> nth=1', (s) => [...s.options].find((o) => o.text.includes('Himalayan'))?.value);
  await maker.selectOption('select >> nth=1', custOpt);
  const itemSel = maker.locator('tbody select').first();
  const itemOpt = await itemSel.evaluate((s) => [...s.options].find((o) => o.text.includes('GLV-100'))?.value);
  await itemSel.selectOption(itemOpt);
  await maker.locator('tbody input.num').first().fill('10');
  await maker.waitForSelector('text=Total');
  await shot(maker, '02-invoice-form');
  await maker.click('button:has-text("Save & submit for approval")');
  await maker.waitForURL(/\/docs\/sales-invoices\/[0-9a-f-]{36}$/);
  await maker.waitForSelector('text=SUBMITTED');
  await shot(maker, '03-invoice-submitted');

  const checker = await session(browser, 'checker.np@ledgerpro.local');
  await checker.goto(BASE + '/approvals');
  await checker.waitForSelector('button:has-text("Approve")');
  await shot(checker, '04-approvals');
  await checker.click('button:has-text("Approve") >> nth=0');
  await checker.waitForSelector('text=Nothing waiting for approval');
  await checker.goto(BASE + '/docs/sales-invoices');
  await checker.waitForSelector('text=SI-');
  await checker.click('text=SI-');
  await checker.waitForSelector('text=POSTED');
  await shot(checker, '05-invoice-posted');
  await checker.goto(BASE + '/reports/trial-balance');
  await checker.waitForSelector('text=Total ✔');
  await shot(checker, '06-trial-balance');
  await checker.goto(BASE + '/reports/sales-book');
  await checker.waitForSelector('text=SI-');
  await shot(checker, '07-sales-book');
  for (const p of ['/journals/new', '/opening', '/accounts', '/reports/day-book', '/reports/aging', '/settings/fiscal', '/approvals', '/docs/receipts/new', '/docs/bills/new', '/docs/expenses/new', '/contacts?type=CUSTOMER', '/items']) {
    await checker.goto(BASE + p);
    await checker.waitForLoadState('networkidle');
  }
  const owner = await session(browser, 'owner@ledgerpro.local');
  for (const p of ['/settings/users', '/settings/company', '/settings/tax', '/settings/workflows', '/settings/audit', '/security']) {
    await owner.goto(BASE + p);
    await owner.waitForLoadState('networkidle');
  }
  await shot(owner, '08-audit');
  console.log(errors.length ? 'UI ERRORS:\n' + errors.join('\n') : 'SMOKE OK — no page errors');
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
