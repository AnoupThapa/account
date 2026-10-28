/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Phase 2B acceptance (docs/14 §5): global tax systems, group taxes, taxable/non-taxable choices. */
import { describe, it, expect, afterAll } from 'vitest';
import { addMember, closeApp, setupCompany, TestClient } from './helpers';

afterAll(closeApp);

interface Ctx {
  admin: TestClient;
  maker: TestClient;
  checker: TestClient;
  acct: (key: string) => string;
  tax: (code: string) => string;
  refreshTax: () => Promise<void>;
}

async function companyCtx(country: string, extra: Record<string, unknown> = {}): Promise<Ctx> {
  const { admin } = await setupCompany(country, 'SERVICE', undefined, extra);
  const maker = await addMember(admin, ['ACCOUNTANT'], 'Mira Maker');
  const checker = await addMember(admin, ['CHECKER'], 'Kiran Checker');
  const accts = (await admin.get('/accounts')).body as { id: string; code: string; system_key: string | null }[];
  let taxes = (await admin.get('/tax-codes')).body as { id: string; code: string }[];
  const c: Ctx = {
    admin, maker, checker,
    acct: (k) => accts.find((a) => a.system_key === k)!.id,
    tax: (code) => taxes.find((t) => t.code === code)!.id,
    refreshTax: async () => { taxes = (await admin.get('/tax-codes')).body; },
  };
  return c;
}

async function post(c: Ctx, type: string, id: string) {
  const s = await c.maker.post(`/documents/${type}/${id}/submit`);
  if (s.status !== 201) throw new Error(`submit ${type} failed: ${JSON.stringify(s.body)}`);
  if (s.body.status === 'POSTED') return s.body;
  const req = (await c.checker.get('/approvals')).body.find((r: { doc_id: string }) => r.doc_id === id);
  const a = await c.checker.post(`/approvals/${req.id}/approve`, {});
  if (a.body.status !== 'POSTED') throw new Error(`approve ${type} failed: ${JSON.stringify(a.body)}`);
  return a.body;
}

async function journal(c: Ctx, path: string, id: string) {
  const doc = (await c.checker.get(`/${path}/${id}`)).body;
  const e = (await c.checker.get(`/reports/entries/${doc.journal_entry_id}`)).body;
  return { doc, lines: e.lines as { code: string; name: string; debit: string; credit: string; tax_code?: string }[] };
}
const total = (lines: { debit: string; credit: string }[], side: 'debit' | 'credit') => lines.reduce((s, l) => s + Number(l[side]), 0).toFixed(2);

