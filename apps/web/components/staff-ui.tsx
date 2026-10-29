/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

export const ATT_LABEL: Record<string, string> = { PRESENT: 'Present', LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off', NOT_MARKED: 'Not marked' };
const ATT_COLOR: Record<string, string> = { PRESENT: '#047857', LATE: '#b45309', HALF_DAY: '#b45309', ABSENT: '#b91c1c', LEAVE: '#1d4ed8', HOLIDAY: '#6d28d9', WEEKLY_OFF: '#6b7280', NOT_MARKED: '#6b7280' };

export function AttBadge({ s }: { s: string }) {
  return (
    <span className="badge" style={{ color: ATT_COLOR[s] ?? '#374151', borderColor: ATT_COLOR[s] ?? '#374151' }}>
      {ATT_LABEL[s] ?? s}
    </span>
  );
}

/** Accounting periods of the company (for choosing a payslip month). */
export function usePeriods() {
  const q = useQuery({ queryKey: ['fiscal-years'], queryFn: () => get<any[]>('/fiscal-years'), staleTime: 60_000 });
  const periods: { id: string; name: string; start_date: string; end_date: string; fy: string }[] = (q.data ?? []).flatMap((f) => f.periods.filter((p: any) => !p.is_adjustment).map((p: any) => ({ id: p.id, name: p.name, start_date: p.start_date, end_date: p.end_date, fy: f.label })));
  return { ...q, periods };
}

export function monthRange(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
export const thisMonth = () => new Date().toISOString().slice(0, 7);

export function fmtTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: tz });
  } catch {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
export const fmtHours = (min: number) => (min ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m` : '—');

export function Tile({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="panel p-3">
      <div className="muted text-xs font-semibold uppercase">{label}</div>
      <div className="text-xl font-bold mt-1" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

/** Payslip / certificate breakdown rows shared by the staff portal and HR screens. */
export function Row({ label, v, bold }: { label: string; v: React.ReactNode; bold?: boolean }) {
  return (
    <tr style={bold ? { fontWeight: 700 } : undefined}>
      <td>{label}</td>
      <td className="num">{v}</td>
    </tr>
  );
}
