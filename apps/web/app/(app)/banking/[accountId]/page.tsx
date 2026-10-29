/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { d, money } from '@ledgerpro/shared';
import { get, post, qs } from '@/lib/api';
import { useSession } from '@/components/providers';
import { AddTransaction } from '@/components/bank-add-transaction';
import { DateText, Empty, ErrorBanner, Field, Loading, Modal, Money, Notice, PageHeader, today } from '@/components/ui';

const TIER: Record<string, string> = { REFERENCE: 'same reference + amount', DATE_AMOUNT: 'same amount, close date', AMOUNT: 'same amount only', COMBINATION: 'several books items add up' };
type Tab = 'match' | 'matched' | 'ignored' | 'history';

/** The reconcile screen: statement lines on the left, book transactions on the right. */
export default function Reconcile({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  const { can } = useSession();
  const qc = useQueryClient();
  const canDo = can('bank.reconcile');
  const [tab, setTab] = useState<Tab>('match');
  const [selS, setSelS] = useState<Set<string>>(new Set());
  const [selB, setSelB] = useState<Set<string>>(new Set());
  const [older, setOlder] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState<any>(null);
  const [ignoring, setIgnoring] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [finishing, setFinishing] = useState(false);

  const accounts = useQuery({ queryKey: ['bank-accounts'], queryFn: () => get<any[]>('/bank/accounts') });
  const acct = accounts.data?.find((a) => a.id === accountId);
  const stmt = useQuery({ queryKey: ['bank', accountId, 'lines', 'UNMATCHED'], queryFn: () => get<any[]>(`/bank/accounts/${accountId}/statement-lines?status=UNMATCHED`) });
  const book = useQuery({ queryKey: ['bank', accountId, 'book', older], queryFn: () => get<any[]>(`/bank/accounts/${accountId}/book-lines${qs({ includeOlder: older })}`) });
  const sug = useQuery({ queryKey: ['bank', accountId, 'sug'], queryFn: () => get<any[]>(`/bank/accounts/${accountId}/suggestions`) });
  const matched = useQuery({ queryKey: ['bank', accountId, 'matches'], queryFn: () => get<any[]>(`/bank/accounts/${accountId}/matches`), enabled: tab === 'matched' });
  const ignored = useQuery({ queryKey: ['bank', accountId, 'lines', 'IGNORED'], queryFn: () => get<any[]>(`/bank/accounts/${accountId}/statement-lines?status=IGNORED`), enabled: tab === 'ignored' });
  const hist = useQuery({ queryKey: ['bank', accountId, 'hist'], queryFn: () => get<any[]>(`/bank/accounts/${accountId}/reconciliations`), enabled: tab === 'history' });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bank', accountId] });
    qc.invalidateQueries({ queryKey: ['bank-accounts'] });
  };
  const run = async (fn: () => Promise<any>, ok?: (r: any) => string) => {
    setErr(null);
    setMsg('');
    try {
      const r = await fn();
      if (ok) setMsg(ok(r));
      setSelS(new Set());
      setSelB(new Set());
      refresh();
    } catch (x) {
      setErr(x);
    }
  };

  const sTotal = useMemo(() => (stmt.data ?? []).filter((l) => selS.has(l.id)).reduce((s, l) => s.plus(l.amount), d(0)), [stmt.data, selS]);
  const bTotal = useMemo(() => (book.data ?? []).filter((l) => selB.has(l.id)).reduce((s, l) => s.plus(l.amount), d(0)), [book.data, selB]);
  const diff = sTotal.minus(bTotal);
  const canMatch = canDo && selS.size > 0 && selB.size > 0 && diff.isZero();
  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    fn(n);
  };
  const suggestFor = (id: string) => sug.data?.find((s) => s.statementLineId === id);
  const bookById = (id: string) => book.data?.find((b) => b.id === id);
  const doMatch = () => run(() => post(`/bank/accounts/${accountId}/match`, { statementLineIds: [...selS], journalLineIds: [...selB] }), (r) => `Matched ${money(r.total)}.`);

  return (
    <div className="space-y-4">
      <PageHeader
        title={acct ? `Reconcile · ${acct.name}` : 'Reconcile'}
        subtitle={acct && <>Books balance <Money v={acct.bookBalance} /> · {acct.unmatchedStatement} statement line(s) to match{acct.lastReconciled && <> · last reconciled to <DateText ad={acct.lastReconciled.date} short /></>}</>}
        actions={<div className="flex gap-2"><Link className="btn" href="/banking">All accounts</Link>{can('bank.import') && <Link className="btn" href={`/banking/${accountId}/import`} data-testid="go-import">Upload statement</Link>}{canDo && <button className="btn btn-primary" onClick={() => setFinishing(true)} data-testid="finish-btn">Finish reconciliation</button>}</div>}
      />
      <ErrorBanner error={err} />
      {msg && <Notice tone="ok">{msg}</Notice>}
      <div className="flex gap-1 border-b" style={{ borderColor: 'var(--line)' }}>
        {([['match', 'To match'], ['matched', 'Matched'], ['ignored', 'Ignored'], ['history', 'Past reconciliations']] as [Tab, string][]).map(([t, l]) => <button key={t} className="px-3 py-2 text-sm" style={t === tab ? { borderBottom: '2px solid var(--brand)', fontWeight: 600, color: 'var(--brand)' } : undefined} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {tab === 'match' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {canDo && <button className="btn" onClick={() => run(() => post(`/bank/accounts/${accountId}/auto-match`), (r) => `Auto-match matched ${r.applied} line(s).${r.needConfirmation ? ` ${r.needConfirmation} more have a suggestion for you to confirm.` : ''}`)} data-testid="auto-match">Auto-match</button>}
            <label className="text-sm flex items-center gap-1 muted"><input type="checkbox" checked={older} onChange={(e) => setOlder(e.target.checked)} /> Show books items from before the statement started</label>
            <div className="ml-auto panel px-3 py-2 text-sm flex flex-wrap gap-x-4" data-testid="match-bar">
              <span>Statement <b>{money(sTotal)}</b></span><span>Books <b>{money(bTotal)}</b></span>
              <span style={{ color: selS.size && selB.size ? (diff.isZero() ? 'var(--ok)' : 'var(--danger)') : undefined }}>Difference <b>{money(diff)}</b></span>
              <button className="btn btn-primary btn-sm" disabled={!canMatch} onClick={doMatch} data-testid="match-btn">Match</button>
            </div>
          </div>
          <div className="grid lg:grid-cols-2 gap-4 items-start">
            <div className="panel overflow-x-auto" data-testid="stmt-pane">
              <div className="p-2 font-semibold text-sm border-b" style={{ borderColor: 'var(--line)' }}>Bank statement ({stmt.data?.length ?? 0})</div>
              {!stmt.data ? <Loading /> : stmt.data.length === 0 ? <Empty>Nothing left to match. {can('bank.import') ? 'Upload a statement to begin.' : ''}</Empty> : (
                <table className="grid text-sm"><tbody>
                  {stmt.data.map((l) => {
                    const s = suggestFor(l.id);
                    return (
                      <tr key={l.id} style={selS.has(l.id) ? { background: 'var(--brand-soft)' } : undefined} data-testid="stmt-row">
                        <td className="w-6"><input type="checkbox" checked={selS.has(l.id)} onChange={() => toggle(selS, l.id, setSelS)} aria-label={`Select ${l.description}`} /></td>
                        <td><div className="text-xs muted"><DateText ad={l.txn_date} short /></div><div>{l.description}</div>
                          {(l.reference || l.cheque_no) && <div className="text-xs muted">Ref {l.reference ?? l.cheque_no}</div>}
                          {l.pendingDoc && <div className="text-xs" style={{ color: 'var(--warn)' }}>Waiting for approval: {l.pendingDoc.type.replace('_', ' ').toLowerCase()} {l.pendingDoc.no ?? ''} ({l.pendingDoc.status.toLowerCase()})</div>}
                          {s && !l.pendingDoc && canDo && (
                            <div className="text-xs mt-1 flex flex-wrap items-center gap-1"><span className="badge" style={{ color: s.auto ? 'var(--ok)' : 'var(--warn)' }}>{s.auto ? 'Likely' : 'Suggested'}</span><span className="muted">{TIER[s.tier]}:</span> {s.journalLineIds.map((id: string) => bookById(id)?.sourceNo ?? '…').join(' + ')}
                              <button className="btn btn-sm" onClick={() => run(() => post(`/bank/accounts/${accountId}/match`, { statementLineIds: [l.id], journalLineIds: s.journalLineIds }), () => 'Matched.')} data-testid="accept-suggestion">Accept</button></div>)}
                        </td>
                        <td className="num"><Money v={l.amount} /></td>
                        <td>{canDo && !l.pendingDoc && <div className="flex gap-1"><button className="btn btn-sm" onClick={() => setAdding(l)} data-testid="add-tx">Add</button><button className="btn btn-sm" onClick={() => { setIgnoring(l); setReason(''); }}>Ignore</button></div>}</td>
                      </tr>
                    );
                  })}
                </tbody></table>
              )}
            </div>
            <div className="panel overflow-x-auto" data-testid="book-pane">
              <div className="p-2 font-semibold text-sm border-b" style={{ borderColor: 'var(--line)' }}>Your books ({book.data?.length ?? 0}) <span className="muted font-normal">— payments, receipts, expenses and journals on this account</span></div>
              {!book.data ? <Loading /> : book.data.length === 0 ? <Empty>No unmatched transactions in your books.</Empty> : (
                <table className="grid text-sm"><tbody>
                  {book.data.map((b) => (
                    <tr key={b.id} style={selB.has(b.id) ? { background: 'var(--brand-soft)' } : undefined} data-testid="book-row">
                      <td className="w-6"><input type="checkbox" checked={selB.has(b.id)} onChange={() => toggle(selB, b.id, setSelB)} aria-label={`Select ${b.sourceNo ?? b.entryNo}`} /></td>
                      <td><div className="text-xs muted"><DateText ad={b.date} short /> · {b.sourceNo ?? b.entryNo} · {b.sourceType.replace(/_/g, ' ').toLowerCase()}</div>
                        <div>{b.contactName ?? '—'}</div>{b.description && <div className="text-xs muted">{b.description}</div>}</td>
                      <td className="num"><Money v={b.amount} /></td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </div>
          </div>
          <div className="muted text-xs">Tick lines on both sides and press Match. One statement line can match several books items (and the other way round) as long as the totals are equal.</div>
        </>
      )}

      {tab === 'matched' && (!matched.data ? <Loading /> : matched.data.length === 0 ? <Empty>No matches yet.</Empty> : (
        <div className="space-y-2">{matched.data.map((g) => (
          <div key={g.id} className="panel p-3 text-sm grid md:grid-cols-[1fr_1fr_auto] gap-3">
            <div><div className="muted text-xs">Statement</div>{g.statement.map((s: any, i: number) => <div key={i}><DateText ad={s.txn_date} short /> {s.description} · <Money v={s.amount} /></div>)}</div>
            <div><div className="muted text-xs">Books</div>{g.books.map((b: any) => <div key={b.id}><DateText ad={b.date} short /> {b.sourceNo ?? b.entryNo} {b.contactName} · <Money v={b.amount} /></div>)}</div>
            <div className="text-right"><span className="badge">{g.reconciled ? 'Reconciled' : g.method.toLowerCase()}</span>
              {canDo && (!g.reconciled || can('bank.unreconcile')) && <div className="pt-1"><button className="btn btn-sm" onClick={() => run(() => post(`/bank/matches/${g.id}/unmatch`), () => 'Un-matched.')}>Un-match</button></div>}</div>
          </div>))}</div>
      ))}

      {tab === 'ignored' && (!ignored.data ? <Loading /> : ignored.data.length === 0 ? <Empty>No ignored lines.</Empty> : (
        <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Date</th><th>Description</th><th>Reason</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{ignored.data.map((l) => <tr key={l.id}><td><DateText ad={l.txn_date} short /></td><td>{l.description}</td><td className="muted">{l.ignore_reason}</td><td className="num"><Money v={l.amount} /></td><td>{canDo && <button className="btn btn-sm" onClick={() => run(() => post(`/bank/lines/${l.id}/unignore`), () => 'Line is back in the to-match list.')}>Bring back</button>}</td></tr>)}</tbody></table></div>
      ))}

      {tab === 'history' && (!hist.data ? <Loading /> : hist.data.length === 0 ? <Empty>No finished reconciliations yet.</Empty> : (
        <div className="panel overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Statement date</th><th className="num">Statement balance</th><th>Done by</th><th>Note</th><th /></tr></thead>
          <tbody>{hist.data.map((h) => <tr key={h.id}><td><DateText ad={h.statement_date} /></td><td className="num"><Money v={h.statement_balance} /></td><td>{h.created_by_name}</td><td className="muted">{h.note}</td><td><Link className="btn btn-sm" href={`/banking/reconciliations/${h.id}`}>View report</Link></td></tr>)}</tbody></table></div>
      ))}

      {adding && <AddTransaction line={adding} accountId={accountId} onClose={() => setAdding(null)} onDone={(m) => { setAdding(null); setMsg(m); refresh(); }} />}
      <Modal open={!!ignoring} onClose={() => setIgnoring(null)} title="Ignore this statement line">
        {ignoring && <div className="space-y-3"><div className="text-sm">{ignoring.description} · <Money v={ignoring.amount} /></div>
          <Field label="Why? *"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bank will reverse this" /></Field>
          <button className="btn btn-primary" disabled={reason.trim().length < 3} onClick={() => { const id = ignoring.id; setIgnoring(null); run(() => post(`/bank/lines/${id}/ignore`, { reason }), () => 'Line ignored.'); }}>Ignore line</button></div>}
      </Modal>
      {finishing && <FinishDialog accountId={accountId} onClose={() => setFinishing(false)} onDone={(id) => { setFinishing(false); refresh(); window.location.href = `/banking/reconciliations/${id}`; }} />}
    </div>
  );
}

function FinishDialog({ accountId, onClose, onDone }: { accountId: string; onClose: () => void; onDone: (id: string) => void }) {
  const [date, setDate] = useState(today());
  const [bal, setBal] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const valid = /^-?\d+(\.\d{1,2})?$/.test(bal.trim());
  const p = useQuery({ queryKey: ['bank', accountId, 'preview', date, bal], queryFn: () => get<any>(`/bank/accounts/${accountId}/reconcile-preview${qs({ date, balance: bal.trim() })}`), enabled: valid && /^\d{4}-\d{2}-\d{2}$/.test(date) });
  const save = async () => {
    setErr(null);
    try {
      const r = await post(`/bank/accounts/${accountId}/finish`, { statementDate: date, statementBalance: bal.trim(), note: note || undefined });
      onDone(r.id);
    } catch (x) {
      setErr(x);
    }
  };
  const r = p.data;
  return (
    <Modal open onClose={onClose} title="Finish reconciliation" wide>
      <div className="space-y-3">
        <ErrorBanner error={err} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Statement closing date"><input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
          <Field label="Closing balance on the statement" hint="The balance printed at the bottom of the bank statement."><input className="input" inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} data-testid="finish-balance" /></Field>
        </div>
        {r && (
          <div className="panel p-3 text-sm space-y-1" data-testid="finish-math">
            <div className="flex justify-between"><span>Balance in your books at this date</span><Money v={r.bookBalance} /></div>
            <div className="flex justify-between"><span>less: books items not on the statement yet (outstanding)</span><Money v={r.unmatchedBookNet} /></div>
            <div className="flex justify-between"><span>plus: statement items ignored</span><Money v={r.unmatchedStatementNet} /></div>
            <div className="flex justify-between font-semibold border-t pt-1" style={{ borderColor: 'var(--line)' }}><span>Expected statement balance</span><Money v={r.expectedStatementBalance} /></div>
            <div className="flex justify-between"><span>Balance you entered</span><Money v={r.statementBalance} /></div>
            <div className="flex justify-between font-semibold" style={{ color: d(r.difference).isZero() ? 'var(--ok)' : 'var(--danger)' }}><span>Difference</span><Money v={r.difference} /></div>
            {r.openStatementLines > 0 && <div style={{ color: 'var(--danger)' }}>{r.openStatementLines} statement line(s) are still waiting to be matched, added or ignored.</div>}
            {r.straddling > 0 && <div style={{ color: 'var(--danger)' }}>A match links this statement date with a later books entry — choose a later date.</div>}
          </div>
        )}
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex gap-2"><button className="btn btn-primary" disabled={!r?.canFinish} onClick={save} data-testid="finish-save">Finish and lock</button><button className="btn" onClick={onClose}>Cancel</button></div>
        <div className="muted text-xs">Finishing locks every match up to this date. Only someone with the “undo reconciliation” permission can unlock them, and it is logged.</div>
      </div>
    </Modal>
  );
}
