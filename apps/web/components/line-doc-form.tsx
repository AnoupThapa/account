/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { calculateTax, TaxType } from '@ledgerpro/shared';
import { get, patch, post } from '@/lib/api';
import { DocDef } from '@/lib/docs';
import { AccountSelect, CashAccountSelect, ContactSelect, CostCentreSelect, ItemSelect, TaxSelect, useItems, useTaxCodes } from './pickers';
import { DateField, ErrorBanner, Field, Money, today } from './ui';

interface Line {
  itemId: string | null;
  accountId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxCodeId: string | null;
  costCentreId: string | null;
}
const blank = (): Line => ({ itemId: null, accountId: null, description: '', quantity: '1', unitPrice: '', discountPercent: '0', taxCodeId: null, costCentreId: null });

export function LineDocForm({ def, existing }: { def: DocDef; existing?: any }) {
  const router = useRouter();
  const qc = useQueryClient();
  const items = useItems();
  const taxes = useTaxCodes();
  const e = existing;
  const [h, setH] = useState<any>(() => ({
    date: e ? e.invoice_date ?? e.note_date ?? e.quote_date ?? e.order_date ?? e.bill_date ?? e.expense_date : today(),
    dueDate: e?.due_date ?? e?.expected_date ?? '',
    validUntil: e?.valid_until ?? '',
    contactId: e?.contact_id ?? null,
    pricesIncludeTax: e?.price_includes_tax ?? false,
    notes: e?.notes ?? e?.narration ?? '',
    reference: e?.customer_ref ?? e?.supplier_ref ?? '',
    cashAccountId: e?.cash_account_id ?? null,
    refundAccountId: e?.refund_account_id ?? null,
    originalInvoiceId: e?.original_invoice_id ?? null,
    originalBillId: e?.original_bill_id ?? null,
    reason: e?.reason ?? '',
    supplierInvoiceNo: e?.supplier_invoice_no ?? '',
    supplierInvoiceDate: e?.supplier_invoice_date ?? '',
    supplierPan: e?.supplier_pan ?? '',
    expenseKind: e?.kind ?? 'PAID',
    paidFromAccountId: e?.paid_from_account_id ?? null,
    cashSale: !!e?.cash_account_id,
    refund: !!e?.refund_account_id,
  }));
  const [lines, setLines] = useState<Line[]>(() =>
    e?.lines?.length
      ? e.lines.map((l: any) => ({ itemId: l.item_id, accountId: l.account_id, description: l.description ?? '', quantity: String(Number(l.quantity)), unitPrice: String(Number(l.unit_price)), discountPercent: String(Number(l.discount_percent)), taxCodeId: l.tax_code_id, costCentreId: l.cost_centre_id }))
      : [blank()],
  );
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => setH((x: any) => ({ ...x, [k]: v }));

  const originals = useQuery({
    queryKey: ['originals', def.key, h.contactId],
    queryFn: () => get<any[]>(`/${def.key === 'credit-notes' ? 'sales-invoices' : 'bills'}?status=POSTED&contactId=${h.contactId}`),
    enabled: !!h.contactId && (def.key === 'credit-notes' || def.key === 'debit-notes'),
  });

  const rateOf = (taxId: string | null) => {
    const t = taxes.data?.find((x) => x.id === taxId);
    if (!t) return { type: 'OUT_OF_SCOPE' as TaxType, rate: '0' };
    const r = (t.rates as any[]).find((r) => r.effective_from <= h.date && (!r.effective_to || r.effective_to >= h.date));
    return { type: t.type as TaxType, rate: r?.rate ?? '0' };
  };
  const preview = useMemo(() => {
    try {
      return calculateTax(
        lines.map((l) => ({ quantity: l.quantity || '0', unitPrice: l.unitPrice || '0', discountPercent: l.discountPercent || '0', taxType: rateOf(l.taxCodeId).type, taxRate: rateOf(l.taxCodeId).rate })),
        { pricesIncludeTax: h.pricesIncludeTax },
      );
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, h.pricesIncludeTax, h.date, taxes.data]);

  const setLine = (i: number, patchL: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patchL } : l)));
  const pickItem = (i: number, id: string | null) => {
    const it = items.data?.find((x) => x.id === id);
    setLine(i, { itemId: id, description: it?.name ?? '', unitPrice: it ? String(Number(def.side === 'SALES' ? it.sales_price : it.purchase_price) || '') : '', taxCodeId: it?.default_tax_code_id ?? null, accountId: null });
  };

  const save = async (andSubmit: boolean) => {
    setErr(null);
    setBusy(true);
    try {
      const body: any = {
        date: h.date,
        dueDate: h.dueDate || null,
        validUntil: h.validUntil || null,
        contactId: h.contactId,
        pricesIncludeTax: h.pricesIncludeTax,
        notes: h.notes || null,
        reference: h.reference || null,
        lines: lines.filter((l) => l.itemId || l.accountId || l.unitPrice).map((l) => ({ ...l, unitPrice: l.unitPrice || '0', quantity: l.quantity || '1', discountPercent: l.discountPercent || '0' })),
        version: e?.version,
      };
      if (def.key === 'sales-invoices') body.cashAccountId = h.cashSale ? h.cashAccountId : null;
      if (def.key === 'credit-notes' || def.key === 'debit-notes') {
        body.refundAccountId = h.refund ? h.refundAccountId : null;
        body.reason = h.reason || null;
        if (def.key === 'credit-notes') body.originalInvoiceId = h.originalInvoiceId;
        else body.originalBillId = h.originalBillId;
      }
      if (def.key === 'bills') Object.assign(body, { supplierInvoiceNo: h.supplierInvoiceNo, supplierInvoiceDate: h.supplierInvoiceDate || null, supplierPan: h.supplierPan || null });
      if (def.key === 'expenses') Object.assign(body, { expenseKind: h.expenseKind, paidFromAccountId: h.expenseKind === 'PAID' ? h.paidFromAccountId : null, supplierInvoiceNo: h.supplierInvoiceNo || null, supplierPan: h.supplierPan || null });
      const saved = e ? await patch(`/${def.key}/${e.id}`, body) : await post(`/${def.key}`, body);
      if (andSubmit && def.docType) await post(`/documents/${def.docType}/${saved.id}/submit`, {});
      await qc.invalidateQueries({ queryKey: [def.key] });
      router.push(`/docs/${def.key}/${saved.id}`);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const isExpense = def.key === 'expenses';
  const contactType = isExpense ? (h.expenseKind === 'CLAIM' ? 'EMPLOYEE' : 'SUPPLIER') : def.contactType;
  return (
    <div className="space-y-4">
      <ErrorBanner error={err} />
      <div className="panel p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {isExpense && (
          <Field label="Type">
            <select className="input" value={h.expenseKind} onChange={(x) => set('expenseKind', x.target.value)}>
              <option value="PAID">Paid now (bank/cash)</option>
              <option value="CLAIM">Employee claim (reimburse later)</option>
            </select>
          </Field>
        )}
        <Field label={def.side === 'SALES' ? 'Customer *' : isExpense ? (h.expenseKind === 'CLAIM' ? 'Employee *' : 'Supplier (optional)') : 'Supplier *'}>
          <ContactSelect type={contactType} value={h.contactId} onChange={(v) => set('contactId', v)} />
        </Field>
        <DateField label={def.dateLabel} value={h.date} onChange={(v) => set('date', v)} required />
        {['sales-invoices', 'bills'].includes(def.key) && <DateField label="Due date (blank = payment terms)" value={h.dueDate} onChange={(v) => set('dueDate', v)} />}
        {def.key === 'sales-quotes' && <DateField label="Valid until" value={h.validUntil} onChange={(v) => set('validUntil', v)} />}
        {['sales-orders', 'purchase-orders'].includes(def.key) && <DateField label="Expected date" value={h.dueDate} onChange={(v) => set('dueDate', v)} />}
        {def.key === 'bills' && (
          <>
            <Field label="Supplier invoice no. *"><input className="input" value={h.supplierInvoiceNo} onChange={(x) => set('supplierInvoiceNo', x.target.value)} /></Field>
            <DateField label="Supplier invoice date" value={h.supplierInvoiceDate} onChange={(v) => set('supplierInvoiceDate', v)} />
          </>
        )}
        {isExpense && h.expenseKind === 'PAID' && (
          <Field label="Paid from *"><CashAccountSelect value={h.paidFromAccountId} onChange={(v) => set('paidFromAccountId', v)} /></Field>
        )}
        {(def.key === 'bills' || isExpense) && <Field label="Supplier PAN/VAT"><input className="input" value={h.supplierPan} onChange={(x) => set('supplierPan', x.target.value)} placeholder="from supplier if blank" /></Field>}
        {isExpense && <Field label="Supplier receipt no."><input className="input" value={h.supplierInvoiceNo} onChange={(x) => set('supplierInvoiceNo', x.target.value)} /></Field>}
        {['sales-invoices', 'sales-orders', 'debit-notes'].includes(def.key) && <Field label={def.side === 'SALES' ? 'Customer ref / PO' : 'Supplier ref'}><input className="input" value={h.reference} onChange={(x) => set('reference', x.target.value)} /></Field>}
        {def.key === 'sales-invoices' && (
          <Field label="Cash sale?">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={h.cashSale} onChange={(x) => set('cashSale', x.target.checked)} /> Paid now</label>
            {h.cashSale && <CashAccountSelect value={h.cashAccountId} onChange={(v) => set('cashAccountId', v)} />}
          </Field>
        )}
        {(def.key === 'credit-notes' || def.key === 'debit-notes') && (
          <>
            <Field label={def.key === 'credit-notes' ? 'Original invoice' : 'Original bill'}>
              <select className="input" value={(def.key === 'credit-notes' ? h.originalInvoiceId : h.originalBillId) ?? ''} onChange={(x) => set(def.key === 'credit-notes' ? 'originalInvoiceId' : 'originalBillId', x.target.value || null)}>
                <option value="">— none —</option>
                {(originals.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.doc_no} · {o.grand_total}</option>)}
              </select>
            </Field>
            <Field label="Reason"><input className="input" value={h.reason} onChange={(x) => set('reason', x.target.value)} /></Field>
            <Field label="Refund in cash?">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={h.refund} onChange={(x) => set('refund', x.target.checked)} /> Cash refund</label>
              {h.refund && <CashAccountSelect value={h.refundAccountId} onChange={(v) => set('refundAccountId', v)} />}
            </Field>
          </>
        )}
        <Field label="Prices">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={h.pricesIncludeTax} onChange={(x) => set('pricesIncludeTax', x.target.checked)} /> Prices include VAT/GST</label>
        </Field>
      </div>

      <div className="panel overflow-x-auto">
        <table className="grid min-w-[900px]">
          <thead>
            <tr><th style={{ width: 230 }}>Item</th><th>Description / account</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 110 }}>Rate</th><th style={{ width: 80 }}>Disc %</th><th style={{ width: 130 }}>Tax</th><th className="num" style={{ width: 110 }}>Amount</th><th /></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><ItemSelect value={l.itemId} onChange={(v) => pickItem(i, v)} placeholder="(no item)" /></td>
                <td className="space-y-1">
                  <input className="input" placeholder="Description" value={l.description} onChange={(x) => setLine(i, { description: x.target.value })} />
                  {!l.itemId && <AccountSelect value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} placeholder={def.side === 'SALES' ? 'Income account…' : 'Expense / asset account…'} />}
                  <CostCentreSelect value={l.costCentreId} onChange={(v) => setLine(i, { costCentreId: v })} />
                </td>
                <td><input className="input num" value={l.quantity} onChange={(x) => setLine(i, { quantity: x.target.value })} inputMode="decimal" /></td>
                <td><input className="input num" value={l.unitPrice} onChange={(x) => setLine(i, { unitPrice: x.target.value })} inputMode="decimal" /></td>
                <td><input className="input num" value={l.discountPercent} onChange={(x) => setLine(i, { discountPercent: x.target.value })} inputMode="decimal" /></td>
                <td><TaxSelect value={l.taxCodeId} onChange={(v) => setLine(i, { taxCodeId: v })} /></td>
                <td className="num"><Money v={preview?.lines[i]?.net} /></td>
                <td><button className="btn btn-sm" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} aria-label="Remove line">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-3 flex flex-wrap justify-between items-start gap-4">
          <button className="btn btn-sm" onClick={() => setLines((ls) => [...ls, blank()])}>+ Add line</button>
          {preview && (
            <table className="text-sm">
              <tbody>
                <tr><td className="pr-6 muted">Sub-total</td><td className="num"><Money v={preview.subtotal} /></td></tr>
                {Number(preview.exemptTotal) > 0 && <tr><td className="pr-6 muted">Exempt / non-taxable</td><td className="num"><Money v={preview.exemptTotal} /></td></tr>}
                {Number(preview.zeroRatedTotal) > 0 && <tr><td className="pr-6 muted">Zero-rated</td><td className="num"><Money v={preview.zeroRatedTotal} /></td></tr>}
                <tr><td className="pr-6 muted">Taxable</td><td className="num"><Money v={preview.taxableTotal} /></td></tr>
                <tr><td className="pr-6 muted">VAT / GST</td><td className="num"><Money v={preview.taxTotal} /></td></tr>
                <tr><td className="pr-6 font-bold">Total</td><td className="num font-bold"><Money v={preview.grandTotal} /></td></tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
      <Field label="Notes"><textarea className="input" rows={2} value={h.notes} onChange={(x) => set('notes', x.target.value)} /></Field>
      <div className="flex gap-2">
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
        {def.docType && <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Save & submit for approval</button>}
      </div>
      <p className="muted text-xs">Totals are re-calculated by the server using the tax rate effective on the document date.</p>
    </div>
  );
}
