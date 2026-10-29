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
import { get, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { DateField, Empty, ErrorBanner, Field, Loading, Modal, PageHeader } from '@/components/ui';

const blank = { fullName: '', email: '', phone: '', designation: '', department: '', employmentType: 'PERMANENT', joinDate: '', pan: '', ssfNo: '' };

/** HR: all staff profiles. */
export default function StaffList() {
  const { can } = useSession();
  const qc = useQueryClient();
  const [status, setStatus] = useState('ACTIVE');
  const [text, setText] = useState('');
  const q = useQuery({ queryKey: ['staff', status, text], queryFn: () => get<any[]>(`/staff?status=${status}&q=${encodeURIComponent(text)}`) });
  const [nw, setNw] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    setErr(null);
    try {
      const body = Object.fromEntries(Object.entries(nw).filter(([, v]) => v !== ''));
      await post('/staff', body);
      setNw(null);
      qc.invalidateQueries({ queryKey: ['staff'] });
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div>
      <PageHeader title="Staff" subtitle="Every staff member's profile. Open one for salary, attendance, payslips and certificates." actions={can('staff.manage') && <button className="btn btn-primary" onClick={() => setNw({ ...blank })}>+ New staff member</button>} />
      <div className="flex gap-2 mb-3">
        <input className="input max-w-xs" placeholder="Search name, code or department" value={text} onChange={(e) => setText(e.target.value)} />
        <select className="input max-w-[10rem]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="">All</option></select>
      </div>
      <ErrorBanner error={q.error} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>No staff yet.</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid text-sm">
            <thead><tr><th>Code</th><th>Name</th><th>Designation</th><th>Department</th><th>Type</th><th>Login</th><th>Status</th></tr></thead>
            <tbody>
              {q.data.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono text-xs">{s.code}</td>
                  <td><Link className="underline" href={`/staff/${s.id}`}>{s.full_name}</Link></td>
                  <td>{s.designation}</td><td>{s.department}</td><td className="text-xs">{s.employment_type.replace('_', ' ').toLowerCase()}</td>
                  <td>{s.has_login ? <span className="badge">yes</span> : <span className="muted text-xs">no login</span>}</td>
                  <td><span className="badge">{s.status.toLowerCase()}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!nw} onClose={() => setNw(null)} title="New staff member" wide>
        {nw && (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><ErrorBanner error={err} /></div>
            <Field label="Full name *"><input className="input" value={nw.fullName} onChange={(e) => setNw({ ...nw, fullName: e.target.value })} /></Field>
            <Field label="Email" hint="Needed to create a login and to email payslip notices"><input className="input" type="email" value={nw.email} onChange={(e) => setNw({ ...nw, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={nw.phone} onChange={(e) => setNw({ ...nw, phone: e.target.value })} /></Field>
            <Field label="Designation"><input className="input" value={nw.designation} onChange={(e) => setNw({ ...nw, designation: e.target.value })} /></Field>
            <Field label="Department"><input className="input" value={nw.department} onChange={(e) => setNw({ ...nw, department: e.target.value })} /></Field>
            <Field label="Employment type"><select className="input" value={nw.employmentType} onChange={(e) => setNw({ ...nw, employmentType: e.target.value })}>{['PERMANENT', 'CONTRACT', 'PART_TIME', 'CASUAL', 'INTERN'].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <DateField label="Join date" value={nw.joinDate} onChange={(v) => setNw({ ...nw, joinDate: v })} />
            <Field label="PAN"><input className="input" value={nw.pan} onChange={(e) => setNw({ ...nw, pan: e.target.value })} /></Field>
            <Field label="SSF no."><input className="input" value={nw.ssfNo} onChange={(e) => setNw({ ...nw, ssfNo: e.target.value })} /></Field>
            <div className="sm:col-span-2"><button className="btn btn-primary" disabled={!nw.fullName} onClick={save}>Create</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
