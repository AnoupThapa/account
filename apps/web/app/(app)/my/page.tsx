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
import { ApiError, get, post } from '@/lib/api';
import { AttBadge, fmtHours, fmtTime, Row } from '@/components/staff-ui';
import { DateText, ErrorBanner, Loading, Money, Notice, PageHeader } from '@/components/ui';

/** Staff self-service: my profile, today's clock-in, pay summary. */
export default function MyProfile() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me-staff'], queryFn: () => get('/me/staff'), retry: false });
  const slips = useQuery({ queryKey: ['me-payslips'], queryFn: () => get<any[]>('/me/payslips'), retry: false });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const act = async (path: string) => {
    setErr(null);
    setBusy(true);
    try {
      await post(path, {});
      await qc.invalidateQueries({ queryKey: ['me-staff'] });
      await qc.invalidateQueries({ queryKey: ['me-attendance'] });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.code === 'HR_NOT_STAFF') return <Notice tone="warn">Your login is not linked to a staff record yet. Please ask HR to create your staff profile.</Notice>;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const e = q.data;
  const today = e.today;
  const rec = today.record;
  const unread = (slips.data ?? []).filter((s) => !s.viewed_at).length;
  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title={e.full_name} subtitle={`${e.designation ?? 'Staff'}${e.department ? ' · ' + e.department : ''} · ${e.code}`} />
      <ErrorBanner error={err} />
      {unread > 0 && (
        <Notice tone="ok">
          You have {unread} new payslip{unread > 1 ? 's' : ''}. <Link className="underline" href="/my/payslips">Open my payslips</Link>
        </Notice>
      )}
      <div className="panel p-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <div className="muted text-xs font-semibold uppercase">Today · <DateText ad={today.date} /></div>
            <div className="mt-1 flex items-center gap-2">
              {rec ? <AttBadge s={rec.status} /> : today.weeklyOff ? <AttBadge s="WEEKLY_OFF" /> : <AttBadge s="NOT_MARKED" />}
              <span className="text-sm">In {fmtTime(rec?.check_in, today.timezone)} · Out {fmtTime(rec?.check_out, today.timezone)} · {fmtHours(rec?.worked_minutes ?? 0)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy || !!rec?.check_in} onClick={() => act('/me/attendance/clock-in')}>Clock in</button>
            <button className="btn" disabled={busy || !rec?.check_in || !!rec?.check_out} onClick={() => act('/me/attendance/clock-out')}>Clock out</button>
          </div>
        </div>
        <p className="muted text-xs mt-2">Times follow your company's time zone ({today.timezone}). Forgot to clock out? Ask HR to correct it.</p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="panel p-4">
          <div className="font-semibold mb-2">My details</div>
          <table className="text-sm w-full"><tbody>
            <Row label="Employment" v={e.employment_type.replace('_', ' ').toLowerCase()} />
            <Row label="Joined" v={e.join_date ? <DateText ad={e.join_date} /> : '—'} />
            <Row label="Email" v={e.email ?? '—'} />
            <Row label="Phone" v={e.phone ?? '—'} />
            <Row label="PAN" v={e.pan ?? '—'} />
            <Row label="SSF no." v={e.ssf_no ?? '—'} />
            <Row label="Bank" v={e.bank_name ? `${e.bank_name} · ${e.bank_account ?? ''}` : '—'} />
          </tbody></table>
          <p className="muted text-xs mt-2">To change any of these, ask HR.</p>
        </div>
        <div className="panel p-4">
          <div className="font-semibold mb-2">My current salary</div>
          {e.salary ? (
            <table className="text-sm w-full"><tbody>
              <Row label="Basic salary" v={<Money v={e.salary.basic_salary} />} />
              <Row label="Allowance" v={<Money v={e.salary.allowance} />} />
              <Row label="Other allowance" v={<Money v={e.salary.other_allowance} />} />
              <Row label="From" v={<DateText ad={e.salary.effective_from} />} />
            </tbody></table>
          ) : <p className="muted text-sm">No salary has been set yet.</p>}
          <div className="mt-3 flex gap-2 text-sm"><Link className="btn btn-sm" href="/my/payslips">My payslips</Link><Link className="btn btn-sm" href="/my/certificates">TDS certificates</Link></div>
        </div>
      </div>
    </div>
  );
}