describe('tax systems: packs, regimes and countries', () => {
  it('lists the packs, and an existing Nepal company was given the Nepal regime with its labels', async () => {
    const c = await companyCtx('NP');
    const packs = (await c.admin.get('/tax/packs')).body as { key: string }[];
    expect(packs.map((p) => p.key)).toEqual(expect.arrayContaining(['NP_VAT', 'AU_GST', 'GB_VAT', 'IN_GST', 'CA_GST', 'US_SALES_TAX', 'GENERIC_VAT']));
    const r = (await c.admin.get('/tax/regime')).body;
    expect(r.regime).toMatchObject({ key: 'NP_VAT', tax_label: 'VAT', tax_id_label: 'PAN/VAT No.', source_pack: 'NP_VAT' });
    expect(r.nonTaxableCodeId).toBe(c.tax('EXEMPT'));
    expect(r.defaultStandardCodeId).toBe(c.tax('VAT13'));
  });

  it('a company in any country is created with that country’s currency, year and tax pack (UK)', async () => {
    const c = await companyCtx('GB');
    const co = (await c.admin.get('/companies/current')).body;
    expect(co).toMatchObject({ country: 'GB', base_currency: 'GBP', fy_start_month: 4, calendar_mode: 'AD' });
    expect((await c.admin.get('/tax/regime')).body.regime).toMatchObject({ key: 'GB_VAT', invoice_title: 'VAT Invoice' });
    const codes = (await c.admin.get('/tax-codes')).body.map((t: { code: string }) => t.code);
    expect(codes).toEqual(expect.arrayContaining(['VAT20', 'VAT5', 'VAT0', 'EXEMPT', 'OUTSCOPE']));
    const cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Thames Ltd' })).body;
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-05', contactId: cust.id, lines: [{ accountId: c.acct('SALES_SERVICES'), quantity: '1', unitPrice: '1000', taxCodeId: c.tax('VAT20') }] })).body;
    expect(inv).toMatchObject({ tax_total: '200.00', grand_total: '1200.00' });
    await post(c, 'SALES_INVOICE', inv.id);
  });

  it('an unlisted country gets the generic starter pack and can be changed with another pack; applying a pack twice adds nothing', async () => {
    const c = await companyCtx('XK');
    expect((await c.admin.get('/tax/regime')).body.regime).toMatchObject({ key: 'GENERIC_VAT', country: 'XK' });
    await c.admin.stepUp();
    const first = await c.admin.post('/tax/regime/apply-pack', { packKey: 'NZ_GST' });
    expect(first.status).toBe(201);
    expect(first.body.created).toEqual(expect.arrayContaining(['GST15', 'GST0']));
    const again = await c.admin.post('/tax/regime/apply-pack', { packKey: 'NZ_GST' });
    expect(again.body.created).toEqual([]);
    expect((await c.admin.get('/tax/regime')).body.regime.key).toBe('NZ_GST');
    // rates are company data: adding a dated change leaves earlier documents alone
    await c.refreshTax();
    const nz = await c.admin.post(`/tax-codes/${c.tax('GST15')}/rates`, { rate: '16', effectiveFrom: '2027-04-01' });
    expect(nz.status).toBe(201);
  });

  it('applying a pack needs the tax.manage permission and step-up', async () => {
    const c = await companyCtx('NP');
    expect((await c.maker.post('/tax/regime/apply-pack', { packKey: 'NZ_GST' })).status).toBe(403);
    const noStep = await c.admin.post('/tax/regime/apply-pack', { packKey: 'NZ_GST' });
    expect(noStep.status).toBeGreaterThanOrEqual(400);
    expect((await c.admin.post('/tax/regime/apply-pack', { packKey: 'NOPE' })).status).toBeGreaterThanOrEqual(400);
  });

  it('custom builder: any model, labels, codes and a group of two codes; groups cannot nest', async () => {
    const c = await companyCtx('XK');
    await c.admin.stepUp();
    const reg = await c.admin.post('/tax/regime/custom', { name: 'Kosovo VAT', model: 'CREDIT_VAT', taxLabel: 'TVSH', taxIdLabel: 'NUI', invoiceTitle: 'Faturë', returnPeriod: 'MONTHLY' });
    expect(reg.status).toBe(201);
    const a = (await c.admin.post('/tax-codes', { code: 'FED', name: 'Federal 5%', type: 'STANDARD', rate: '5', effectiveFrom: '2026-01-01' })).body;
    const b = (await c.admin.post('/tax-codes', { code: 'LOC', name: 'Local 2%', type: 'STANDARD', rate: '2', effectiveFrom: '2026-01-01' })).body;
    const g = await c.admin.post('/tax-codes/group', { code: 'COMBINED', name: 'Federal + local', components: [{ codeId: a.id, stacked: false }, { codeId: b.id, stacked: true }] });
    expect(g.status).toBe(201);
    expect(g.body).toMatchObject({ is_group: true, type: 'STANDARD' });
    const nested = await c.admin.post('/tax-codes/group', { code: 'NEST', name: 'Nested', components: [{ codeId: g.body.id }, { codeId: a.id }] });
    expect(nested.body.code).toBe('VAL_FIELD');
    const one = await c.admin.post('/tax-codes/group', { code: 'ONE', name: 'One', components: [{ codeId: a.id }] });
    expect(one.status).toBe(422);
    const r = (await c.admin.get('/tax/regime')).body;
    expect(r.regime).toMatchObject({ key: 'CUSTOM', tax_label: 'TVSH', tax_id_label: 'NUI' });
    await c.refreshTax();
    const cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Prishtina SH.P.K.' })).body;
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-05', contactId: cust.id, lines: [{ accountId: c.acct('SALES_SERVICES'), quantity: '1', unitPrice: '1000', taxCodeId: c.tax('COMBINED') }] })).body;
    expect(inv.tax_total).toBe('71.00'); // 5% of 1000 = 50, then 2% of (1000 + 50) = 21
    expect(inv.grand_total).toBe('1071.00');
  });
});

