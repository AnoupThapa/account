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
import { useSession } from '@/components/providers';
import { useStepUp } from '@/components/step-up';
import { DateField, DateText, ErrorBanner, Field, Loading, Modal, PageHeader, today } from '@/components/ui';

export default function Tax() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tax-codes'], queryFn: () => get<any[]>('/tax-codes') });
  const tds = useQuery({ queryKey: ['tds-codes'], queryFn: () => get<any[]>('/tds-codes') });
  const [rate, setRate] = useState<any>(null);
  const [nc, setNc] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const step = useStepUp();
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await step.run(fn); qc.invalidateQueries(); return true; } catch (e) { setErr(e); return false; } };
  if (!q.data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Tax codes" subtitle="Admin only. Rates are effective-dated: a change is a new rate from a date, history is kept." actions={can('tax.manage') && <button className="btn btn-primary" onClick={() => setNc({ code: '', name: '', type: 'STANDARD', rate: '', effectiveFrom: today(), isClaimable: true })}>+ New tax code</button>} />
      <ErrorBanner error={err} />
      <div className="panel overflow-x-auto">
        <table className="grid text-sm"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Claimable</th><th>Rates</th><th /></tr></thead>
          <tbody>{q.data.map((t) => <tr key={t.id}><td className="font-mono">{t.code}</td><td>{t.name}</td><td>{t.type}</td><td>{t.is_claimable ? 'yes' : 'no'}</td>
            <td>{t.rates.map((r: any) => <div key={r.id}>{Number(r.rate)}% from <DateText ad={r.effective_from} />{r.effective_to && <> to <DateText ad={r.effective_to} /></>}</div>)}</td>
            <td>{can('tax.manage') && t.type === 'STANDARD' && <button className="btn btn-sm" onClick={() => setRate({ id: t.id, code: t.code, rate: '', effectiveFrom: today() })}>New rate</button>}</td></tr>)}</tbody></table>
      </div>
      <div className="panel overflow-x-auto">
        <div className="p-3 font-semibold">TDS codes (management tracking)</div>
        <table className="grid text-sm"><tbody>{(tds.data ?? []).map((t) => <tr key={t.id}><td className="font-mono">{t.code}</td><td>{t.name}</td><td className="num">{Number(t.rate)}%</td></tr>)}</tbody></table>
      </div>
      <Modal open={!!rate} onClose={() => setRate(null)} title={`New rate for ${rate?.code}`}>
        {rate && <div className="space-y-3">
          <Field label="Rate %"><input className="input num" value={rate.rate} onChange={(e) => setRate({ ...rate, rate: e.target.value })} /></Field>
          <DateField label="Effective from" value={rate.effectiveFrom} onChange={(v) => setRate({ ...rate, effectiveFrom: v })} />
          <button className="btn btn-primary" onClick={async () => { if (await act(() => post(`/tax-codes/${rate.id}/rates`, { rate: rate.rate, effectiveFrom: rate.effectiveFrom }))) setRate(null); }}>Save</button>
        </div>}
      </Modal>
      <Modal open={!!nc} onClose={() => setNc(null)} title="New tax code">
        {nc && <div className="space-y-3">
          <Field label="Code"><input className="input" value={nc.code} onChange={(e) => setNc({ ...nc, code: e.target.value })} /></Field>
          <Field label="Name"><input className="input" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} /></Field>
          <Field label="Type"><select className="input" value={nc.type} onChange={(e) => setNc({ ...nc, type: e.target.value })}>{['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Rate %"><input className="input num" value={nc.rate} onChange={(e) => setNc({ ...nc, rate: e.target.value })} /></Field>
          <DateField label="Effective from" value={nc.effectiveFrom} onChange={(v) => setNc({ ...nc, effectiveFrom: v })} />
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={nc.isClaimable} onChange={(e) => setNc({ ...nc, isClaimable: e.target.checked })} /> Input tax is claimable</label>
          <button className="btn btn-primary" onClick={async () => { if (await act(() => post('/tax-codes', { ...nc, rate: nc.rate || '0' }))) setNc(null); }}>Create</button>
        </div>}
      </Modal>
      {step.modal}
    </div>
  );
}
