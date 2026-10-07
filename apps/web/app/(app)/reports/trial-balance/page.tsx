/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { ExportCsv, RangeBar, useRange } from '@/components/report-kit';
import { ErrorBanner, Loading, Money, PageHeader } from '@/components/ui';

export default function TB() {
  const [r, setR] = useRange();
  const [zero, setZero] = useState(false);
  const path = `/reports/trial-balance${qs({ from: r.from, to: r.to, includeZero: zero })}`;
  const q = useQuery({ queryKey: [path], queryFn: () => get(path), enabled: !!r.from });
  return (
    <div>
      <PageHeader title="Trial balance" subtitle={q.data?.period.label} actions={<ExportCsv path={path} />} />
      <RangeBar r={r} setR={setR}><label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Show zero balances</label></RangeBar>
      <ErrorBanner error={q.error} />
      {!q.data ? <Loading /> : (
        <div className="panel overflow-x-auto">
          {!q.data.balanced && <div className="p-3 font-bold" style={{ color: 'var(--danger)' }}>⚠ Trial balance does not agree — contact support.</div>}
          <table className="grid text-sm">
            <thead><tr><th>Code</th><th>Account</th><th className="num">Opening Dr</th><th className="num">Opening Cr</th><th className="num">Period Dr</th><th className="num">Period Cr</th><th className="num">Closing Dr</th><th className="num">Closing Cr</th></tr></thead>
            <tbody>
              {q.data.rows.map((x: any) => (
                <tr key={x.accountId}>
                  <td className="font-mono">{x.code}</td>
                  <td><Link className="hover:underline" href={`/reports/general-ledger?accountId=${x.accountId}&from=${r.from}&to=${r.to}`}>{x.name}</Link></td>
                  {['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'].map((k) => <td key={k} className="num"><Money v={x[k]} blankZero /></td>)}
                </tr>
              ))}
              <tr className="font-bold">
                <td /><td>Total {q.data.balanced ? '✔' : '✖'}</td>
                {['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'].map((k) => <td key={k} className="num"><Money v={q.data.totals[k]} /></td>)}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
