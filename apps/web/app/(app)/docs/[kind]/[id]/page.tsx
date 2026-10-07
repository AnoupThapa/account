/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { DOCS, DocKey, dateFieldOf } from '@/lib/docs';
import { useSession } from '@/components/providers';
import { Allocations, PostingActions, PrintButtons } from '@/components/doc-actions';
import { DateField, DateText, Empty, ErrorBanner, Field, Loading, Modal, Money, PageHeader, Status, today } from '@/components/ui';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className="flex justify-between gap-4 text-sm py-0.5">
      <span className="muted">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

export default function ViewDoc({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = use(params);
  const def = DOCS[kind as DocKey];
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const [err, setErr] = useState<unknown>(null);
  const [advOpen, setAdvOpen] = useState(false);
  const [adv, setAdv] = useState({ date: today(), targetId: '', amount: '' });
  const q = useQuery({ queryKey: [kind, id], queryFn: () => get(`/${kind}/${id}`), enabled: !!def });
  const advTargets = useQuery({
    queryKey: ['adv-targets', q.data?.contact_id],
    queryFn: () => get<any[]>(`/${kind === 'receipts' ? 'sales-invoices' : 'bills'}?status=POSTED&unpaid=true&contactId=${q.data.contact_id}`),
    enabled: advOpen && !!q.data,
  });
  if (!def) return <Empty>Unknown page</Empty>;
  if (q.error) return <ErrorBanner error={q.error} />;
  if (!q.data) return <Loading />;
  const doc = q.data;
  const run = async (fn: () => Promise<any>) => {
    setErr(null);
    try {
      const r = await fn();
      await qc.invalidateQueries();
      return r;
    } catch (e) {
      setErr(e);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${def.singular} ${doc.doc_no ?? '(draft)'}`}
        subtitle={<>
          <Status s={doc.status} /> {doc.contact_name && <span className="ml-2">{doc.contact_name}</span>} · <DateText ad={dateFieldOf(doc)} />
        </>}
        actions={!def.money && def.printType ? <PrintButtons type={def.printType} id={doc.id} /> : undefined}
      />
      <ErrorBanner error={err} />
      {doc.status === 'CANCELLED' && <div className="panel p-3 text-sm" style={{ borderColor: 'var(--danger)' }}>Cancelled{doc.cancel_reason ? `: ${doc.cancel_reason}` : ''}. The number is kept for the audit trail.</div>}
      {doc.status === 'REJECTED' && <div className="panel p-3 text-sm" style={{ borderColor: 'var(--warn)' }}>Rejected by the checker — see History for the reason, edit and submit again.</div>}

      {def.posting && def.docType ? (
        <PostingActions docType={def.docType} doc={doc} perm={def.perm} editHref={`/docs/${kind}/${id}/edit`} deletePath={`/${kind}/${id}`} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {doc.status === 'DRAFT' && can(`${def.perm}.create`) && <Link className="btn btn-sm" href={`/docs/${kind}/${id}/edit`}>Edit</Link>}
          {(def.statusFlow?.[doc.status] ?? []).map((s) => (
            <button key={s} className={`btn btn-sm ${s === 'CANCELLED' ? 'btn-danger' : ''}`} onClick={() => run(() => post(`/${kind}/${id}/status`, { status: s }))}>Mark {s.toLowerCase()}</button>
          ))}
          {(def.convert ?? []).map((c) => (
            <button key={c.to} className="btn btn-sm btn-primary" onClick={async () => { const r = await run(() => post(`/${kind}/${id}/convert`, { to: c.to, supplierInvoiceNo: c.to === 'PURCHASE_BILL' ? prompt("Supplier's invoice number") ?? undefined : undefined })); if (r?.id) router.push(`/docs/${c.path}/${r.id}`); }}>{c.label}</button>
          ))}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="panel p-4 lg:col-span-1">
          {def.money ? (
            <>
              <Row k="Type" v={doc.kind} />
              <Row k="Amount" v={<Money v={doc.amount} />} />
              <Row k="Discount" v={Number(doc.discount_amount) ? <Money v={doc.discount_amount} /> : null} />
              <Row k="TDS" v={Number(doc.tds_amount) ? <Money v={doc.tds_amount} /> : null} />
              <Row k="Total credited" v={<Money v={doc.total} />} />
              <Row k="Unallocated" v={<Money v={doc.unallocated_amount} />} />
              <Row k="Reference" v={doc.reference} />
              <Row k="Cheque" v={doc.cheque_no} />
              <Row k="Narration" v={doc.narration} />
            </>
          ) : (
            <>
              <Row k="Due" v={doc.due_date && <DateText ad={doc.due_date} />} />
              <Row k="Supplier invoice" v={doc.supplier_invoice_no} />
              <Row k="PAN / VAT" v={doc.buyer_pan ?? doc.supplier_pan ?? doc.contact_pan} />
              <Row k="Reason" v={doc.reason} />
              <Row k="Cash sale" v={doc.cash_account_id ? 'Yes' : null} />
              <Row k="Prices include tax" v={doc.price_includes_tax ? 'Yes' : null} />
              <Row k="Sub-total" v={<Money v={doc.subtotal} />} />
              <Row k="Exempt" v={Number(doc.exempt_total) ? <Money v={doc.exempt_total} /> : null} />
              <Row k="Zero-rated" v={Number(doc.zero_rated_total) ? <Money v={doc.zero_rated_total} /> : null} />
              <Row k="Taxable" v={doc.taxable_total !== undefined ? <Money v={doc.taxable_total} /> : null} />
              <Row k="VAT / GST" v={<Money v={doc.tax_total} />} />
              <Row k="Non-claimable tax (in cost)" v={Number(doc.non_claimable_tax) ? <Money v={doc.non_claimable_tax} /> : null} />
              <Row k="Total" v={<b><Money v={doc.grand_total} /></b>} />
              <Row k="Amount due" v={doc.amount_due !== undefined ? <Money v={doc.amount_due} /> : null} />
              <Row k="Unallocated credit" v={doc.unallocated_amount !== undefined ? <Money v={doc.unallocated_amount} /> : null} />
              <Row k="Printed" v={doc.print_count ? `${doc.print_count}×` : null} />
              <Row k="Notes" v={doc.notes ?? doc.narration} />
            </>
          )}
          {doc.journal_entry_id && (
            <div className="mt-3"><Link className="underline text-sm" href={`/reports/entry/${doc.journal_entry_id}`}>View posted journal →</Link></div>
          )}
        </div>
        {!def.money && (
          <div className="panel lg:col-span-2 overflow-x-auto">
            <table className="grid text-sm">
              <thead><tr><th>#</th><th>Description</th><th>Account</th><th className="num">Qty</th><th className="num">Rate</th><th>Tax</th><th className="num">Net</th><th className="num">Tax amt</th></tr></thead>
              <tbody>
                {doc.lines.map((l: any) => (
                  <tr key={l.id}>
                    <td>{l.line_no}</td>
                    <td>{l.description}{l.sku && <div className="muted text-xs">{l.sku}</div>}</td>
                    <td className="text-xs">{l.account_code} {l.account_name}</td>
                    <td className="num">{Number(l.quantity)}</td>
                    <td className="num"><Money v={l.unit_price} /></td>
                    <td>{l.tax_code}{l.tax_type === 'EXEMPT' ? ' (exempt)' : ''}</td>
                    <td className="num"><Money v={l.net_amount} /></td>
                    <td className="num"><Money v={l.tax_amount} blankZero /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {def.money && doc.kind === 'ADVANCE' && doc.status === 'POSTED' && Number(doc.unallocated_amount) > 0 && (
        <div>
          <button className="btn btn-primary btn-sm" onClick={() => setAdvOpen(true)}>Apply advance to {kind === 'receipts' ? 'an invoice' : 'a bill'}</button>
          <Modal open={advOpen} onClose={() => setAdvOpen(false)} title="Apply advance">
            <div className="space-y-3">
              <DateField label="Date" value={adv.date} onChange={(v) => setAdv({ ...adv, date: v })} />
              <Field label={kind === 'receipts' ? 'Invoice' : 'Bill'}>
                <select className="input" value={adv.targetId} onChange={(e) => setAdv({ ...adv, targetId: e.target.value })}>
                  <option value="">Choose…</option>
                  {(advTargets.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.doc_no} · due {t.amount_due}</option>)}
                </select>
              </Field>
              <Field label={`Amount (available ${doc.unallocated_amount})`}><input className="input num" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} /></Field>
              <button className="btn btn-primary" onClick={() => run(async () => { const r = await post(`/advance-adjustments/${kind === 'receipts' ? 'customer' : 'supplier'}`, { date: adv.date, advanceId: doc.id, targetId: adv.targetId, amount: adv.amount }); await post(`/documents/ADVANCE_ADJUSTMENT/${r.id}/submit`, {}); setAdvOpen(false); })}>Submit for approval</button>
            </div>
          </Modal>
        </div>
      )}
      <Allocations rows={doc.allocations} />
    </div>
  );
}
