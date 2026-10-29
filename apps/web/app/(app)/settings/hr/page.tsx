/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '@/lib/api';
import { ErrorBanner, Field, Loading, Notice, PageHeader } from '@/components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** HR settings: working hours, grace, weekly off, SSF rates. */
export default function HrSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['hr-settings'], queryFn: () => get('/hr/settings') });
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (q.data) setF({ workStart: q.data.work_start, graceMinutes: String(q.data.grace_minutes), standardMinutes: String(q.data.standard_minutes), halfDayMinutes: String(q.data.half_day_minutes), weeklyOff: q.data.weekly_off, ssfEmployeePct: String(Number(q.data.ssf_employee_pct)), ssfEmployerPct: String(Number(q.data.ssf_employer_pct)) });
  }, [q.data]);
  if (!f) return q.error ? <ErrorBanner error={q.error} /> : <Loading />;
  const save = async () => {
    setErr(null);
    setOk(false);
    try {
      await patch('/hr/settings', { workStart: f.workStart, graceMinutes: Number(f.graceMinutes), standardMinutes: Number(f.standardMinutes), halfDayMinutes: Number(f.halfDayMinutes), weeklyOff: f.weeklyOff, ssfEmployeePct: f.ssfEmployeePct, ssfEmployerPct: f.ssfEmployerPct });
      setOk(true);
      qc.invalidateQueries({ queryKey: ['hr-settings'] });
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="HR settings" subtitle="Working hours decide who is late or half-day; SSF rates pre-fill payslips." />
      <ErrorBanner error={err} />
      {ok && <Notice tone="ok">Saved.</Notice>}
      <div className="panel p-4 grid sm:grid-cols-2 gap-3">
        <Field label="Work starts (HH:MM)"><input className="input" value={f.workStart} onChange={(e) => setF({ ...f, workStart: e.target.value })} /></Field>
        <Field label="Grace period (minutes)" hint="Clock-in after start + grace is Late"><input className="input num" value={f.graceMinutes} onChange={(e) => setF({ ...f, graceMinutes: e.target.value })} /></Field>
        <Field label="Standard day (minutes)"><input className="input num" value={f.standardMinutes} onChange={(e) => setF({ ...f, standardMinutes: e.target.value })} /></Field>
        <Field label="Half day below (minutes worked)"><input className="input num" value={f.halfDayMinutes} onChange={(e) => setF({ ...f, halfDayMinutes: e.target.value })} /></Field>
        <div className="sm:col-span-2"><div className="text-sm font-medium mb-1">Weekly off days</div><div className="flex flex-wrap gap-3">{DAYS.map((d, i) => <label key={d} className="flex gap-1 text-sm"><input type="checkbox" checked={f.weeklyOff.includes(i)} onChange={(e) => setF({ ...f, weeklyOff: e.target.checked ? [...f.weeklyOff, i] : f.weeklyOff.filter((x: number) => x !== i) })} /> {d}</label>)}</div></div>
        <Field label="SSF — employee % of basic" hint="Default 11 — confirm with your accountant"><input className="input num" value={f.ssfEmployeePct} onChange={(e) => setF({ ...f, ssfEmployeePct: e.target.value })} /></Field>
        <Field label="SSF — employer % of basic" hint="Default 20 — confirm with your accountant"><input className="input num" value={f.ssfEmployerPct} onChange={(e) => setF({ ...f, ssfEmployerPct: e.target.value })} /></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary" onClick={save}>Save settings</button></div>
      </div>
      <p className="muted text-xs">The SSF defaults come from secondary sources and are not verified. They only pre-fill payslips — you can overwrite them on each payslip.</p>
    </div>
  );
}
