'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { del, get, post } from '@/lib/api';
import { useSession } from './providers';
import { DateField, DateText, ErrorBanner, Field, Modal, Money, today } from './ui';

export function JournalPreview({ docType, id }: { docType: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  return (
    <>
      <button className="btn btn-sm" onClick={async () => { setOpen(true); try { setRows(await get(`/documents/${docType}/${id}/journal-preview`)); } catch (e) { setErr(e); } }}>Journal preview</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Journal that will be / was posted" wide>
        <ErrorBanner error={err} />
        <table className="grid text-sm">
          <thead><tr><th>Account</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th></tr></thead>
          <tbody>
            {(rows ?? []).map((r, i) => (
              <tr key={i}><td>{r.accountCode} · {r.accountName}</td><td>{r.description}</td><td className="num"><Money v={r.debit} blankZero /></td><td className="num"><Money v={r.credit} blankZero /></td></tr>
            ))}
          </tbody>
        </table>
      </Modal>
    </>
  );
}

export function History({ docType, id }: { docType: string; id: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  return (
    <>
      <button className="btn btn-sm" onClick={async () => { setOpen(true); setRows(await get(`/documents/${docType}/${id}/history`).catch(() => [])); }}>History</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Approval history">
        <table className="grid text-sm">
          <thead><tr><th>When</th><th>Action</th><th>By</th><th>Comment</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{new Date(r.acted_at).toLocaleString()}</td><td>{r.action}{r.step_no ? ` (step ${r.step_no})` : ''}</td><td>{r.by}</td><td>{r.comment}</td></tr>)}</tbody>
        </table>
      </Modal>
    </>
  );
}

/** Workflow buttons for a posting document: submit / withdraw / delete / cancel-or-reverse request. */
export function PostingActions({ docType, doc, editHref, deletePath, perm, correctionLabel = 'Request cancellation', onChanged }: { docType: string; doc: any; editHref?: string; deletePath?: string; perm: string; correctionLabel?: string; onChanged?: () => void }) {
  const { can } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const [err, setErr] = useState<unknown>(null);
  const [corr, setCorr] = useState(false);
  const [cf, setCf] = useState({ date: today(), reason: '' });
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries();
      onChanged?.();
    } catch (e) {
      setErr(e);
    }
  };
  const draft = ['DRAFT', 'REJECTED'].includes(doc.status);
  return (
    <div className="space-y-2">
      <ErrorBanner error={err} />
      <div className="flex flex-wrap gap-2">
        {draft && can(`${perm}.create`) && editHref && <button className="btn btn-sm" onClick={() => router.push(editHref)}>Edit</button>}
        {draft && can(`${perm}.create`) && <button className="btn btn-sm btn-primary" onClick={() => run(() => post(`/documents/${docType}/${doc.id}/submit`, {}))}>Submit for approval</button>}
        {draft && can(`${perm}.create`) && deletePath && <button className="btn btn-sm btn-danger" onClick={() => confirmDelete(() => run(async () => { await del(deletePath); router.back(); }))}>Delete draft</button>}
        {doc.status === 'SUBMITTED' && can(`${perm}.create`) && <button className="btn btn-sm" onClick={() => run(() => post(`/documents/${docType}/${doc.id}/withdraw`, {}))}>Withdraw</button>}
        {doc.status === 'POSTED' && can('correction.create') && <button className="btn btn-sm btn-danger" onClick={() => setCorr(true)}>{correctionLabel}</button>}
        <JournalPreview docType={docType} id={doc.id} />
        {can('approval.view') && <History docType={docType} id={doc.id} />}
      </div>
      <Modal open={corr} onClose={() => setCorr(false)} title={correctionLabel}>
        <p className="text-sm mb-3">A reversing journal will be posted (dated below, in an open period) after a checker approves. The document number is kept and shown as {correctionLabel.includes('ancel') ? 'Cancelled' : 'Reversed'}.</p>
        <div className="space-y-3">
          <DateField label="Reversal date" value={cf.date} onChange={(v) => setCf({ ...cf, date: v })} />
          <Field label="Reason (required)"><textarea className="input" value={cf.reason} onChange={(e) => setCf({ ...cf, reason: e.target.value })} /></Field>
          <button className="btn btn-primary" onClick={() => run(async () => { await post('/corrections', { targetType: docType, targetId: doc.id, correctionDate: cf.date, reason: cf.reason }); setCorr(false); })}>Submit request</button>
        </div>
      </Modal>
    </div>
  );
}

function confirmDelete(fn: () => void) {
  // a non-blocking confirm: second click within 3s confirms (avoids browser dialogs)
  const w = window as unknown as { __lpDel?: number };
  if (w.__lpDel && Date.now() - w.__lpDel < 3000) {
    w.__lpDel = 0;
    fn();
  } else {
    w.__lpDel = Date.now();
    alertToast('Click "Delete draft" again to confirm');
  }
}
export function alertToast(msg: string) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.setAttribute('role', 'status');
  Object.assign(el.style, { position: 'fixed', bottom: '20px', right: '20px', background: 'var(--ink)', color: 'var(--panel)', padding: '10px 14px', borderRadius: '8px', zIndex: '100', fontSize: '13px' });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

export function PrintButtons({ type, id }: { type: string; id: string }) {
  return (
    <div className="flex gap-2">
      <a className="btn btn-sm" href={`/api/print/${type}/${id}?format=html`} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); openWithCompany(`/print/${type}/${id}?format=html`); }}>Print</a>
      <a className="btn btn-sm" href="#" onClick={(e) => { e.preventDefault(); openWithCompany(`/print/${type}/${id}?format=pdf`); }}>PDF</a>
    </div>
  );
}

/** Opens an API document in a new tab (fetch with company header → blob URL). */
export async function openWithCompany(path: string) {
  const { api } = await import('@/lib/api');
  const res = await api<Response>(path, { raw: true });
  if (!res.ok) {
    const p = await res.json().catch(() => ({ detail: res.statusText }));
    alertToast(p.detail ?? 'Could not open the document');
    return;
  }
  const blob = await res.blob();
  window.open(URL.createObjectURL(blob), '_blank', 'noopener');
}

export function Allocations({ rows }: { rows: any[] }) {
  if (!rows?.length) return null;
  return (
    <div className="panel p-3">
      <div className="font-semibold mb-2 text-sm">Allocations</div>
      <table className="grid text-sm">
        <thead><tr><th>Date</th><th>From</th><th>To</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}><td><DateText ad={a.allocated_on} short /></td><td>{a.source_type}</td><td>{a.target_type}</td><td className="num"><Money v={a.amount} /></td><td>{a.reversed_at ? 'Un-allocated' : 'Active'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
