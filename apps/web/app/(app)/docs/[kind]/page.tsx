/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { DOCS, DocKey, dateFieldOf } from '@/lib/docs';
import { useSession } from '@/components/providers';
import { DateText, Empty, ErrorBanner, Loading, Money, PageHeader, Status } from '@/components/ui';

export default function DocList({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  const def = DOCS[kind as DocKey];
  const router = useRouter();
  const { can } = useSession();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: [kind, status], queryFn: () => get<any[]>(`/${kind}${qs({ status })}`), enabled: !!def });
  if (!def) return <Empty>Unknown page</Empty>;
  const statuses = def.posting ? ['DRAFT', 'SUBMITTED', 'REJECTED', 'POSTED', 'CANCELLED', 'REVERSED'] : Object.keys(def.statusFlow ?? {}).concat(['CANCELLED']);
  return (
    <div>
      <PageHeader
        title={def.title}
        actions={
          <>
            <select className="input" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
            {can(`${def.perm}.create`) && <Link className="btn btn-primary" href={`/docs/${kind}/new`}>+ New {def.singular.toLowerCase()}</Link>}
          </>
        }
      />
      <ErrorBanner error={q.error} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Nothing here yet.</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid">
            <thead>
              <tr>
                <th>No.</th><th>Date</th><th>{def.side === 'SALES' ? 'Customer' : 'Supplier / payee'}</th>
                {def.key === 'bills' && <th>Supplier inv.</th>}
                {def.money && <th>Type</th>}
                <th className="num">{def.money ? 'Amount' : 'Total'}</th>
                {['sales-invoices', 'bills', 'expenses'].includes(def.key) && <th className="num">Due</th>}
                {def.money && <th className="num">Unallocated</th>}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id} className="click" onClick={() => router.push(`/docs/${kind}/${r.id}`)}>
                  <td className="font-mono text-xs">{r.doc_no ?? <span className="muted">draft</span>}</td>
                  <td><DateText ad={dateFieldOf(r)} short /></td>
                  <td>{r.contact_name ?? r.buyer_name ?? <span className="muted">—</span>}</td>
                  {def.key === 'bills' && <td>{r.supplier_invoice_no}</td>}
                  {def.money && <td>{r.kind}</td>}
                  <td className="num"><Money v={def.money ? r.amount : r.grand_total} /></td>
                  {['sales-invoices', 'bills', 'expenses'].includes(def.key) && <td className="num"><Money v={r.amount_due} blankZero /></td>}
                  {def.money && <td className="num"><Money v={r.unallocated_amount} blankZero /></td>}
                  <td><Status s={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
