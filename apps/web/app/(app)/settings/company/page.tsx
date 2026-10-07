'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
import { useStepUp } from '@/components/step-up';
import { ErrorBanner, Field, Loading, Notice, PageHeader } from '@/components/ui';

export default function Company() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['company'], queryFn: () => get('/companies/current') });
  const br = useQuery({ queryKey: ['branches'], queryFn: () => get<any[]>('/companies/current/branches') });
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [nb, setNb] = useState({ code: '', name: '' });
  const step = useStepUp();
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  if (!f) return <Loading />;
  const save = async () => {
    setErr(null); setOk(null);
    try {
      await patch('/companies/current', { name: f.name, legalName: f.legal_name, pan: f.pan, vatNo: f.vat_no, abn: f.abn, address: f.address, phone: f.phone, email: f.email ?? '', taxRounding: f.tax_rounding, version: f.version });
      setOk('Saved.');
      qc.invalidateQueries();
    } catch (e) { setErr(e); }
  };
  const controls = async (patchBody: any) => {
    setErr(null);
    try {
      const fresh = await get('/companies/current');
      await step.run(() => patch('/companies/current/controls', { ...patchBody, version: fresh.version }));
      qc.invalidateQueries();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Company settings" subtitle={`${f.country} · ${f.base_currency} · ${f.calendar_mode} calendar · ${f.business_type}`} />
      <ErrorBanner error={err} />
      {ok && <Notice tone="ok">{ok}</Notice>}
      <div className="panel p-4 grid sm:grid-cols-2 gap-3">
        <Field label="Trading name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Legal name"><input className="input" value={f.legal_name ?? ''} onChange={(e) => setF({ ...f, legal_name: e.target.value })} /></Field>
        {f.country === 'AU' ? <Field label="ABN"><input className="input" value={f.abn ?? ''} onChange={(e) => setF({ ...f, abn: e.target.value })} /></Field> : <Field label="PAN / VAT No."><input className="input" value={f.pan ?? ''} onChange={(e) => setF({ ...f, pan: e.target.value })} /></Field>}
        <Field label="Phone"><input className="input" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="Email"><input className="input" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Address"><input className="input" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Tax rounding" hint="Per line (default) or once per document"><select className="input" value={f.tax_rounding} onChange={(e) => setF({ ...f, tax_rounding: e.target.value })}><option value="LINE">Per line</option><option value="DOCUMENT">Per document</option></select></Field>
        <div className="sm:col-span-2"><button className="btn btn-primary" onClick={save}>Save</button></div>
      </div>
      <div className="panel p-4 space-y-3">
        <h2 className="font-bold">Controls</h2>
        <label className="flex gap-2 text-sm items-start"><input type="checkbox" checked={f.self_approval_allowed} onChange={(e) => controls({ selfApprovalAllowed: e.target.checked })} /> <span><b>Allow self-approval</b> (single-user companies only). A warning “Maker–checker disabled” is shown everywhere.</span></label>
        <label className="flex gap-2 text-sm items-start"><input type="checkbox" checked={f.enforce_2fa_all} onChange={(e) => controls({ enforce2faAll: e.target.checked })} /> <span><b>Require 2FA for everyone</b> (it is always required for Admin, Checker and Finance Manager).</span></label>
      </div>
      <div className="panel p-4">
        <h2 className="font-bold mb-2">Branches</h2>
        <table className="grid text-sm"><tbody>{(br.data ?? []).map((b) => <tr key={b.id}><td className="font-mono">{b.code}</td><td>{b.name}{b.is_head_office && ' (head office)'}</td></tr>)}</tbody></table>
        <div className="flex gap-2 mt-3"><input className="input" style={{ width: 100 }} placeholder="Code" value={nb.code} onChange={(e) => setNb({ ...nb, code: e.target.value })} /><input className="input" placeholder="Branch name" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} /><button className="btn" onClick={async () => { try { await post('/companies/current/branches', nb); setNb({ code: '', name: '' }); br.refetch(); } catch (e) { setErr(e); } }}>Add</button></div>
      </div>
      {step.modal}
    </div>
  );
}
