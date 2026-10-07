'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { DOCS, DocKey } from '@/lib/docs';
import { LineDocForm } from '@/components/line-doc-form';
import { MoneyForm } from '@/components/money-form';
import { Empty, Loading, PageHeader } from '@/components/ui';

export default function EditDoc({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = use(params);
  const def = DOCS[kind as DocKey];
  const q = useQuery({ queryKey: [kind, id], queryFn: () => get(`/${kind}/${id}`), enabled: !!def });
  if (!def) return <Empty>Unknown page</Empty>;
  if (!q.data) return <Loading />;
  return (
    <div>
      <PageHeader title={`Edit ${def.singular.toLowerCase()}`} subtitle="Editing a submitted document sends it back to draft." />
      {def.money ? <MoneyForm def={def} existing={q.data} /> : <LineDocForm def={def} existing={q.data} />}
    </div>
  );
}
