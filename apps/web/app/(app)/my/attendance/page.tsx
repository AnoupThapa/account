/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { AttBadge, fmtHours, fmtTime, monthRange, thisMonth, Tile } from '@/components/staff-ui';
import { DateText, ErrorBanner, Loading, PageHeader } from '@/components/ui';

export default function MyAttendance() {
  const [ym, setYm] = useState(thisMonth());
  const r = monthRange(ym);
  const q = useQuery({ queryKey: ['me-attendance', ym], queryFn: () => get(`/me/attendance${qs(r)}`) });
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const s = q.data.summary;
  const tz = q.data.today.timezone;
  return (
    <div className="space-y-4 max-w-4xl">
      <PageHeader title="My attendance" subtitle="Your clock-in and clock-out history. HR can correct mistakes." actions={<input type="month" className="input" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="Month" />} />
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        <Tile label="Present" value={s.present} /><Tile label="Late" value={s.late} /><Tile label="Half day" value={s.halfDay} /><Tile label="Absent" value={s.absent} /><Tile label="Leave" value={s.leave} /><Tile label="Holiday" value={s.holiday} /><Tile label="Weekly off" value={s.weeklyOff} />
      </div>
      <div className="panel overflow-x-auto">
        <table className="grid text-sm">
          <thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th><th>Note</th></tr></thead>
          <tbody>
            {q.data.days.map((d: any) => (
              <tr key={d.date}><td><DateText ad={d.date} /></td><td><AttBadge s={d.status} /></td><td>{fmtTime(d.check_in, tz)}</td><td>{fmtTime(d.check_out, tz)}</td><td>{fmtHours(d.worked_minutes)}</td><td className="muted text-xs">{d.source === 'MANUAL' ? `Set by HR${d.remarks ? ': ' + d.remarks : ''}` : ''}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
