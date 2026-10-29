/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post, qs } from '@/lib/api';
import { useSession } from '@/components/providers';
import { openWithCompany } from '@/components/doc-actions';
import { DateField, DateText, Empty, ErrorBanner, Field, Loading, Modal, Money, Notice, PageHeader } from '@/components/ui';
import { calcPay } from '@ledgerpro/shared';

const NUM: [string, string][] = [['basicSalary', 'Basic salary'], ['allowance', 'Allowance'], ['otherAllowance', 'Other allowance'], ['tdsDeducted', 'TDS deductible'], ['ssfEmployee', 'SSF — employee contribution'], ['ssfEmployer', 'SSF — employer contribution'], ['otherDeductions', 'Other deductible']];
const blank = (): any => ({ employeeId: '', periodFrom: '', periodTo: '', basicSalary: '', allowance: '0', otherAllowance: '0', tdsDeducted: '0', ssfEmployee: '0', ssfEmployer: '0', otherDeductions: '0', tdsDepositRef: '', tdsDepositDate: '', notes: '' });

/** Admin / HR Manager: issue TDS certificates manually, or pre-filled from a staff member's sent payslips. */
export default function StaffCertificates() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['certs'], queryFn: () => get<any[]>('/tds-certificates') });
  const staff = useQuery({ queryKey: ['staff', '', ''], queryFn: () => get<any[]>('/staff?status=&q='), enabled: can('tds_certificate.issue') });
  const [f, setF] = useState<any>(null);
  const [cancel, setCancel] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null);
    try {
      await fn();
      setMsg(ok);
      await qc.invalidateQueries({ queryKey: ['certs'] });
      return true;
    } catch (e) {
      setErr(e);
      return false;
    }
  };
  const fill = async () => {
    setErr(null);
    try {
      const s = await get(`/tds-certificates/suggest${qs({ employeeId: f.employeeId, from: f.periodFrom, to: f.periodTo })}`);
      if (!s.payslips) throw new Error('This staff member has no sent payslips inside that period.');
      setF({ ...f, ...Object.fromEntries(NUM.map(([k]) => [k, s[k]])), notes: f.notes || `Filled from ${s.payslips} sent payslip(s)` });
    } catch (e) {
      setErr(e);
    }
  };
  let totals: { grossPay: string; netPay: string } | null = null;
  if (f) {
    try {
      totals = calcPay({ basicSalary: f.basicSalary || 0, allowance: f.allowance || 0, otherAllowance: f.otherAllowance || 0, tdsAmount: f.tdsDeducted || 0, ssfEmployee: f.ssfEmployee || 0, ssfEmployer: f.ssfEmployer || 0, otherDeductions: f.otherDeductions || 0 });
    } catch {
      totals = null;
    }
  }
  return (
    <div className="space-y-4">
      <PageHeader title="TDS certificates" subtitle="Certificates of tax deducted at source on staff remuneration. Issued by the Admin or HR Manager; the staff member can see and print their own." actions={can('tds_certificate.issue') && <button className="btn btn-primary" onClick={() => setF(blank())}>+ Issue certificate</button>} />
      <ErrorBanner error={err ?? q.error} />
      {msg && <Notice tone="ok">{msg}</Notice>}
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>No certificates issued yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>No.</th><th>Staff</th><th>Period</th><th className="num">Remuneration</th><th className="num">TDS</th><th className="num">Total receivable</th><th>Status</th><th /></tr></thead>
          <tbody>{q.data.map((c) => (
            <tr key={c.id}><td className="font-mono text-xs">{c.cert_no}</td><td>{c.full_name}</td><td><DateText ad={c.period_from} /> – <DateText ad={c.period_to} /></td><td className="num"><Money v={c.total_remuneration} /></td><td className="num"><Money v={c.tds_deducted} /></td><td className="num font-semibold"><Money v={c.total_receivable} /></td>
              <td><span className="badge">{c.status.toLowerCase()}</span></td>
              <td className="whitespace-nowrap"><button className="btn btn-sm" onClick={() => openWithCompany(`/tds-certificates/${c.id}/print?format=html`)}>Print</button> <button className="btn btn-sm" onClick={() => openWithCompany(`/tds-certificates/${c.id}/print?format=pdf`)}>PDF</button>{can('tds_certificate.issue') && c.status === 'ISSUED' && <> <button className="btn btn-sm" onClick={() => setCancel({ id: c.id, reason: '' })}>Cancel</button></>}</td></tr>))}</tbody></table></div>
      )}
      <Modal open={!!f} onClose={() => setF(null)} title="Issue TDS certificate" wide>
        {f && <div className="space-y-3">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Staff member *"><select className="input" value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Choose…</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.code})</option>)}</select></Field>
            <DateField label="Period from *" value={f.periodFrom} onChange={(v) => setF({ ...f, periodFrom: v })} />
            <DateField label="Period to *" value={f.periodTo} onChange={(v) => setF({ ...f, periodTo: v })} />
          </div>
          <div className="flex items-center gap-2"><button className="btn btn-sm" disabled={!f.employeeId || !f.periodFrom || !f.periodTo} onClick={fill}>Fill from this staff member's sent payslips</button><span className="muted text-xs">or type the amounts below yourself</span></div>
          <div className="grid sm:grid-cols-3 gap-3">
            {NUM.map(([k, l]) => <Field key={k} label={l}><input className="input num" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} inputMode="decimal" /></Field>)}
            <Field label="Total remuneration (calculated)"><div className="input num bg-transparent">{totals ? <Money v={totals.grossPay} /> : '—'}</div></Field>
            <Field label="Total receivable (calculated)" hint="Remuneration − TDS − SSF (employee) − other deductible"><div className="input num font-bold bg-transparent">{totals ? <Money v={totals.netPay} /> : 'check the amounts'}</div></Field>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="TDS deposit voucher / ref (optional)"><input className="input" value={f.tdsDepositRef} onChange={(e) => setF({ ...f, tdsDepositRef: e.target.value })} /></Field>
            <DateField label="TDS deposit date (optional)" value={f.tdsDepositDate} onChange={(v) => setF({ ...f, tdsDepositDate: v })} />
            <Field label="Note"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <p className="muted text-xs">Employer's SSF contribution is shown on the certificate but is not deducted from the staff member. Once issued, a certificate cannot be edited — cancel it and issue a new one.</p>
          <button className="btn btn-primary" disabled={!f.employeeId || !f.periodFrom || !f.periodTo || !totals} onClick={async () => { const b = { ...f, source: 'MANUAL', tdsDepositRef: f.tdsDepositRef || null, tdsDepositDate: f.tdsDepositDate || null, notes: f.notes || null }; if (await run(() => post('/tds-certificates', b), 'Certificate issued.')) setF(null); }}>Issue certificate</button>
        </div>}
      </Modal>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Cancel certificate">
        {cancel && <div className="space-y-3"><Field label="Reason *"><input className="input" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} /></Field>
          <button className="btn btn-primary" disabled={cancel.reason.trim().length < 3} onClick={async () => { if (await run(() => post(`/tds-certificates/${cancel.id}/cancel`, { reason: cancel.reason }), 'Certificate cancelled (number kept).')) setCancel(null); }}>Cancel certificate</button></div>}
      </Modal>
    </div>
  );
}
