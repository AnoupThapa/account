/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { sql } from 'kysely';
import { AppError, patchSchema, zMoneyNonNeg, zQty } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';

const contactSchema = z.object({
  type: z.enum(['CUSTOMER', 'SUPPLIER', 'BOTH', 'EMPLOYEE']),
  code: z.string().min(1).max(30).optional(),
  name: z.string().min(1).max(200),
  pan: z.string().regex(/^\d{9}$/, 'Nepal PAN/VAT is 9 digits').nullish().or(z.literal('')),
  vatNo: z.string().max(20).nullish(),
  abn: z.string().regex(/^\d{11}$/, 'ABN is 11 digits').nullish().or(z.literal('')),
  taxId: z.string().max(30).nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  phone: z.string().max(40).nullish(),
  address: z.string().max(500).nullish(),
  creditLimit: zMoneyNonNeg.nullish(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  notes: z.string().max(2000).nullish(),
});

const itemSchema = z.object({
  sku: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  type: z.enum(['INVENTORY', 'NON_INVENTORY', 'SERVICE', 'RAW_MATERIAL', 'FINISHED_GOOD', 'FIXED_ASSET']),
  uomCode: z.string().max(10).default('PCS'),
  taxApplicability: z.enum(['TAXABLE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']),
  defaultTaxCodeId: z.string().uuid().nullish(),
  /** purchase side, when it differs from the sales side (omit/null = same as sales) */
  purchaseTaxApplicability: z.enum(['TAXABLE', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']).nullish(),
  purchaseDefaultTaxCodeId: z.string().uuid().nullish(),
  salesPrice: zQty.default('0'),
  purchasePrice: zQty.default('0'),
  salesAccountId: z.string().uuid().nullish(),
  purchaseAccountId: z.string().uuid().nullish(),
  hsCode: z.string().max(20).nullish(),
  barcode: z.string().max(60).nullish(),
  reorderLevel: zQty.nullish(),
});

@Controller()
export class ContactsController {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  // ---------------------------------------------------------------- contacts
  @Perm('contact.view')
  @Get('contacts')
  list(@Ctx() ctx: CompanyContext, @Query('type') type?: string, @Query('q') q?: string) {
    return this.tx(ctx, (trx) =>
      trx
        .selectFrom('contacts')
        .selectAll()
        .$if(type === 'CUSTOMER', (x) => x.where('type', 'in', ['CUSTOMER', 'BOTH']))
        .$if(type === 'SUPPLIER', (x) => x.where('type', 'in', ['SUPPLIER', 'BOTH']))
        .$if(type === 'EMPLOYEE', (x) => x.where('type', '=', 'EMPLOYEE'))
        .$if(!!q, (x) => x.where((eb) => eb.or([eb('name', 'ilike', `%${q}%`), eb('code', 'ilike', `%${q}%`), eb('pan', '=', q!)])))
        .orderBy('name')
        .limit(500)
        .execute(),
    );
  }

  @Perm('contact.view')
  @Get('contacts/:id')
  async get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, async (trx) => {
      const c = await trx.selectFrom('contacts').selectAll().where('id', '=', id).executeTakeFirst();
      if (!c) throw new AppError('NOT_FOUND');
      const bal = await trx
        .selectFrom('journal_lines')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select(['accounts.system_key', sql<string>`sum(debit - credit)`.as('balance')])
        .where('journal_lines.contact_id', '=', id)
        .where('accounts.system_key', 'in', ['AR_CONTROL', 'AP_CONTROL', 'CUSTOMER_ADVANCES', 'SUPPLIER_ADVANCES', 'STAFF_PAYABLES'])
        .groupBy('accounts.system_key')
        .execute();
      return { ...c, balances: Object.fromEntries(bal.map((b) => [b.system_key, b.balance])) };
    });
  }

  @Perm('contact.manage')
  @Post('contacts')
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(contactSchema)) b: z.infer<typeof contactSchema>) {
    return this.tx(ctx, async (trx) => {
      const code =
        b.code ??
        `${b.type === 'SUPPLIER' ? 'S' : b.type === 'EMPLOYEE' ? 'E' : 'C'}${String(
          Number((await trx.selectFrom('contacts').select(sql<string>`count(*)`.as('n')).executeTakeFirstOrThrow()).n) + 1,
        ).padStart(5, '0')}`;
      const row = await trx
        .insertInto('contacts')
        .values({
          company_id: ctx.companyId,
          type: b.type,
          code,
          name: b.name,
          pan: b.pan || null,
          vat_no: b.vatNo ?? null,
          abn: b.abn || null,
          tax_id: b.taxId || null,
          email: b.email || null,
          phone: b.phone ?? null,
          address: b.address ?? null,
          credit_limit: b.creditLimit ?? null,
          payment_terms_days: b.paymentTermsDays,
          notes: b.notes ?? null,
          created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'contact', row.id, null, row);
      return row;
    });
  }

  @Perm('contact.manage')
  @Patch('contacts/:id')
  update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(patchSchema(contactSchema).extend({ isActive: z.boolean().optional(), version: z.number().int() }))) b: Partial<z.infer<typeof contactSchema>> & { isActive?: boolean; version: number }) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('contacts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      if (before.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
      const keep = <T>(v: T | undefined, old: T) => (v === undefined ? old : v);
      const after = await trx
        .updateTable('contacts')
        .set({
          type: b.type ?? before.type,
          name: b.name ?? before.name,
          pan: b.pan === undefined ? before.pan : b.pan || null,
          vat_no: keep(b.vatNo, before.vat_no),
          abn: b.abn === undefined ? before.abn : b.abn || null,
          tax_id: b.taxId === undefined ? before.tax_id : b.taxId || null,
          email: b.email === undefined ? before.email : b.email || null,
          phone: keep(b.phone, before.phone),
          address: keep(b.address, before.address),
          credit_limit: keep(b.creditLimit, before.credit_limit),
          payment_terms_days: b.paymentTermsDays ?? before.payment_terms_days,
          notes: keep(b.notes, before.notes),
          is_active: b.isActive ?? before.is_active,
          updated_by: ctx.userId,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'contact', id, before, after);
      return after;
    });
  }

  // ------------------------------------------------------------------- items
  @Perm('item.view')
  @Get('items')
  items(@Ctx() ctx: CompanyContext, @Query('q') q?: string) {
    return this.tx(ctx, (trx) =>
      trx
        .selectFrom('items')
        .selectAll()
        .$if(!!q, (x) => x.where((eb) => eb.or([eb('name', 'ilike', `%${q}%`), eb('sku', 'ilike', `%${q}%`), eb('barcode', '=', q!)])))
        .orderBy('name')
        .limit(500)
        .execute(),
    );
  }

  @Perm('member')
  @Get('uoms')
  uoms(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, (trx) => trx.selectFrom('uoms').selectAll().orderBy('code').execute());
  }

  /** Pick / validate the tax code for an item side: TAXABLE → regime's default standard code; others → first matching code. */
  private async resolveItemTax(trx: Tx, applicability: 'TAXABLE' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | undefined, codeId: string | null | undefined, field: string): Promise<string | null> {
    if (!applicability) return codeId ?? null;
    const typeOf = { TAXABLE: 'STANDARD', ZERO_RATED: 'ZERO_RATED', EXEMPT: 'EXEMPT', OUT_OF_SCOPE: 'OUT_OF_SCOPE' } as const;
    if (!codeId) {
      const regime = await trx.selectFrom('companies').innerJoin('tax_regimes', 'tax_regimes.id', 'companies.tax_regime_id').select(['tax_regimes.default_standard_code', 'tax_regimes.non_taxable_code']).executeTakeFirst();
      const preferred = applicability === 'TAXABLE' ? regime?.default_standard_code : applicability === 'EXEMPT' || applicability === 'OUT_OF_SCOPE' ? regime?.non_taxable_code : null;
      let q = trx.selectFrom('tax_codes').select(['id', 'type']).where('type', '=', typeOf[applicability]).where('is_active', '=', true);
      if (applicability === 'TAXABLE') q = q.where('is_claimable', '=', true);
      const pref = preferred ? await q.where('code', '=', preferred).executeTakeFirst() : undefined;
      codeId = pref?.id ?? (await q.orderBy('is_group', 'desc').orderBy('code').executeTakeFirst())?.id ?? null;
    }
    if (codeId) {
      const tc = await trx.selectFrom('tax_codes').select('type').where('id', '=', codeId).executeTakeFirst();
      if (!tc || tc.type !== typeOf[applicability]) throw new AppError('VAL_FIELD', 'Tax code does not match the item tax applicability', undefined, [{ field, message: 'Mismatch with tax applicability' }]);
    }
    return codeId;
  }

  private async itemDefaults(trx: Tx, b: Partial<z.infer<typeof itemSchema>>) {
    const keys = ['SALES_GOODS', 'SALES_SERVICES', 'GENERAL_EXPENSE', 'INVENTORY', 'COGS'];
    const sys = await trx.selectFrom('accounts').select(['id', 'system_key']).where('system_key', 'in', keys).execute();
    const k = (key: string) => sys.find((s) => s.system_key === key)?.id ?? null;
    const isService = b.type === 'SERVICE';
    const stock = b.type === 'INVENTORY' || b.type === 'FINISHED_GOOD' || b.type === 'RAW_MATERIAL';
    b.defaultTaxCodeId = await this.resolveItemTax(trx, b.taxApplicability, b.defaultTaxCodeId, 'defaultTaxCodeId');
    if (b.purchaseTaxApplicability) b.purchaseDefaultTaxCodeId = await this.resolveItemTax(trx, b.purchaseTaxApplicability, b.purchaseDefaultTaxCodeId, 'purchaseDefaultTaxCodeId');
    else b.purchaseDefaultTaxCodeId = null;
    return {
      sales: b.salesAccountId ?? (isService ? k('SALES_SERVICES') : k('SALES_GOODS') ?? k('SALES_SERVICES')),
      purchase: b.purchaseAccountId ?? (stock ? k('INVENTORY') ?? k('GENERAL_EXPENSE') : k('GENERAL_EXPENSE')),
      inventory: stock ? k('INVENTORY') : null,
      cogs: stock ? k('COGS') : null,
      stock,
    };
  }

  @Perm('item.manage')
  @Post('items')
  createItem(@Ctx() ctx: CompanyContext, @Body(new Zod(itemSchema)) b: z.infer<typeof itemSchema>) {
    return this.tx(ctx, async (trx) => {
      const def = await this.itemDefaults(trx, b);
      const row = await trx
        .insertInto('items')
        .values({
          company_id: ctx.companyId,
          sku: b.sku,
          name: b.name,
          description: b.description ?? null,
          type: b.type,
          uom_code: b.uomCode,
          tax_applicability: b.taxApplicability,
          default_tax_code_id: b.defaultTaxCodeId ?? null,
          purchase_tax_applicability: b.purchaseTaxApplicability ?? null,
          purchase_default_tax_code_id: b.purchaseDefaultTaxCodeId ?? null,
          sales_price: b.salesPrice,
          purchase_price: b.purchasePrice,
          sales_account_id: def.sales,
          purchase_account_id: def.purchase,
          inventory_account_id: def.inventory,
          cogs_account_id: def.cogs,
          is_stock_tracked: def.stock,
          hs_code: b.hsCode ?? null,
          barcode: b.barcode ?? null,
          reorder_level: b.reorderLevel ?? null,
          created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'item', row.id, null, row);
      return row;
    });
  }

  @Perm('item.manage')
  @Patch('items/:id')
  updateItem(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(patchSchema(itemSchema).extend({ isActive: z.boolean().optional(), version: z.number().int() }))) b: Partial<z.infer<typeof itemSchema>> & { isActive?: boolean; version: number }) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('items').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      if (before.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
      const merged = { type: b.type ?? (before.type as any), taxApplicability: b.taxApplicability ?? (before.tax_applicability as any), defaultTaxCodeId: b.defaultTaxCodeId === undefined ? before.default_tax_code_id : b.defaultTaxCodeId, purchaseTaxApplicability: b.purchaseTaxApplicability === undefined ? (before.purchase_tax_applicability as any) : b.purchaseTaxApplicability, purchaseDefaultTaxCodeId: b.purchaseDefaultTaxCodeId === undefined ? before.purchase_default_tax_code_id : b.purchaseDefaultTaxCodeId, salesAccountId: b.salesAccountId ?? before.sales_account_id, purchaseAccountId: b.purchaseAccountId ?? before.purchase_account_id };
      await this.itemDefaults(trx, merged);
      const after = await trx
        .updateTable('items')
        .set({
          name: b.name ?? before.name,
          description: b.description === undefined ? before.description : b.description,
          uom_code: b.uomCode ?? before.uom_code,
          tax_applicability: merged.taxApplicability,
          default_tax_code_id: merged.defaultTaxCodeId,
          purchase_tax_applicability: merged.purchaseTaxApplicability ?? null,
          purchase_default_tax_code_id: merged.purchaseDefaultTaxCodeId ?? null,
          sales_price: b.salesPrice ?? before.sales_price,
          purchase_price: b.purchasePrice ?? before.purchase_price,
          sales_account_id: merged.salesAccountId,
          purchase_account_id: merged.purchaseAccountId,
          hs_code: b.hsCode === undefined ? before.hs_code : b.hsCode,
          barcode: b.barcode === undefined ? before.barcode : b.barcode,
          reorder_level: b.reorderLevel === undefined ? before.reorder_level : b.reorderLevel,
          is_active: b.isActive ?? before.is_active,
          updated_by: ctx.userId,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'item', id, before, after);
      return after;
    });
  }
}
