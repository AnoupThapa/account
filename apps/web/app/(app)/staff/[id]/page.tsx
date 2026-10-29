/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post, put, qs } from '@/lib/api';
import { useSession } from '@/components/providers';
import { openWithCompany } from '@/components/doc-actions';
import { AttBadge, fmtHours, fmtTime, monthRange, thisMonth, Tile } from '@/components/staff-ui';
import { DateField, DateText, Empty, ErrorBanner, Field, Loading, Modal, Money, Notice, PageHeader, today } from '@/components/ui';

const TABS = ['Profile', 'Salary', 'Attendance', 'Payslips', 'TDS certificates', 'Login'] as const;

/** One staff member's profile for HR: details, salary history, attendance, payslips, certificates and login. */
export default function StaffProfile() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Profile');
  const q = useQuery({ queryKey: ['staff-one', id], queryFn: () => get(`/staff/${id}`) });
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['staff-one', id] });
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
      await refresh();
      return true;
    } catch (e) {
      setErr(e);
      return false;
    }
  };
  if (q.isLoading) return <Loading />;
  if (!q.data) return <ErrorBanner error={q.error} />;
  const e = q.data;
  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title={e.full_name} subtitle={`${e.code} · ${e.designation ?? 'Staff'}${e.department ? ' · ' + e.department : ''} · ${e.status.toLowerCase()}`} />
      <ErrorBanner error={err} />
      {msg && <Notice tone="ok">{msg}</Notice>}
      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: 'var(--line)' }}>
        {TABS.filter((t) => (t !== 'Salary' || can('staff.view_salary')) && (t !== 'Login' || can('staff.manage_login')) && (t !== 'Attendance' || can('attendance.view_all')) && (t !== 'Payslips' || can('payslip.view_all')) && (t !== 'TDS certificates' || can('tds_certificate.view'))).map((t) => (
          <button key={t} className="px-3 py-2 text-sm" style={t === tab ? { borderBottom: '2px solid var(--brand)', fontWeight: 600, color: 'var(--brand)' } : undefined} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === 'Profile' && <ProfileTab e={e} canEdit={can('staff.manage')} run={run} />}
      {tab === 'Salary' && <SalaryTab e={e} canEdit={can('staff.manage')} run={run} />}
      {tab === 'Attendance' && <AttendanceTab e={e} canMark={can('attendance.manage')} />}
      {tab === 'Payslips' && <PayslipsTab e={e} />}
      {tab === 'TDS certificates' && <CertsTab e={e} />}
      {tab === 'Login' && <LoginTab e={e} run={run} />}
    </div>
  );
}

