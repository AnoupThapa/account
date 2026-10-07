'use client';
import { useQuery } from '@tanstack/react-query';
import { ReactNode, useEffect, useState } from 'react';
import { get } from '@/lib/api';
import { alertToast } from './doc-actions';
import { DateField, today } from './ui';

/** Default range: start of the current fiscal year → today. */
export function useRange() {
  const fys = useQuery({ queryKey: ['fiscal-years'], queryFn: () => get<any[]>('/fiscal-years') });
  const [r, setR] = useState({ from: '', to: today() });
  useEffect(() => {
    if (!r.from && fys.data?.length) {
      const t = today();
      const cur = fys.data.find((f) => f.start_date <= t && f.end_date >= t) ?? fys.data[0];
      setR((x) => ({ ...x, from: cur.start_date }));
    }
  }, [fys.data, r.from]);
  return [r, setR] as const;
}

export function RangeBar({ r, setR, children }: { r: { from: string; to: string }; setR: (x: { from: string; to: string }) => void; children?: ReactNode }) {
  return (
    <div className="panel p-3 mb-4 flex flex-wrap gap-4 items-end">
      <div className="w-56"><DateField label="From" value={r.from} onChange={(v) => setR({ ...r, from: v })} /></div>
      <div className="w-56"><DateField label="To" value={r.to} onChange={(v) => setR({ ...r, to: v })} /></div>
      {children}
    </div>
  );
}

/** Watermarked CSV export (needs report.<name>.export; logged in the audit trail). */
export function ExportCsv({ path }: { path: string }) {
  return (
    <button
      className="btn btn-sm"
      onClick={async () => {
        const { api } = await import('@/lib/api');
        const res = await api<Response>(path + (path.includes('?') ? '&' : '?') + 'format=csv', { raw: true });
        if (!res.ok) {
          const p = await res.json().catch(() => ({}));
          return alertToast(p.detail ?? 'Export not allowed');
        }
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]) ?? 'export.csv';
        a.click();
      }}
    >
      Export CSV
    </button>
  );
}
