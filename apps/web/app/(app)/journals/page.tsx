/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { useSession } from '@/components/providers';
import { DateText, Empty, Loading, Money, PageHeader, Status } from '@/components/ui';

export default function Journals() {
  const { can } = useSession();
  const router = useRouter();
  const q = useQuery({ queryKey: ['journals'], queryFn: () => get<any[]>('/journals') });
  return (
    <div>
      <PageHeader title="Journal vouchers" actions={can('journal.create') && <Link className="btn btn-primary" href="/journals/new">+ New journal</Link>} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>No journals yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="grid"><thead><tr><th>No.</th><th>Date</th><th>Narration</th><th>Maker</th><th className="num">Amount</th><th>Status</th></tr></thead>
          <tbody>{q.data.map((j) => <tr key={j.id} className="click" onClick={() => router.push(`/journals/${j.id}`)}><td className="font-mono text-xs">{j.doc_no ?? 'draft'}</td><td><DateText ad={j.journal_date} short /></td><td>{j.narration}</td><td>{j.created_by_name}</td><td className="num"><Money v={j.total} /></td><td><Status s={j.status} /></td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}
