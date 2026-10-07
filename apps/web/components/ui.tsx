/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { ReactNode, useEffect, useState } from 'react';
import { formatDual, formatMoney, toBS, formatBs, parseBs, toAD, todayAd } from '@ledgerpro/shared';
import { ApiError } from '@/lib/api';
import { useSession } from './providers';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div>
        <h1 className="text-xl font-bold">{title}</h1>
        {subtitle && <div className="muted text-sm mt-0.5">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const p = e?.problem;
  return (
    <div role="alert" className="panel p-3 mb-3" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
      <div className="font-semibold">{p?.title ?? 'Something went wrong'}</div>
      {p?.detail && p.detail !== p.title && <div className="text-sm">{p.detail}</div>}
      {p?.fields?.length ? (
        <ul className="text-sm list-disc ml-5">
          {p.fields.map((f) => (
            <li key={f.field}>
              {f.field}: {f.message}
            </li>
          ))}
        </ul>
      ) : null}
      {p && p.status >= 500 && p.requestId && <div className="text-xs mt-1">Reference: {p.requestId}</div>}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'ok' | 'warn' }) {
  const color = tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--brand)';
  return (
    <div className="panel p-3 mb-3 text-sm" style={{ borderColor: color }}>
      {children}
    </div>
  );
}

export function Status({ s }: { s: string }) {
  return <span className={`badge badge-${s}`}>{s.replace('_', ' ')}</span>;
}

export function useCurrency() {
  const { access } = useSession();
  return access?.company?.base_currency ?? 'NPR';
}
export function usePrimaryCalendar(): 'BS' | 'AD' {
  const { access } = useSession();
  return access?.company?.calendar_mode === 'AD' ? 'AD' : 'BS';
}

export function Money({ v, cur, blankZero }: { v: string | number | null | undefined; cur?: string; blankZero?: boolean }) {
  const c = useCurrency();
  if (v === null || v === undefined || v === '') return <span />;
  if (blankZero && Number(v) === 0) return <span className="muted">–</span>;
  return <span className="num">{formatMoney(String(v), cur ?? c)}</span>;
}

/** Every date in both calendars (docs/03 §2). */
export function DateText({ ad, short }: { ad: string | null | undefined; short?: boolean }) {
  const primary = usePrimaryCalendar();
  if (!ad) return <span />;
  if (short) {
    let bs = '';
    try {
      bs = formatBs(toBS(ad));
    } catch {
      /* out of range */
    }
    return (
      <span title={formatDual(ad, primary)} className="whitespace-nowrap">
        {primary === 'BS' ? bs || ad : ad}
        <span className="muted text-xs block">{primary === 'BS' ? ad : bs}</span>
      </span>
    );
  }
  return <span className="whitespace-nowrap">{formatDual(ad, primary)}</span>;
}

/** Date input with BS/AD toggle; value is always AD (YYYY-MM-DD). */
export function DateField({ label, value, onChange, required, error }: { label?: string; value: string; onChange: (ad: string) => void; required?: boolean; error?: string }) {
  const primary = usePrimaryCalendar();
  const [mode, setMode] = useState<'BS' | 'AD'>(primary);
  const [bsText, setBsText] = useState('');
  const [bsErr, setBsErr] = useState<string | null>(null);
  useEffect(() => setMode(primary), [primary]);
  useEffect(() => {
    try {
      setBsText(value ? formatBs(toBS(value)) : '');
    } catch {
      setBsText('');
    }
  }, [value]);
  return (
    <div>
      {label && (
        <label className="label">
          {label}
          {required && ' *'}
          <button type="button" className="ml-2 text-xs underline" onClick={() => setMode(mode === 'BS' ? 'AD' : 'BS')}>
            {mode === 'BS' ? 'enter AD' : 'enter BS'}
          </button>
        </label>
      )}
      {mode === 'AD' ? (
        <input type="date" className="input" value={value} onChange={(e) => onChange(e.target.value)} required={required} />
      ) : (
        <input
          className="input"
          placeholder="YYYY-MM-DD (BS)"
          value={bsText}
          onChange={(e) => {
            setBsText(e.target.value);
            try {
              const b = parseBs(e.target.value);
              setBsErr(null);
              onChange(toAD(b.year, b.month, b.day));
            } catch (err: any) {
              setBsErr(e.target.value.length >= 8 ? err.message : null);
            }
          }}
          required={required}
        />
      )}
      <div className="muted text-xs mt-0.5">{value ? formatDual(value, mode) : ' '}</div>
      {(bsErr || error) && <div className="field-error">{bsErr ?? error}</div>}
    </div>
  );
}

export function Field({ label, children, error, hint }: { label: string; children: ReactNode; error?: string; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="muted text-xs mt-0.5">{hint}</div>}
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-auto" style={{ background: 'rgba(0,0,0,.35)' }} onClick={onClose}>
      <div className={`panel p-4 w-full ${wide ? 'max-w-4xl' : 'max-w-lg'} mt-10`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex justify-between items-center mb-3">
          <h2 className="font-bold text-lg">{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="muted text-center py-10">{children}</div>;
}

export function Loading() {
  return <div className="muted py-8 text-center">Loading…</div>;
}

export const today = () => todayAd();

/** Can the user do this? Hides controls; the API enforces it regardless. */
export function Can({ p, children }: { p: string; children: ReactNode }) {
  const { can } = useSession();
  return can(p) ? <>{children}</> : null;
}
