/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { openWithCompany } from '@/components/doc-actions';
import { Row } from '@/components/staff-ui';
import { DateText, Empty, ErrorBanner, Loading, Modal, Money, PageHeader } from '@/components/ui';

/** My payslips: list, open (marks as viewed), print/PDF, acknowledge. */
export default function MyPayslips() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['me-payslips'], queryFn: () => get<any[]>('/me/payslips') });
  const [open, setOpen] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const view = async (id: string) => {
    setErr(null);
    try {
      setOpen(await get(`/me/payslips/${id}`));
      qc.invalidateQueries({ queryKey: ['me-payslips'] });
    } catch (e) {
      setErr(e);
    }
  };
  const ack = async () => {
    try {
      await post(`/me/payslips/${open.id}/acknowledge`, {});
      setOpen({ ...open, acknowledged_at: new Date().toISOString() });
      qc.invalidateQueries({ queryKey: ['me-payslips'] });
    } catch (e) {
      setErr(e);
    }
  };
  if (q.isLoading) return <Loading />;
  return (
    <div className="max-w-4xl">
      <PageHeader title="My payslips" subtitle="Payslips issued to you by HR. Open one to review it, then confirm that you have received it." />
      <ErrorBanner error={err ?? q.error} />
      {!q.data?.length ? <Empty>No payslips yet.</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid text-sm">
            <thead><tr><th>Period</th><th>No.</th><th className="num">Gross</th><th className="num">Deductions</th><th className="num">Net pay</th><th>Status</th><th /></tr></thead>
            <tbody>
              {q.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.period_label}</td><td className="font-mono text-xs">{p.payslip_no}</td>
                  <td className="num"><Money v={p.gross_pay} /></td><td className="num"><Money v={p.total_deductions} /></td><td className="num font-semibold"><Money v={p.net_pay} /></td>
                  <td>{p.acknowledged_at ? <span className="badge">Acknowledged</span> : p.viewed_at ? <span className="badge">Viewed</span> : <span className="badge" style={{ color: 'var(--brand)', borderColor: 'var(--brand)' }}>New</span>}</td>
                  <td><button className="btn btn-sm" onClick={() => view(p.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `Payslip ${open.payslip_no} · ${open.period_label}` : ''}>
        {open && (
          <div className="space-y-3">
            <div className="muted text-xs"><DateText ad={open.period_start} /> – <DateText ad={open.period_end} /></div>
            <table className="text-sm w-full"><tbody>
              <Row label="Basic salary" v={<Money v={open.basic_salary} />} />
              <Row label="Allowance" v={<Money v={open.allowance} />} />
              <Row label="Other allowance" v={<Money v={open.other_allowance} />} />
              <Row bold label="Gross pay" v={<Money v={open.gross_pay} />} />
              <Row label="TDS" v={<Money v={open.tds_amount} />} />
              <Row label="SSF — my contribution" v={<Money v={open.ssf_employee} />} />
              <Row label="Other deductions" v={<Money v={open.other_deductions} />} />
              <Row bold label="Total deductions" v={<Money v={open.total_deductions} />} />
              <Row bold label="Net pay (total receivable)" v={<Money v={open.net_pay} />} />
            </tbody></table>
            <p className="muted text-xs">Employer's SSF contribution: <Money v={open.ssf_employer} /> (paid by the employer, not deducted from your pay).</p>
            {open.notes && <p className="text-sm">{open.notes}</p>}
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-sm" onClick={() => openWithCompany(`/me/payslips/${open.id}/print?format=html`)}>Print</button>
              <button className="btn btn-sm" onClick={() => openWithCompany(`/me/payslips/${open.id}/print?format=pdf`)}>PDF</button>
              {open.acknowledged_at ? <span className="badge">You confirmed receipt</span> : <button className="btn btn-primary btn-sm" onClick={ack}>I have received and reviewed this payslip</button>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
