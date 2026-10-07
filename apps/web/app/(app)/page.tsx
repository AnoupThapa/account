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
import { DateText, ErrorBanner, Loading, Money, PageHeader } from '@/components/ui';

function Tile({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string }) {
  const body = (
    <div className="panel p-4 h-full">
      <div className="muted text-xs font-semibold uppercase">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="muted text-xs mt-1">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export default function Home() {
  const { access, can } = useSession();
  const s = useQuery({ queryKey: ['summary'], queryFn: () => get('/reports/summary') });
  const ob = useQuery({ queryKey: ['opening'], queryFn: () => get('/opening-balances'), enabled: can('opening.view') });
  return (
    <div>
      <PageHeader title={access?.company?.name ?? 'Home'} subtitle={s.data && <>Position as of <DateText ad={s.data.asOf} /> · management accounts (unaudited)</>} />
      <ErrorBanner error={s.error} />
      {ob.data?.goLiveStatus === 'SETUP' && (
        <div className="panel p-3 mb-4 text-sm" style={{ borderColor: 'var(--warn)' }}>
          This company is in <b>setup</b>. Enter <Link className="underline" href="/opening">opening balances</Link> and go live when Opening Balance Equity is zero.
        </div>
      )}
      {!s.data ? (
        <Loading />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Cash & bank" value={<Money v={s.data.cashAndBank} />} />
          <Tile label="Receivables" value={<Money v={s.data.receivables} />} sub={<>Overdue <Money v={s.data.receivablesOverdue} /></>} href="/reports/aging?side=AR" />
          <Tile label="Payables" value={<Money v={s.data.payables} />} sub={<>Due in 7 days <Money v={s.data.payablesDueIn7Days} /></>} href="/reports/aging?side=AP" />
          <Tile label="Pending approvals" value={s.data.pendingApprovals} href="/approvals" />
          <Tile label="Income (FY to date)" value={<Money v={s.data.incomeYtd} />} />
          <Tile label="Expenses (FY to date)" value={<Money v={s.data.expenseYtd} />} />
          <Tile label="Profit (FY to date)" value={<Money v={s.data.profitYtd} />} sub="Before tax and year-end adjustments" />
        </div>
      )}
      <p className="muted text-xs mt-6">Full dashboard with charts, ratios and the downloadable Financial Summary arrives in Phase 4.</p>
    </div>
  );
}
