'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { formatDual, todayAd } from '@ledgerpro/shared';
import { post } from '@/lib/api';
import { useSession } from './providers';

interface NavItem {
  href: string;
  label: string;
  perm?: string;
}
const NAV: { group: string; items: NavItem[] }[] = [
  { group: '', items: [{ href: '/', label: 'Home' }, { href: '/approvals', label: 'Approvals', perm: 'approval.view' }] },
  {
    group: 'Sales',
    items: [
      { href: '/docs/sales-invoices', label: 'Invoices', perm: 'sales_invoice.view' },
      { href: '/docs/receipts', label: 'Receipts & advances', perm: 'receipt.view' },
      { href: '/docs/credit-notes', label: 'Credit notes', perm: 'credit_note.view' },
      { href: '/docs/sales-quotes', label: 'Quotations', perm: 'sales_quote.view' },
      { href: '/docs/sales-orders', label: 'Sales orders', perm: 'sales_order.view' },
      { href: '/contacts?type=CUSTOMER', label: 'Customers', perm: 'contact.view' },
    ],
  },
  {
    group: 'Purchases',
    items: [
      { href: '/docs/bills', label: 'Bills', perm: 'bill.view' },
      { href: '/docs/payments', label: 'Payments & advances', perm: 'payment.view' },
      { href: '/docs/expenses', label: 'Expenses & claims', perm: 'expense.view' },
      { href: '/docs/debit-notes', label: 'Debit notes', perm: 'debit_note.view' },
      { href: '/docs/purchase-orders', label: 'Purchase orders', perm: 'purchase_order.view' },
      { href: '/goods-receipts', label: 'Goods receipts', perm: 'goods_receipt.view' },
      { href: '/contacts?type=SUPPLIER', label: 'Suppliers', perm: 'contact.view' },
    ],
  },
  {
    group: 'Accounting',
    items: [
      { href: '/journals', label: 'Journal vouchers', perm: 'journal.view' },
      { href: '/opening', label: 'Opening balances', perm: 'opening.view' },
      { href: '/accounts', label: 'Chart of accounts', perm: 'coa.view' },
      { href: '/items', label: 'Items', perm: 'item.view' },
      { href: '/corrections', label: 'Reversals & cancellations', perm: 'correction.view' },
    ],
  },
  {
    group: 'Reports',
    items: [
      { href: '/reports/trial-balance', label: 'Trial balance', perm: 'report.trial_balance.view' },
      { href: '/reports/general-ledger', label: 'General ledger', perm: 'report.general_ledger.view' },
      { href: '/reports/day-book', label: 'Day book / Journal', perm: 'report.day_book.view' },
      { href: '/reports/sales-book', label: 'Sales book', perm: 'report.sales_book.view' },
      { href: '/reports/purchase-book', label: 'Purchase book', perm: 'report.purchase_book.view' },
      { href: '/reports/aging', label: 'AR / AP aging', perm: 'report.ar_aging.view' },
      { href: '/reports/statement', label: 'Statements', perm: 'report.contact_statement.view' },
      { href: '/reports/tax', label: 'VAT / GST summary', perm: 'report.vat_summary.view' },
    ],
  },
  {
    group: 'Settings',
    items: [
      { href: '/settings/company', label: 'Company', perm: 'company.manage' },
      { href: '/settings/users', label: 'Users & roles', perm: 'user.view' },
      { href: '/settings/fiscal', label: 'Fiscal years & periods', perm: 'fiscal_year.manage' },
      { href: '/settings/tax', label: 'Tax & TDS codes', perm: 'tax.view' },
      { href: '/settings/workflows', label: 'Approval workflows', perm: 'workflow.manage' },
      { href: '/settings/audit', label: 'Audit log', perm: 'audit.view' },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  const { me, access, companyId, selectCompany, can } = useSession();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  const company = me?.companies.find((c) => c.id === companyId);

  return (
    <div className="min-h-screen flex">
      <aside className={`${open ? 'fixed inset-0 z-40' : 'hidden'} md:static md:block w-64 shrink-0 border-r overflow-y-auto`} style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
        <div className="p-4 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="font-black text-lg" style={{ color: 'var(--brand)' }}>
            LedgerPro
          </div>
          {me && me.companies.length > 0 && (
            <select className="input mt-2" value={companyId ?? ''} onChange={(e) => (e.target.value === '__new' ? router.push('/companies') : selectCompany(e.target.value || null))} aria-label="Company">
              <option value="">Select company…</option>
              {me.companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.country})
                </option>
              ))}
              {me.is_super_admin && <option value="__new">+ New company…</option>}
            </select>
          )}
          {access?.company?.self_approval_allowed && <div className="text-xs mt-2 font-semibold" style={{ color: 'var(--warn)' }}>⚠ Maker–checker disabled</div>}
        </div>
        {companyId && (
          <nav className="p-2 text-sm">
            {NAV.map((g) => {
              const items = g.items.filter((i) => !i.perm || can(i.perm));
              if (!items.length) return null;
              return (
                <div key={g.group} className="mb-2">
                  {g.group && <div className="px-2 pt-2 pb-1 text-xs font-bold uppercase muted">{g.group}</div>}
                  {items.map((i) => {
                    const active = i.href === '/' ? path === '/' : path.startsWith(i.href.split('?')[0]);
                    return (
                      <Link key={i.href} href={i.href} className="block px-2 py-1.5 rounded-md" style={active ? { background: 'var(--brand-soft)', color: 'var(--brand)', fontWeight: 600 } : undefined}>
                        {i.label}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        )}
      </aside>
      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between gap-2 px-4 py-2 border-b" style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}>
          <button className="btn btn-sm md:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            ☰
          </button>
          <div className="text-sm muted truncate">
            {company ? <b style={{ color: 'var(--ink)' }}>{company.name}</b> : 'No company selected'} · Today {formatDual(todayAd(), company?.calendar_mode === 'AD' ? 'AD' : 'BS')}
            {company?.go_live_status === 'SETUP' && <span className="badge ml-2">SETUP</span>}
          </div>
          <div className="flex items-center gap-2">
            <Link href="/security" className="text-sm">
              {me?.full_name}
            </Link>
            <button
              className="btn btn-sm"
              onClick={async () => {
                await post('/auth/logout', {}).catch(() => undefined);
                location.href = '/login';
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="p-4 md:p-6 max-w-[1400px]">{children}</main>
      </div>
    </div>
  );
}
