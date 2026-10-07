/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => get<any[]>('/accounts'), staleTime: 60_000 });
}
export function useContacts(type?: string) {
  return useQuery({ queryKey: ['contacts', type ?? 'all'], queryFn: () => get<any[]>('/contacts' + (type ? `?type=${type}` : '')), staleTime: 30_000 });
}
export function useItems() {
  return useQuery({ queryKey: ['items'], queryFn: () => get<any[]>('/items'), staleTime: 30_000 });
}
export function useTaxCodes() {
  return useQuery({ queryKey: ['tax-codes'], queryFn: () => get<any[]>('/tax-codes'), staleTime: 60_000 });
}
export function useTds() {
  return useQuery({ queryKey: ['tds-codes'], queryFn: () => get<any[]>('/tds-codes'), staleTime: 60_000 });
}
export function useCostCentres() {
  return useQuery({ queryKey: ['cost-centres'], queryFn: () => get<any[]>('/cost-centres'), staleTime: 60_000 });
}

interface PickerProps {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export function AccountSelect({ value, onChange, placeholder = 'Account…', required, className, filter }: PickerProps & { filter?: (a: any) => boolean }) {
  const { data = [] } = useAccounts();
  const list = data.filter((a) => a.is_postable && a.is_active && (!filter || filter(a)));
  return (
    <select className={className ?? 'input'} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} required={required}>
      <option value="">{placeholder}</option>
      {['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].map((cls) => (
        <optgroup key={cls} label={cls}>
          {list
            .filter((a) => a.class === cls)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} · {a.name}
                {a.requires_contact ? ' (needs contact)' : ''}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export function CashAccountSelect(p: PickerProps) {
  return <AccountSelect {...p} placeholder={p.placeholder ?? 'Bank / cash account…'} filter={(a) => ['CASH', 'BANK', 'WALLET'].includes(a.subtype)} />;
}

export function ContactSelect({ value, onChange, type, placeholder = 'Contact…', required, className }: PickerProps & { type?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE' }) {
  const { data = [] } = useContacts(type);
  return (
    <select className={className ?? 'input'} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} required={required}>
      <option value="">{placeholder}</option>
      {data
        .filter((c) => c.is_active)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} {c.pan ? `· PAN ${c.pan}` : c.abn ? `· ABN ${c.abn}` : ''}
          </option>
        ))}
    </select>
  );
}

export function ItemSelect({ value, onChange, placeholder = 'Item…', className }: PickerProps) {
  const { data = [] } = useItems();
  return (
    <select className={className ?? 'input'} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {data
        .filter((i) => i.is_active)
        .map((i) => (
          <option key={i.id} value={i.id}>
            {i.sku} · {i.name}
          </option>
        ))}
    </select>
  );
}

export function TaxSelect({ value, onChange, className, placeholder = 'No tax' }: PickerProps) {
  const { data = [] } = useTaxCodes();
  return (
    <select className={className ?? 'input'} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{placeholder}</option>
      {data
        .filter((t) => t.is_active)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.code}
          </option>
        ))}
    </select>
  );
}

export function CostCentreSelect({ value, onChange, className }: PickerProps) {
  const { data = [] } = useCostCentres();
  if (!data.length) return null;
  return (
    <select className={className ?? 'input'} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Cost centre…</option>
      {data.map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} · {c.name}
        </option>
      ))}
    </select>
  );
}
