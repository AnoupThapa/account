/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import type { ProblemDetails } from '@ledgerpro/shared';

export class ApiError extends Error {
  constructor(public problem: ProblemDetails) {
    super(problem.detail || problem.title);
  }
  get code() {
    return this.problem.code;
  }
  fieldError(name: string) {
    return this.problem.fields?.find((f) => f.field === name || f.field.endsWith('.' + name))?.message;
  }
}

let csrf: string | null = null;
let refreshing: Promise<boolean> | null = null;

export function getCompanyId(): string | null {
  try {
    return localStorage.getItem('lp.company');
  } catch {
    return null;
  }
}
export function setCompanyId(id: string | null) {
  try {
    if (id) localStorage.setItem('lp.company', id);
    else localStorage.removeItem('lp.company');
  } catch {
    /* private mode */
  }
}

async function ensureCsrf() {
  if (csrf) return csrf;
  const r = await fetch('/api/auth/csrf', { credentials: 'same-origin' });
  csrf = (await r.json()).csrfToken;
  return csrf!;
}

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': await ensureCsrf() } });
      return r.ok;
    })().finally(() => setTimeout(() => (refreshing = null), 0));
  }
  return refreshing;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  company?: boolean;
  raw?: boolean;
}

/** Fetch wrapper: CSRF header, selected company, silent token refresh, RFC 7807 errors. */
export async function api<T = any>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
  const doFetch = async () => {
    const headers: Record<string, string> = { 'X-CSRF-Token': await ensureCsrf() };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const cid = getCompanyId();
    if (opts.company !== false && cid) headers['X-Company-Id'] = cid;
    return fetch('/api' + path, { method, headers, credentials: 'same-origin', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  };
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    throw new ApiError({ type: '', title: 'Offline — changes not saved', status: 0, code: 'SYS_UNEXPECTED', detail: 'Network error: you appear to be offline. Nothing was saved.' });
  }
  if (res.status === 401 && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === 'AUTH_TOKEN_INVALID' || body?.code === 'AUTH_UNAUTHENTICATED') {
      if (await tryRefresh()) res = await doFetch();
    }
  }
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if (body?.code === 'AUTH_CSRF') {
      csrf = null;
      res = await doFetch();
    }
  }
  if (opts.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    const p: ProblemDetails = data && typeof data === 'object' && 'code' in data ? data : { type: '', title: 'Something went wrong', status: res.status, code: 'SYS_UNEXPECTED', detail: String(data ?? res.statusText) };
    if (p.code === 'AUTH_TOKEN_INVALID' || p.code === 'AUTH_UNAUTHENTICATED') {
      if (typeof window !== 'undefined' && !location.pathname.startsWith('/login')) location.href = '/login?next=' + encodeURIComponent(location.pathname);
    }
    if (p.code === 'AUTH_2FA_SETUP_REQUIRED' && typeof window !== 'undefined' && location.pathname !== '/security') location.href = '/security?setup=1';
    throw new ApiError(p);
  }
  return data as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const patch = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? '?' + s : '';
}
