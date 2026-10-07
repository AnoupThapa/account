'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { d, money, sum } from '@ledgerpro/shared';
import { patch, post } from '@/lib/api';
import { AccountSelect, ContactSelect, CostCentreSelect, useAccounts } from './pickers';
import { DateField, ErrorBanner, Field, Money, today } from './ui';

interface L { accountId: string | null; contactId: string | null; debit: string; credit: string; description: string; costCentreId: string | null }
const blank = (): L => ({ accountId: null, contactId: null, debit: '', credit: '', description: '', costCentreId: null });

export function JournalForm({ existing }: { existing?: any }) {
  const router = useRouter();
  const accts = useAccounts();
  const [h, setH] = useState({ journalDate: existing?.journal_date ?? today(), narration: existing?.narration ?? '', reference: existing?.reference ?? '' });
  const [lines, setLines] = useState<L[]>(existing?.lines?.map((l: any) => ({ accountId: l.account_id, contactId: l.contact_id, debit: Number(l.debit) ? l.debit : '', credit: Number(l.credit) ? l.credit : '', description: l.description ?? '', costCentreId: l.cost_centre_id })) ?? [blank(), blank()]);
  const [err, setErr] = useState<unknown>(null);
  const dr = sum(lines.map((l) => l.debit || 0));
  const cr = sum(lines.map((l) => l.credit || 0));
  const diff = dr.minus(cr);
  const setLine = (i: number, p: Partial<L>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const needsContact = (id: string | null) => !!accts.data?.find((a) => a.id === id)?.requires_contact;
  const save = async (submit: boolean) => {
    setErr(null);
    try {
      const body = { ...h, reference: h.reference || undefined, lines: lines.filter((l) => l.accountId).map((l) => ({ ...l, debit: l.debit || '0', credit: l.credit || '0', description: l.description || undefined })), version: existing?.version };
      const j = existing ? await patch(`/journals/${existing.id}`, body) : await post('/journals', body);
      if (submit) await post(`/documents/MANUAL_JOURNAL/${j.id}/submit`, {});
      router.push(`/journals/${j.id}`);
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div className="space-y-4">
      <ErrorBanner error={err} />
      <div className="panel p-4 grid sm:grid-cols-3 gap-3">
        <DateField label="Date" value={h.journalDate} onChange={(v) => setH({ ...h, journalDate: v })} required />
        <Field label="Reference"><input className="input" value={h.reference} onChange={(e) => setH({ ...h, reference: e.target.value })} /></Field>
        <div className="sm:col-span-3"><Field label="Narration *"><input className="input" value={h.narration} onChange={(e) => setH({ ...h, narration: e.target.value })} /></Field></div>
      </div>
      <div className="panel overflow-x-auto">
        <table className="grid min-w-[860px]">
          <thead><tr><th>Account</th><th>Customer / supplier</th><th>Description</th><th style={{ width: 130 }} className="num">Debit</th><th style={{ width: 130 }} className="num">Credit</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td><AccountSelect value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} /><CostCentreSelect value={l.costCentreId} onChange={(v) => setLine(i, { costCentreId: v })} /></td>
                <td>{needsContact(l.accountId) ? <ContactSelect value={l.contactId} onChange={(v) => setLine(i, { contactId: v })} placeholder="Required…" /> : <span className="muted text-xs">—</span>}</td>
                <td><input className="input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                <td><input className="input num" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} inputMode="decimal" /></td>
                <td><input className="input num" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} inputMode="decimal" /></td>
                <td><button className="btn btn-sm" onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((_, j) => j !== i) : ls))}>✕</button></td>
              </tr>
            ))}
            <tr>
              <td colSpan={3}><button className="btn btn-sm" onClick={() => setLines([...lines, blank()])}>+ Add line</button>
                {!diff.isZero() && <span className="ml-3 text-sm" style={{ color: 'var(--danger)' }}>Difference <Money v={money(diff.abs())} /> — debits must equal credits</span>}
              </td>
              <td className="num font-bold"><Money v={money(dr)} /></td>
              <td className="num font-bold"><Money v={money(cr)} /></td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={() => save(false)}>Save draft</button>
        <button className="btn btn-primary" disabled={!diff.isZero() || d(dr).isZero()} onClick={() => save(true)}>Save & submit for approval</button>
      </div>
    </div>
  );
}
