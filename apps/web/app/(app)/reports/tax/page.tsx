'use client';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { RangeBar, useRange } from '@/components/report-kit';
import { ErrorBanner, Loading, Money, PageHeader } from '@/components/ui';

export default function Tax() {
  const [r, setR] = useRange();
  const path = `/reports/tax-summary${qs({ from: r.from, to: r.to })}`;
  const q = useQuery({ queryKey: [path], queryFn: () => get(path), enabled: !!r.from });
  return (
    <div className="max-w-2xl">
      <PageHeader title="VAT / GST summary" subtitle={q.data ? `${q.data.period.label} · management view (not a tax return)` : undefined} />
      <RangeBar r={r} setR={setR} />
      <ErrorBanner error={q.error} />
      {!q.data ? <Loading /> : (
        <div className="panel p-4 space-y-3 text-sm">
          <div className="font-semibold">Output tax (on sales)</div>
          {q.data.output.map((x: any) => <div key={x.code} className="flex justify-between"><span>{x.code} {x.name}</span><Money v={x.amount} /></div>)}
          <div className="flex justify-between font-semibold"><span>Total output</span><Money v={q.data.outputTotal} /></div>
          <div className="font-semibold pt-2">Input tax (claimable, on purchases)</div>
          {q.data.input.map((x: any) => <div key={x.code} className="flex justify-between"><span>{x.code} {x.name}</span><Money v={x.amount} /></div>)}
          <div className="flex justify-between font-semibold"><span>Total input</span><Money v={q.data.inputTotal} /></div>
          <div className="flex justify-between text-lg font-bold border-t pt-2" style={{ borderColor: 'var(--line)' }}><span>{Number(q.data.netPayable) >= 0 ? 'Net payable' : 'Net refundable / carried forward'}</span><Money v={q.data.netPayable} /></div>
        </div>
      )}
    </div>
  );
}
