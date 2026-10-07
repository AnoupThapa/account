'use client';
import { use } from 'react';
import { DOCS, DocKey } from '@/lib/docs';
import { LineDocForm } from '@/components/line-doc-form';
import { MoneyForm } from '@/components/money-form';
import { Empty, PageHeader } from '@/components/ui';

export default function NewDoc({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  const def = DOCS[kind as DocKey];
  if (!def) return <Empty>Unknown page</Empty>;
  return (
    <div>
      <PageHeader title={`New ${def.singular.toLowerCase()}`} />
      {def.money ? <MoneyForm def={def} /> : <LineDocForm def={def} />}
    </div>
  );
}
