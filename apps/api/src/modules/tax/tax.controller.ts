import { Body, Controller, Get, Injectable, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError, addDays, zAdDate, zRate } from '@ledgerpro/shared';
import { Ctx, Perm, StepUp, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';

const taxCodeSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(80),
  type: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE']),
  rate: zRate,
  effectiveFrom: zAdDate,
  isClaimable: z.boolean().default(true),
  outputAccountId: z.string().uuid().nullish(),
  inputAccountId: z.string().uuid().nullish(),
});
const taxUpdate = z.object({ name: z.string().min(1).max(80).optional(), isClaimable: z.boolean().optional(), isActive: z.boolean().optional() });
const rateSchema = z.object({ rate: zRate, effectiveFrom: zAdDate });
const tdsSchema = z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(120), rate: zRate, payableAccountId: z.string().uuid().optional(), receivableAccountId: z.string().uuid().nullish() });

export interface TaxInfo {
  id: string;
  code: string;
  type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | 'REVERSE_CHARGE';
  rate: string;
  isClaimable: boolean;
  outputAccountId: string | null;
  inputAccountId: string | null;
}

/** Effective-dated tax lookups (docs/02 §4: rates are data, not code). */
@Injectable()
export class TaxService {
  async taxOn(trx: Tx, taxCodeId: string, date: string): Promise<TaxInfo> {
    const tc = await trx.selectFrom('tax_codes').selectAll().where('id', '=', taxCodeId).executeTakeFirst();
    if (!tc || !tc.is_active) throw new AppError('VAL_FIELD', 'Unknown or inactive tax code');
    const r = await trx
      .selectFrom('tax_rates')
      .select('rate')
      .where('tax_code_id', '=', taxCodeId)
      .where('effective_from', '<=', date)
      .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', date)]))
      .executeTakeFirst();
    if (!r) throw new AppError('TAX_NO_RATE', `No ${tc.code} rate is set for ${date} — ask Admin`);
    return {
      id: tc.id,
      code: tc.code,
      type: tc.type as TaxInfo['type'],
      rate: r.rate,
      isClaimable: tc.is_claimable,
      outputAccountId: tc.output_account_id,
      inputAccountId: tc.input_account_id,
    };
  }
}

