'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { sourceHref } from '@/lib/docs';
import { DateText, ErrorBanner, Loading, Money, PageHeader, Status } from '@/components/ui';

export default function Entry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['entry', id], queryFn: () => get(`/reports/entries/${id}`) });
  if (q.error) return <ErrorBanner error={q.error} />;
  if (!q.data) return <Loading />;
  const e = q.data;
  const href = sourceHref(e.source_type, e.source_id);
  return (
    <div className="space-y-4">
      <PageHeader title={`Ledger entry ${e.entry_no}`} subtitle={<><Status s={e.status} /> · <DateText ad={e.entry_date} /> · {e.narration}</>} />
      <div className="text-sm flex flex-wrap gap-4">
        <span>Source: {href ? <Link className="underline" href={href}>{e.source_type} {e.source_no}</Link> : `${e.source_type} ${e.source_no ?? ''}`}</span>
        {e.reversal_of && <Link className="underline" href={`/reports/entry/${e.reversal_of}`}>Reverses an earlier entry →</Link>}
        {e.reversed_by_entry_id && <Link className="underline" href={`/reports/entry/${e.reversed_by_entry_id}`}>Reversed by →</Link>}
        <span className="muted">Posted {new Date(e.posted_at).toLocaleString()}</span>
      </div>
      <div className="panel overflow-x-auto">
        <table className="grid text-sm"><thead><tr><th>#</th><th>Account</th><th>Contact</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>
            {e.lines.map((l: any) => <tr key={l.line_no}><td>{l.line_no}</td><td><Link className="hover:underline" href={`/reports/general-ledger?accountId=${l.account_id}`}>{l.code} · {l.name}</Link></td><td>{l.contact_name}</td><td>{l.description}</td><td className="num"><Money v={l.debit} blankZero /></td><td className="num"><Money v={l.credit} blankZero /></td></tr>)}
            <tr className="font-bold"><td colSpan={4}>Total</td><td className="num"><Money v={e.total} /></td><td className="num"><Money v={e.total} /></td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted text-xs">Posted ledger entries can never be edited or deleted — corrections are made by reversal.</p>
    </div>
  );
}
