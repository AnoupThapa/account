/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { sourceHref } from '@/lib/docs';
import { AccountSelect } from '@/components/pickers';
import { ExportCsv, RangeBar, useRange } from '@/components/report-kit';
import { DateText, Empty, ErrorBanner, Field, Loading, Money, PageHeader } from '@/components/ui';

function GL() {
  const sp = useSearchParams();
  const router = useRouter();
  const [r, setR] = useRange();
  const accountId = sp.get('accountId');
  useEffect(() => {
    const f = sp.get('from');
    const t = sp.get('to');
    if (f && t) setR({ from: f, to: t });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const path = `/reports/general-ledger${qs({ accountId, from: r.from, to: r.to })}`;
  const q = useQuery({ queryKey: [path], queryFn: () => get(path), enabled: !!accountId && !!r.from });
  return (
    <div>
      <PageHeader title="General ledger" subtitle={q.data && `${q.data.account.code} · ${q.data.account.name} — ${q.data.period.label}`} actions={accountId && <ExportCsv path={path} />} />
      <RangeBar r={r} setR={setR}>
        <div className="w-80"><Field label="Account"><AccountSelect value={accountId} onChange={(v) => router.replace(`/reports/general-ledger?accountId=${v ?? ''}`)} /></Field></div>
      </RangeBar>
      <ErrorBanner error={q.error} />
      {!accountId ? <Empty>Choose an account.</Empty> : !q.data ? <Loading /> : (
        <div className="panel overflow-x-auto">
          <table className="grid text-sm">
            <thead><tr><th>Date</th><th>Entry</th><th>Source</th><th>Narration</th><th>Contact</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              <tr><td colSpan={7} className="font-semibold">Opening balance</td><td className="num font-semibold"><Money v={q.data.openingBalance} /></td></tr>
              {q.data.lines.map((l: any) => {
                const href = sourceHref(l.source_type, l.source_id);
                return (
                  <tr key={l.id}>
                    <td><DateText ad={l.entry_date} short /></td>
                    <td><Link className="underline font-mono text-xs" href={`/reports/entry/${l.entry_id}`}>{l.entry_no}</Link>{l.status === 'REVERSED' && <span className="badge badge-REVERSED ml-1">rev</span>}</td>
                    <td className="text-xs">{href ? <Link className="underline" href={href}>{l.source_no ?? l.source_type}</Link> : l.source_no ?? l.source_type}</td>
                    <td>{l.description ?? l.narration}</td>
                    <td>{l.contact_name}</td>
                    <td className="num"><Money v={l.debit} blankZero /></td>
                    <td className="num"><Money v={l.credit} blankZero /></td>
                    <td className="num"><Money v={l.balance} /></td>
                  </tr>
                );
              })}
              <tr className="font-bold"><td colSpan={5}>Closing balance (debit + / credit −)</td><td className="num"><Money v={q.data.totalDebit} /></td><td className="num"><Money v={q.data.totalCredit} /></td><td className="num"><Money v={q.data.closingBalance} /></td></tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
export default function Page() {
  return <Suspense><GL /></Suspense>;
}
