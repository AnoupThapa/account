'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { post } from '@/lib/api';
import { ErrorBanner } from '@/components/ui';

function LoginForm() {
  const sp = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = (r: { mustChangePassword?: boolean; mfaSetupRequired?: boolean }) => {
    const next = sp.get('next');
    location.href = r.mustChangePassword || r.mfaSetupRequired ? '/security' : next && next.startsWith('/') ? next : '/';
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (!mfaToken) {
        const r = await post('/auth/login', { email, password });
        if (r.mfaRequired) setMfaToken(r.mfaToken);
        else done(r);
      } else {
        done(await post('/auth/2fa/verify', { mfaToken, code }));
      }
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={submit} className="panel p-6 w-full max-w-sm space-y-4">
        <div>
          <div className="font-black text-2xl" style={{ color: 'var(--brand)' }}>LedgerPro</div>
          <div className="muted text-sm">Management accounting · Nepal & Australia</div>
        </div>
        <ErrorBanner error={err} />
        {!mfaToken ? (
          <>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="label" htmlFor="pw">Password</label>
              <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </>
        ) : (
          <div>
            <label className="label" htmlFor="code">6-digit code from your authenticator app (or a recovery code)</label>
            <input id="code" className="input text-center tracking-widest text-lg" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </div>
        )}
        <button className="btn btn-primary w-full justify-center" disabled={busy}>
          {busy ? 'Please wait…' : mfaToken ? 'Verify' : 'Sign in'}
        </button>
        <div className="text-sm text-center">
          <Link href="/forgot-password" className="underline">Forgot password?</Link>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
