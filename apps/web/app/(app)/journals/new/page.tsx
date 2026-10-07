'use client';
import { JournalForm } from '@/components/journal-form';
import { PageHeader } from '@/components/ui';
export default function NewJournal() {
  return (<div><PageHeader title="New journal voucher" subtitle="Control accounts (receivables, payables, VAT) need a contact and special permission." /><JournalForm /></div>);
}
