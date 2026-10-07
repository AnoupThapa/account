'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { useStepUp } from '@/components/step-up';
import { DateText, ErrorBanner, Loading, PageHeader, Status } from '@/components/ui';

export default function Fiscal() {
  const { can } = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fiscal-years'], queryFn: () => get<any[]>('/fiscal-years') });
  const [err, setErr] = useState<unknown>(null);
  const step = useStepUp();
  const act = async (fn: () => Promise<unknown>) => { setErr(null); try { await step.run(fn); qc.invalidateQueries({ queryKey: ['fiscal-years'] }); } catch (e) { setErr(e); } };
  if (!q.data) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader title="Fiscal years & periods" subtitle="Nepal: Shrawan 1 – Ashadh end (BS months). Australia: 1 July – 30 June. Locked periods reject all postings." actions={can('fiscal_year.manage') && <button className="btn btn-primary" onClick={() => act(() => post('/fiscal-years', {}))}>+ Create next fiscal year</button>} />
      <ErrorBanner error={err} />
      {q.data.map((fy) => (
        <div key={fy.id} className="panel overflow-x-auto">
          <div className="p-3 flex justify-between"><b>FY {fy.label}</b><span className="text-sm"><DateText ad={fy.start_date} /> → <DateText ad={fy.end_date} /> <Status s={fy.status} /></span></div>
          <table className="grid text-sm">
            <thead><tr><th>#</th><th>Period</th><th>From</th><th>To</th><th>Status</th><th /></tr></thead>
            <tbody>
              {fy.periods.map((p: any) => (
                <tr key={p.id}>
                  <td>{p.period_no}</td><td>{p.name}</td><td><DateText ad={p.start_date} short /></td><td><DateText ad={p.end_date} short /></td>
                  <td>{p.is_locked ? '🔒 Locked' : 'Open'}</td>
                  <td>{p.is_locked ? can('period.unlock') && <button className="btn btn-sm" onClick={() => act(() => post(`/periods/${p.id}/unlock`, {}))}>Unlock</button> : can('period.lock') && <button className="btn btn-sm" onClick={() => act(() => post(`/periods/${p.id}/lock`, {}))}>Lock</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {step.modal}
    </div>
  );
}
