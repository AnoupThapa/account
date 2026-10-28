/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Injectable, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError, addDays, d, patchSchema, zAdDate, zRate, TAX_PACKS, TAX_PACK_BY_KEY, validatePack, TaxPack } from '@ledgerpro/shared';
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
const groupSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(80),
  components: z.array(z.object({ codeId: z.string().uuid(), stacked: z.boolean().default(false) })).min(2, 'A group needs at least two components').max(6),
});
const regimeSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  model: z.enum(['CREDIT_VAT', 'SALES_TAX', 'COMPOUND', 'NONE']).optional(),
  taxLabel: z.string().min(1).max(30).optional(),
  taxIdLabel: z.string().min(1).max(30).optional(),
  invoiceTitle: z.string().min(1).max(40).optional(),
  pricesIncludeTaxDefault: z.boolean().optional(),
  returnPeriod: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL', 'NONE']).optional(),
  nonTaxableCode: z.string().max(20).nullish(),
  defaultStandardCode: z.string().max(20).nullish(),
  taxRounding: z.enum(['LINE', 'DOCUMENT']).optional(),
  overrideReasonRequired: z.boolean().optional(),
});
const customRegimeSchema = regimeSchema.extend({ name: z.string().min(1).max(120), model: z.enum(['CREDIT_VAT', 'SALES_TAX', 'COMPOUND', 'NONE']) });
const tdsSchema = z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(120), rate: zRate, payableAccountId: z.string().uuid().optional(), receivableAccountId: z.string().uuid().nullish() });

export interface TaxComponentInfo {
  id: string;
  code: string;
  rate: string;
  stacked: boolean;
  isClaimable: boolean;
  outputAccountId: string | null;
  inputAccountId: string | null;
}
export interface TaxInfo {
  id: string;
  code: string;
  type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | 'REVERSE_CHARGE';
  rate: string; // for a group: the combined effective rate
  isClaimable: boolean; // for a group: true only if every component is claimable
  outputAccountId: string | null;
  inputAccountId: string | null;
  /** Group (compound) code: one entry per component, in charging order. null for a plain code. */
  components: TaxComponentInfo[] | null;
}

/** Effective-dated tax lookups (docs/02 §4: rates are data, not code). */
@Injectable()
export class TaxService {
  private async rateOn(trx: Tx, tc: { id: string; code: string }, date: string): Promise<string> {
    const r = await trx
      .selectFrom('tax_rates')
      .select('rate')
      .where('tax_code_id', '=', tc.id)
      .where('effective_from', '<=', date)
      .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>=', date)]))
      .executeTakeFirst();
    if (!r) throw new AppError('TAX_NO_RATE', `No ${tc.code} rate is set for ${date} — ask Admin`);
    return r.rate;
  }

  async taxOn(trx: Tx, taxCodeId: string, date: string): Promise<TaxInfo> {
    const tc = await trx.selectFrom('tax_codes').selectAll().where('id', '=', taxCodeId).executeTakeFirst();
    if (!tc || !tc.is_active) throw new AppError('VAL_FIELD', 'Unknown or inactive tax code');
    if (tc.is_group) {
      const parts = await trx
        .selectFrom('tax_code_components as g')
        .innerJoin('tax_codes as c', 'c.id', 'g.component_id')
        .select(['g.seq', 'g.stacked', 'c.id', 'c.code', 'c.is_claimable', 'c.is_active', 'c.output_account_id', 'c.input_account_id'])
        .where('g.group_id', '=', tc.id)
        .orderBy('g.seq')
        .execute();
      if (parts.length < 2) throw new AppError('VAL_FIELD', `Group tax code ${tc.code} has no components`);
      const components: TaxComponentInfo[] = [];
      let running = d(0);
      for (const p of parts) {
        if (!p.is_active) throw new AppError('VAL_FIELD', `Tax component ${p.code} of ${tc.code} is inactive`);
        const rate = await this.rateOn(trx, p, date);
        running = running.plus(d(1).plus(p.stacked ? running : 0).times(rate).div(100));
        components.push({ id: p.id, code: p.code, rate, stacked: p.stacked, isClaimable: p.is_claimable, outputAccountId: p.output_account_id, inputAccountId: p.input_account_id });
      }
      return { id: tc.id, code: tc.code, type: 'STANDARD', rate: running.times(100).toFixed(4), isClaimable: components.every((c) => c.isClaimable), outputAccountId: null, inputAccountId: null, components };
    }
    const rate = await this.rateOn(trx, tc, date);
    return {
      id: tc.id,
      code: tc.code,
      type: tc.type as TaxInfo['type'],
      rate,
      isClaimable: tc.is_claimable,
      outputAccountId: tc.output_account_id,
      inputAccountId: tc.input_account_id,
      components: null,
    };
  }

