/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useSession } from '@/components/providers';
import { DateText, Empty, ErrorBanner, Loading, Money, PageHeader } from '@/components/ui';

/** Banking: every bank / cash / wallet account with what is waiting to be reconciled. */
export default function Banking() {
  const { can } = useSession();
  const q = useQuery({ queryKey: ['bank-accounts'], queryFn: () => get<any[]>('/bank/accounts') });
  return (
    <div className="space-y-4">
      <PageHeader title="Banking" subtitle="Upload your bank statement, then match each line with the payments, receipts and expenses in your books." />
      <ErrorBanner error={q.error} />
      {!q.data ? <Loading /> : q.data.length === 0 ? <Empty>No bank, cash or wallet accounts yet. Add one in the Chart of accounts.</Empty> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {q.data.map((a) => (
            <div key={a.id} className="panel p-4 space-y-2" data-testid={`bank-card-${a.code}`}>
              <div className="flex justify-between gap-2"><div><div className="font-semibold">{a.name}</div><div className="muted text-xs font-mono">{a.code} · {a.subtype}</div></div><div className="text-right"><div className="muted text-xs">Balance in books</div><Money v={a.bookBalance} /></div></div>
              <div className="text-sm flex gap-4"><span><b>{a.unmatchedStatement}</b> to match</span><span><b>{a.matchedStatement}</b> matched</span>{a.ignored > 0 && <span className="muted">{a.ignored} ignored</span>}</div>
              <div className="muted text-xs">{a.lastReconciled ? <>Last reconciled to <DateText ad={a.lastReconciled.date} short /></> : 'Never reconciled'}</div>
              <div className="flex gap-2 pt-1">
                <Link className="btn btn-primary btn-sm" href={`/banking/${a.id}`}>Reconcile</Link>
                {can('bank.import') && <Link className="btn btn-sm" href={`/banking/${a.id}/import`}>Upload statement</Link>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
