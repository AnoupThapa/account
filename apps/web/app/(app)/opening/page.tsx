/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, money, sum } from '@ledgerpro/shared';
import { get, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { AccountSelect, ContactSelect } from '@/components/pickers';
import { DateField, DateText, ErrorBanner, Field, Loading, Money, Notice, PageHeader, Status } from '@/components/ui';

interface L { kind: 'ACCOUNT' | 'CUSTOMER' | 'SUPPLIER'; accountId: string | null; contactId: string | null; reference: string; docDate: string; dueDate: string; debit: string; credit: string }
const blank = (kind: L['kind'] = 'ACCOUNT'): L => ({ kind, accountId: null, contactId: null, reference: '', docDate: '', dueDate: '', debit: '', credit: '' });

export default function Opening() {
  const { can } = useSession();
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ['opening'], queryFn: () => get('/opening-balances') });
  const fys = useQuery({ queryKey: ['fiscal-years'], queryFn: () => get<any[]>('/fiscal-years') });
  const [asOf, setAsOf] = useState('');
  const [lines, setLines] = useState<L[]>([blank(), blank()]);
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!st.data) return <Loading />;
  const s = st.data;
  const fyStart = fys.data?.[fys.data.length - 1]?.start_date ?? '';
  const dr = sum(lines.map((l) => l.debit || 0));
  const cr = sum(lines.map((l) => l.credit || 0));
  const setLine = (i: number, p: Partial<L>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Opening balances" subtitle="Enter your trial balance at go-live plus customers' and suppliers' open invoices (for aging). The difference goes to Opening Balance Equity, which must be zero before going live." />
      <ErrorBanner error={err} />
      {msg && <Notice tone="ok">{msg}</Notice>}
      <div className="panel p-4 flex flex-wrap gap-6 items-center">
        <div>Status: <Status s={s.goLiveStatus} /></div>
        <div>Go-live date: {s.goLiveDate ? <DateText ad={s.goLiveDate} /> : '—'}</div>
        <div>Opening Balance Equity: <b><Money v={s.openingBalanceEquity} /></b></div>
        {s.goLiveStatus === 'SETUP' && can('opening.go_live') && (
          <>
            <button className="btn btn-primary" onClick={() => run(() => post('/opening-balances/go-live', {}), 'Company is now LIVE.')}>Go live</button>
            {Number(s.openingBalanceEquity) !== 0 && can('journal.post_control') && (
              <button className="btn" onClick={() => run(() => post('/opening-balances/transfer-difference', { target: 'RETAINED_EARNINGS', date: s.goLiveDate ?? fyStart }), 'A journal moving the difference to Retained Earnings was submitted for approval.')}>Accept difference → Retained Earnings (journal)</button>
            )}
          </>
        )}
      </div>
      {s.documents.length > 0 && (
        <div className="panel"><table className="grid text-sm"><thead><tr><th>No.</th><th>As of</th><th className="num">Total</th><th className="num">To OBE</th><th>Status</th></tr></thead>
          <tbody>{s.documents.map((x: any) => <tr key={x.id}><td><Link className="underline" href={`/opening/${x.id}`}>{x.doc_no ?? 'draft'}</Link></td><td><DateText ad={x.as_of_date} short /></td><td className="num"><Money v={x.total} /></td><td className="num"><Money v={x.obe_difference} /></td><td><Status s={x.status} /></td></tr>)}</tbody></table></div>
      )}
      {s.goLiveStatus === 'SETUP' && can('opening.create') && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-bold">New opening balance entry</h2>
          <div className="max-w-xs"><DateField label="Go-live date (usually first day of a fiscal year or month)" value={asOf || fyStart} onChange={setAsOf} /></div>
          <div className="overflow-x-auto">
            <table className="grid min-w-[900px] text-sm">
              <thead><tr><th style={{ width: 130 }}>Type</th><th>Account / contact</th><th>Invoice ref</th><th>Invoice date</th><th>Due</th><th className="num" style={{ width: 120 }}>Debit</th><th className="num" style={{ width: 120 }}>Credit</th><th /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td><select className="input" value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as L['kind'], accountId: null, contactId: null })}><option value="ACCOUNT">Account</option><option value="CUSTOMER">Customer invoice</option><option value="SUPPLIER">Supplier bill</option></select></td>
                    <td>{l.kind === 'ACCOUNT' ? <AccountSelect value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} filter={(a) => !['AR_CONTROL', 'AP_CONTROL', 'OPENING_BALANCE_EQUITY'].includes(a.system_key)} /> : <ContactSelect type={l.kind} value={l.contactId} onChange={(v) => setLine(i, { contactId: v })} />}</td>
                    <td>{l.kind !== 'ACCOUNT' && <input className="input" value={l.reference} onChange={(e) => setLine(i, { reference: e.target.value })} />}</td>
                    <td>{l.kind !== 'ACCOUNT' && <input type="date" className="input" value={l.docDate} onChange={(e) => setLine(i, { docDate: e.target.value })} />}</td>
                    <td>{l.kind !== 'ACCOUNT' && <input type="date" className="input" value={l.dueDate} onChange={(e) => setLine(i, { dueDate: e.target.value })} />}</td>
                    <td><input className="input num" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} /></td>
                    <td><input className="input num" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} /></td>
                    <td><button className="btn btn-sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
                <tr><td colSpan={5}><button className="btn btn-sm" onClick={() => setLines([...lines, blank()])}>+ Line</button> <span className="muted ml-3">Difference to Opening Balance Equity: <Money v={money(dr.minus(cr))} /></span></td><td className="num font-bold"><Money v={money(dr)} /></td><td className="num font-bold"><Money v={money(cr)} /></td><td /></tr>
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary" onClick={() => run(async () => {
            const r = await post('/opening-balances', { asOfDate: asOf || fyStart, lines: lines.filter((l) => (l.accountId || l.contactId) && (d(l.debit || 0).gt(0) || d(l.credit || 0).gt(0))).map((l) => ({ ...l, debit: l.debit || '0', credit: l.credit || '0', docDate: l.docDate || null, dueDate: l.dueDate || null, reference: l.reference || null })) });
            await post(`/documents/OPENING_BALANCE/${r.id}/submit`, {});
            setLines([blank(), blank()]);
          }, 'Submitted for approval.')}>Save & submit for approval</button>
        </div>
      )}
    </div>
  );
}
