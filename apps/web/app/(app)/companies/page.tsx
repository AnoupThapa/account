/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { DateField, ErrorBanner, Field, PageHeader, today } from '@/components/ui';

export default function Companies() {
  const { me, selectCompany } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', legalName: '', country: 'NP', businessType: 'MIXED', pan: '', abn: '', address: '', phone: '', email: '', firstFiscalYearDate: today() });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!me?.is_super_admin) return <div className="panel p-4">Only a platform Super Admin can create companies.</div>;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="max-w-2xl">
      <PageHeader title="New company" subtitle="Creates the company, head office, default roles, chart of accounts, tax codes, approval workflows and the first fiscal year." />
      <ErrorBanner error={err} />
      <form
        className="panel p-4 grid sm:grid-cols-2 gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            const c = await post('/companies', { ...f, pan: f.pan || undefined, abn: f.abn || undefined, email: f.email || undefined, legalName: f.legalName || undefined });
            await qc.invalidateQueries({ queryKey: ['me'] });
            selectCompany(c.id);
            location.href = '/';
          } catch (e) {
            setErr(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Trading name *"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
        <Field label="Legal name"><input className="input" value={f.legalName} onChange={(e) => set('legalName', e.target.value)} /></Field>
        <Field label="Country *" hint={f.country === 'NP' ? 'NPR · BS calendar · FY Shrawan–Ashadh · VAT 13%' : f.country === 'AU' ? 'AUD · AD calendar · FY July–June · GST 10%' : 'USD · AD calendar · calendar-year FY'}>
          <select className="input" value={f.country} onChange={(e) => set('country', e.target.value)}>
            <option value="NP">Nepal</option>
            <option value="AU">Australia</option>
            <option value="OTHER">Other</option>
          </select>
        </Field>
        <Field label="Business type *" hint="Loads the matching chart-of-accounts template">
          <select className="input" value={f.businessType} onChange={(e) => set('businessType', e.target.value)}>
            <option value="SERVICE">Service</option>
            <option value="TRADING">Trading</option>
            <option value="MANUFACTURING">Manufacturing</option>
            <option value="MIXED">Mixed</option>
          </select>
        </Field>
        {f.country === 'AU' ? (
          <Field label="ABN"><input className="input" value={f.abn} onChange={(e) => set('abn', e.target.value)} /></Field>
        ) : (
          <Field label="PAN / VAT No."><input className="input" value={f.pan} onChange={(e) => set('pan', e.target.value)} /></Field>
        )}
        <Field label="Phone"><input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Address"><input className="input" value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <DateField label="A date inside the first fiscal year" value={f.firstFiscalYearDate} onChange={(v) => set('firstFiscalYearDate', v)} />
        <div className="sm:col-span-2"><button className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button></div>
      </form>
    </div>
  );
}