  /**
   * Load a tax pack into a company (docs/14 §3.2). Idempotent and non-destructive: existing codes (same code) are
   * left untouched, nothing is deleted, rates start at 14 Apr 1943 like the original seeds (admin adds dated changes).
   */
  async applyPack(trx: Tx, companyId: string, userId: string | null, pack: TaxPack, accounts?: { output?: string | null; input?: string | null }) {
    const problems = validatePack(pack);
    if (problems.length) throw new AppError('VAL_FIELD', `Tax pack ${pack.key} is invalid: ${problems.join('; ')}`);
    let outAcct = accounts?.output ?? null;
    let inAcct = accounts?.input ?? null;
    if (!outAcct || !inAcct) {
      const sys = await trx.selectFrom('accounts').select(['id', 'system_key']).where('system_key', 'in', ['OUTPUT_TAX', 'INPUT_TAX']).execute();
      outAcct = outAcct ?? sys.find((x) => x.system_key === 'OUTPUT_TAX')?.id ?? null;
      inAcct = inAcct ?? sys.find((x) => x.system_key === 'INPUT_TAX')?.id ?? null;
    }
    const fields = {
      name: pack.name, country: pack.country === 'OTHER' ? ((await trx.selectFrom('companies').select('country').where('id', '=', companyId).executeTakeFirstOrThrow()).country) : pack.country, model: pack.model, tax_label: pack.taxLabel, tax_id_label: pack.taxIdLabel, invoice_title: pack.invoiceTitle,
      prices_include_tax_default: pack.pricesIncludeTax, return_period: pack.returnPeriod, non_taxable_code: pack.nonTaxableCode,
      default_standard_code: pack.defaultStandardCode || null, source_pack: pack.key, pack_version: pack.version, pack_as_of: pack.asOf,
    };
    const existingRegime = await trx.selectFrom('tax_regimes').select('id').where('key', '=', pack.key).executeTakeFirst();
    const regimeId = existingRegime
      ? (await trx.updateTable('tax_regimes').set({ ...fields, updated_by: userId }).where('id', '=', existingRegime.id).returning('id').executeTakeFirstOrThrow()).id
      : (await trx.insertInto('tax_regimes').values({ company_id: companyId, key: pack.key, ...fields, created_by: userId }).returning('id').executeTakeFirstOrThrow()).id;
    await trx.updateTable('companies').set({ tax_regime_id: regimeId }).where('id', '=', companyId).execute();

    const created: string[] = [];
    const skipped: string[] = [];
    const idOf = new Map<string, string>();
    for (const c of pack.codes.filter((x) => !x.group)) {
      const have = await trx.selectFrom('tax_codes').select(['id', 'regime_id']).where('code', '=', c.code).executeTakeFirst();
      if (have) {
        idOf.set(c.code, have.id);
        skipped.push(c.code);
        if (!have.regime_id) await trx.updateTable('tax_codes').set({ regime_id: regimeId }).where('id', '=', have.id).execute();
        continue;
      }
      const row = await trx
        .insertInto('tax_codes')
        .values({ company_id: companyId, code: c.code, name: c.name, type: c.type, output_account_id: outAcct, input_account_id: inAcct, is_claimable: c.claimable, regime_id: regimeId, created_by: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('tax_rates').values({ company_id: companyId, tax_code_id: row.id, rate: c.rate, effective_from: '1943-04-14', created_by: userId }).execute();
      idOf.set(c.code, row.id);
      created.push(c.code);
    }
    for (const g of pack.codes.filter((x) => x.group)) {
      const have = await trx.selectFrom('tax_codes').select('id').where('code', '=', g.code).executeTakeFirst();
      if (have) {
        skipped.push(g.code);
        continue;
      }
      const parts = g.group!.map((x) => ({ ...x, id: idOf.get(x.code)! }));
      const claimable = parts.every((x) => pack.codes.find((c) => c.code === x.code)!.claimable);
      const row = await trx
        .insertInto('tax_codes')
        .values({ company_id: companyId, code: g.code, name: g.name, type: 'STANDARD', is_group: true, is_claimable: claimable, regime_id: regimeId, created_by: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('tax_code_components').values(parts.map((x, i) => ({ company_id: companyId, group_id: row.id, component_id: x.id, seq: i + 1, stacked: !!x.stacked }))).execute();
      created.push(g.code);
    }
    return { regimeId, created, skipped };
  }
}

@Controller()
export class TaxController {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService, private readonly taxService: TaxService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  @Perm('tax.view')
  @Get('tax-codes')
  list(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const codes = await trx.selectFrom('tax_codes').selectAll().orderBy('code').execute();
      const rates = await trx.selectFrom('tax_rates').selectAll().orderBy('effective_from', 'desc').execute();
      const comps = await trx.selectFrom('tax_code_components').selectAll().orderBy('seq').execute();
      return codes.map((c) => ({
        ...c,
        rates: rates.filter((r) => r.tax_code_id === c.id),
        components: c.is_group ? comps.filter((g) => g.group_id === c.id).map((g) => ({ code_id: g.component_id, code: codes.find((x) => x.id === g.component_id)?.code, stacked: g.stacked })) : [],
      }));
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
          regime_id: (await trx.selectFrom('companies').select('tax_regime_id').where('id', '=', ctx.companyId).executeTakeFirst())?.tax_regime_id ?? null,
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


  // ------------------------------------------------------------ tax system (docs/14)
  /** Available packs (starter data — admin must confirm rates). */
  @Perm('tax.view')
  @Get('tax/packs')
  packs() {
    return TAX_PACKS.map((p) => ({ key: p.key, name: p.name, country: p.country, model: p.model, taxLabel: p.taxLabel, taxIdLabel: p.taxIdLabel, version: p.version, asOf: p.asOf, notes: p.notes, codes: p.codes.map((c) => ({ code: c.code, name: c.name, type: c.type, rate: c.rate, claimable: c.claimable, group: c.group?.map((g) => g.code) ?? null })) }));
  }

  @Perm('tax.view')
  @Get('tax/regime')
  regime(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const co = await trx.selectFrom('companies').select(['tax_regime_id', 'tax_rounding', 'tax_override_reason_required', 'country']).where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
      const regime = co.tax_regime_id ? await trx.selectFrom('tax_regimes').selectAll().where('id', '=', co.tax_regime_id).executeTakeFirst() : undefined;
      const idOf = async (code: string | null | undefined) => (code ? (await trx.selectFrom('tax_codes').select('id').where('code', '=', code).executeTakeFirst())?.id ?? null : null);
      return {
        regime: regime ?? null,
        nonTaxableCodeId: await idOf(regime?.non_taxable_code),
        defaultStandardCodeId: await idOf(regime?.default_standard_code),
        policy: { taxRounding: co.tax_rounding, overrideReasonRequired: co.tax_override_reason_required },
        country: co.country,
      };
    });
  }

  /** Load a pack: adds its codes (never deletes or edits existing ones). Admin + step-up, audited. */
  @Perm('tax.manage')
  @StepUp()
  @Post('tax/regime/apply-pack')
  applyPack(@Ctx() ctx: CompanyContext, @Body(new Zod(z.object({ packKey: z.string().max(40) }))) b: { packKey: string }) {
    return this.tx(ctx, async (trx) => {
      const pack = TAX_PACK_BY_KEY[b.packKey];
      if (!pack) throw new AppError('VAL_FIELD', 'Unknown tax pack');
      const before = await trx.selectFrom('companies').select('tax_regime_id').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
      const res = await this.taxService.applyPack(trx, ctx.companyId, ctx.userId, pack);
      await this.audit.log(trx, ctx, 'UPDATE', 'tax_regime', res.regimeId, { previousRegimeId: before.tax_regime_id }, { pack: pack.key, version: pack.version, created: res.created, skipped: res.skipped });
      return res;
    });
  }

  /** "My country isn't listed": create/replace the company's custom regime (labels, model, defaults). */
  @Perm('tax.manage')
  @StepUp()
  @Post('tax/regime/custom')
  customRegime(@Ctx() ctx: CompanyContext, @Body(new Zod(customRegimeSchema)) b: z.infer<typeof customRegimeSchema>) {
    return this.tx(ctx, async (trx) => {
      const co = await trx.selectFrom('companies').select('country').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
      const fields = {
        name: b.name, country: co.country, model: b.model, tax_label: b.taxLabel ?? 'Tax', tax_id_label: b.taxIdLabel ?? 'Tax ID', invoice_title: b.invoiceTitle ?? 'Tax Invoice',
        prices_include_tax_default: b.pricesIncludeTaxDefault ?? false, return_period: b.returnPeriod ?? 'NONE', non_taxable_code: b.nonTaxableCode ?? null, default_standard_code: b.defaultStandardCode ?? null,
      };
      const have = await trx.selectFrom('tax_regimes').select('id').where('key', '=', 'CUSTOM').executeTakeFirst();
      const row = have
        ? await trx.updateTable('tax_regimes').set({ ...fields, updated_by: ctx.userId }).where('id', '=', have.id).returningAll().executeTakeFirstOrThrow()
        : await trx.insertInto('tax_regimes').values({ company_id: ctx.companyId, key: 'CUSTOM', ...fields, created_by: ctx.userId }).returningAll().executeTakeFirstOrThrow();
      await trx.updateTable('companies').set({ tax_regime_id: row.id }).where('id', '=', ctx.companyId).execute();
      await this.audit.log(trx, ctx, have ? 'UPDATE' : 'CREATE', 'tax_regime', row.id, null, row);
      return row;
    });
  }

  @Perm('tax.manage')
  @StepUp()
  @Patch('tax/regime')
  updateRegime(@Ctx() ctx: CompanyContext, @Body(new Zod(regimeSchema)) b: z.infer<typeof regimeSchema>) {
    return this.tx(ctx, async (trx) => {
      const co = await trx.selectFrom('companies').select(['tax_regime_id', 'tax_rounding', 'tax_override_reason_required']).where('id', '=', ctx.companyId).forUpdate().executeTakeFirstOrThrow();
      if (!co.tax_regime_id) throw new AppError('VAL_FIELD', 'Choose a tax system first');
      const before = await trx.selectFrom('tax_regimes').selectAll().where('id', '=', co.tax_regime_id).executeTakeFirstOrThrow();
      for (const [label, code] of [['Non-taxable code', b.nonTaxableCode], ['Default standard code', b.defaultStandardCode]] as const) {
        if (code && !(await trx.selectFrom('tax_codes').select('id').where('code', '=', code).where('is_active', '=', true).executeTakeFirst())) throw new AppError('VAL_FIELD', `${label} "${code}" does not exist`);
      }
      const after = await trx
        .updateTable('tax_regimes')
        .set({
          name: b.name ?? before.name, model: b.model ?? before.model, tax_label: b.taxLabel ?? before.tax_label, tax_id_label: b.taxIdLabel ?? before.tax_id_label,
          invoice_title: b.invoiceTitle ?? before.invoice_title, prices_include_tax_default: b.pricesIncludeTaxDefault ?? before.prices_include_tax_default,
          return_period: b.returnPeriod ?? before.return_period, non_taxable_code: b.nonTaxableCode === undefined ? before.non_taxable_code : b.nonTaxableCode,
          default_standard_code: b.defaultStandardCode === undefined ? before.default_standard_code : b.defaultStandardCode, updated_by: ctx.userId,
        })
        .where('id', '=', before.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.updateTable('companies').set({ tax_rounding: b.taxRounding ?? co.tax_rounding, tax_override_reason_required: b.overrideReasonRequired ?? co.tax_override_reason_required }).where('id', '=', ctx.companyId).execute();
      await this.audit.log(trx, ctx, 'UPDATE', 'tax_regime', before.id, { ...before, taxRounding: co.tax_rounding, overrideReasonRequired: co.tax_override_reason_required }, { ...after, taxRounding: b.taxRounding ?? co.tax_rounding, overrideReasonRequired: b.overrideReasonRequired ?? co.tax_override_reason_required });
      return after;
    });
  }

  /** Group (compound) tax code, e.g. CGST+SGST or GST+PST. Components must be plain codes. */
  @Perm('tax.manage')
  @StepUp()
  @Post('tax-codes/group')
  createGroup(@Ctx() ctx: CompanyContext, @Body(new Zod(groupSchema)) b: z.infer<typeof groupSchema>) {
    return this.tx(ctx, async (trx) => {
      const ids = b.components.map((c) => c.codeId);
      if (new Set(ids).size !== ids.length) throw new AppError('VAL_FIELD', 'A component can only be used once in a group');
      const parts = await trx.selectFrom('tax_codes').select(['id', 'code', 'type', 'is_group', 'is_active', 'is_claimable', 'regime_id']).where('id', 'in', ids).execute();
      if (parts.length !== ids.length) throw new AppError('VAL_FIELD', 'Unknown component tax code');
      if (parts.some((p) => p.is_group)) throw new AppError('VAL_FIELD', 'A group cannot contain another group');
      if (parts.some((p) => p.type !== 'STANDARD' || !p.is_active)) throw new AppError('VAL_FIELD', 'Components must be active STANDARD tax codes');
      const regime = (await trx.selectFrom('companies').select('tax_regime_id').where('id', '=', ctx.companyId).executeTakeFirst())?.tax_regime_id ?? null;
      const row = await trx
        .insertInto('tax_codes')
        .values({ company_id: ctx.companyId, code: b.code.toUpperCase(), name: b.name, type: 'STANDARD', is_group: true, is_claimable: parts.every((p) => p.is_claimable), regime_id: regime, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.insertInto('tax_code_components').values(b.components.map((c, i) => ({ company_id: ctx.companyId, group_id: row.id, component_id: c.codeId, seq: i + 1, stacked: i === 0 ? false : c.stacked }))).execute();
      await this.audit.log(trx, ctx, 'CREATE', 'tax_code', row.id, null, { ...row, components: b.components });
      return row;
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
  updateTds(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(patchSchema(tdsSchema).extend({ isActive: z.boolean().optional() }))) b: Partial<z.infer<typeof tdsSchema>> & { isActive?: boolean }) {
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
