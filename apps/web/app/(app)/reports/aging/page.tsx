/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { ExportCsv } from '@/components/report-kit';
import { DateField, ErrorBanner, Loading, Money, PageHeader, today } from '@/components/ui';

function Aging() {
  const sp = useSearchParams();
  const [side, setSide] = useState(sp.get('side') === 'AP' ? 'AP' : 'AR');
  const [asOf, setAsOf] = useState(today());
  const path = `/reports/aging/${side}${qs({ asOf })}`;
  const q = useQuery({ queryKey: [path], queryFn: () => get(path) });
  const cols = [['current', 'Not due'], ['d1_30', '1–30'], ['d31_60', '31–60'], ['d61_90', '61–90'], ['d90_plus', '90+']];
  return (
    <div>
      <PageHeader title={side === 'AR' ? 'Receivables aging' : 'Payables aging'} actions={<ExportCsv path={path} />} />
      <div className="panel p-3 mb-4 flex gap-4 items-end">
        <div><label className="label">Side</label><select className="input" value={side} onChange={(e) => setSide(e.target.value)}><option value="AR">Customers (AR)</option><option value="AP">Suppliers & claims (AP)</option></select></div>
        <div className="w-56"><DateField label="As of" value={asOf} onChange={setAsOf} /></div>
      </div>
      <ErrorBanner error={q.error} />
      {!q.data ? <Loading /> : (
        <div className="panel overflow-x-auto">
          <table className="grid text-sm">
            <thead><tr><th>{side === 'AR' ? 'Customer' : 'Supplier'}</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}<th className="num">Open items</th><th className="num">Unallocated credits</th><th className="num">Net</th></tr></thead>
            <tbody>
              {q.data.contacts.map((c: any) => (
                <tr key={c.contactId}><td><Link className="underline" href={`/reports/statement?contactId=${c.contactId}`}>{c.contactName}</Link></td>{cols.map(([k]) => <td key={k} className="num"><Money v={c[k]} blankZero /></td>)}<td className="num"><Money v={c.total} /></td><td className="num"><Money v={c.unallocatedCredits} blankZero /></td><td className="num font-semibold"><Money v={c.net} /></td></tr>
              ))}
              <tr className="font-bold"><td>Total</td>{cols.map(([k]) => <td key={k} className="num"><Money v={q.data.totals[k]} /></td>)}<td className="num"><Money v={q.data.totals.total} /></td><td className="num"><Money v={q.data.totals.unallocatedCredits} /></td><td className="num"><Money v={q.data.totals.net} /></td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
export default function Page() { return <Suspense><Aging /></Suspense>; }
