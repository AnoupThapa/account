'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { ContactSelect } from '@/components/pickers';
import { DateField, DateText, Empty, ErrorBanner, Field, Loading, Modal, PageHeader, Status, today } from '@/components/ui';

export default function GoodsReceipts() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['grn'], queryFn: () => get<any[]>('/goods-receipts') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ date: today(), contactId: null, purchaseOrderId: '', supplierRef: '' });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null);
  const pos = useQuery({ queryKey: ['po-open', f.contactId], queryFn: () => get<any[]>(`/purchase-orders?contactId=${f.contactId}`), enabled: !!f.contactId });
  const po = useQuery({ queryKey: ['po', f.purchaseOrderId], queryFn: () => get(`/purchase-orders/${f.purchaseOrderId}`), enabled: !!f.purchaseOrderId });
  return (
    <div>
      <PageHeader title="Goods receipts" subtitle="Record goods received against purchase orders. (Stock valuation and GRNI posting arrive with inventory in Phase 7.)" actions={can('goods_receipt.create') && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Receive goods</button>} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>No goods receipts.</Empty> : (
        <div className="panel"><table className="grid"><thead><tr><th>No.</th><th>Date</th><th>Supplier</th><th>Supplier ref</th><th>Status</th></tr></thead>
          <tbody>{q.data.map((g) => <tr key={g.id}><td className="font-mono text-xs">{g.doc_no}</td><td><DateText ad={g.receipt_date} short /></td><td>{g.contact_name}</td><td>{g.supplier_ref}</td><td><Status s={g.status} /></td></tr>)}</tbody></table></div>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Receive goods" wide>
        <ErrorBanner error={err} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Supplier"><ContactSelect type="SUPPLIER" value={f.contactId} onChange={(v) => setF({ ...f, contactId: v, purchaseOrderId: '' })} /></Field>
          <DateField label="Received on" value={f.date} onChange={(v) => setF({ ...f, date: v })} />
          <Field label="Purchase order"><select className="input" value={f.purchaseOrderId} onChange={(e) => setF({ ...f, purchaseOrderId: e.target.value })}><option value="">Choose…</option>{(pos.data ?? []).filter((p) => ['ISSUED', 'PARTIAL'].includes(p.status)).map((p) => <option key={p.id} value={p.id}>{p.doc_no}</option>)}</select></Field>
          <Field label="Supplier delivery note"><input className="input" value={f.supplierRef} onChange={(e) => setF({ ...f, supplierRef: e.target.value })} /></Field>
        </div>
        {po.data && (
          <table className="grid text-sm mt-3"><thead><tr><th>Item</th><th className="num">Ordered</th><th style={{ width: 120 }}>Received now</th></tr></thead>
            <tbody>{po.data.lines.filter((l: any) => l.item_id).map((l: any) => <tr key={l.id}><td>{l.description}</td><td className="num">{Number(l.quantity)}</td><td><input className="input num" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td></tr>)}</tbody></table>
        )}
        <button className="btn btn-primary mt-3" onClick={async () => {
          setErr(null);
          try {
            const lines = po.data.lines.filter((l: any) => l.item_id && Number(qty[l.id]) > 0).map((l: any) => ({ itemId: l.item_id, poLineId: l.id, quantity: qty[l.id] }));
            await post('/goods-receipts', { date: f.date, contactId: f.contactId, purchaseOrderId: f.purchaseOrderId, supplierRef: f.supplierRef || null, lines });
            setOpen(false);
            qc.invalidateQueries();
          } catch (e) { setErr(e); }
        }}>Save goods receipt</button>
      </Modal>
    </div>
  );
}
