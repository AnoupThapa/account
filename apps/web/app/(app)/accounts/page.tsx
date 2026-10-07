'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { ErrorBanner, Field, Loading, Modal, PageHeader } from '@/components/ui';

export default function Accounts() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['accounts'], queryFn: () => get<any[]>('/accounts') });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  if (!q.data) return <Loading />;
  const byParent = new Map<string | null, any[]>();
  for (const a of q.data) byParent.set(a.parent_id, [...(byParent.get(a.parent_id) ?? []), a]);
  const rows: { a: any; depth: number }[] = [];
  const walk = (pid: string | null, depth: number) => (byParent.get(pid) ?? []).sort((x, y) => x.code.localeCompare(y.code)).forEach((a) => { rows.push({ a, depth }); walk(a.id, depth + 1); });
  walk(null, 0);
  const save = async () => {
    setErr(null);
    try {
      if (edit.id) await patch(`/accounts/${edit.id}`, { name: edit.name, isActive: edit.is_active, version: edit.version });
      else await post('/accounts', { code: edit.code, name: edit.name, class: edit.class, parentId: edit.parentId || null, subtype: edit.subtype || null, requiresContact: false });
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div>
      <PageHeader title="Chart of accounts" subtitle="Class → Group → Sub-group → Ledger. System accounts (🔒) are protected." actions={can('coa.manage') && <button className="btn btn-primary" onClick={() => setEdit({ code: '', name: '', class: 'EXPENSE', parentId: '' })}>+ New account</button>} />
      <div className="panel overflow-x-auto">
        <table className="grid text-sm">
          <thead><tr><th>Code</th><th>Name</th><th>Class</th><th>Type</th><th /></tr></thead>
          <tbody>
            {rows.map(({ a, depth }) => (
              <tr key={a.id} style={{ opacity: a.is_active ? 1 : 0.5 }}>
                <td className="font-mono">{a.code}</td>
                <td style={{ paddingLeft: 8 + depth * 18, fontWeight: a.is_postable ? 400 : 700 }}>
                  {a.is_postable ? <Link className="hover:underline" href={`/reports/general-ledger?accountId=${a.id}`}>{a.name}</Link> : a.name} {a.is_system && '🔒'} {a.is_control && <span className="badge">control</span>}
                </td>
                <td className="text-xs">{a.class}</td>
                <td className="text-xs muted">{a.subtype}</td>
                <td>{can('coa.manage') && !a.is_system && <button className="btn btn-sm" onClick={() => setEdit({ ...a })}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit account' : 'New account'}>
        {edit && (
          <div className="space-y-3">
            <ErrorBanner error={err} />
            {!edit.id && <Field label="Code *" hint="Assets 1xxx · Liabilities 2xxx · Equity 3xxx · Income 4xxx · Expenses 5xxx"><input className="input" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>}
            <Field label="Name *"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {!edit.id && (
              <>
                <Field label="Class"><select className="input" value={edit.class} onChange={(e) => setEdit({ ...edit, class: e.target.value })}>{['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Under (heading)"><select className="input" value={edit.parentId} onChange={(e) => setEdit({ ...edit, parentId: e.target.value })}><option value="">— top level —</option>{q.data.filter((a) => !a.is_postable && a.class === edit.class).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
                <Field label="Special type" hint="Use BANK / CASH / WALLET for money accounts"><select className="input" value={edit.subtype ?? ''} onChange={(e) => setEdit({ ...edit, subtype: e.target.value })}><option value="">—</option>{['BANK', 'CASH', 'WALLET', 'CURRENT_ASSET', 'PPE', 'CURRENT_LIABILITY', 'ADMIN', 'SELLING', 'FINANCE', 'REVENUE', 'OTHER_INCOME'].map((s) => <option key={s}>{s}</option>)}</select></Field>
              </>
            )}
            {edit.id && <label className="text-sm flex gap-2"><input type="checkbox" checked={edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} /> Active</label>}
            <button className="btn btn-primary" onClick={save}>Save</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
