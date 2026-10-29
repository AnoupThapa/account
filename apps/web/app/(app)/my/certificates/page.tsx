/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { openWithCompany } from '@/components/doc-actions';
import { DateText, Empty, ErrorBanner, Loading, Money, PageHeader } from '@/components/ui';

export default function MyCertificates() {
  const q = useQuery({ queryKey: ['me-certs'], queryFn: () => get<any[]>('/me/tds-certificates') });
  if (q.isLoading) return <Loading />;
  return (
    <div className="max-w-4xl">
      <PageHeader title="My TDS certificates" subtitle="Certificates of tax deducted at source on your remuneration, issued by your employer." />
      <ErrorBanner error={q.error} />
      {!q.data?.length ? <Empty>No certificates have been issued to you yet.</Empty> : (
        <div className="panel overflow-x-auto">
          <table className="grid text-sm">
            <thead><tr><th>No.</th><th>Period</th><th className="num">Remuneration</th><th className="num">TDS</th><th className="num">SSF (me)</th><th className="num">Total receivable</th><th /></tr></thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs">{c.cert_no}</td>
                  <td><DateText ad={c.period_from} /> – <DateText ad={c.period_to} /></td>
                  <td className="num"><Money v={c.total_remuneration} /></td><td className="num"><Money v={c.tds_deducted} /></td><td className="num"><Money v={c.ssf_employee} /></td><td className="num font-semibold"><Money v={c.total_receivable} /></td>
                  <td className="whitespace-nowrap"><button className="btn btn-sm" onClick={() => openWithCompany(`/me/tds-certificates/${c.id}/print?format=html`)}>Print</button> <button className="btn btn-sm" onClick={() => openWithCompany(`/me/tds-certificates/${c.id}/print?format=pdf`)}>PDF</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
