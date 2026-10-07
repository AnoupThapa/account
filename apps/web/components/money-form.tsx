/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, money, sum } from '@ledgerpro/shared';
import { get, patch, post } from '@/lib/api';
import { DocDef } from '@/lib/docs';
import { CashAccountSelect, ContactSelect, useTds } from './pickers';
import { DateField, DateText, ErrorBanner, Field, Money, today } from './ui';

export function MoneyForm({ def, existing }: { def: DocDef; existing?: any }) {
  const router = useRouter();
  const qc = useQueryClient();
  const isReceipt = def.key === 'receipts';
  const e = existing;
  const [f, setF] = useState<any>(() => ({
    date: e?.receipt_date ?? e?.payment_date ?? today(),
    contactId: e?.contact_id ?? null,
    kind: e?.kind ?? (isReceipt ? 'RECEIPT' : 'PAYMENT'),
    accountId: e?.deposit_account_id ?? e?.paid_from_account_id ?? null,
    amount: e?.amount ?? '',
    discountAmount: e?.discount_amount ?? '0',
    tdsCodeId: e?.tds_code_id ?? null,
    tdsAmount: e?.tds_amount ?? '0',
    reference: e?.reference ?? '',
    chequeNo: e?.cheque_no ?? '',
    narration: e?.narration ?? '',
  }));
  const [alloc, setAlloc] = useState<Record<string, string>>(() => Object.fromEntries(((e?.planned_allocations as any[]) ?? []).map((a) => [a.targetId, a.amount])));
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const tds = useTds();
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const targetPath = isReceipt ? 'sales-invoices' : f.kind === 'CLAIM' ? 'expenses' : 'bills';
  const open = useQuery({
    queryKey: ['open-items', targetPath, f.contactId],
    queryFn: () => get<any[]>(`/${targetPath}?status=POSTED&unpaid=true&contactId=${f.contactId}`),
    enabled: !!f.contactId && f.kind !== 'ADVANCE',
  });
  const total = d(f.amount || 0).plus(f.discountAmount || 0).plus(f.tdsAmount || 0);
  const allocated = sum(Object.values(alloc).filter(Boolean));

  const save = async (andSubmit: boolean) => {
    setErr(null);
    setBusy(true);
    try {
      const targetType = isReceipt ? 'SALES_INVOICE' : f.kind === 'CLAIM' ? 'EXPENSE' : 'PURCHASE_BILL';
      const body = {
        ...f,
        reference: f.reference || null,
        chequeNo: f.chequeNo || null,
        narration: f.narration || null,
        tdsCodeId: f.tdsCodeId || null,
        allocations: f.kind === 'ADVANCE' ? [] : Object.entries(alloc).filter(([, v]) => v && Number(v) > 0).map(([targetId, amount]) => ({ targetType, targetId, amount })),
        version: e?.version,
      };
      const saved = e ? await patch(`/${def.key}/${e.id}`, body) : await post(`/${def.key}`, body);
      if (andSubmit) await post(`/documents/${def.docType}/${saved.id}/submit`, {});
      await qc.invalidateQueries({ queryKey: [def.key] });
      router.push(`/docs/${def.key}/${saved.id}`);
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const tdsCode = tds.data?.find((t) => t.id === f.tdsCodeId);
  return (
    <div className="space-y-4">
      <ErrorBanner error={err} />
      <div className="panel p-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Type">
          <select className="input" value={f.kind} onChange={(x) => set('kind', x.target.value)}>
            {isReceipt ? (
              <>
                <option value="RECEIPT">Receipt against invoices</option>
                <option value="ADVANCE">Customer advance</option>
              </>
            ) : (
              <>
                <option value="PAYMENT">Payment to supplier</option>
                <option value="ADVANCE">Supplier advance</option>
                <option value="CLAIM">Employee claim settlement</option>
              </>
            )}
          </select>
        </Field>
        <Field label={isReceipt ? 'Customer *' : f.kind === 'CLAIM' ? 'Employee *' : 'Supplier *'}>
          <ContactSelect type={isReceipt ? 'CUSTOMER' : f.kind === 'CLAIM' ? 'EMPLOYEE' : 'SUPPLIER'} value={f.contactId} onChange={(v) => { set('contactId', v); setAlloc({}); }} />
        </Field>
        <DateField label={def.dateLabel} value={f.date} onChange={(v) => set('date', v)} required />
        <Field label={isReceipt ? 'Deposited to *' : 'Paid from *'}><CashAccountSelect value={f.accountId} onChange={(v) => set('accountId', v)} /></Field>
        <Field label={isReceipt ? 'Amount received *' : 'Amount paid *'}><input className="input num" value={f.amount} onChange={(x) => set('amount', x.target.value)} inputMode="decimal" /></Field>
        {f.kind !== 'ADVANCE' && f.kind !== 'CLAIM' && (
          <>
            <Field label={isReceipt ? 'Discount allowed' : 'Discount received'}><input className="input num" value={f.discountAmount} onChange={(x) => set('discountAmount', x.target.value)} inputMode="decimal" /></Field>
            <Field label={isReceipt ? 'TDS deducted by customer' : 'TDS withheld'} hint={tdsCode ? `${tdsCode.name} @ ${Number(tdsCode.rate)}%` : undefined}>
              <div className="flex gap-1">
                <select className="input" value={f.tdsCodeId ?? ''} onChange={(x) => set('tdsCodeId', x.target.value || null)}>
                  <option value="">No TDS</option>
                  {(tds.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.code}</option>)}
                </select>
                <input className="input num" style={{ maxWidth: 110 }} value={f.tdsAmount} onChange={(x) => set('tdsAmount', x.target.value)} inputMode="decimal" />
              </div>
            </Field>
          </>
        )}
        <Field label="Reference"><input className="input" value={f.reference} onChange={(x) => set('reference', x.target.value)} /></Field>
        <Field label="Cheque no."><input className="input" value={f.chequeNo} onChange={(x) => set('chequeNo', x.target.value)} /></Field>
        <div className="lg:col-span-2"><Field label="Narration"><input className="input" value={f.narration} onChange={(x) => set('narration', x.target.value)} /></Field></div>
      </div>
      {f.kind !== 'ADVANCE' && f.contactId && (
        <div className="panel">
          <div className="p-3 flex justify-between text-sm">
            <b>Apply to open {isReceipt ? 'invoices' : f.kind === 'CLAIM' ? 'claims' : 'bills'}</b>
            <span>Total credited <Money v={money(total)} /> · applied <Money v={money(allocated)} /> · left on account <Money v={money(total.minus(allocated))} /></span>
          </div>
          <table className="grid text-sm">
            <thead><tr><th>No.</th><th>Date</th><th className="num">Total</th><th className="num">Due</th><th style={{ width: 160 }}>Apply</th></tr></thead>
            <tbody>
              {(open.data ?? []).map((o) => (
                <tr key={o.id}>
                  <td>{o.doc_no}</td>
                  <td><DateText ad={o.invoice_date ?? o.bill_date ?? o.expense_date} short /></td>
                  <td className="num"><Money v={o.grand_total} /></td>
                  <td className="num"><Money v={o.amount_due} /></td>
                  <td className="flex gap-1">
                    <input className="input num" value={alloc[o.id] ?? ''} onChange={(x) => setAlloc({ ...alloc, [o.id]: x.target.value })} inputMode="decimal" />
                    <button className="btn btn-sm" onClick={() => { const left = total.minus(allocated).plus(alloc[o.id] || 0); const amt = left.lt(o.amount_due) ? left : d(o.amount_due); setAlloc({ ...alloc, [o.id]: amt.gt(0) ? money(amt) : '' }); }}>Max</button>
                  </td>
                </tr>
              ))}
              {!open.data?.length && <tr><td colSpan={5} className="muted">No open items for this contact.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2">
        <button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Save & submit for approval</button>
      </div>
    </div>
  );
}