describe('group (compound) taxes post each component separately', () => {
  it('India: GST 18% = CGST 9% + SGST 9%; tax summary lists both; inclusive pricing gives the same ledger', async () => {
    const c = await companyCtx('IN');
    expect((await c.admin.get('/tax/regime')).body.regime).toMatchObject({ key: 'IN_GST', tax_id_label: 'GSTIN', model: 'COMPOUND' });
    const cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Pune Traders' })).body;
    const line = { accountId: c.acct('SALES_SERVICES'), quantity: '1', taxCodeId: c.tax('GST18') };
    const ex = (await c.maker.post('/sales-invoices', { date: '2026-10-05', contactId: cust.id, lines: [{ ...line, unitPrice: '1000' }] })).body;
    expect(ex).toMatchObject({ tax_total: '180.00', grand_total: '1180.00', taxable_total: '1000.00' });
    await post(c, 'SALES_INVOICE', ex.id);
    const { lines } = await journal(c, 'sales-invoices', ex.id);
    const outputs = lines.filter((l) => Number(l.credit) > 0 && l.name.toLowerCase().includes('output'));
    expect(outputs.map((l) => l.credit).sort()).toEqual(['90.00', '90.00']);
    expect(total(lines, 'debit')).toBe('1180.00');
    expect(total(lines, 'credit')).toBe('1180.00');

    const inc = (await c.maker.post('/sales-invoices', { date: '2026-10-06', contactId: cust.id, pricesIncludeTax: true, lines: [{ ...line, unitPrice: '1180' }] })).body;
    expect(inc).toMatchObject({ tax_total: '180.00', grand_total: '1180.00', subtotal: '1000.00' });
    await post(c, 'SALES_INVOICE', inc.id);

    const sum = (await c.checker.get('/reports/tax-summary?from=2026-10-01&to=2026-10-31')).body;
    const byCode = Object.fromEntries(sum.output.map((o: { code: string; amount: string }) => [o.code, o.amount]));
    expect(byCode).toMatchObject({ CGST9: '180.00', SGST9: '180.00' });
    expect(sum.outputTotal).toBe('360.00');
  });

  it('Canada (BC): bill with GST 5% + PST 7% — GST claimed, PST (not claimable) added to cost', async () => {
    const c = await companyCtx('CA');
    const sup = (await c.maker.post('/contacts', { type: 'SUPPLIER', name: 'Vancouver Supplies' })).body;
    const bill = (await c.maker.post('/bills', { date: '2026-10-05', contactId: sup.id, supplierInvoiceNo: 'VS-1', lines: [{ accountId: c.acct('GENERAL_EXPENSE'), quantity: '1', unitPrice: '1000', taxCodeId: c.tax('GST-PST-BC') }] })).body;
    expect(bill).toMatchObject({ tax_total: '120.00', grand_total: '1120.00', non_claimable_tax: '70.00' });
    await post(c, 'PURCHASE_BILL', bill.id);
    const { lines } = await journal(c, 'bills', bill.id);
    const expense = lines.filter((l) => Number(l.debit) > 0 && !l.name.toLowerCase().includes('input'));
    expect(expense.map((l) => l.debit)).toEqual(['1070.00']);
    const input = lines.filter((l) => l.name.toLowerCase().includes('input'));
    expect(input.map((l) => l.debit)).toEqual(['50.00']);
    expect(total(lines, 'debit')).toBe('1120.00');
    expect(total(lines, 'credit')).toBe('1120.00');
  });

  it('tax-code changes to a posted document never happen: editing a rate leaves old invoices as posted', async () => {
    const c = await companyCtx('IN');
    await c.admin.stepUp();
    const cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Delhi Co' })).body;
    const mk = async (date: string) => (await c.maker.post('/sales-invoices', { date, contactId: cust.id, lines: [{ accountId: c.acct('SALES_SERVICES'), quantity: '1', unitPrice: '100', taxCodeId: c.tax('GST5') }] })).body;
    const before = await mk('2026-10-05');
    expect(before.tax_total).toBe('5.00');
    await post(c, 'SALES_INVOICE', before.id);
    const cg = await c.admin.post(`/tax-codes/${c.tax('CGST2.5')}/rates`, { rate: '3', effectiveFrom: '2026-11-01' });
    expect(cg.status).toBe(201);
    expect((await c.checker.get(`/sales-invoices/${before.id}`)).body.tax_total).toBe('5.00');
    expect((await mk('2026-11-05')).tax_total).toBe('5.50'); // CGST 3% + SGST 2.5% on 100
  });
});

