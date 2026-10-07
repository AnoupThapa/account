'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { SessionProvider, useSession } from '@/components/providers';
import { Shell } from '@/components/shell';
import { Loading } from '@/components/ui';

function Gate({ children }: { children: React.ReactNode }) {
  const { me, companyId, loading } = useSession();
  const path = usePathname();
  useEffect(() => {
    if (me?.must_change_password && path !== '/security') location.href = '/security';
  }, [me, path]);
  if (loading || !me) return <Loading />;
  const companyFree = ['/security', '/companies'].includes(path);
  if (!companyId && !companyFree) {
    return (
      <Shell>
        <div className="panel p-6 max-w-lg">
          <h1 className="font-bold text-lg mb-2">Choose a company</h1>
          {me.companies.length ? <p className="text-sm">Select a company from the menu on the left.</p> : <p className="text-sm">You are not a member of any company yet. {me.is_super_admin ? <a className="underline" href="/companies">Create the first company</a> : 'Ask your administrator to add you.'}</p>}
        </div>
      </Shell>
    );
  }
  return <Shell>{children}</Shell>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <Gate>{children}</Gate>
    </SessionProvider>
  );
}
