'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { PostingActions } from '@/components/doc-actions';
import { DateText, Loading, Money, PageHeader, Status } from '@/components/ui';

export default function OpeningDoc({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['opening', id], queryFn: () => get(`/opening-balances/${id}`) });
  if (!q.data) return <Loading />;
  const o = q.data;
  return (
    <div className="space-y-4">
      <PageHeader title={`Opening balances ${o.doc_no ?? '(draft)'}`} subtitle={<><Status s={o.status} /> · as of <DateText ad={o.as_of_date} /> · to Opening Balance Equity <Money v={o.obe_difference} /></>} />
      <PostingActions docType="OPENING_BALANCE" doc={o} perm="opening" deletePath={`/opening-balances/${id}`} correctionLabel="Request reversal" onChanged={() => q.refetch()} />
      <div className="panel"><table className="grid text-sm"><thead><tr><th>Type</th><th>Account / contact</th><th>Ref</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
        <tbody>{o.lines.map((l: any) => <tr key={l.id}><td>{l.kind}</td><td>{l.account_code ? `${l.account_code} · ${l.account_name}` : l.contact_name}</td><td>{l.reference}</td><td className="num"><Money v={l.debit} blankZero /></td><td className="num"><Money v={l.credit} blankZero /></td></tr>)}</tbody></table></div>
    </div>
  );
}
