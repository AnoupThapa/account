/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { ExportCsv, RangeBar, useRange } from '@/components/report-kit';
import { DateText, ErrorBanner, Loading, Money, PageHeader } from '@/components/ui';

/** IRD-style Sales / Purchase book: date, number, party, PAN, total, exempt, zero-rated, taxable, VAT. */
export function Book({ kind }: { kind: 'sales' | 'purchase' }) {
  const [r, setR] = useRange();
  const path = `/reports/${kind}-book${qs({ from: r.from, to: r.to })}`;
  const q = useQuery({ queryKey: [path], queryFn: () => get(path), enabled: !!r.from });
  const party = kind === 'sales' ? 'Buyer' : 'Supplier';
  const Table = ({ rows, totals, title }: { rows: any[]; totals: any; title: string }) => (
    <div className="panel overflow-x-auto mb-4">
      <div className="px-3 py-2 font-semibold">{title}</div>
      <table className="grid text-sm">
        <thead><tr><th>Date (BS)</th><th>No.</th>{kind === 'purchase' && <th>Supplier inv.</th>}<th>{party}</th><th>{party} PAN</th><th className="num">Total</th><th className="num">Exempt</th><th className="num">Zero-rated</th><th className="num">Taxable</th><th className="num">VAT/GST</th></tr></thead>
        <tbody>
          {rows.map((x: any) => (
            <tr key={x.id} style={x.cancelled ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
              <td><DateText ad={x.date} short /></td><td className="font-mono text-xs">{x.doc_no}{x.cancelled && ' (cancelled)'}</td>
              {kind === 'purchase' && <td>{x.supplier_invoice_no}</td>}
              <td>{x.buyer_name ?? x.supplier_name}</td><td>{x.buyer_pan ?? x.supplier_pan}</td>
              <td className="num"><Money v={x.grand_total} /></td><td className="num"><Money v={x.exempt_total} blankZero /></td><td className="num"><Money v={x.zero_rated_total} blankZero /></td><td className="num"><Money v={x.taxable_total} blankZero /></td><td className="num"><Money v={x.tax_total} blankZero /></td>
            </tr>
          ))}
          <tr className="font-bold"><td colSpan={kind === 'purchase' ? 5 : 4}>Total (excluding cancelled)</td><td className="num"><Money v={totals.total} /></td><td className="num"><Money v={totals.exempt} /></td><td className="num"><Money v={totals.zeroRated} /></td><td className="num"><Money v={totals.taxable} /></td><td className="num"><Money v={totals.tax} /></td></tr>
        </tbody>
      </table>
    </div>
  );
  return (
    <div>
      <PageHeader title={kind === 'sales' ? 'Sales book' : 'Purchase book'} subtitle={q.data?.period.label} actions={<ExportCsv path={path} />} />
      <RangeBar r={r} setR={setR} />
      <ErrorBanner error={q.error} />
      {!q.data ? <Loading /> : (
        <>
          <Table rows={q.data.rows} totals={q.data.totals} title={kind === 'sales' ? 'Sales' : 'Purchases & expenses with tax'} />
          <Table rows={q.data.returns} totals={q.data.returnTotals} title={kind === 'sales' ? 'Sales returns (credit notes)' : 'Purchase returns (debit notes)'} />
        </>
      )}
    </div>
  );
}
