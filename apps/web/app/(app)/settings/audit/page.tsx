/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { ErrorBanner, Loading, Modal, Notice, PageHeader } from '@/components/ui';

export default function Audit() {
  const [f, setF] = useState({ entity: '', action: '' });
  const q = useQuery({ queryKey: ['audit', f], queryFn: () => get<any[]>(`/audit-logs${qs({ ...f, limit: 300 })}`) });
  const v = useQuery({ queryKey: ['audit-verify'], queryFn: () => get('/audit-logs/verify') });
  const integ = useQuery({ queryKey: ['integrity'], queryFn: () => get('/reports/integrity') });
  const [row, setRow] = useState<any>(null);
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" subtitle="Append-only and hash-chained: nobody (including Admin) can edit or delete it." />
      {v.data && <Notice tone={v.data.intact ? 'ok' : 'warn'}>{v.data.intact ? `✔ Hash chain verified (${v.data.rowsChecked} entries).` : `⚠ Hash chain broken at entry ${v.data.firstBrokenId} — investigate immediately.`}</Notice>}
      {integ.data && <div className="panel p-3 text-sm space-y-1">{integ.data.checks.map((c: any) => <div key={c.check}>{c.ok ? '✔' : '✖'} {c.check} <span className="muted">({c.detail})</span></div>)}</div>}
      <div className="flex gap-2">
        <input className="input" style={{ width: 200 }} placeholder="Entity (e.g. sales_invoices)" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })} />
        <select className="input" style={{ width: 180 }} value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}><option value="">All actions</option>{['CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'APPROVE', 'REJECT', 'POST', 'REVERSE', 'CANCEL', 'LOCK', 'UNLOCK', 'EXPORT', 'PRINT', 'ROLE_ASSIGNED', 'SETTING_CHANGED', 'ALLOCATE', 'GO_LIVE'].map((a) => <option key={a}>{a}</option>)}</select>
      </div>
      <ErrorBanner error={q.error} />
      {!q.data ? <Loading /> : (
        <div className="panel overflow-x-auto">
          <table className="grid text-sm"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th><th /></tr></thead>
            <tbody>{q.data.map((r) => <tr key={r.id}><td className="text-xs">{new Date(r.at).toLocaleString()}</td><td>{r.user_name}</td><td>{r.action}</td><td className="text-xs">{r.entity}</td><td className="text-xs">{r.ip}</td><td><button className="btn btn-sm" onClick={() => setRow(r)}>Details</button></td></tr>)}</tbody></table>
        </div>
      )}
      <Modal open={!!row} onClose={() => setRow(null)} title={`${row?.action} ${row?.entity}`} wide>
        {row && <div className="grid sm:grid-cols-2 gap-3 text-xs"><div><b>Before</b><pre className="whitespace-pre-wrap">{JSON.stringify(row.before, null, 2)}</pre></div><div><b>After</b><pre className="whitespace-pre-wrap">{JSON.stringify(row.after, null, 2)}</pre></div><div className="sm:col-span-2 muted">Request {row.request_id} · hash {row.hash}</div></div>}
      </Modal>
    </div>
  );
}
