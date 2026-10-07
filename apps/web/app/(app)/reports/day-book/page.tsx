'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { get, qs } from '@/lib/api';
import { sourceHref } from '@/lib/docs';
import { ExportCsv, RangeBar, useRange } from '@/components/report-kit';
import { DateText, ErrorBanner, Loading, Money, PageHeader } from '@/components/ui';

export default function DayBook() {
  const [r, setR] = useRange();
  const path = `/reports/journal${qs({ from: r.from, to: r.to })}`;
  const q = useQuery({ queryKey: [path], queryFn: () => get(path), enabled: !!r.from });
  return (
    <div>
      <PageHeader title="Day book / Journal register" subtitle={q.data?.period.label} actions={<><ExportCsv path={`/reports/day-book${qs({ from: r.from, to: r.to })}`} /><ExportCsv path={path} /></>} />
      <RangeBar r={r} setR={setR} />
      <ErrorBanner error={q.error} />
      {!q.data ? <Loading /> : (
        <div className="space-y-3">
          {q.data.entries.map((e: any) => {
            const href = sourceHref(e.source_type, e.source_id);
            return (
              <div key={e.id} className="panel">
                <div className="px-3 py-2 flex flex-wrap justify-between gap-2 text-sm border-b" style={{ borderColor: 'var(--line)' }}>
                  <div><DateText ad={e.entry_date} /> · <Link className="underline font-mono" href={`/reports/entry/${e.id}`}>{e.entry_no}</Link> · {href ? <Link className="underline" href={href}>{e.source_no ?? e.source_type}</Link> : e.source_type} · {e.narration}</div>
                  <div className="muted">by {e.posted_by_name}{e.status === 'REVERSED' && <span className="badge badge-REVERSED ml-2">reversed</span>}</div>
                </div>
                <table className="grid text-sm"><tbody>{e.lines.map((l: any) => <tr key={l.line_no}><td style={{ width: '45%' }}>{l.code} · {l.name}{l.contact_name && <span className="muted"> — {l.contact_name}</span>}</td><td>{l.description}</td><td className="num"><Money v={l.debit} blankZero /></td><td className="num"><Money v={l.credit} blankZero /></td></tr>)}</tbody></table>
              </div>
            );
          })}
          <div className="text-right font-bold">Total <Money v={q.data.totalDebit} /></div>
        </div>
      )}
    </div>
  );
}
