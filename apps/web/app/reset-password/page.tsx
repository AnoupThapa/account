/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { post } from '@/lib/api';
import { ErrorBanner } from '@/components/ui';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        className="panel p-6 w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) return setErr({ problem: { title: 'Passwords do not match' } });
          try {
            await post('/auth/password/reset', { token, newPassword: pw });
            setOk(true);
          } catch (e) {
            setErr(e);
          }
        }}
      >
        <h1 className="font-bold text-lg">Choose a new password</h1>
        <ErrorBanner error={err} />
        {ok ? (
          <p className="text-sm">
            Password changed. <a className="underline" href="/login">Sign in</a>
          </p>
        ) : (
          <>
            <input className="input" type="password" placeholder="New password (min. 10 characters)" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={10} />
            <input className="input" type="password" placeholder="Repeat new password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
            <button className="btn btn-primary w-full justify-center">Save password</button>
          </>
        )}
      </form>
    </div>
  );
}
export default function Reset() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
