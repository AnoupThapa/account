/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '@/lib/api';
import { ErrorBanner, Loading, Money, Notice, PageHeader } from '@/components/ui';

export default function Workflows() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['workflows'], queryFn: () => get<any[]>('/approval-workflows') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => get<any[]>('/roles') });
  const [edit, setEdit] = useState<Record<string, any[]>>({});
  const [err, setErr] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  if (!q.data || !roles.data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Approval workflows" subtitle="Per document type: steps apply when the amount is at or above the step's minimum. Checkers can never approve their own entries." />
      <ErrorBanner error={err} />
      {ok && <Notice tone="ok">Saved.</Notice>}
      {q.data.map((w) => {
        const steps = edit[w.id] ?? w.steps.map((s: any) => ({ name: s.name, roleId: s.role_id, minAmount: s.min_amount }));
        const setSteps = (s: any[]) => setEdit({ ...edit, [w.id]: s });
        return (
          <div key={w.id} className="panel p-3">
            <div className="flex justify-between items-center mb-2">
              <b>{w.name}</b>
              <label className="text-sm flex gap-2"><input type="checkbox" checked={w.auto_approve} onChange={async (e) => { try { await patch(`/approval-workflows/${w.id}`, { autoApprove: e.target.checked }); qc.invalidateQueries({ queryKey: ['workflows'] }); } catch (x) { setErr(x); } }} /> Auto-approve (low-risk only, logged)</label>
            </div>
            <table className="grid text-sm"><thead><tr><th>Step</th><th>Name</th><th>Approver role</th><th className="num">From amount</th><th /></tr></thead>
              <tbody>{steps.map((s: any, i: number) => (
                <tr key={i}><td>{i + 1}</td>
                  <td><input className="input" value={s.name} onChange={(e) => setSteps(steps.map((x: any, j: number) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                  <td><select className="input" value={s.roleId ?? ''} onChange={(e) => setSteps(steps.map((x: any, j: number) => (j === i ? { ...x, roleId: e.target.value || null } : x)))}><option value="">Anyone with approve permission</option>{roles.data.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></td>
                  <td><input className="input num" value={s.minAmount} onChange={(e) => setSteps(steps.map((x: any, j: number) => (j === i ? { ...x, minAmount: e.target.value } : x)))} /><div className="muted text-xs text-right"><Money v={s.minAmount || 0} /></div></td>
                  <td><button className="btn btn-sm" onClick={() => steps.length > 1 && setSteps(steps.filter((_: any, j: number) => j !== i))}>✕</button></td></tr>
              ))}</tbody></table>
            <div className="flex gap-2 mt-2">
              <button className="btn btn-sm" onClick={() => setSteps([...steps, { name: 'Additional approval', roleId: null, minAmount: '0' }])}>+ Step</button>
              {edit[w.id] && <button className="btn btn-sm btn-primary" onClick={async () => { setErr(null); try { await patch(`/approval-workflows/${w.id}`, { steps }); setOk(true); const n = { ...edit }; delete n[w.id]; setEdit(n); qc.invalidateQueries({ queryKey: ['workflows'] }); } catch (x) { setErr(x); } }}>Save steps</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
