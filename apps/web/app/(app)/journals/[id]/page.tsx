/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { PostingActions } from '@/components/doc-actions';
import { DateText, ErrorBanner, Loading, Money, PageHeader, Status } from '@/components/ui';

export default function ViewJournal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['journal', id], queryFn: () => get(`/journals/${id}`) });
  if (q.error) return <ErrorBanner error={q.error} />;
  if (!q.data) return <Loading />;
  const j = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title={`Journal ${j.doc_no ?? '(draft)'}`} subtitle={<><Status s={j.status} /> · <DateText ad={j.journal_date} /> · {j.narration}</>} />
      <PostingActions docType="MANUAL_JOURNAL" doc={j} perm="journal" editHref={`/journals/${id}/edit`} deletePath={`/journals/${id}`} correctionLabel="Request reversal" onChanged={() => q.refetch()} />
      <div className="panel overflow-x-auto">
        <table className="grid"><thead><tr><th>Account</th><th>Contact</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>{j.lines.map((l: any) => <tr key={l.id}><td>{l.account_code} · {l.account_name}</td><td>{l.contact_name}</td><td>{l.description}</td><td className="num"><Money v={l.debit} blankZero /></td><td className="num"><Money v={l.credit} blankZero /></td></tr>)}</tbody></table>
      </div>
      {j.journal_entry_id && <Link className="underline text-sm" href={`/reports/entry/${j.journal_entry_id}`}>View posted ledger entry →</Link>}
    </div>
  );
}
