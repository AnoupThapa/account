/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { post } from '@/lib/api';
import { ErrorBanner } from '@/components/ui';

export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        className="panel p-6 w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await post('/auth/password/forgot', { email });
            setSent(true);
          } catch (e) {
            setErr(e);
          }
        }}
      >
        <h1 className="font-bold text-lg">Reset your password</h1>
        <ErrorBanner error={err} />
        {sent ? (
          <p className="text-sm">If that email is registered, a reset link has been sent. It is valid for 1 hour.</p>
        ) : (
          <>
            <input className="input" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button className="btn btn-primary w-full justify-center">Send reset link</button>
          </>
        )}
        <Link href="/login" className="text-sm underline block text-center">Back to sign in</Link>
      </form>
    </div>
  );
}
