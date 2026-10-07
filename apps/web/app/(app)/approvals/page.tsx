'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { JournalPreview } from '@/components/doc-actions';
import { Empty, ErrorBanner, Field, Loading, Modal, Money, PageHeader } from '@/components/ui';

const LINK: Record<string, string> = {
  SALES_INVOICE: '/docs/sales-invoices/', CREDIT_NOTE: '/docs/credit-notes/', PURCHASE_BILL: '/docs/bills/', DEBIT_NOTE: '/docs/debit-notes/',
  EXPENSE: '/docs/expenses/', RECEIPT: '/docs/receipts/', PAYMENT: '/docs/payments/', MANUAL_JOURNAL: '/journals/', OPENING_BALANCE: '/opening/',
};

export default function Approvals() {
  const qc = useQueryClient();
  const [mine, setMine] = useState(true);
  const q = useQuery({ queryKey: ['approvals', mine], queryFn: () => get<any[]>(`/approvals?mine=${mine}`) });
  const [err, setErr] = useState<unknown>(null);
  const [reject, setReject] = useState<any>(null);
  const [reason, setReason] = useState('');
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div>
      <PageHeader title="Approvals" subtitle="Maker–checker: you can't approve your own entries." actions={<label className="text-sm flex items-center gap-2"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only items I can approve</label>} />
      <ErrorBanner error={err} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>Nothing waiting for approval. 🎉</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid">
            <thead><tr><th>Document</th><th>Submitted by</th><th>When</th><th className="num">Amount</th><th>Step</th><th /></tr></thead>
            <tbody>
              {q.data.map((r) => (
                <tr key={r.id}>
                  <td>{LINK[r.doc_type] ? <Link className="underline" href={LINK[r.doc_type] + r.doc_id}>{r.doc_type.replace(/_/g, ' ')}</Link> : r.doc_type.replace(/_/g, ' ')}<div className="muted text-xs">{r.doc_ref}</div></td>
                  <td>{r.submitted_by_name}</td>
                  <td className="text-xs">{new Date(r.submitted_at).toLocaleString()}</td>
                  <td className="num"><Money v={r.amount} /></td>
                  <td className="text-xs">{r.current_step}/{r.total_steps} · {r.stepName}{!r.canApprove && r.reason && <div style={{ color: 'var(--warn)' }}>{r.reason}</div>}</td>
                  <td className="flex gap-1 flex-wrap justify-end">
                    <JournalPreview docType={r.doc_type} id={r.doc_id} />
                    {r.canApprove && <button className="btn btn-sm btn-primary" onClick={() => act(() => post(`/approvals/${r.id}/approve`, {}))}>Approve</button>}
                    {r.canApprove && <button className="btn btn-sm btn-danger" onClick={() => { setReject(r); setReason(''); }}>Reject</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!reject} onClose={() => setReject(null)} title="Reject">
        <Field label="Reason (sent to the maker)"><textarea className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <button className="btn btn-danger mt-3" onClick={() => act(async () => { await post(`/approvals/${reject.id}/reject`, { reason }); setReject(null); })}>Reject</button>
      </Modal>
    </div>
  );
}
