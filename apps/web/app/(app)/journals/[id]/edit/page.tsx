/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { JournalForm } from '@/components/journal-form';
import { Loading, PageHeader } from '@/components/ui';
export default function EditJournal({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['journal', id], queryFn: () => get(`/journals/${id}`) });
  if (!q.data) return <Loading />;
  return (<div><PageHeader title="Edit journal" /><JournalForm existing={q.data} /></div>);
}
