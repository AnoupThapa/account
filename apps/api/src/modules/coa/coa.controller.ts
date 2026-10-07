/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';

const CLASS_RANGES: Record<string, [number, number][]> = {
  ASSET: [[1000, 1999], [9000, 9999]],
  LIABILITY: [[2000, 2999], [9000, 9999]],
  EQUITY: [[3000, 3999]],
  INCOME: [[4000, 4999]],
  EXPENSE: [[5000, 5999], [9000, 9999]],
};

const accountSchema = z.object({
  code: z.string().regex(/^[0-9A-Za-z.-]{2,20}$/, 'Use 2–20 letters/digits'),
  name: z.string().min(2).max(150),
  class: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
  parentId: z.string().uuid().nullish(),
  isPostable: z.boolean().default(true),
  subtype: z.string().max(30).nullish(),
  cashFlowCategory: z.enum(['OPERATING', 'INVESTING', 'FINANCING', 'CASH']).nullish(),
  requiresContact: z.boolean().default(false),
  description: z.string().max(1000).nullish(),
});
const accountUpdate = z.object({
  name: z.string().min(2).max(150).optional(),
  parentId: z.string().uuid().nullish(),
  subtype: z.string().max(30).nullish(),
  cashFlowCategory: z.enum(['OPERATING', 'INVESTING', 'FINANCING', 'CASH']).nullish(),
  description: z.string().max(1000).nullish(),
  isActive: z.boolean().optional(),
  version: z.number().int(),
});
const ccSchema = z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(150), parentId: z.string().uuid().nullish(), isActive: z.boolean().optional() });

@Controller()
export class CoaController {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  @Perm('coa.view')
  @Get('accounts')
  list(@Ctx() ctx: CompanyContext, @Query('postable') postable?: string, @Query('subtype') subtype?: string) {
    return this.tx(ctx, (trx) =>
      trx
        .selectFrom('accounts')
        .selectAll()
        .$if(postable === 'true', (q) => q.where('is_postable', '=', true).where('is_active', '=', true))
        .$if(!!subtype, (q) => q.where('subtype', 'in', subtype!.split(',')))
        .orderBy('code')
        .execute(),
    );
  }

  @Perm('coa.manage')
  @Post('accounts')
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(accountSchema)) b: z.infer<typeof accountSchema>) {
    return this.tx(ctx, async (trx) => {
      const n = Number(b.code.replace(/\D.*$/, ''));
      if (Number.isFinite(n) && !CLASS_RANGES[b.class].some(([lo, hi]) => n >= lo && n <= hi)) {
        throw new AppError('VAL_FIELD', `Code ${b.code} is outside the ${b.class.toLowerCase()} range`, undefined, [{ field: 'code', message: 'Code does not match the account class range (docs/02 §3)' }]);
      }
      if (b.parentId) {
        const p = await trx.selectFrom('accounts').select(['class', 'is_postable']).where('id', '=', b.parentId).executeTakeFirst();
        if (!p) throw new AppError('VAL_FIELD', 'Parent account not found');
        if (p.is_postable) {
          const used = await trx.selectFrom('journal_lines').select('id').where('account_id', '=', b.parentId).limit(1).executeTakeFirst();
          if (used) throw new AppError('VAL_FIELD', 'The parent already has postings — choose a heading account as parent');
          await trx.updateTable('accounts').set({ is_postable: false }).where('id', '=', b.parentId).where('is_system', '=', false).execute();
        }
      }
      const row = await trx
        .insertInto('accounts')
        .values({
          company_id: ctx.companyId,
          code: b.code,
          name: b.name,
          class: b.class,
          parent_id: b.parentId ?? null,
          is_postable: b.isPostable,
          requires_contact: b.requiresContact,
          subtype: b.subtype ?? null,
          cash_flow_category: b.cashFlowCategory ?? null,
          description: b.description ?? null,
          created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'account', row.id, null, row);
      return row;
    });
  }

  @Perm('coa.manage')
  @Patch('accounts/:id')
  update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(accountUpdate)) b: z.infer<typeof accountUpdate>) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('accounts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      if (before.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
      if (b.isActive === false) {
        const bal = await trx
          .selectFrom('journal_lines')
          .select((eb) => eb.fn.sum<string>(eb('debit', '-', eb.ref('credit'))).as('bal'))
          .where('account_id', '=', id)
          .executeTakeFirst();
        if (bal?.bal && Number(bal.bal) !== 0) throw new AppError('VAL_FIELD', 'Account has a balance — move it before deactivating');
      }
      const after = await trx
        .updateTable('accounts')
        .set({
          name: b.name ?? before.name,
          parent_id: b.parentId === undefined ? before.parent_id : b.parentId,
          subtype: b.subtype === undefined ? before.subtype : b.subtype,
          cash_flow_category: b.cashFlowCategory === undefined ? before.cash_flow_category : b.cashFlowCategory,
          description: b.description === undefined ? before.description : b.description,
          is_active: b.isActive ?? before.is_active,
          updated_by: ctx.userId,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'account', id, before, after);
      return after;
    });
  }

  @Perm('coa.view')
  @Get('cost-centres')
  costCentres(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, (trx) => trx.selectFrom('cost_centres').selectAll().orderBy('code').execute());
  }

  @Perm('cost_centre.manage')
  @Post('cost-centres')
  createCc(@Ctx() ctx: CompanyContext, @Body(new Zod(ccSchema)) b: z.infer<typeof ccSchema>) {
    return this.tx(ctx, async (trx) => {
      const row = await trx
        .insertInto('cost_centres')
        .values({ company_id: ctx.companyId, code: b.code.toUpperCase(), name: b.name, parent_id: b.parentId ?? null, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'cost_centre', row.id, null, row);
      return row;
    });
  }

  @Perm('cost_centre.manage')
  @Patch('cost-centres/:id')
  updateCc(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(ccSchema.partial())) b: Partial<z.infer<typeof ccSchema>>) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('cost_centres').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      const after = await trx
        .updateTable('cost_centres')
        .set({ name: b.name ?? before.name, parent_id: b.parentId === undefined ? before.parent_id : b.parentId, is_active: b.isActive ?? before.is_active, updated_by: ctx.userId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'cost_centre', id, before, after);
      return after;
    });
  }
}
