/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { api, getCompanyId, post, setCompanyId } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: (n, e: any) => n < 1 && !e?.problem, refetchOnWindowFocus: false, staleTime: 15_000 } },
      }),
  );
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

export interface Me {
  id: string;
  email: string;
  full_name: string;
  is_super_admin: boolean;
  mfa_enabled: boolean;
  must_change_password: boolean;
  companies: { id: string; name: string; country: string; base_currency: string; calendar_mode: string; go_live_status: string }[];
}
export interface Access {
  company: any;
  roles: { id: string; name: string; key: string | null }[];
  permissions: string[];
}

interface SessionValue {
  me: Me | undefined;
  access: Access | undefined;
  companyId: string | null;
  selectCompany: (id: string | null) => void;
  can: (p: string) => boolean;
  loading: boolean;
  error: any;
}
const SessionCtx = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [companyId, setCid] = useState<string | null>(null);
  useEffect(() => setCid(getCompanyId()), []);
  const me = useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me', { company: false }) });
  const validCompany = companyId && me.data?.companies.some((c) => c.id === companyId) ? companyId : null;
  const access = useQuery({ queryKey: ['access', validCompany], queryFn: () => api<Access>('/me/access'), enabled: !!validCompany && !!me.data && !me.data.must_change_password });

  // idle-timer: report real activity so the 30-minute idle timeout counts usage, not token age
  useEffect(() => {
    let active = false;
    const mark = () => (active = true);
    window.addEventListener('keydown', mark);
    window.addEventListener('pointerdown', mark);
    const t = setInterval(() => {
      if (active) {
        active = false;
        post('/auth/activity', {}).catch(() => undefined);
      }
    }, 4 * 60_000);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', mark);
      window.removeEventListener('pointerdown', mark);
    };
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      me: me.data,
      access: access.data,
      companyId: validCompany,
      selectCompany: (id) => {
        setCompanyId(id);
        setCid(id);
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      },
      can: (p) => !!access.data?.permissions.includes(p),
      loading: me.isLoading || (!!validCompany && access.isLoading),
      error: me.error ?? access.error,
    }),
    [me.data, access.data, validCompany, me.isLoading, access.isLoading, me.error, access.error, qc],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const v = useContext(SessionCtx);
  if (!v) throw new Error('SessionProvider missing');
  return v;
}
