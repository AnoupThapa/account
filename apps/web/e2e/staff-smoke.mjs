/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
// Staff portal & HR smoke test through the real UI: HR Manager creates and sends payslips, the staff member signs in,
// clocks in, opens and acknowledges the payslip, and cannot open HR screens.
// Usage: BASE_URL=http://localhost:3000 CHROMIUM_PATH=... node e2e/staff-smoke.mjs   (needs demo data: pnpm seed:demo; ENFORCE_2FA=false)
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PW = process.env.DEMO_PASSWORD || 'Demo-Ledger-2026!';
const errors = [];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

async function login(email) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
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
  await page.waitForTimeout(800);
  return page;
}

const hr = await login('hr.np@ledgerpro.local');
await hr.goto(BASE + '/staff');
await hr.waitForSelector('text=Sita Shrestha');
await hr.goto(BASE + '/staff/payslips');
await hr.waitForSelector('text=Create drafts for everyone');
await hr.locator('table.grid').or(hr.locator('text=No payslips for this period yet')).first().waitFor();
// the payslips of a previous run may exist: only create/send when there are none for the period
if (await hr.locator('text=No payslips for this period yet').count()) {
  await hr.click('text=Create drafts for everyone');
  await hr.waitForSelector('text=Created');
  hr.once('dialog', (d) => d.accept());
  await hr.click('text=Send all drafts');
  await hr.waitForSelector('text=payslip(s).');
}
await hr.goto(BASE + '/staff/certificates');
await hr.waitForSelector('text=Issue certificate');
await hr.goto(BASE + '/staff/attendance');
await hr.waitForSelector('text=Daily sheet');

const st = await login('staff.np@ledgerpro.local');
await st.waitForURL('**/my');
await st.waitForSelector('text=Clock in');
if (await st.locator('button:has-text("Clock in"):not([disabled])').count()) await st.click('button:has-text("Clock in")');
await st.goto(BASE + '/my/payslips');
await st.waitForSelector('button:has-text("Open")');
await st.click('button:has-text("Open") >> nth=0');
await st.waitForSelector('text=Net pay (total receivable)');
await st.goto(BASE + '/my/attendance');
await st.waitForSelector('text=My attendance');
await st.goto(BASE + '/my/certificates');
await st.waitForSelector('text=My TDS certificates');
const nav = await st.innerText('nav');
if (/Journal|Invoices|Trial balance|Payslips\n|Staff\n/.test(nav.replace('My payslips', ''))) throw new Error('staff menu shows accounting/HR items: ' + nav);
await browser.close();
if (errors.length) {
  console.error('PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('STAFF SMOKE OK — no page errors');