function ProfileTab({ e, canEdit, run }: { e: any; canEdit: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean> }) {
  const [f, setF] = useState<any>({ fullName: e.full_name, email: e.email ?? '', phone: e.phone ?? '', address: e.address ?? '', designation: e.designation ?? '', department: e.department ?? '', employmentType: e.employment_type, joinDate: e.join_date ?? '', exitDate: e.exit_date ?? '', pan: e.pan ?? '', ssfNo: e.ssf_no ?? '', bankName: e.bank_name ?? '', bankAccount: e.bank_account ?? '', emergencyContact: e.emergency_contact ?? '', notes: e.notes ?? '', status: e.status });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const T = (k: string, label: string, props: any = {}) => <Field label={label}><input className="input" disabled={!canEdit} value={f[k]} onChange={(x) => set(k, x.target.value)} {...props} /></Field>;
  return (
    <div className="panel p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {T('fullName', 'Full name')}{T('email', 'Email', { type: 'email' })}{T('phone', 'Phone')}
      {T('designation', 'Designation')}{T('department', 'Department')}
      <Field label="Employment type"><select className="input" disabled={!canEdit} value={f.employmentType} onChange={(x) => set('employmentType', x.target.value)}>{['PERMANENT', 'CONTRACT', 'PART_TIME', 'CASUAL', 'INTERN'].map((t) => <option key={t}>{t}</option>)}</select></Field>
      <DateField label="Join date" value={f.joinDate} onChange={(v) => set('joinDate', v)} /><DateField label="Exit date" value={f.exitDate} onChange={(v) => set('exitDate', v)} />
      {T('pan', 'PAN')}{T('ssfNo', 'SSF no.')}
      {'bank_name' in e && <>{T('bankName', 'Bank')}{T('bankAccount', 'Bank account')}</>}
      {T('address', 'Address')}{T('emergencyContact', 'Emergency contact')}
      <Field label="Status"><select className="input" disabled={!canEdit} value={f.status} onChange={(x) => set('status', x.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive (blocks sign-in)</option></select></Field>
      {canEdit && <div className="sm:col-span-2 lg:col-span-3"><button className="btn btn-primary" onClick={() => run(() => patch(`/staff/${e.id}`, { ...f, email: f.email || null, joinDate: f.joinDate || null, exitDate: f.exitDate || null, version: e.version }), 'Saved')}>Save changes</button></div>}
    </div>
  );
}

function SalaryTab({ e, canEdit, run }: { e: any; canEdit: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean> }) {
  const [n, setN] = useState<any>(null);
  return (
    <div className="space-y-3">
      {canEdit && <button className="btn btn-primary btn-sm" onClick={() => setN({ effectiveFrom: today(), basicSalary: '', allowance: '0', otherAllowance: '0', otherDeductions: '0', ssfApplicable: true })}>+ New salary (raise / change)</button>}
      {!e.salary?.length ? <Empty>No salary set yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>From</th><th className="num">Basic</th><th className="num">Allowance</th><th className="num">Other allowance</th><th className="num">Other deductions</th><th>SSF</th></tr></thead>
          <tbody>{e.salary.map((s: any) => <tr key={s.id}><td><DateText ad={s.effective_from} /></td><td className="num"><Money v={s.basic_salary} /></td><td className="num"><Money v={s.allowance} /></td><td className="num"><Money v={s.other_allowance} /></td><td className="num"><Money v={s.other_deductions} /></td><td>{s.ssf_applicable ? 'yes' : 'no'}</td></tr>)}</tbody></table></div>
      )}
      <p className="muted text-xs">A change is saved as a new row from a date; earlier rows are kept as history and posted payslips never change.</p>
      <Modal open={!!n} onClose={() => setN(null)} title="New salary">
        {n && <div className="space-y-3">
          <DateField label="Effective from" value={n.effectiveFrom} onChange={(v) => setN({ ...n, effectiveFrom: v })} />
          {[['basicSalary', 'Basic salary'], ['allowance', 'Allowance'], ['otherAllowance', 'Other allowance'], ['otherDeductions', 'Other deductions (monthly)']].map(([k, l]) => <Field key={k} label={l}><input className="input num" value={n[k]} onChange={(x) => setN({ ...n, [k]: x.target.value })} inputMode="decimal" /></Field>)}
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={n.ssfApplicable} onChange={(x) => setN({ ...n, ssfApplicable: x.target.checked })} /> SSF applies</label>
          <button className="btn btn-primary" disabled={!n.basicSalary} onClick={async () => { if (await run(() => post(`/staff/${e.id}/salary`, n), 'Salary saved')) setN(null); }}>Save</button>
        </div>}
      </Modal>
    </div>
  );
}

function AttendanceTab({ e, canMark }: { e: any; canMark: boolean }) {
  const qc = useQueryClient();
  const [ym, setYm] = useState(thisMonth());
  const r = monthRange(ym);
  const q = useQuery({ queryKey: ['staff-att', e.id, ym], queryFn: () => get(`/attendance/staff/${e.id}${qs(r)}`) });
  const [m, setM] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    setErr(null);
    try {
      await put(`/attendance/staff/${e.id}/${m.date}`, { status: m.status, checkIn: m.checkIn || null, checkOut: m.checkOut || null, remarks: m.remarks });
      setM(null);
      qc.invalidateQueries({ queryKey: ['staff-att'] });
    } catch (x) {
      setErr(x);
    }
  };
  if (!q.data) return <Loading />;
  const s = q.data.summary;
  return (
    <div className="space-y-3">
      <input type="month" className="input max-w-[12rem]" value={ym} onChange={(x) => x.target.value && setYm(x.target.value)} aria-label="Month" />
      <div className="grid grid-cols-3 sm:grid-cols-7 gap-2"><Tile label="Present" value={s.present} /><Tile label="Late" value={s.late} /><Tile label="Half day" value={s.halfDay} /><Tile label="Absent" value={s.absent} /><Tile label="Leave" value={s.leave} /><Tile label="Holiday" value={s.holiday} /><Tile label="Weekly off" value={s.weeklyOff} /></div>
      <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th><th>Note</th><th /></tr></thead>
        <tbody>{q.data.days.map((d: any) => <tr key={d.date}><td><DateText ad={d.date} /></td><td><AttBadge s={d.status} /></td><td>{fmtTime(d.check_in)}</td><td>{fmtTime(d.check_out)}</td><td>{fmtHours(d.worked_minutes)}</td><td className="muted text-xs">{d.remarks}</td>
          <td>{canMark && <button className="btn btn-sm" onClick={() => setM({ date: d.date, status: ['NOT_MARKED'].includes(d.status) ? 'PRESENT' : d.status, checkIn: '', checkOut: '', remarks: '' })}>Correct</button>}</td></tr>)}</tbody></table></div>
      <Modal open={!!m} onClose={() => setM(null)} title={m ? `Correct attendance · ${m.date}` : ''}>
        {m && <div className="space-y-3"><ErrorBanner error={err} />
          <Field label="Status"><select className="input" value={m.status} onChange={(x) => setM({ ...m, status: x.target.value })}>{['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'].map((t) => <option key={t}>{t}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="In (HH:MM, optional)"><input className="input" value={m.checkIn} onChange={(x) => setM({ ...m, checkIn: x.target.value })} placeholder="09:55" /></Field><Field label="Out (HH:MM, optional)"><input className="input" value={m.checkOut} onChange={(x) => setM({ ...m, checkOut: x.target.value })} placeholder="18:05" /></Field></div>
          <Field label="Reason for this change *"><input className="input" value={m.remarks} onChange={(x) => setM({ ...m, remarks: x.target.value })} /></Field>
          <button className="btn btn-primary" disabled={m.remarks.trim().length < 3} onClick={save}>Save correction</button></div>}
      </Modal>
    </div>
  );
}

function PayslipsTab({ e }: { e: any }) {
  const q = useQuery({ queryKey: ['staff-slips', e.id], queryFn: () => get<any[]>(`/payslips?employeeId=${e.id}`) });
  if (!q.data) return <Loading />;
  return !q.data.length ? <Empty>No payslips yet. Create them under Staff & HR → Payslips.</Empty> : (
    <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Period</th><th>No.</th><th className="num">Gross</th><th className="num">Net pay</th><th>Status</th><th>Staff</th><th /></tr></thead>
      <tbody>{q.data.map((p) => <tr key={p.id}><td>{p.period_label}</td><td className="font-mono text-xs">{p.payslip_no}</td><td className="num"><Money v={p.gross_pay} /></td><td className="num"><Money v={p.net_pay} /></td><td><span className="badge">{p.status.toLowerCase()}</span></td><td className="text-xs">{p.acknowledged_at ? 'acknowledged' : p.viewed_at ? 'viewed' : p.status === 'SENT' ? 'not opened' : ''}</td><td><button className="btn btn-sm" onClick={() => openWithCompany(`/payslips/${p.id}/print?format=html`)}>Print</button></td></tr>)}</tbody></table></div>
  );
}

function CertsTab({ e }: { e: any }) {
  const q = useQuery({ queryKey: ['staff-certs', e.id], queryFn: () => get<any[]>(`/tds-certificates?employeeId=${e.id}`) });
  if (!q.data) return <Loading />;
  return !q.data.length ? <Empty>No TDS certificates issued yet. Issue one under Staff & HR → TDS certificates.</Empty> : (
    <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>No.</th><th>Period</th><th className="num">Remuneration</th><th className="num">TDS</th><th className="num">Receivable</th><th>Status</th><th /></tr></thead>
      <tbody>{q.data.map((c) => <tr key={c.id}><td className="font-mono text-xs">{c.cert_no}</td><td><DateText ad={c.period_from} /> – <DateText ad={c.period_to} /></td><td className="num"><Money v={c.total_remuneration} /></td><td className="num"><Money v={c.tds_deducted} /></td><td className="num"><Money v={c.total_receivable} /></td><td><span className="badge">{c.status.toLowerCase()}</span></td><td><button className="btn btn-sm" onClick={() => openWithCompany(`/tds-certificates/${c.id}/print?format=html`)}>Print</button></td></tr>)}</tbody></table></div>
  );
}

function LoginTab({ e, run }: { e: any; run: (fn: () => Promise<unknown>, ok?: string) => Promise<boolean> }) {
  const [f, setF] = useState({ email: e.email ?? '', initialPassword: '' });
  return (
    <div className="panel p-4 space-y-3 max-w-lg">
      {e.has_login ? <Notice tone="ok">This staff member can sign in as <b>{e.login_email}</b> and sees only their own profile, attendance, payslips and certificates.</Notice> : (
        <>
          <p className="text-sm">Give this staff member a login to the staff portal. If the email already has a LedgerPro account it is linked; otherwise set an initial password — they must change it at first sign-in.</p>
          <Field label="Email"><input className="input" type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} /></Field>
          <Field label="Initial password (only for a new account)" hint="At least 10 characters"><input className="input" type="password" value={f.initialPassword} onChange={(x) => setF({ ...f, initialPassword: x.target.value })} autoComplete="new-password" /></Field>
          <button className="btn btn-primary" disabled={!f.email} onClick={() => run(() => post(`/staff/${e.id}/login`, { email: f.email, initialPassword: f.initialPassword || undefined }), 'Login created')}>Create login</button>
        </>
      )}
    </div>
  );
}
