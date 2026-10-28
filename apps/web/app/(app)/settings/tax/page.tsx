/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
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
  const regime = useQuery({ queryKey: ['tax-regime'], queryFn: () => get<any>('/tax/regime') });
  const packs = useQuery({ queryKey: ['tax-packs'], queryFn: () => get<any[]>('/tax/packs') });
  const [pick, setPick] = useState<any>(null);
  const [custom, setCustom] = useState<any>(null);
  const [grp, setGrp] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const step = useStepUp();
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await step.run(fn); qc.invalidateQueries(); return true; } catch (e) { setErr(e); return false; } };
  if (!q.data || !regime.data) return <Loading />;
  const rg = regime.data.regime;
  const plain = q.data.filter((t) => !t.is_group && t.is_active);
  return (
    <div className="space-y-4">
      <PageHeader title="Tax system" subtitle="Choose the tax system your company uses, or build your own. Rates shown in packs are starter data — confirm them with your accountant." />
      <ErrorBanner error={err} />
      <div className="panel p-4 space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <div>
            <div className="font-semibold">{rg ? rg.name : 'No tax system chosen'}</div>
            {rg && <div className="muted text-sm">{rg.tax_label} · tax ID: {rg.tax_id_label} · model: {rg.model.replace('_', ' ').toLowerCase()} · returns: {rg.return_period.toLowerCase()}{rg.source_pack ? ` · pack ${rg.source_pack} v${rg.pack_version} (rates as of ${rg.pack_as_of?.slice(0, 10)})` : ' · custom'}</div>}
          </div>
          {can('tax.manage') && <div className="flex gap-2">
            <button className="btn" onClick={() => setPick({ key: packs.data?.find((p) => p.country === regime.data.country)?.key ?? packs.data?.[0]?.key })}>Choose from library</button>
            <button className="btn" onClick={() => setCustom({ name: '', model: 'CREDIT_VAT', taxLabel: 'VAT', taxIdLabel: 'Tax ID', invoiceTitle: 'Tax Invoice', returnPeriod: 'MONTHLY' })}>My country isn’t listed</button>
          </div>}
        </div>
        {rg && can('tax.manage') && (
          <div className="grid sm:grid-cols-4 gap-3">
            <Field label="“Non-taxable” code" hint="Used by the Non-taxable button on bills"><select className="input" value={rg.non_taxable_code ?? ''} onChange={(e) => act(() => patch('/tax/regime', { nonTaxableCode: e.target.value || null }))}><option value="">—</option>{q.data.filter((t) => ['EXEMPT', 'OUT_OF_SCOPE'].includes(t.type) && t.is_active).map((t) => <option key={t.id} value={t.code}>{t.code} · {t.type.toLowerCase().replace('_', ' ')}</option>)}</select></Field>
            <Field label="Usual taxable code" hint="Suggested for new taxable items"><select className="input" value={rg.default_standard_code ?? ''} onChange={(e) => act(() => patch('/tax/regime', { defaultStandardCode: e.target.value || null }))}><option value="">—</option>{q.data.filter((t) => t.type === 'STANDARD' && t.is_active).map((t) => <option key={t.id} value={t.code}>{t.code}</option>)}</select></Field>
            <Field label="Rounding"><select className="input" value={regime.data.policy.taxRounding} onChange={(e) => act(() => patch('/tax/regime', { taxRounding: e.target.value }))}><option value="LINE">Per line</option><option value="DOCUMENT">Per document</option></select></Field>
            <Field label="Changing an item’s tax on a line"><label className="flex gap-2 text-sm"><input type="checkbox" checked={regime.data.policy.overrideReasonRequired} onChange={(e) => act(() => patch('/tax/regime', { overrideReasonRequired: e.target.checked }))} /> Reason required</label></Field>
          </div>
        )}
      </div>
      <PageHeader title="Tax codes" subtitle="Admin only. Rates are effective-dated: a change is a new rate from a date, history is kept." actions={can('tax.manage') && <div className="flex gap-2"><button className="btn" onClick={() => setGrp({ code: '', name: '', components: [{ codeId: '', stacked: false }, { codeId: '', stacked: false }] })}>+ Combined tax (e.g. GST + PST)</button><button className="btn btn-primary" onClick={() => setNc({ code: '', name: '', type: 'STANDARD', rate: '', effectiveFrom: today(), isClaimable: true })}>+ New tax code</button></div>} />
      <div className="panel overflow-x-auto">
        <table className="grid text-sm"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Claimable</th><th>Rates</th><th /></tr></thead>
          <tbody>{q.data.map((t) => <tr key={t.id}><td className="font-mono">{t.code}</td><td>{t.name}{t.is_group && <div className="muted text-xs">combined: {t.components.map((c: any, i: number) => `${i ? (c.stacked ? ' on top of ' : ' + ') : ''}${c.code}`).join('')}</div>}</td><td>{t.is_group ? 'COMBINED' : t.type}</td><td>{t.is_claimable ? 'yes' : 'no'}</td>
            <td>{t.is_group ? <span className="muted text-xs">uses the rates of its parts</span> : t.rates.map((r: any) => <div key={r.id}>{Number(r.rate)}% from <DateText ad={r.effective_from} />{r.effective_to && <> to <DateText ad={r.effective_to} /></>}</div>)}</td>
            <td>{can('tax.manage') && t.type === 'STANDARD' && !t.is_group && <button className="btn btn-sm" onClick={() => setRate({ id: t.id, code: t.code, rate: '', effectiveFrom: today() })}>New rate</button>}</td></tr>)}</tbody></table>
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
      <Modal open={!!pick} onClose={() => setPick(null)} title="Choose a tax system" wide>
        {pick && (() => {
          const p = packs.data?.find((x) => x.key === pick.key);
          return <div className="space-y-3">
            <Field label="Tax system"><select className="input" value={pick.key} onChange={(e) => setPick({ key: e.target.value })}>{(packs.data ?? []).map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select></Field>
            {p && <>
              <p className="text-sm">{p.notes}</p>
              <p className="muted text-xs">Version {p.version}, rates as of {p.asOf}. Starter data — not tax advice. Loading adds these codes to your company; nothing is deleted or changed.</p>
              <div className="overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th className="num">Rate</th><th>Claimable</th></tr></thead><tbody>{p.codes.map((c: any) => <tr key={c.code}><td className="font-mono">{c.code}</td><td>{c.name}{c.group && <div className="muted text-xs">= {c.group.join(' + ')}</div>}</td><td>{c.group ? 'COMBINED' : c.type}</td><td className="num">{c.group ? '' : `${Number(c.rate)}%`}</td><td>{c.claimable ? 'yes' : 'no'}</td></tr>)}</tbody></table></div>
            </>}
            <button className="btn btn-primary" onClick={async () => { if (await act(() => post('/tax/regime/apply-pack', { packKey: pick.key }))) setPick(null); }}>Use this tax system</button>
          </div>;
        })()}
      </Modal>
      <Modal open={!!custom} onClose={() => setCustom(null)} title="Build your own tax system">
        {custom && <div className="space-y-3">
          <p className="text-sm">Describe how tax works in your country, then add tax codes below (and “Combined tax” if two taxes apply to one sale).</p>
          <Field label="Name"><input className="input" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="e.g. Peru IGV" /></Field>
          <Field label="How does it work?"><select className="input" value={custom.model} onChange={(e) => setCustom({ ...custom, model: e.target.value })}>
            <option value="CREDIT_VAT">VAT / GST — tax on sales minus tax on purchases</option>
            <option value="SALES_TAX">Sales tax — charged on sales, not recoverable on purchases</option>
            <option value="COMPOUND">More than one tax on a sale (e.g. federal + provincial)</option>
            <option value="NONE">No indirect tax</option></select></Field>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="What is the tax called?"><input className="input" value={custom.taxLabel} onChange={(e) => setCustom({ ...custom, taxLabel: e.target.value })} /></Field>
            <Field label="Tax registration number is called"><input className="input" value={custom.taxIdLabel} onChange={(e) => setCustom({ ...custom, taxIdLabel: e.target.value })} /></Field>
            <Field label="Title on invoices"><input className="input" value={custom.invoiceTitle} onChange={(e) => setCustom({ ...custom, invoiceTitle: e.target.value })} /></Field>
            <Field label="Returns are filed"><select className="input" value={custom.returnPeriod} onChange={(e) => setCustom({ ...custom, returnPeriod: e.target.value })}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Yearly</option><option value="NONE">Not applicable</option></select></Field>
          </div>
          <button className="btn btn-primary" disabled={!custom.name} onClick={async () => { if (await act(() => post('/tax/regime/custom', custom))) setCustom(null); }}>Save tax system</button>
        </div>}
      </Modal>
      <Modal open={!!grp} onClose={() => setGrp(null)} title="Combined tax (two or more taxes on one sale)">
        {grp && <div className="space-y-3">
          <p className="text-sm">Pick the taxes that apply together. “On top of” means the later tax is charged on the price <i>plus</i> the earlier tax. Create the individual taxes first.</p>
          <Field label="Code"><input className="input" value={grp.code} onChange={(e) => setGrp({ ...grp, code: e.target.value })} /></Field>
          <Field label="Name"><input className="input" value={grp.name} onChange={(e) => setGrp({ ...grp, name: e.target.value })} /></Field>
          {grp.components.map((c: any, i: number) => <div key={i} className="flex gap-2 items-center">
            <select className="input" value={c.codeId} onChange={(e) => setGrp({ ...grp, components: grp.components.map((x: any, j: number) => (j === i ? { ...x, codeId: e.target.value } : x)) })}><option value="">Choose tax…</option>{plain.filter((t) => t.type === 'STANDARD').map((t) => <option key={t.id} value={t.id}>{t.code} · {t.name}</option>)}</select>
            {i > 0 && <label className="flex gap-1 text-xs whitespace-nowrap"><input type="checkbox" checked={c.stacked} onChange={(e) => setGrp({ ...grp, components: grp.components.map((x: any, j: number) => (j === i ? { ...x, stacked: e.target.checked } : x)) })} /> on top of earlier</label>}
          </div>)}
          <button className="btn btn-sm" onClick={() => setGrp({ ...grp, components: [...grp.components, { codeId: '', stacked: false }] })}>+ Add another tax</button>
          <div><button className="btn btn-primary" disabled={!grp.code || !grp.name || grp.components.some((c: any) => !c.codeId)} onClick={async () => { if (await act(() => post('/tax-codes/group', grp))) setGrp(null); }}>Create</button></div>
        </div>}
      </Modal>
      {step.modal}
    </div>
  );
}
