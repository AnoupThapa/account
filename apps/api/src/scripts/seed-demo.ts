/**
 * DEMO DATA (local/staging only): an owner super-admin, a Nepal company and an Australian company,
 * demo users for each role, a few customers, suppliers and items. Safe to run twice.
 * Usage: pnpm --filter @ledgerpro/api seed:demo
 */
import 'reflect-metadata';
import { sql } from 'kysely';
import { todayAd } from '@ledgerpro/shared';
import { createApp } from '../bootstrap';
import { DatabaseService } from '../common/database.service';
import { ProvisioningService } from '../modules/companies/provisioning.service';
import { hashPassword } from '../modules/auth/auth.service';
import type { RequestContext } from '../common/context';

const PASSWORD = process.env.DEMO_PASSWORD || 'Demo-Ledger-2026!';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to load demo data in production');
  const app = await createApp();
  const dbs = app.get(DatabaseService);
  const prov = app.get(ProvisioningService);

  const upsertUser = async (email: string, name: string, superAdmin = false) => {
    const existing = await dbs.db.selectFrom('users').select('id').where(sql`lower(email)`, '=', email).executeTakeFirst();
    if (existing) return existing.id;
    const r = await dbs.db.insertInto('users').values({ email, full_name: name, password_hash: await hashPassword(PASSWORD), is_super_admin: superAdmin }).returning('id').executeTakeFirstOrThrow();
    return r.id;
  };
  const owner = await upsertUser('owner@ledgerpro.local', 'Owner (Super Admin)', true);
  const ctx: RequestContext = { requestId: 'seed', ip: null, userAgent: 'seed-demo', userId: owner, sessionId: '', isSuperAdmin: true, companyId: null, permissions: new Set(), roleIds: [], stepUpAt: null };

  const companies = [
    { name: 'Demo Nepal Pvt. Ltd.', country: 'NP' as const, businessType: 'MIXED' as const, pan: '601234567', address: 'Bhaktapur, Nepal', prefix: 'np' },
    { name: 'Demo Australia Pty Ltd', country: 'AU' as const, businessType: 'TRADING' as const, abn: '51824753556', address: 'Sydney NSW, Australia', prefix: 'au' },
  ];
  for (const c of companies) {
    const exists = await dbs.platform(owner, null, (trx) => trx.selectFrom('companies').select('id').where('name', '=', c.name).executeTakeFirst());
    let companyId = exists?.id;
    if (!companyId) {
      const co = await prov.createCompany(ctx, { ...c, firstFiscalYearDate: todayAd(c.country === 'NP' ? 'Asia/Kathmandu' : 'Australia/Sydney') });
      companyId = co.id;
    }
    const users = [
      [`accountant.${c.prefix}@ledgerpro.local`, `Accountant (${c.country})`, 'ACCOUNTANT'],
      [`checker.${c.prefix}@ledgerpro.local`, `Checker (${c.country})`, 'CHECKER'],
      [`finance.${c.prefix}@ledgerpro.local`, `Finance Manager (${c.country})`, 'FINANCE_MANAGER'],
      [`auditor.${c.prefix}@ledgerpro.local`, `Auditor (${c.country})`, 'AUDITOR'],
    ];
    await dbs.tenant(companyId, owner, async (trx) => {
      for (const [email, name, key] of users) {
        const uid = await upsertUser(email, name);
        await trx.insertInto('user_companies').values({ user_id: uid, company_id: companyId! }).onConflict((oc) => oc.columns(['user_id', 'company_id']).doNothing()).execute();
        const role = await trx.selectFrom('roles').select('id').where('key', '=', key).executeTakeFirstOrThrow();
        await trx.insertInto('user_roles').values({ company_id: companyId!, user_id: uid, role_id: role.id }).onConflict((oc) => oc.columns(['user_id', 'role_id']).doNothing()).execute();
      }
      const contacts = c.country === 'NP'
        ? [['CUSTOMER', 'C00001', 'Himalayan Hotels Pvt. Ltd.', '600111222', 30], ['CUSTOMER', 'C00002', 'Kathmandu Clinic', '600333444', 15], ['SUPPLIER', 'S00001', 'Nepal Hygiene Suppliers', '300555666', 30], ['EMPLOYEE', 'E00001', 'Sita Shrestha', null, 0]]
        : [['CUSTOMER', 'C00001', 'Harbour Cafe Pty Ltd', null, 14], ['SUPPLIER', 'S00001', 'Southern Cross Wholesale', null, 30], ['EMPLOYEE', 'E00001', 'Jack Smith', null, 0]];
      for (const [type, code, name, pan, terms] of contacts) {
        await trx.insertInto('contacts').values({ company_id: companyId!, type: type as string, code: code as string, name: name as string, pan: c.country === 'NP' ? (pan as string | null) : null, payment_terms_days: terms as number, created_by: owner }).onConflict((oc) => oc.columns(['company_id', 'code']).doNothing()).execute();
      }
      const std = await trx.selectFrom('tax_codes').select(['id', 'type']).where('code', 'in', c.country === 'NP' ? ['VAT13', 'EXEMPT'] : ['GST', 'FRE']).execute();
      const acct = async (key: string) => (await trx.selectFrom('accounts').select('id').where('system_key', '=', key).executeTakeFirst())?.id ?? null;
      const items: [string, string, string, string, string][] = c.country === 'NP'
        ? [['GLV-100', 'Nitrile gloves, box of 100', 'TAXABLE', '950', '700'], ['MSK-50', 'Surgical masks, box of 50', 'TAXABLE', '450', '300'], ['RICE-25', 'Rice 25 kg (exempt)', 'EXEMPT', '2500', '2100']]
        : [['CLN-5L', 'Floor cleaner 5 L', 'TAXABLE', '24.95', '14.00'], ['MILK-2L', 'Milk 2 L (GST-free)', 'ZERO_RATED', '3.80', '2.60']];
      for (const [sku, name, appl, sp, pp] of items) {
        const tc = std.find((t) => (appl === 'TAXABLE' ? t.type === 'STANDARD' : t.type !== 'STANDARD'));
        await trx
          .insertInto('items')
          .values({ company_id: companyId!, sku, name, type: 'NON_INVENTORY', tax_applicability: appl, default_tax_code_id: tc?.id ?? null, sales_price: sp, purchase_price: pp, sales_account_id: await acct('SALES_GOODS'), purchase_account_id: await acct('GENERAL_EXPENSE'), created_by: owner })
          .onConflict((oc) => oc.columns(['company_id', 'sku']).doNothing())
          .execute();
      }
    });
  }
  await app.close();
  console.log('\nDemo data ready. Sign in at http://localhost:3000 with any of:');
  console.log('  owner@ledgerpro.local (Super Admin + Company Admin of both demo companies)');
  console.log('  accountant.np@ / checker.np@ / finance.np@ / auditor.np@ledgerpro.local');
  console.log('  accountant.au@ / checker.au@ / finance.au@ / auditor.au@ledgerpro.local');
  console.log(`  Password for all demo users: ${PASSWORD}`);
  console.log('  (Admin/Checker/Finance roles must set up 2FA on first sign-in unless ENFORCE_2FA=false on this laptop.)\n');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
