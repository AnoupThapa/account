/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { openWithCompany } from '@/components/doc-actions';
import { usePeriods } from '@/components/staff-ui';
import { Empty, ErrorBanner, Field, Loading, Modal, Money, Notice, PageHeader } from '@/components/ui';

const FIELDS: [string, string][] = [['basicSalary', 'Basic salary'], ['allowance', 'Allowance'], ['otherAllowance', 'Other allowance'], ['tdsAmount', 'TDS (typed in)'], ['ssfEmployee', 'SSF — employee'], ['ssfEmployer', 'SSF — employer (not deducted)'], ['otherDeductions', 'Other deductions']];

/** HR: generate payslips for a period, check them, send them to the staff. */
export default function StaffPayslips() {
  const { can } = useSession();
  const qc = useQueryClient();
  const { periods } = usePeriods();
  const [periodId, setPeriodId] = useState('');
  useEffect(() => {
    if (!periodId && periods.length) setPeriodId(periods[0].id);
  }, [periods, periodId]);
  const q = useQuery({ queryKey: ['payslips', periodId], queryFn: () => get<any[]>(`/payslips?periodId=${periodId}`), enabled: !!periodId });
  const staff = useQuery({ queryKey: ['staff', 'ACTIVE', ''], queryFn: () => get<any[]>('/staff?status=ACTIVE&q=') });
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [one, setOne] = useState<string>('');
  const [cancel, setCancel] = useState<any>(null);
  const reload = () => qc.invalidateQueries({ queryKey: ['payslips'] });
  const run = async (fn: () => Promise<any>, ok: (r: any) => string) => {
    setErr(null);
    setMsg(null);
    try {
      setMsg(ok(await fn()));
      await reload();
      return true;
    } catch (e) {
      setErr(e);
      return false;
    }
  };
  const drafts = (q.data ?? []).filter((p) => p.status === 'DRAFT').length;
  const openEdit = async (p: any) => {
    const full = await get(`/payslips/${p.id}`);
    setEdit({ id: p.id, version: full.version, name: p.full_name, ...Object.fromEntries(FIELDS.map(([k]) => [k, full[k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase())]])), notes: full.notes ?? '' });
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Payslips" subtitle="Create payslips from each staff member's salary, add the TDS, check, then send. Sent payslips appear in the staff member's own profile and cannot be edited." />
      <ErrorBanner error={err ?? q.error} />
      {msg && <Notice tone="ok">{msg}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Period"><select className="input" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>{periods.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.fy})</option>)}</select></Field>
        {can('payslip.generate') && (
          <>
            <button className="btn" onClick={() => run(() => post('/payslips/draft-all', { periodId }), (r) => `Created ${r.created} draft payslip(s)${r.skipped.length ? `; skipped ${r.skipped.map((s: any) => `${s.name} (${s.reason})`).join(', ')}` : ''}.`)}>Create drafts for everyone</button>
            <select className="input max-w-[14rem]" value={one} onChange={(e) => setOne(e.target.value)}><option value="">Add one staff member…</option>{(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select>
            <button className="btn" disabled={!one} onClick={() => run(() => post('/payslips', { employeeId: one, periodId }), () => 'Draft created.').then(() => setOne(''))}>Add</button>
            <button className="btn btn-primary" disabled={!drafts} onClick={() => confirm(`Send ${drafts} draft payslip(s) to their staff now? They cannot be edited afterwards.`) && run(() => post('/payslips/send-all', { periodId }), (r) => `Sent ${r.sent} payslip(s).`)}>Send all drafts ({drafts})</button>
          </>
        )}
      </div>
      {!periodId || q.isLoading || !q.data ? <Loading /> : !q.data.length ? <Empty>No payslips for this period yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Staff</th><th>No.</th><th className="num">Gross</th><th className="num">TDS</th><th className="num">Deductions</th><th className="num">Net pay</th><th>Status</th><th>Staff has</th><th /></tr></thead>
          <tbody>{q.data.map((p) => (
            <tr key={p.id}>
              <td>{p.full_name} <span className="muted text-xs">{p.code}</span>{!p.has_login && <div className="text-xs" style={{ color: 'var(--warn)' }}>no login yet</div>}</td>
              <td className="font-mono text-xs">{p.payslip_no}</td><td className="num"><Money v={p.gross_pay} /></td><td className="num"><Money v={p.tds_amount} /></td><td className="num"><Money v={p.total_deductions} /></td><td className="num font-semibold"><Money v={p.net_pay} /></td>
              <td><span className="badge">{p.status.toLowerCase()}</span></td><td className="text-xs">{p.acknowledged_at ? 'acknowledged' : p.viewed_at ? 'opened' : p.status === 'SENT' ? 'not opened yet' : ''}</td>
              <td className="whitespace-nowrap">
                <button className="btn btn-sm" onClick={() => openWithCompany(`/payslips/${p.id}/print?format=html`)}>View</button>{' '}
                {can('payslip.generate') && p.status === 'DRAFT' && <><button className="btn btn-sm" onClick={() => openEdit(p)}>Edit</button> <button className="btn btn-sm btn-primary" onClick={() => run(() => post(`/payslips/${p.id}/send`, {}), (r) => `Sent ${r.payslip_no}${r.emailQueued ? ' (email queued)' : ''}${r.hasLogin ? '' : ' — this staff member has no login yet'}.`)}>Send</button> </>}
                {can('payslip.generate') && p.status !== 'CANCELLED' && <button className="btn btn-sm" onClick={() => setCancel({ id: p.id, reason: '' })}>Cancel</button>}
              </td>
            </tr>))}</tbody></table></div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit draft · ${edit.name}` : ''}>
        {edit && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">{FIELDS.map(([k, l]) => <Field key={k} label={l}><input className="input num" value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} inputMode="decimal" /></Field>)}</div>
          <Field label="Note on the payslip"><input className="input" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
          <p className="muted text-xs">Net pay = gross − TDS − employee SSF − other deductions. Employer SSF is shown but not deducted.</p>
          <button className="btn btn-primary" onClick={async () => { const { id, name: _n, ...b } = edit; if (await run(() => patch(`/payslips/${id}`, { ...b, notes: b.notes || null }), () => 'Draft saved.')) setEdit(null); }}>Save draft</button>
        </div>}
      </Modal>
      <Modal open={!!cancel} onClose={() => setCancel(null)} title="Cancel payslip">
        {cancel && <div className="space-y-3"><Field label="Reason *"><input className="input" value={cancel.reason} onChange={(e) => setCancel({ ...cancel, reason: e.target.value })} /></Field>
          <p className="muted text-xs">The payslip number is kept. The staff member will no longer see it; you can issue a corrected one.</p>
          <button className="btn btn-primary" disabled={cancel.reason.trim().length < 3} onClick={async () => { if (await run(() => post(`/payslips/${cancel.id}/cancel`, { reason: cancel.reason }), () => 'Payslip cancelled.')) setCancel(null); }}>Cancel payslip</button></div>}
      </Modal>
    </div>
  );
}
