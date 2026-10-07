/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { DateText, Empty, Loading, Money, PageHeader, Status } from '@/components/ui';

export default function Corrections() {
  const q = useQuery({ queryKey: ['corrections'], queryFn: () => get<any[]>('/corrections') });
  return (
    <div>
      <PageHeader title="Reversals & cancellations" subtitle="Posted entries are never edited or deleted — corrections post a linked reversing journal after approval." />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>No corrections.</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid">
            <thead><tr><th>No.</th><th>Kind</th><th>Document</th><th>Date</th><th>Reason</th><th className="num">Amount</th><th>Status</th></tr></thead>
            <tbody>{q.data.map((c) => <tr key={c.id}><td className="font-mono text-xs">{c.doc_no ?? 'draft'}</td><td>{c.kind}</td><td>{c.target_type.replace(/_/g, ' ')} {c.target_ref}</td><td><DateText ad={c.correction_date} short /></td><td>{c.reason}</td><td className="num"><Money v={c.total} /></td><td><Status s={c.status} /></td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
