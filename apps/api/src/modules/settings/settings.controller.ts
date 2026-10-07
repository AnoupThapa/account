import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError, setBsCalendar, BS_MONTH_DAYS } from '@ledgerpro/shared';
import { Ctx, NoCompany, Perm, StepUp, SuperAdminOnly, Zod } from '../../common/decorators';
import type { CompanyContext, RequestContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { FiscalService } from './fiscal.service';

const createFySchema = z.object({ containingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
const bsFixSchema = z.object({ days: z.number().int().min(29).max(32), verified: z.boolean().default(true) });

@Controller()
export class SettingsController {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService, private readonly fiscal: FiscalService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  @Perm('member')
  @Get('fiscal-years')
  fiscalYears(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const fys = await trx.selectFrom('fiscal_years').selectAll().orderBy('start_date', 'desc').execute();
      const periods = await trx.selectFrom('accounting_periods').selectAll().orderBy('period_no').execute();
      return fys.map((f) => ({ ...f, periods: periods.filter((p) => p.fiscal_year_id === f.id) }));
    });
  }

  /** Create the FY containing a date, or the next FY after the latest. */
  @Perm('fiscal_year.manage')
  @Post('fiscal-years')
  createFy(@Ctx() ctx: CompanyContext, @Body(new Zod(createFySchema)) b: z.infer<typeof createFySchema>) {
    return this.tx(ctx, (trx) => (b.containingDate ? this.fiscal.ensureFiscalYear(trx, ctx, b.containingDate) : this.fiscal.createNext(trx, ctx)));
  }

  @Perm('period.lock')
  @Post('periods/:id/lock')
  lock(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.setLock(ctx, id, true);
  }

  /** Unlocking is sensitive: separate permission + step-up auth (security.md §2). */
  @Perm('period.unlock')
  @StepUp()
  @Post('periods/:id/unlock')
  unlock(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.setLock(ctx, id, false);
  }

  private setLock(ctx: CompanyContext, id: string, lock: boolean) {
    return this.tx(ctx, async (trx) => {
      const p = await trx.selectFrom('accounting_periods').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!p) throw new AppError('NOT_FOUND');
      if (p.is_locked === lock) return p;
      const after = await trx
        .updateTable('accounting_periods')
        .set({ is_locked: lock, locked_by: lock ? ctx.userId : null, locked_at: lock ? new Date() : null })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, lock ? 'LOCK' : 'UNLOCK', 'accounting_period', id, { is_locked: p.is_locked }, { is_locked: lock, name: p.name });
      return after;
    });
  }

  @Perm('number_series.manage')
  @Get('number-series')
  series(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, (trx) =>
      trx.selectFrom('number_series').innerJoin('fiscal_years', 'fiscal_years.id', 'number_series.fiscal_year_id').select(['number_series.id', 'doc_type', 'prefix', 'next_no', 'padding', 'fiscal_years.label as fy_label']).orderBy('doc_type').execute(),
    );
  }

  // ------------------------------------------------------- BS calendar table
  @NoCompany()
  @Get('bs-calendar')
  bsCalendar() {
    return this.dbs.db.selectFrom('bs_calendar').selectAll().orderBy('bs_year').orderBy('bs_month').execute();
  }

  /** Platform admin corrects/verifies a BS month length against the official calendar (docs/03 §1). */
  @NoCompany()
  @SuperAdminOnly()
  @StepUp()
  @Patch('bs-calendar/:year/:month')
  fixBs(@Ctx() ctx: RequestContext, @Param('year') year: string, @Param('month') month: string, @Body(new Zod(bsFixSchema)) b: z.infer<typeof bsFixSchema>) {
    return this.dbs.platform(ctx.userId, null, async (trx) => {
      const y = Number(year);
      const m = Number(month);
      const before = await trx.selectFrom('bs_calendar').selectAll().where('bs_year', '=', y).where('bs_month', '=', m).executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      // Changing a month length shifts every later AD start date: recompute the following rows.
      await trx.updateTable('bs_calendar').set({ days: b.days, verified_by: b.verified ? ctx.userId : null, verified_at: b.verified ? new Date() : null, is_provisional: !b.verified }).where('bs_year', '=', y).where('bs_month', '=', m).execute();
      const rows = await trx.selectFrom('bs_calendar').selectAll().orderBy('bs_year').orderBy('bs_month').execute();
      const table: Record<number, number[]> = {};
      for (const r of rows) (table[r.bs_year] ??= [])[r.bs_month - 1] = r.days;
      setBsCalendar(table);
      let ad = rows[0].ad_start;
      for (const r of rows) {
        if (r.ad_start !== ad) await trx.updateTable('bs_calendar').set({ ad_start: ad }).where('bs_year', '=', r.bs_year).where('bs_month', '=', r.bs_month).execute();
        const next = new Date(Date.parse(ad + 'T00:00:00Z') + r.days * 86_400_000);
        ad = next.toISOString().slice(0, 10);
      }
      await this.audit.log(trx, { ...ctx, companyId: null }, 'UPDATE', 'bs_calendar', null, before, { year: y, month: m, days: b.days });
      return { ok: true };
    });
  }
}

/** Load admin-verified BS month lengths from the DB at startup (falls back to the built-in table). */
export async function loadBsCalendarFromDb(dbs: DatabaseService) {
  const rows = await dbs.db.selectFrom('bs_calendar').select(['bs_year', 'bs_month', 'days']).execute();
  if (rows.length !== Object.keys(BS_MONTH_DAYS).length * 12) return;
  const table: Record<number, number[]> = {};
  for (const r of rows) (table[r.bs_year] ??= [])[r.bs_month - 1] = r.days;
  setBsCalendar(table);
}
