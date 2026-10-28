/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { COUNTRIES, TAX_PACKS, countryDefaults, packForCountry } from '@ledgerpro/shared';
import { post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { DateField, ErrorBanner, Field, PageHeader, today } from '@/components/ui';

export default function Companies() {
  const { me, selectCompany } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', legalName: '', country: 'NP', customCountry: '', taxPack: '', businessType: 'MIXED', pan: '', abn: '', taxId: '', address: '', phone: '', email: '', firstFiscalYearDate: today() });
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!me?.is_super_admin) return <div className="panel p-4">Only a platform Super Admin can create companies.</div>;
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  const country = f.country === '__other' ? f.customCountry.trim().toUpperCase() : f.country;
  const cd = countryDefaults(country || 'OTHER');
  const pack = f.taxPack ? TAX_PACKS.find((p) => p.key === f.taxPack)! : packForCountry(country || 'OTHER');
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
            const { customCountry: _cc, ...rest } = f;
            const c = await post('/companies', { ...rest, country: country || 'OTHER', taxPack: f.taxPack || undefined, pan: f.pan || undefined, abn: f.abn || undefined, taxId: f.taxId || undefined, email: f.email || undefined, legalName: f.legalName || undefined });
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
        <Field label="Country *" hint={`${cd.currency} · ${cd.calendar} calendar · year starts ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][cd.fyStartMonth - 1]}${cd.calendar === 'BS' ? ' (BS month)' : ''}`}>
          <select className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value, taxPack: '' })}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            <option value="__other">Another country (enter its 2-letter code)…</option>
          </select>
          {f.country === '__other' && <input className="input mt-1" maxLength={2} placeholder="e.g. PE" value={f.customCountry} onChange={(e) => set('customCountry', e.target.value)} />}
        </Field>
        <Field label="Tax system *" hint={pack.notes}>
          <select className="input" value={f.taxPack || pack.key} onChange={(e) => set('taxPack', e.target.value)}>
            {TAX_PACKS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <span className="muted text-xs">Starter rates (as of {pack.asOf}) — your accountant must confirm them. You can change everything later in Settings → Tax system.</span>
        </Field>
        <Field label="Business type *" hint="Loads the matching chart-of-accounts template">
          <select className="input" value={f.businessType} onChange={(e) => set('businessType', e.target.value)}>
            <option value="SERVICE">Service</option>
            <option value="TRADING">Trading</option>
            <option value="MANUFACTURING">Manufacturing</option>
            <option value="MIXED">Mixed</option>
          </select>
        </Field>
        {country === 'AU' ? (
          <Field label="ABN"><input className="input" value={f.abn} onChange={(e) => set('abn', e.target.value)} /></Field>
        ) : country === 'NP' ? (
          <Field label="PAN / VAT No."><input className="input" value={f.pan} onChange={(e) => set('pan', e.target.value)} /></Field>
        ) : (
          <Field label={pack.taxIdLabel}><input className="input" value={f.taxId} onChange={(e) => set('taxId', e.target.value)} /></Field>
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
