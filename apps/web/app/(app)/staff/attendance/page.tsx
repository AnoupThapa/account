/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, put, qs } from '@/lib/api';
import { useSession } from '@/components/providers';
import { AttBadge, fmtHours, fmtTime, monthRange, thisMonth, Tile } from '@/components/staff-ui';
import { DateText, ErrorBanner, Field, Loading, Modal, PageHeader, today } from '@/components/ui';

/** HR: daily attendance sheet and monthly register for everyone. */
export default function StaffAttendance() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'daily' | 'register'>('daily');
  const [date, setDate] = useState(today());
  const [ym, setYm] = useState(thisMonth());
  const daily = useQuery({ queryKey: ['att-daily', date], queryFn: () => get(`/attendance/daily?date=${date}`), enabled: tab === 'daily' });
  const reg = useQuery({ queryKey: ['att-reg', ym], queryFn: () => get(`/attendance/register${qs(monthRange(ym))}`), enabled: tab === 'register' });
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    setErr(null);
    try {
      await put(`/attendance/staff/${m.id}/${date}`, { status: m.status, checkIn: m.checkIn || null, checkOut: m.checkOut || null, remarks: m.remarks });
      setM(null);
      qc.invalidateQueries({ queryKey: ['att-daily'] });
    } catch (x) {
      setErr(x);
    }
  };
  const d = daily.data;
  const counts = d ? d.rows.reduce((a: Record<string, number>, r: any) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {}) : {};
  return (
    <div className="space-y-4">
      <PageHeader title="Attendance" subtitle="Who clocked in, who is late or absent. Click Correct to fix a day (a reason is required and logged)." />
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--line)' }}>
        {(['daily', 'register'] as const).map((t) => <button key={t} className="px-3 py-2 text-sm" style={t === tab ? { borderBottom: '2px solid var(--brand)', fontWeight: 600, color: 'var(--brand)' } : undefined} onClick={() => setTab(t)}>{t === 'daily' ? 'Daily sheet' : 'Monthly register'}</button>)}
      </div>
      {tab === 'daily' ? (
        <>
          <input type="date" className="input max-w-[12rem]" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          <ErrorBanner error={daily.error} />
          {!d ? <Loading /> : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
                {['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'WEEKLY_OFF', 'NOT_MARKED'].map((s) => <Tile key={s} label={s.replace('_', ' ').toLowerCase()} value={counts[s] ?? 0} />)}
              </div>
              <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Code</th><th>Name</th><th>Department</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th><th>Note</th><th /></tr></thead>
                <tbody>{d.rows.map((r: any) => <tr key={r.id}><td className="font-mono text-xs">{r.code}</td><td>{r.full_name}</td><td>{r.department}</td><td><AttBadge s={r.status} /></td><td>{fmtTime(r.check_in)}</td><td>{fmtTime(r.check_out)}</td><td>{fmtHours(r.worked_minutes)}</td><td className="muted text-xs">{r.source === 'MANUAL' ? `HR: ${r.remarks ?? ''}` : ''}</td>
                  <td>{can('attendance.manage') && <button className="btn btn-sm" onClick={() => setM({ id: r.id, name: r.full_name, status: r.status === 'NOT_MARKED' ? 'PRESENT' : r.status, checkIn: '', checkOut: '', remarks: '' })}>Correct</button>}</td></tr>)}</tbody></table></div>
            </>
          )}
        </>
      ) : (
        <>
          <input type="month" className="input max-w-[12rem]" value={ym} onChange={(e) => e.target.value && setYm(e.target.value)} aria-label="Month" />
          <ErrorBanner error={reg.error} />
          {!reg.data ? <Loading /> : (
            <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Code</th><th>Name</th><th className="num">Present</th><th className="num">Late</th><th className="num">Half</th><th className="num">Absent</th><th className="num">Leave</th><th className="num">Holiday</th><th className="num">Off</th></tr></thead>
              <tbody>{reg.data.rows.map((r: any) => <tr key={r.id}><td className="font-mono text-xs">{r.code}</td><td>{r.full_name}</td><td className="num">{r.summary.present}</td><td className="num">{r.summary.late}</td><td className="num">{r.summary.halfDay}</td><td className="num">{r.summary.absent}</td><td className="num">{r.summary.leave}</td><td className="num">{r.summary.holiday}</td><td className="num">{r.summary.weeklyOff}</td></tr>)}</tbody></table>
              <div className="p-2 muted text-xs"><DateText ad={reg.data.from} /> – <DateText ad={reg.data.to} />. “Absent” counts working days in the past that have no attendance.</div></div>
          )}
        </>
      )}
      <Modal open={!!m} onClose={() => setM(null)} title={m ? `Correct · ${m.name} · ${date}` : ''}>
        {m && <div className="space-y-3"><ErrorBanner error={err} />
          <Field label="Status"><select className="input" value={m.status} onChange={(x) => setM({ ...m, status: x.target.value })}>{['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="In (HH:MM)"><input className="input" value={m.checkIn} onChange={(x) => setM({ ...m, checkIn: x.target.value })} placeholder="09:55" /></Field><Field label="Out (HH:MM)"><input className="input" value={m.checkOut} onChange={(x) => setM({ ...m, checkOut: x.target.value })} placeholder="18:05" /></Field></div>
          <Field label="Reason *"><input className="input" value={m.remarks} onChange={(x) => setM({ ...m, remarks: x.target.value })} /></Field>
          <button className="btn btn-primary" disabled={m.remarks.trim().length < 3} onClick={save}>Save</button></div>}
      </Modal>
    </div>
  );
}
