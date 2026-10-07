'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { del, get, post } from '@/lib/api';
import { useSession } from '@/components/providers';
import { ErrorBanner, Field, Notice, PageHeader } from '@/components/ui';

export default function Security() {
  const { me } = useSession();
  const qc = useQueryClient();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [pwOk, setPwOk] = useState(false);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get('/auth/sessions') });

  return (
    <div className="max-w-3xl">
      <PageHeader title="Security" subtitle="Two-factor authentication, password and sessions" />
      <ErrorBanner error={err} />
      {me?.must_change_password && <Notice tone="warn">Your administrator set a temporary password. Please choose your own password to continue.</Notice>}

      <section className="panel p-4 mb-4">
        <h2 className="font-bold mb-2">Two-factor authentication (2FA)</h2>
        {me?.mfa_enabled && !codes ? (
          <p className="text-sm">✅ 2FA is on. You will be asked for a 6-digit code when you sign in.</p>
        ) : codes ? (
          <div>
            <Notice tone="ok">2FA is now on. Save these one-time recovery codes somewhere safe (each works once if you lose your phone):</Notice>
            <div className="grid grid-cols-2 gap-1 font-mono text-sm mb-3">{codes.map((c) => <div key={c}>{c}</div>)}</div>
            <a className="btn btn-primary" href="/">Continue</a>
          </div>
        ) : !setup ? (
          <div>
            <p className="text-sm mb-3">2FA is required for Admin, Checker and Finance Manager roles. Install Google Authenticator, Microsoft Authenticator or similar on your phone, then:</p>
            <button className="btn btn-primary" onClick={async () => { try { setSetup(await post('/auth/2fa/setup', {})); } catch (e) { setErr(e); } }}>Set up 2FA</button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6 items-start">
            <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={180} height={180} />
            <div className="space-y-2 text-sm">
              <p>1. Scan this QR code with your authenticator app (or type the key <code className="font-mono">{setup.secret}</code>).</p>
              <p>2. Enter the 6-digit code it shows:</p>
              <input className="input max-w-40 tracking-widest text-center" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
              <button className="btn btn-primary" onClick={async () => { try { const r = await post('/auth/2fa/enable', { code }); setCodes(r.recoveryCodes); qc.invalidateQueries({ queryKey: ['me'] }); } catch (e) { setErr(e); } }}>Turn on 2FA</button>
            </div>
          </div>
        )}
      </section>

      <section className="panel p-4 mb-4">
        <h2 className="font-bold mb-2">Change password</h2>
        {pwOk && <Notice tone="ok">Password changed. Other devices were signed out.</Notice>}
        <form
          className="grid sm:grid-cols-3 gap-3 items-end"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            if (pw.newPassword !== pw.repeat) return setErr({ problem: { title: 'New passwords do not match' } });
            try {
              await post('/auth/password/change', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
              setPwOk(true);
              setPw({ currentPassword: '', newPassword: '', repeat: '' });
              qc.invalidateQueries({ queryKey: ['me'] });
            } catch (e) {
              setErr(e);
            }
          }}
        >
          <Field label="Current password"><input className="input" type="password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required /></Field>
          <Field label="New password (min. 10)"><input className="input" type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required minLength={10} /></Field>
          <Field label="Repeat new password"><input className="input" type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} required /></Field>
          <div><button className="btn btn-primary">Change password</button></div>
        </form>
      </section>

      <section className="panel p-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="font-bold">Signed-in devices</h2>
          <button className="btn btn-sm" onClick={async () => { await post('/auth/sessions/revoke-others', {}); sessions.refetch(); }}>Sign out other devices</button>
        </div>
        <table className="grid text-sm">
          <thead><tr><th>Device</th><th>IP</th><th>Last active</th><th /></tr></thead>
          <tbody>
            {(sessions.data ?? []).map((s: any) => (
              <tr key={s.id}>
                <td className="max-w-80 truncate">{s.user_agent}{s.current && <b> (this device)</b>}</td>
                <td>{s.ip}</td>
                <td>{new Date(s.last_used_at).toLocaleString()}</td>
                <td>{!s.current && <button className="btn btn-sm" onClick={async () => { await del(`/auth/sessions/${s.id}`); sessions.refetch(); }}>Sign out</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
