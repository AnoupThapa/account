'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { AccountSelect, TaxSelect } from '@/components/pickers';
import { Empty, ErrorBanner, Field, Loading, Modal, Money, PageHeader } from '@/components/ui';

const blank = { sku: '', name: '', type: 'NON_INVENTORY', uomCode: 'PCS', taxApplicability: 'TAXABLE', defaultTaxCodeId: null, salesPrice: '0', purchasePrice: '0', salesAccountId: null, purchaseAccountId: null, hsCode: '', barcode: '' };

export default function Items() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['items'], queryFn: () => get<any[]>('/items') });
  const uoms = useQuery({ queryKey: ['uoms'], queryFn: () => get<any[]>('/uoms') });
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const save = async () => {
    setErr(null);
    try {
      const body = { ...edit, hsCode: edit.hsCode || null, barcode: edit.barcode || null };
      if (edit.id) await patch(`/items/${edit.id}`, { ...body, version: edit.version });
      else await post('/items', body);
      setEdit(null);
      qc.invalidateQueries({ queryKey: ['items'] });
    } catch (e) {
      setErr(e);
    }
  };
  return (
    <div>
      <PageHeader title="Items" subtitle="Products and services. Tax applicability is set here and used on every line." actions={can('item.manage') && <button className="btn btn-primary" onClick={() => setEdit({ ...blank })}>+ New item</button>} />
      {q.isLoading ? <Loading /> : !q.data?.length ? <Empty>No items yet.</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid">
            <thead><tr><th>SKU</th><th>Name</th><th>Type</th><th>Tax</th><th className="num">Sale price</th><th className="num">Cost</th><th /></tr></thead>
            <tbody>
              {q.data.map((i) => (
                <tr key={i.id}>
                  <td className="font-mono text-xs">{i.sku}</td><td>{i.name}</td><td className="text-xs">{i.type}</td><td className="text-xs">{i.tax_applicability}</td>
                  <td className="num"><Money v={i.sales_price} /></td><td className="num"><Money v={i.purchase_price} /></td>
                  <td>{can('item.manage') && <button className="btn btn-sm" onClick={() => setEdit({ ...i, uomCode: i.uom_code, taxApplicability: i.tax_applicability, defaultTaxCodeId: i.default_tax_code_id, salesPrice: i.sales_price, purchasePrice: i.purchase_price, salesAccountId: i.sales_account_id, purchaseAccountId: i.purchase_account_id, hsCode: i.hs_code ?? '', barcode: i.barcode ?? '' })}>Edit</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit item' : 'New item'} wide>
        {edit && (
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="sm:col-span-3"><ErrorBanner error={err} /></div>
            <Field label="SKU *"><input className="input" value={edit.sku} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></Field>
            <Field label="Name *"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Type"><select className="input" value={edit.type} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>{['NON_INVENTORY', 'SERVICE', 'INVENTORY', 'RAW_MATERIAL', 'FINISHED_GOOD', 'FIXED_ASSET'].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Tax applicability *" hint="Taxable, zero-rated, exempt or out of scope"><select className="input" value={edit.taxApplicability} onChange={(e) => setEdit({ ...edit, taxApplicability: e.target.value, defaultTaxCodeId: null })}>{['TAXABLE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE'].map((t) => <option key={t}>{t}</option>)}</select></Field>
            <Field label="Default tax code" hint="Blank = standard code for the applicability"><TaxSelect value={edit.defaultTaxCodeId} onChange={(v) => setEdit({ ...edit, defaultTaxCodeId: v })} placeholder="Automatic" /></Field>
            <Field label="Unit"><select className="input" value={edit.uomCode} onChange={(e) => setEdit({ ...edit, uomCode: e.target.value })}>{(uoms.data ?? []).map((u) => <option key={u.code} value={u.code}>{u.code} · {u.name}</option>)}</select></Field>
            <Field label="Sale price"><input className="input num" value={edit.salesPrice} onChange={(e) => setEdit({ ...edit, salesPrice: e.target.value })} /></Field>
            <Field label="Purchase price"><input className="input num" value={edit.purchasePrice} onChange={(e) => setEdit({ ...edit, purchasePrice: e.target.value })} /></Field>
            <Field label="HS code"><input className="input" value={edit.hsCode} onChange={(e) => setEdit({ ...edit, hsCode: e.target.value })} /></Field>
            <Field label="Sales account" hint="Blank = default"><AccountSelect value={edit.salesAccountId} onChange={(v) => setEdit({ ...edit, salesAccountId: v })} placeholder="Default" filter={(a) => a.class === 'INCOME'} /></Field>
            <Field label="Purchase account" hint="Blank = default"><AccountSelect value={edit.purchaseAccountId} onChange={(v) => setEdit({ ...edit, purchaseAccountId: v })} placeholder="Default" filter={(a) => ['EXPENSE', 'ASSET'].includes(a.class)} /></Field>
            <Field label="Barcode"><input className="input" value={edit.barcode} onChange={(e) => setEdit({ ...edit, barcode: e.target.value })} /></Field>
            <div className="sm:col-span-3"><button className="btn btn-primary" onClick={save}>Save</button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
