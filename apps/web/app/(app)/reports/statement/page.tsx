'use client';
import Link from 'next/link';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { sourceHref } from '@/lib/docs';
import { ContactSelect } from '@/components/pickers';
import { RangeBar, useRange } from '@/components/report-kit';
import { DateText, Empty, ErrorBanner, Field, Loading, Money, PageHeader } from '@/components/ui';

function Statement() {
  const sp = useSearchParams();
  const router = useRouter();
  const contactId = sp.get('contactId');
  const [r, setR] = useRange();
  const path = `/reports/statement/${contactId}${qs({ from: r.from, to: r.to })}`;
  const q = useQuery({ queryKey: [path], queryFn: () => get(path), enabled: !!contactId && !!r.from });
  return (
    <div>
      <PageHeader title="Customer / supplier statement" subtitle={q.data && `${q.data.contact.name} — ${q.data.period.label}`} />
      <RangeBar r={r} setR={setR}><div className="w-80"><Field label="Contact"><ContactSelect value={contactId} onChange={(v) => router.replace(`/reports/statement?contactId=${v ?? ''}`)} /></Field></div></RangeBar>
      <ErrorBanner error={q.error} />
      {!contactId ? <Empty>Choose a contact.</Empty> : !q.data ? <Loading /> : (
        <div className="panel overflow-x-auto">
          <table className="grid text-sm">
            <thead><tr><th>Date</th><th>Document</th><th>Details</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr><td colSpan={5} className="font-semibold">Opening balance</td><td className="num"><Money v={q.data.openingBalance} /></td></tr>
              {q.data.lines.map((l: any, i: number) => { const href = sourceHref(l.source_type, l.source_id); return (
                <tr key={i}><td><DateText ad={l.entry_date} short /></td><td>{href ? <Link className="underline" href={href}>{l.source_no ?? l.source_type}</Link> : l.source_no}</td><td>{l.description ?? l.narration} <span className="muted text-xs">({l.account_name})</span></td><td className="num"><Money v={l.debit} blankZero /></td><td className="num"><Money v={l.credit} blankZero /></td><td className="num"><Money v={l.balance} /></td></tr>
              ); })}
              <tr className="font-bold"><td colSpan={5}>Closing balance</td><td className="num"><Money v={q.data.closingBalance} /></td></tr>
            </tbody>
          </table>
          <p className="muted text-xs p-3">{q.data.note}</p>
        </div>
      )}
    </div>
  );
}
export default function Page() { return <Suspense><Statement /></Suspense>; }