@Controller()
export class TaxController {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  @Perm('tax.view')
  @Get('tax-codes')
  list(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const codes = await trx.selectFrom('tax_codes').selectAll().orderBy('code').execute();
      const rates = await trx.selectFrom('tax_rates').selectAll().orderBy('effective_from', 'desc').execute();
      return codes.map((c) => ({ ...c, rates: rates.filter((r) => r.tax_code_id === c.id) }));
    });
  }

  /** Admin only + step-up: tax settings are sensitive (security.md §2). */
  @Perm('tax.manage')
  @StepUp()
  @Post('tax-codes')
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(taxCodeSchema)) b: z.infer<typeof taxCodeSchema>) {
    return this.tx(ctx, async (trx) => {
      const sys = await trx.selectFrom('accounts').select(['id', 'system_key']).where('system_key', 'in', ['OUTPUT_TAX', 'INPUT_TAX']).execute();
      if (b.type !== 'STANDARD' && Number(b.rate) !== 0) throw new AppError('VAL_FIELD', 'Only STANDARD tax codes can have a non-zero rate');
      const tc = await trx
        .insertInto('tax_codes')
        .values({
          company_id: ctx.companyId,
          code: b.code.toUpperCase(),
          name: b.name,
          type: b.type,
          is_claimable: b.isClaimable,
          output_account_id: b.outputAccountId ?? sys.find((s) => s.system_key === 'OUTPUT_TAX')?.id ?? null,
          input_account_id: b.inputAccountId ?? sys.find((s) => s.system_key === 'INPUT_TAX')?.id ?? null,
          created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.insertInto('tax_rates').values({ company_id: ctx.companyId, tax_code_id: tc.id, rate: b.rate, effective_from: b.effectiveFrom, created_by: ctx.userId }).execute();
      await this.audit.log(trx, ctx, 'CREATE', 'tax_code', tc.id, null, { ...tc, rate: b.rate, effectiveFrom: b.effectiveFrom });
      return tc;
    });
  }

  @Perm('tax.manage')
  @StepUp()
  @Patch('tax-codes/:id')
  update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(taxUpdate)) b: z.infer<typeof taxUpdate>) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('tax_codes').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      const after = await trx
        .updateTable('tax_codes')
        .set({ name: b.name ?? before.name, is_claimable: b.isClaimable ?? before.is_claimable, is_active: b.isActive ?? before.is_active, updated_by: ctx.userId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'tax_code', id, before, after);
      return after;
    });
  }

  /** New rate from a date: the previous open-ended rate is closed the day before (no overlaps — DB-enforced). */
  @Perm('tax.manage')
  @StepUp()
  @Post('tax-codes/:id/rates')
  addRate(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(rateSchema)) b: z.infer<typeof rateSchema>) {
    return this.tx(ctx, async (trx) => {
      const tc = await trx.selectFrom('tax_codes').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!tc) throw new AppError('NOT_FOUND');
      if (tc.type !== 'STANDARD' && Number(b.rate) !== 0) throw new AppError('VAL_FIELD', 'Only STANDARD tax codes can have a non-zero rate');
      const open = await trx.selectFrom('tax_rates').selectAll().where('tax_code_id', '=', id).where('effective_to', 'is', null).executeTakeFirst();
      if (open) {
        if (open.effective_from >= b.effectiveFrom) throw new AppError('VAL_FIELD', 'New rate must start after the current rate started');
        await trx.updateTable('tax_rates').set({ effective_to: addDays(b.effectiveFrom, -1) }).where('id', '=', open.id).execute();
      }
      const r = await trx.insertInto('tax_rates').values({ company_id: ctx.companyId, tax_code_id: id, rate: b.rate, effective_from: b.effectiveFrom, created_by: ctx.userId }).returningAll().executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'tax_rate', r.id, open ?? null, r);
      return r;
    });
  }

  @Perm('tax.view')
  @Get('tds-codes')
  tds(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, (trx) => trx.selectFrom('tds_codes').selectAll().orderBy('code').execute());
  }

  @Perm('tds.manage')
  @Post('tds-codes')
  createTds(@Ctx() ctx: CompanyContext, @Body(new Zod(tdsSchema)) b: z.infer<typeof tdsSchema>) {
    return this.tx(ctx, async (trx) => {
      const sys = await trx.selectFrom('accounts').select(['id', 'system_key']).where('system_key', 'in', ['TDS_PAYABLE', 'TDS_RECEIVABLE']).execute();
      const payable = b.payableAccountId ?? sys.find((s) => s.system_key === 'TDS_PAYABLE')?.id;
      if (!payable) throw new AppError('VAL_FIELD', 'Choose the TDS payable account');
      const row = await trx
        .insertInto('tds_codes')
        .values({
          company_id: ctx.companyId,
          code: b.code.toUpperCase(),
          name: b.name,
          rate: b.rate,
          payable_account_id: payable,
          receivable_account_id: b.receivableAccountId ?? sys.find((s) => s.system_key === 'TDS_RECEIVABLE')?.id ?? null,
          created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'tds_code', row.id, null, row);
      return row;
    });
  }

  @Perm('tds.manage')
  @Patch('tds-codes/:id')
  updateTds(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(tdsSchema.partial().extend({ isActive: z.boolean().optional() }))) b: Partial<z.infer<typeof tdsSchema>> & { isActive?: boolean }) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('tds_codes').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      const after = await trx
        .updateTable('tds_codes')
        .set({ name: b.name ?? before.name, rate: b.rate ?? before.rate, is_active: b.isActive ?? before.is_active, updated_by: ctx.userId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'tds_code', id, before, after);
      return after;
    });
  }
}
