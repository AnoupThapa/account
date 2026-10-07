/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { Empty, ErrorBanner, Field, Loading, Modal, PageHeader } from '@/components/ui';

const blank = { type: 'CUSTOMER', name: '', pan: '', abn: '', email: '', phone: '', address: '', paymentTermsDays: 0, creditLimit: '' };

function Contacts() {
  const type = useSearchParams().get('type') ?? undefined;
  const { can, access } = useSession();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['contacts', type ?? 'all', search], queryFn: () => get<any[]>(`/contacts?${type ? `type=${type}&` : ''}q=${encodeURIComponent(search)}`) });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const au = access?.company?.country === 'AU';
  const save = async () => {
    setErr(null);
    try {
      const body = { ...edit, pan: edit.pan || null, abn: edit.abn || null, email: edit.email || null, creditLimit: edit.creditLimit || null, paymentTermsDays: Number(edit.paymentTermsDays) || 0 };
      if (edit.id) await patch(`/contacts/${edit.id}`, { ...body, version: edit.version });
      else await post('/contacts', body);
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['contacts'] });
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div>
      <PageHeader title={type === 'SUPPLIER' ? 'Suppliers' : type === 'CUSTOMER' ? 'Customers' : 'Contacts'} actions={<>
        <input className="input" style={{ width: 220 }} placeholder="Search name, code, PAN…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {can('contact.manage') && <button className="btn btn-primary" onClick={() => setEdit({ ...blank, type: type ?? 'CUSTOMER' })}>+ New</button>}
      </>} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>No contacts yet.</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid">
            <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>{au ? 'ABN' : 'PAN'}</th><th>Phone</th><th>Terms</th><th /></tr></thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.code}</td>
                  <td>{c.name}{!c.is_active && <span className="badge ml-1">inactive</span>}</td>
                  <td className="text-xs">{c.type}</td>
                  <td>{au ? c.abn : c.pan}</td>
                  <td>{c.phone}</td>
                  <td>{c.payment_terms_days ? `${c.payment_terms_days} days` : 'On receipt'}</td>
                  <td className="flex gap-1 justify-end">
                    <Link className="btn btn-sm" href={`/reports/statement?contactId=${c.id}`}>Statement</Link>
                    {can('contact.manage') && <button className="btn btn-sm" onClick={() => setEdit({ ...c, pan: c.pan ?? '', abn: c.abn ?? '', email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '', paymentTermsDays: c.payment_terms_days, creditLimit: c.credit_limit ?? '' })}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit contact' : 'New contact'}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <ErrorBanner error={err} />
            <Field label="Type"><select className="input" value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}><option>CUSTOMER</option><option>SUPPLIER</option><option>BOTH</option><option>EMPLOYEE</option></select></Field>
            <Field label="Name *"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {au ? <Field label="ABN (11 digits)"><input className="input" value={edit.abn} onChange={(e) => setEdit({ ...edit, abn: e.target.value })} /></Field> : <Field label="PAN / VAT (9 digits)"><input className="input" value={edit.pan} onChange={(e) => setEdit({ ...edit, pan: e.target.value })} /></Field>}
            <Field label="Payment terms (days)"><input className="input" type="number" value={edit.paymentTermsDays} onChange={(e) => setEdit({ ...edit, paymentTermsDays: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Phone"><input className="input" value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label="Credit limit"><input className="input" value={edit.creditLimit} onChange={(e) => setEdit({ ...edit, creditLimit: e.target.value })} /></Field>
            <Field label="Address"><input className="input" value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
            {edit.id && <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked, isActive: e.target.checked })} /> Active</label>}
            <div className="col-span-2"><button className="btn btn-primary" onClick={save}>Save</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
export default function Page() {
  return <Suspense><Contacts /></Suspense>;
}
