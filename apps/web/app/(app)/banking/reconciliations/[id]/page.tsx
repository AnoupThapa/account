/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { DateText, ErrorBanner, Loading, Money } from '@/components/ui';

/** Printable Bank Reconciliation Statement. */
export default function Brs({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['bank-brs', id], queryFn: () => get<any>(`/bank/reconciliations/${id}`) });
  const r = q.data;
  if (!r) return <><ErrorBanner error={q.error} /><Loading /></>;
  const det = r.details ?? {};
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex justify-between print:hidden"><Link className="btn" href={`/banking/${r.account_id}`}>Back</Link><button className="btn btn-primary" onClick={() => window.print()}>Print</button></div>
      <div className="panel p-6 space-y-4" data-testid="brs">
        <div><div className="text-xl font-bold">Bank Reconciliation Statement</div><div className="muted">{r.company.name} · {det.account?.code} {det.account?.name}</div><div className="muted">As at <DateText ad={r.statement_date} /> · prepared by {r.created_by_name} on <DateText ad={String(r.created_at).slice(0, 10)} short /></div></div>
        <table className="grid text-sm"><tbody>
          <tr><td>Balance as per bank statement</td><td className="num"><Money v={r.statement_balance} /></td></tr>
          <tr><td>Balance as per books</td><td className="num"><Money v={r.book_balance} /></td></tr>
          <tr><td>Books items not yet on the statement (net)</td><td className="num"><Money v={r.unmatched_book_net} /></td></tr>
          <tr><td>Statement items ignored (net)</td><td className="num"><Money v={r.unmatched_statement_net} /></td></tr>
          <tr className="font-semibold"><td>Difference</td><td className="num"><Money v={r.difference} /></td></tr>
        </tbody></table>
        {det.outstandingBook?.length > 0 && <div><div className="font-semibold text-sm">Outstanding in books (not yet cleared by the bank)</div><table className="grid text-sm"><tbody>{det.outstandingBook.map((b: any) => <tr key={b.id}><td><DateText ad={b.date} short /></td><td>{b.sourceNo ?? b.entryNo} {b.contactName}</td><td className="num"><Money v={b.amount} /></td></tr>)}</tbody></table></div>}
        {det.ignored?.length > 0 && <div><div className="font-semibold text-sm">Statement lines ignored</div><table className="grid text-sm"><tbody>{det.ignored.map((b: any) => <tr key={b.id}><td><DateText ad={b.date} short /></td><td>{b.description} <span className="muted">({b.reason})</span></td><td className="num"><Money v={b.amount} /></td></tr>)}</tbody></table></div>}
        {r.note && <div className="text-sm"><b>Note:</b> {r.note}</div>}
      </div>
    </div>
  );
}