describe('taxable / non-taxable choices on items and bills', () => {
  it('an item taxable when sold can be exempt when bought (purchase side), and the bill posts no tax', async () => {
    const c = await companyCtx('NP');
    const item = (await c.maker.post('/items', { sku: 'DUAL-1', name: 'Dual-treatment item', type: 'NON_INVENTORY', taxApplicability: 'TAXABLE', purchaseTaxApplicability: 'EXEMPT', salesPrice: '100', purchasePrice: '80' })).body;
    expect(item).toMatchObject({ tax_applicability: 'TAXABLE', purchase_tax_applicability: 'EXEMPT', purchase_default_tax_code_id: c.tax('EXEMPT') });
    const cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Buyer', pan: '600123456' })).body;
    const sup = (await c.maker.post('/contacts', { type: 'SUPPLIER', name: 'Seller', pan: '300555666' })).body;
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-05', contactId: cust.id, lines: [{ itemId: item.id, quantity: '1', unitPrice: '100' }] })).body;
    expect(inv).toMatchObject({ tax_total: '13.00', taxable_total: '100.00' });
    const bill = (await c.maker.post('/bills', { date: '2026-10-05', contactId: sup.id, supplierInvoiceNo: 'S-1', lines: [{ itemId: item.id, quantity: '1', unitPrice: '80' }] })).body;
    expect(bill).toMatchObject({ tax_total: '0.00', exempt_total: '80.00', grand_total: '80.00' });
  });

  it('purchase side mismatch with its tax code is refused', async () => {
    const c = await companyCtx('NP');
    const bad = await c.maker.post('/items', { sku: 'BAD-2', name: 'Bad', type: 'SERVICE', taxApplicability: 'TAXABLE', purchaseTaxApplicability: 'EXEMPT', purchaseDefaultTaxCodeId: c.tax('VAT13') });
    expect(bad.body.code).toBe('VAL_FIELD');
  });

  it('changing an item’s tax on a line needs a reason (company setting) and the reason is kept; with the setting off it is optional', async () => {
    const c = await companyCtx('NP');
    const item = (await c.maker.post('/items', { sku: 'SVC-1', name: 'Consulting', type: 'SERVICE', taxApplicability: 'TAXABLE', salesPrice: '1000' })).body;
    const cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Export Buyer' })).body;
    const body = (reason?: string) => ({ date: '2026-10-05', contactId: cust.id, lines: [{ itemId: item.id, quantity: '1', unitPrice: '1000', taxCodeId: c.tax('VAT0'), ...(reason ? { taxOverrideReason: reason } : {}) }] });
    const noReason = await c.maker.post('/sales-invoices', body());
    expect(noReason.body.code).toBe('VAL_FIELD');
    const ok = await c.maker.post('/sales-invoices', body('Export to India — zero-rated'));
    expect(ok.status).toBe(201);
    const full = (await c.maker.get(`/sales-invoices/${ok.body.id}`)).body;
    expect(full.lines[0]).toMatchObject({ tax_override_reason: 'Export to India — zero-rated', tax_amount: '0.00' });
    await c.admin.stepUp();
    expect((await c.admin.patch('/tax/regime', { overrideReasonRequired: false })).status).toBe(200);
    expect((await c.maker.post('/sales-invoices', body())).status).toBe(201);
  });

  it('“Non-taxable” on an account-only bill line (the regime’s non-taxable code) posts no tax and counts as exempt', async () => {
    const c = await companyCtx('NP');
    const regime = (await c.admin.get('/tax/regime')).body;
    const sup = (await c.maker.post('/contacts', { type: 'SUPPLIER', name: 'Unregistered Vendor' })).body;
    const bill = (await c.maker.post('/bills', { date: '2026-10-05', contactId: sup.id, supplierInvoiceNo: 'U-1', lines: [{ accountId: c.acct('GENERAL_EXPENSE'), quantity: '1', unitPrice: '500', taxCodeId: regime.nonTaxableCodeId }] })).body;
    expect(bill).toMatchObject({ tax_total: '0.00', exempt_total: '500.00', grand_total: '500.00' });
    await post(c, 'PURCHASE_BILL', bill.id);
  });

  it('the setup is isolated per company: another company does not see this company’s regime or codes', async () => {
    const a = await companyCtx('IN');
    const b = await companyCtx('GB');
    const ra = (await a.admin.get('/tax/regime')).body.regime;
    const rb = (await b.admin.get('/tax/regime')).body.regime;
    expect(ra.id).not.toBe(rb.id);
    expect((await b.admin.get('/tax-codes')).body.some((t: { code: string }) => t.code === 'CGST9')).toBe(false);
  });
});
