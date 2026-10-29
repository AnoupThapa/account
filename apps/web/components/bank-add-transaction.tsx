/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { d, money } from '@ledgerpro/shared';
import { get, post } from '@/lib/api';
import { AccountSelect, ContactSelect, TaxSelect } from './pickers';
import { DateText, ErrorBanner, Field, Modal, Money } from './ui';

type Kind = 'RECEIPT' | 'PAYMENT' | 'EXPENSE' | 'CHARGE' | 'INTEREST' | 'OTHER' | 'UNIDENTIFIED';
const LABEL: Record<Kind, string> = {
  RECEIPT: 'Customer receipt (pays sales invoices)',
  PAYMENT: 'Supplier payment (pays bills)',
  EXPENSE: 'Expense',
  CHARGE: 'Bank charge',
  INTEREST: 'Interest / other income or expense',
  OTHER: 'Other (choose the account)',
  UNIDENTIFIED: 'Unidentified — park in Suspense',
};

/** Create the missing transaction for one statement line without leaving the reconcile screen. */
export function AddTransaction({ line, accountId, onClose, onDone }: { line: any; accountId: string; onClose: () => void; onDone: (msg: string) => void }) {
  const isIn = Number(line.amount) > 0;
  const amt = money(d(line.amount).abs());
  const kinds: Kind[] = isIn ? ['RECEIPT', 'INTEREST', 'UNIDENTIFIED'] : ['PAYMENT', 'EXPENSE', 'CHARGE', 'OTHER', 'UNIDENTIFIED'];
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [accId, setAccId] = useState<string | null>(null);
  const [taxId, setTaxId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const target = kind === 'RECEIPT' ? 'sales-invoices' : 'bills';
  const open = useQuery({ queryKey: ['open-items', target, contactId], queryFn: () => get<any[]>(`/${target}?status=POSTED&unpaid=true&contactId=${contactId}`), enabled: !!contactId && (kind === 'RECEIPT' || kind === 'PAYMENT') });
  const allocated = Object.values(alloc).reduce((s, v) => s.plus(v || 0), d(0));
  const reference = line.reference || line.cheque_no || null;

  // pre-fill: pay the oldest invoices first, up to the amount on the statement
  const autoFill = () => {
    let left = d(amt);
    const out: Record<string, string> = {};
    for (const i of open.data ?? []) {
      if (left.lte(0)) break;
      const take = left.lt(i.amount_due) ? left : d(i.amount_due);
      out[i.id] = money(take);
      left = left.minus(take);
    }
    setAlloc(out);
  };

  const go = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (kind === 'RECEIPT' || kind === 'PAYMENT') {
        const targetType = kind === 'RECEIPT' ? 'SALES_INVOICE' : 'PURCHASE_BILL';
        const doc = await post(kind === 'RECEIPT' ? '/receipts' : '/payments', {
          date: line.txn_date, contactId, kind, accountId, amount: amt, reference, narration: text || line.description || null,
          allocations: Object.entries(alloc).filter(([, v]) => v && Number(v) > 0).map(([targetId, amount]) => ({ targetType, targetId, amount })),
        });
        const link = await post(`/bank/lines/${line.id}/link-doc`, { docType: kind, docId: doc.id });
        const sub = await post(`/documents/${kind}/${doc.id}/submit`, {});
        onDone(sub.status === 'POSTED' ? `${kind === 'RECEIPT' ? 'Receipt' : 'Payment'} posted and matched.` : `Sent for approval. It will match this line automatically once approved.`);
        void link;
      } else if (kind === 'EXPENSE') {
        const doc = await post('/expenses', { date: line.txn_date, expenseKind: 'PAID', paidFromAccountId: accountId, contactId: contactId || null, pricesIncludeTax: true, notes: text || line.description || null, reference, lines: [{ accountId: accId, quantity: '1', unitPrice: amt, taxCodeId: taxId || undefined, description: line.description?.slice(0, 200) || undefined }] });
        await post(`/bank/lines/${line.id}/link-doc`, { docType: 'EXPENSE', docId: doc.id });
        const sub = await post(`/documents/EXPENSE/${doc.id}/submit`, {});
        onDone(sub.status === 'POSTED' ? 'Expense posted and matched.' : 'Sent for approval. It will match this line automatically once approved.');
      } else {
        const r = await post(`/bank/lines/${line.id}/journal`, { kind, accountId: accId || undefined, description: text || undefined });
        onDone(r.submit?.status === 'POSTED' ? 'Journal posted and matched.' : 'Journal sent for approval. It will match this line automatically once approved.');
      }
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };

  const needsAccount = ['EXPENSE', 'INTEREST', 'OTHER'].includes(kind);
  const ready = kind === 'RECEIPT' || kind === 'PAYMENT' ? !!contactId && allocated.lte(amt) : needsAccount ? !!accId : true;
  return (
    <Modal open onClose={onClose} title="Add the missing transaction" wide>
      <div className="space-y-3">
        <ErrorBanner error={err} />
        <div className="panel p-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
          <span><DateText ad={line.txn_date} /></span><span>{line.description}</span>{reference && <span className="muted">Ref {reference}</span>}<span className="ml-auto font-semibold"><Money v={line.amount} /></span>
        </div>
        <Field label="What is this?">
          <select className="input" value={kind} onChange={(e) => { setKind(e.target.value as Kind); setAlloc({}); setAccId(null); }} data-testid="addtx-kind">
            {kinds.map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
          </select>
        </Field>
        {(kind === 'RECEIPT' || kind === 'PAYMENT') && (
          <>
            <Field label={kind === 'RECEIPT' ? 'Customer' : 'Supplier'}><ContactSelect type={kind === 'RECEIPT' ? 'CUSTOMER' : 'SUPPLIER'} value={contactId} onChange={(v) => { setContactId(v); setAlloc({}); }} /></Field>
            {contactId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between"><div className="text-sm font-semibold">Which {kind === 'RECEIPT' ? 'invoices' : 'bills'} does this pay?</div><button className="btn btn-sm" onClick={autoFill} disabled={!open.data?.length}>Fill oldest first</button></div>
                {open.data && open.data.length === 0 && <div className="muted text-sm">No unpaid {kind === 'RECEIPT' ? 'invoices' : 'bills'} for this contact — it will be saved as an unallocated {kind === 'RECEIPT' ? 'receipt' : 'payment'} you can apply later.</div>}
                {open.data && open.data.length > 0 && (
                  <table className="grid text-sm"><thead><tr><th>Number</th><th>Date</th><th className="num">Due</th><th className="num">Pay now</th></tr></thead>
                    <tbody>{open.data.map((i: any) => <tr key={i.id}><td>{i.doc_no}</td><td><DateText ad={i.invoice_date ?? i.bill_date} short /></td><td className="num">{i.amount_due}</td>
                      <td className="num"><input className="input w-28 text-right" inputMode="decimal" value={alloc[i.id] ?? ''} onChange={(e) => setAlloc({ ...alloc, [i.id]: e.target.value })} aria-label={`Pay ${i.doc_no}`} /></td></tr>)}</tbody></table>
                )}
                <div className="text-xs muted">Allocated {money(allocated)} of {amt}{allocated.gt(amt) && <span style={{ color: 'var(--danger)' }}> — more than the statement amount</span>}</div>
              </div>
            )}
          </>
        )}
        {needsAccount && <Field label={kind === 'EXPENSE' ? 'Expense account' : 'Account'}><AccountSelect value={accId} onChange={setAccId} filter={(a) => !a.is_control && !a.requires_contact && a.id !== accountId && (kind !== 'EXPENSE' || a.class === 'EXPENSE')} /></Field>}
        {kind === 'EXPENSE' && <div className="grid sm:grid-cols-2 gap-3"><Field label="Tax (the amount already includes it)"><TaxSelect value={taxId} onChange={setTaxId} /></Field><Field label="Supplier (optional)"><ContactSelect type="SUPPLIER" value={contactId} onChange={setContactId} /></Field></div>}
        {kind === 'CHARGE' && <div className="muted text-sm">Posted to the Bank Charges account. Choose a different account under “Other” if needed.</div>}
        {kind === 'UNIDENTIFIED' && <div className="muted text-sm">Posted to the Suspense account until someone works out what it is and reclassifies it.</div>}
        <Field label="Note (optional)"><input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={line.description} /></Field>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={busy || !ready} onClick={go} data-testid="addtx-save">{busy ? 'Saving…' : 'Save and match'}</button><button className="btn" onClick={onClose}>Cancel</button></div>
        <div className="muted text-xs">Every transaction follows your normal approval rules. If approval is needed, this line is matched automatically as soon as it is approved.</div>
      </div>
    </Modal>
  );
}
