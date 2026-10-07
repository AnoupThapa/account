/** Phase 2 acceptance (docs/phases.md): sales & purchases, VAT/GST, numbering, cancellations, AR/AP control. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addMember, closeApp, setupCompany, TestClient } from './helpers';

afterAll(closeApp);

interface Ctx {
  admin: TestClient;
  maker: TestClient;
  checker: TestClient;
  acct: (code: string) => string;
  tax: (code: string) => string;
}

async function companyCtx(country: 'NP' | 'AU'): Promise<Ctx> {
  const { admin } = await setupCompany(country, 'MIXED');
  const maker = await addMember(admin, ['ACCOUNTANT'], 'Mira Maker');
  const checker = await addMember(admin, ['CHECKER'], 'Kiran Checker');
  const accts = (await admin.get('/accounts')).body as { id: string; code: string }[];
  const taxes = (await admin.get('/tax-codes')).body as { id: string; code: string }[];
  return { admin, maker, checker, acct: (c) => accts.find((a) => a.code === c)!.id, tax: (c) => taxes.find((t) => t.code === c)!.id };
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

async function entryLines(c: Ctx, docPath: string, id: string) {
  const doc = (await c.checker.get(`/${docPath}/${id}`)).body;
  const e = (await c.checker.get(`/reports/entries/${doc.journal_entry_id}`)).body;
  return { doc, lines: e.lines as { code: string; debit: string; credit: string; contact_name: string | null }[] };
}
const sumBy = (lines: { code: string; debit: string; credit: string }[], code: string, side: 'debit' | 'credit') =>
  lines.filter((l) => l.code === code).reduce((s, l) => s + Number(l[side]), 0).toFixed(2);

describe('Nepal: sales with VAT 13% and exempt items', () => {
  let c: Ctx;
  let cust: { id: string };
  let vatItem: { id: string };
  let exemptItem: { id: string };
  beforeAll(async () => {
    c = await companyCtx('NP');
    cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Bhaktapur Hotels Pvt. Ltd.', pan: '600123456', paymentTermsDays: 30 })).body;
    vatItem = (await c.maker.post('/items', { sku: 'GLV-100', name: 'Nitrile gloves (box of 100)', type: 'NON_INVENTORY', taxApplicability: 'TAXABLE', salesPrice: '333.33' })).body;
    exemptItem = (await c.maker.post('/items', { sku: 'RICE-25', name: 'Rice 25 kg (basic food — exempt)', type: 'NON_INVENTORY', taxApplicability: 'EXEMPT', salesPrice: '500' })).body;
  });

  it('item tax applicability is set at creation and must match its tax code', async () => {
    expect(vatItem).toMatchObject({ tax_applicability: 'TAXABLE' });
    const bad = await c.maker.post('/items', { sku: 'BAD', name: 'Bad', type: 'SERVICE', taxApplicability: 'EXEMPT', defaultTaxCodeId: c.tax('VAT13') });
    expect(bad.body.code).toBe('VAL_FIELD');
  });

  it('mixed invoice: taxable/exempt split correct, VAT 13% with line rounding, gapless number, correct journal', async () => {
    const inv = await c.maker.post('/sales-invoices', {
      date: '2026-10-01',
      contactId: cust.id,
      lines: [
        { itemId: vatItem.id, quantity: '3', unitPrice: '333.33' },
        { itemId: exemptItem.id, quantity: '1', unitPrice: '500' },
        { itemId: vatItem.id, quantity: '2', unitPrice: '10.05' },
      ],
    });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ taxable_total: '1020.09', exempt_total: '500.00', tax_total: '132.61', grand_total: '1652.70', due_date: '2026-10-31', buyer_pan: '600123456' });
    const r = await post(c, 'SALES_INVOICE', inv.body.id);
    expect(r.docNo).toBe('SI-2083/84-00001');
    const { doc, lines } = await entryLines(c, 'sales-invoices', inv.body.id);
    expect(doc.amount_due).toBe('1652.70');
    expect(sumBy(lines, '1140', 'debit')).toBe('1652.70');
    expect(sumBy(lines, '4100', 'credit')).toBe('1520.09');
    expect(sumBy(lines, '2131', 'credit')).toBe('132.61');
    expect(lines.find((l) => l.code === '1140')!.contact_name).toBe('Bhaktapur Hotels Pvt. Ltd.');
  });

  it('tax-inclusive and exclusive pricing give identical ledger results for the same total', async () => {
    const ex = (await c.maker.post('/sales-invoices', { date: '2026-10-02', contactId: cust.id, lines: [{ itemId: vatItem.id, quantity: '1', unitPrice: '1000' }] })).body;
    const inc = (await c.maker.post('/sales-invoices', { date: '2026-10-02', contactId: cust.id, pricesIncludeTax: true, lines: [{ itemId: vatItem.id, quantity: '1', unitPrice: '1130' }] })).body;
    await post(c, 'SALES_INVOICE', ex.id);
    await post(c, 'SALES_INVOICE', inc.id);
    const a = await entryLines(c, 'sales-invoices', ex.id);
    const b = await entryLines(c, 'sales-invoices', inc.id);
    const shape = (ls: typeof a.lines) => ls.map((l) => [l.code, l.debit, l.credit]).sort();
    expect(shape(b.lines)).toEqual(shape(a.lines));
    expect(b.doc.grand_total).toBe('1130.00');
  });

  it('posted invoice cannot be deleted or edited; cancel needs maker–checker + reason and keeps the number', async () => {
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-03', contactId: cust.id, lines: [{ itemId: vatItem.id, quantity: '1', unitPrice: '100' }] })).body;
    const r = await post(c, 'SALES_INVOICE', inv.id);
    expect((await c.maker.del(`/sales-invoices/${inv.id}`)).body.code).toBe('ACC_IMMUTABLE');
    expect((await c.maker.patch(`/sales-invoices/${inv.id}`, { date: '2026-10-03', contactId: cust.id, lines: [{ itemId: vatItem.id, quantity: '2', unitPrice: '100' }] })).body.code).toBe('ACC_IMMUTABLE');
    expect((await c.maker.post('/corrections', { targetType: 'SALES_INVOICE', targetId: inv.id, correctionDate: '2026-10-03', reason: '' })).status).toBe(422);
    const corr = await c.maker.post('/corrections', { targetType: 'SALES_INVOICE', targetId: inv.id, correctionDate: '2026-10-03', reason: 'Customer order cancelled' });
    const req = (await c.checker.get('/approvals')).body.find((x: { doc_id: string }) => x.doc_id === corr.body.id);
    await c.checker.post(`/approvals/${req.id}/approve`, {});
    const after = (await c.checker.get(`/sales-invoices/${inv.id}`)).body;
    expect(after).toMatchObject({ status: 'CANCELLED', doc_no: r.docNo, cancel_reason: 'Customer order cancelled', amount_due: '0.00' });
    const book = (await c.checker.get('/reports/sales-book?from=2026-10-01&to=2026-10-31')).body;
    const row = book.rows.find((x: { doc_no: string }) => x.doc_no === r.docNo);
    expect(row.cancelled).toBe(true); // number stays visible as Cancelled
  });

  it('receipt with allocation, TDS deducted by customer; over-allocation refused; cancel of paid invoice blocked', async () => {
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-04', contactId: cust.id, lines: [{ itemId: vatItem.id, quantity: '10', unitPrice: '1000' }] })).body; // 11,300
    await post(c, 'SALES_INVOICE', inv.id);
    const tds = (await c.admin.get('/tds-codes')).body.find((t: { code: string }) => t.code === 'TDS-SVC');
    const over = await c.maker.post('/receipts', { date: '2026-10-05', contactId: cust.id, accountId: c.acct('1121'), amount: '20000', allocations: [{ targetType: 'SALES_INVOICE', targetId: inv.id, amount: '20000' }] });
    const s = await c.maker.post(`/documents/RECEIPT/${over.body.id}/submit`);
    expect(s.body.code).toBe('ACC_OVER_ALLOCATION');
    await c.maker.del(`/receipts/${over.body.id}`);
    const rc = (await c.maker.post('/receipts', { date: '2026-10-05', contactId: cust.id, accountId: c.acct('1121'), amount: '9850', tdsCodeId: tds.id, tdsAmount: '150', allocations: [{ targetType: 'SALES_INVOICE', targetId: inv.id, amount: '10000' }] })).body;
    expect(rc.total).toBe('10000.00');
    const pr = await post(c, 'RECEIPT', rc.id);
    expect(pr.docNo).toBe('RV-2083/84-00001');
    const { doc, lines } = await entryLines(c, 'receipts', rc.id);
    expect(doc.unallocated_amount).toBe('0.00');
    expect(sumBy(lines, '1121', 'debit')).toBe('9850.00');
    expect(sumBy(lines, '1172', 'debit')).toBe('150.00');
    expect(sumBy(lines, '1140', 'credit')).toBe('10000.00');
    expect((await c.checker.get(`/sales-invoices/${inv.id}`)).body.amount_due).toBe('1300.00');
    const corr = await c.maker.post('/corrections', { targetType: 'SALES_INVOICE', targetId: inv.id, correctionDate: '2026-10-06', reason: 'test' });
    expect(corr.body.code).toBe('DOC_CANCEL_HAS_PAYMENTS');
  });

  it('customer advance → applied to an invoice via advance adjustment', async () => {
    const adv = (await c.maker.post('/receipts', { date: '2026-10-06', contactId: cust.id, kind: 'ADVANCE', accountId: c.acct('1110'), amount: '5000' })).body;
    await post(c, 'RECEIPT', adv.id);
    let a = await entryLines(c, 'receipts', adv.id);
    expect(sumBy(a.lines, '2120', 'credit')).toBe('5000.00');
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-07', contactId: cust.id, lines: [{ itemId: exemptItem.id, quantity: '6', unitPrice: '500' }] })).body; // 3000
    await post(c, 'SALES_INVOICE', inv.id);
    const too = await c.maker.post('/advance-adjustments/customer', { date: '2026-10-07', advanceId: adv.id, targetId: inv.id, amount: '3500' });
    expect(too.body.code).toBe('ACC_OVER_ALLOCATION');
    const adj = (await c.maker.post('/advance-adjustments/customer', { date: '2026-10-07', advanceId: adv.id, targetId: inv.id, amount: '3000' })).body;
    await post(c, 'ADVANCE_ADJUSTMENT', adj.id);
    expect((await c.checker.get(`/sales-invoices/${inv.id}`)).body.amount_due).toBe('0.00');
    a = await entryLines(c, 'receipts', adv.id);
    expect(a.doc.unallocated_amount).toBe('2000.00');
  });

  it('credit note (sales return) auto-applies to the original invoice; cash sale debits cash', async () => {
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-08', contactId: cust.id, lines: [{ itemId: vatItem.id, quantity: '5', unitPrice: '200' }] })).body; // 1130
    await post(c, 'SALES_INVOICE', inv.id);
    const cn = (await c.maker.post('/credit-notes', { date: '2026-10-09', contactId: cust.id, originalInvoiceId: inv.id, reason: 'Damaged box returned', lines: [{ itemId: vatItem.id, quantity: '1', unitPrice: '200' }] })).body;
    expect(cn.grand_total).toBe('226.00');
    const r = await post(c, 'CREDIT_NOTE', cn.id);
    expect(r.docNo).toBe('CN-2083/84-00001');
    const { lines } = await entryLines(c, 'credit-notes', cn.id);
    expect(sumBy(lines, '4300', 'debit')).toBe('200.00');
    expect(sumBy(lines, '2131', 'debit')).toBe('26.00');
    expect(sumBy(lines, '1140', 'credit')).toBe('226.00');
    expect((await c.checker.get(`/sales-invoices/${inv.id}`)).body.amount_due).toBe('904.00');
    const cash = (await c.maker.post('/sales-invoices', { date: '2026-10-09', contactId: cust.id, cashAccountId: c.acct('1110'), lines: [{ itemId: vatItem.id, quantity: '1', unitPrice: '100' }] })).body;
    await post(c, 'SALES_INVOICE', cash.id);
    const cl = await entryLines(c, 'sales-invoices', cash.id);
    expect(sumBy(cl.lines, '1110', 'debit')).toBe('113.00');
    expect(cl.doc.amount_due).toBe('0.00');
  });

  it('quotation → sales order → invoice conversion', async () => {
    const q = (await c.maker.post('/sales-quotes', { date: '2026-10-10', contactId: cust.id, lines: [{ itemId: vatItem.id, quantity: '2', unitPrice: '300' }] })).body;
    expect(q.doc_no).toBe('QT-2083/84-00001');
    await c.maker.post(`/sales-quotes/${q.id}/status`, { status: 'SENT' });
    await c.maker.post(`/sales-quotes/${q.id}/status`, { status: 'ACCEPTED' });
    const so = (await c.maker.post(`/sales-quotes/${q.id}/convert`, { to: 'SALES_ORDER' })).body;
    expect(so.doc_no).toBe('SO-2083/84-00001');
    expect((await c.maker.get(`/sales-quotes/${q.id}`)).body.status).toBe('CONVERTED');
    const inv = (await c.maker.post(`/sales-orders/${so.id}/convert`, { to: 'SALES_INVOICE', date: '2026-10-11' })).body;
    expect(inv.grand_total).toBe('678.00');
    await post(c, 'SALES_INVOICE', inv.id);
    expect((await c.maker.get(`/sales-orders/${so.id}`)).body.status).toBe('INVOICED');
  });

  it('invoice print: BS+AD dates, PAN, amount in words (lakh), print counter, PDF', async () => {
    const inv = (await c.maker.post('/sales-invoices', { date: '2026-10-12', contactId: cust.id, lines: [{ itemId: vatItem.id, quantity: '1', unitPrice: '110619.47' }] })).body;
    await post(c, 'SALES_INVOICE', inv.id);
    const h1 = await c.maker.get(`/print/sales_invoice/${inv.id}?format=html`);
    expect(h1.text).toContain('Tax Invoice');
    expect(h1.text).toContain('Ashwin 26, 2083 BS');
    expect(h1.text).toContain('12 Oct 2026');
    expect(h1.text).toContain('PAN/VAT No. 600123456');
    expect(h1.text).toContain('Rupees One Lakh Twenty-Five Thousand Only');
    expect(h1.text).toContain('Original');
    const h2 = await c.maker.get(`/print/sales_invoice/${inv.id}?format=html`);
    expect(h2.text).toContain('Copy of original (1)');
    const pdf = await c.maker.get(`/print/sales_invoice/${inv.id}?format=pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (x: Buffer) => chunks.push(x));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await c.checker.get(`/sales-invoices/${inv.id}`)).body.print_count).toBe(3);
  });

  it('AR control = sum of customer open items; aging & statement agree', async () => {
    const integ = (await c.admin.get('/reports/integrity')).body;
    for (const ch of integ.checks) expect(ch, ch.check).toMatchObject({ ok: true });
    const aging = (await c.checker.get('/reports/aging/AR?asOf=2026-10-31')).body;
    const tb = (await c.checker.get('/reports/trial-balance?from=2026-07-17&to=2026-10-31')).body;
    const ar = tb.rows.find((r: { code: string }) => r.code === '1140');
    expect(aging.totals.net).toBe(ar.closingDebit);
    const st = (await c.checker.get(`/reports/statement/${cust.id}?from=2026-07-17&to=2026-10-31`)).body;
    // statement includes the advance liability balance (2,000 credit) on top of AR
    expect(Number(st.closingBalance)).toBeCloseTo(Number(ar.closingDebit) - 2000, 2);
    expect(tb.balanced).toBe(true);
  });

  it('Sales Book (IRD layout) and VAT summary', async () => {
    const book = (await c.checker.get('/reports/sales-book?from=2026-10-01&to=2026-10-31')).body;
    const first = book.rows[0];
    expect(first).toMatchObject({ doc_no: 'SI-2083/84-00001', buyer_pan: '600123456', taxable_total: '1020.09', exempt_total: '500.00', tax_total: '132.61', dateBs: '2083-06-15' });
    expect(book.returns).toHaveLength(1);
    const vat = (await c.checker.get('/reports/tax-summary?from=2026-10-01&to=2026-10-31')).body;
    expect(Number(vat.netPayable)).toBeGreaterThan(0);
  });
});

describe('Nepal: purchases, bills, payments, expenses', () => {
  let c: Ctx;
  let sup: { id: string };
  let emp: { id: string };
  beforeAll(async () => {
    c = await companyCtx('NP');
    sup = (await c.maker.post('/contacts', { type: 'SUPPLIER', name: 'Kathmandu Supplies', pan: '301112223', paymentTermsDays: 15 })).body;
    emp = (await c.maker.post('/contacts', { type: 'EMPLOYEE', name: 'Sita Staff' })).body;
  });

  it('duplicate supplier invoice number is blocked (drafts too, case-insensitive)', async () => {
    const line = [{ accountId: c.acct('5430'), quantity: '1', unitPrice: '1000', taxCodeId: c.tax('VAT13') }];
    const b1 = await c.maker.post('/bills', { date: '2026-10-01', contactId: sup.id, supplierInvoiceNo: 'KS-1001', lines: line });
    expect(b1.status).toBe(201);
    const b2 = await c.maker.post('/bills', { date: '2026-10-02', contactId: sup.id, supplierInvoiceNo: 'ks-1001', lines: line });
    expect(b2.body.code).toBe('DOC_DUPLICATE_INVOICE');
    const r = await post(c, 'PURCHASE_BILL', b1.body.id);
    expect(r.docNo).toBe('PB-2083/84-00001');
    const { lines, doc } = await entryLines(c, 'bills', b1.body.id);
    expect(sumBy(lines, '5430', 'debit')).toBe('1000.00');
    expect(sumBy(lines, '1171', 'debit')).toBe('130.00');
    expect(sumBy(lines, '2110', 'credit')).toBe('1130.00');
    expect(doc.due_date).toBe('2026-10-16');
  });

  it('non-claimable VAT is added to the cost of the expense', async () => {
    const b = (await c.maker.post('/bills', { date: '2026-10-03', contactId: sup.id, supplierInvoiceNo: 'KS-1002', lines: [{ accountId: c.acct('5520'), quantity: '1', unitPrice: '2000', taxCodeId: c.tax('VAT13-NC') }] })).body;
    expect(b.non_claimable_tax).toBe('260.00');
    await post(c, 'PURCHASE_BILL', b.id);
    const { lines } = await entryLines(c, 'bills', b.id);
    expect(sumBy(lines, '5520', 'debit')).toBe('2260.00');
    expect(lines.find((l) => l.code === '1171')).toBeUndefined();
  });

  it('payment with TDS withheld settles a bill; debit note reduces AP; AP control = open items', async () => {
    const b = (await c.maker.post('/bills', { date: '2026-10-04', contactId: sup.id, supplierInvoiceNo: 'KS-1003', lines: [{ accountId: c.acct('5440'), quantity: '1', unitPrice: '10000', taxCodeId: c.tax('VAT13') }] })).body; // 11,300
    await post(c, 'PURCHASE_BILL', b.id);
    const tds = (await c.admin.get('/tds-codes')).body.find((t: { code: string }) => t.code === 'TDS-SVC');
    const p = (await c.maker.post('/payments', { date: '2026-10-05', contactId: sup.id, accountId: c.acct('1121'), amount: '11150', tdsCodeId: tds.id, tdsAmount: '150', allocations: [{ targetType: 'PURCHASE_BILL', targetId: b.id, amount: '11300' }] })).body;
    const r = await post(c, 'PAYMENT', p.id);
    expect(r.docNo).toBe('PV-2083/84-00001');
    const { lines } = await entryLines(c, 'payments', p.id);
    expect(sumBy(lines, '2110', 'debit')).toBe('11300.00');
    expect(sumBy(lines, '1121', 'credit')).toBe('11150.00');
    expect(sumBy(lines, '2133', 'credit')).toBe('150.00');
    expect((await c.checker.get(`/bills/${b.id}`)).body.amount_due).toBe('0.00');
    // debit note against the first bill
    const first = (await c.checker.get('/bills')).body.find((x: { supplier_invoice_no: string }) => x.supplier_invoice_no === 'KS-1001');
    const dn = (await c.maker.post('/debit-notes', { date: '2026-10-06', contactId: sup.id, originalBillId: first.id, reason: 'Short supply', lines: [{ accountId: c.acct('5430'), quantity: '1', unitPrice: '100', taxCodeId: c.tax('VAT13') }] })).body;
    await post(c, 'DEBIT_NOTE', dn.id);
    const dl = await entryLines(c, 'debit-notes', dn.id);
    expect(sumBy(dl.lines, '2110', 'debit')).toBe('113.00');
    expect(sumBy(dl.lines, '1171', 'credit')).toBe('13.00');
    expect((await c.checker.get(`/bills/${first.id}`)).body.amount_due).toBe('1017.00');
    const integ = (await c.admin.get('/reports/integrity')).body;
    for (const ch of integ.checks) expect(ch, ch.check).toMatchObject({ ok: true });
    const aging = (await c.checker.get('/reports/aging/AP?asOf=2026-11-30')).body;
    expect(aging.totals.total).toBe('3277.00'); // 1017 + 2260
  });

  it('direct expense (paid) and employee expense claim settled by a claim payment', async () => {
    const ex = (await c.maker.post('/expenses', { date: '2026-10-07', expenseKind: 'PAID', paidFromAccountId: c.acct('1110'), notes: 'Taxi', lines: [{ accountId: c.acct('5460'), quantity: '1', unitPrice: '800' }] })).body;
    await post(c, 'EXPENSE', ex.id);
    const el = await entryLines(c, 'expenses', ex.id);
    expect(sumBy(el.lines, '1110', 'credit')).toBe('800.00');
    const claim = (await c.maker.post('/expenses', { date: '2026-10-07', expenseKind: 'CLAIM', contactId: emp.id, notes: 'Client lunch', lines: [{ accountId: c.acct('5320'), quantity: '1', unitPrice: '1500' }] })).body;
    await post(c, 'EXPENSE', claim.id);
    const cl = await entryLines(c, 'expenses', claim.id);
    expect(sumBy(cl.lines, '2150', 'credit')).toBe('1500.00');
    const pay = (await c.maker.post('/payments', { date: '2026-10-08', contactId: emp.id, kind: 'CLAIM', accountId: c.acct('1110'), amount: '1500', allocations: [{ targetType: 'EXPENSE', targetId: claim.id, amount: '1500' }] })).body;
    await post(c, 'PAYMENT', pay.id);
    const pl = await entryLines(c, 'payments', pay.id);
    expect(sumBy(pl.lines, '2150', 'debit')).toBe('1500.00');
    expect((await c.checker.get(`/expenses/${claim.id}`)).body.amount_due).toBe('0.00');
  });

  it('PO → goods receipt → bill', async () => {
    const item = (await c.maker.post('/items', { sku: 'MASK-50', name: 'Face masks (50)', type: 'NON_INVENTORY', taxApplicability: 'TAXABLE', purchasePrice: '400' })).body;
    const po = (await c.maker.post('/purchase-orders', { date: '2026-10-09', contactId: sup.id, lines: [{ itemId: item.id, quantity: '10', unitPrice: '400' }] })).body;
    expect(po.doc_no).toBe('PO-2083/84-00001');
    const grnEarly = await c.maker.post('/goods-receipts', { date: '2026-10-10', contactId: sup.id, purchaseOrderId: po.id, lines: [{ itemId: item.id, poLineId: po.lines?.[0]?.id, quantity: '4' }] });
    expect(grnEarly.body.code).toBe('APR_INVALID_STATE');
    await c.maker.post(`/purchase-orders/${po.id}/status`, { status: 'ISSUED' });
    const poFull = (await c.maker.get(`/purchase-orders/${po.id}`)).body;
    const g = await c.maker.post('/goods-receipts', { date: '2026-10-10', contactId: sup.id, purchaseOrderId: po.id, lines: [{ itemId: item.id, poLineId: poFull.lines[0].id, quantity: '4' }] });
    expect(g.body.doc_no).toBe('GRN-2083/84-00001');
    expect((await c.maker.get(`/purchase-orders/${po.id}`)).body.status).toBe('PARTIAL');
    const bill = (await c.maker.post(`/purchase-orders/${po.id}/convert`, { to: 'PURCHASE_BILL', supplierInvoiceNo: 'KS-2001' })).body;
    expect(bill.grand_total).toBe('4520.00');
    await post(c, 'PURCHASE_BILL', bill.id);
    expect((await c.maker.get(`/purchase-orders/${po.id}`)).body.status).toBe('BILLED');
  });

  it('Purchase Book lists bills with supplier PAN and taxable / VAT columns', async () => {
    const book = (await c.checker.get('/reports/purchase-book?from=2026-10-01&to=2026-10-31')).body;
    const b = book.rows.find((r: { supplier_invoice_no: string }) => r.supplier_invoice_no === 'KS-1001');
    expect(b).toMatchObject({ supplier_pan: '301112223', taxable_total: '1000.00', tax_total: '130.00' });
    expect(book.returns).toHaveLength(1);
  });
});

describe('Australia: GST 10%', () => {
  it('mixed invoice with GST 10% and GST-free lines; FY2026-27 numbering; ABN on invoice', async () => {
    const c = await companyCtx('AU');
    const cust = (await c.maker.post('/contacts', { type: 'CUSTOMER', name: 'Sydney Cafe Pty Ltd', abn: '51824753556' })).body;
    const inv = (await c.maker.post('/sales-invoices', {
      date: '2026-10-01',
      contactId: cust.id,
      lines: [
        { accountId: c.acct('4100'), description: 'Cleaning supplies', quantity: '3', unitPrice: '333.33', taxCodeId: c.tax('GST') },
        { accountId: c.acct('4100'), description: 'Fresh produce (GST-free)', quantity: '1', unitPrice: '500', taxCodeId: c.tax('FRE') },
      ],
    })).body;
    expect(inv).toMatchObject({ taxable_total: '999.99', zero_rated_total: '500.00', tax_total: '100.00', grand_total: '1599.99' });
    const r = await post(c, 'SALES_INVOICE', inv.id);
    expect(r.docNo).toBe('SI-FY2026-27-00001');
    const h = await c.maker.get(`/print/sales_invoice/${inv.id}?format=html`);
    expect(h.text).toContain('ABN 51824753556');
    expect(h.text).toContain('GST');
    expect(h.text).toContain('Dollars One Thousand Five Hundred Ninety-Nine and Cents Ninety-Nine Only');
    const tb = (await c.checker.get('/reports/trial-balance?from=2026-07-01&to=2027-06-30')).body;
    expect(tb.balanced).toBe(true);
  });
});
