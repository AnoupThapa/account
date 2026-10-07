'use client';
import { useState } from 'react';
import { ApiError, post } from '@/lib/api';
import { useSession } from './providers';
import { ErrorBanner, Field, Modal } from './ui';

/** Wraps a sensitive action: if the API answers AUTH_STEP_UP_REQUIRED, ask for password (+2FA) and retry. */
export function useStepUp() {
  const { me } = useSession();
  const [pending, setPending] = useState<null | { fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }>(null);
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'AUTH_STEP_UP_REQUIRED') {
        return new Promise<T>((resolve, reject) => setPending({ fn, resolve: resolve as (v: unknown) => void, reject }));
      }
      throw e;
    }
  };
  const modal = (
    <Modal open={!!pending} onClose={() => { pending?.reject(new Error('cancelled')); setPending(null); }} title="Confirm it's you">
      <p className="text-sm mb-3">This is a sensitive action. Re-enter your password{me?.mfa_enabled ? ' and a 2FA code' : ''}.</p>
      <ErrorBanner error={err} />
      <div className="space-y-3">
        <Field label="Password"><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {me?.mfa_enabled && <Field label="2FA code"><input className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" /></Field>}
        <button className="btn btn-primary" onClick={async () => {
          setErr(null);
          try {
            await post('/auth/step-up', { password: pw, code: code || undefined });
            const r = await pending!.fn();
            pending!.resolve(r);
            setPending(null);
            setPw(''); setCode('');
          } catch (e) { setErr(e); }
        }}>Confirm</button>
      </div>
    </Modal>
  );
  return { run, modal };
}
