/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Injectable } from '@nestjs/common';
import { AppError, Country, fiscalYearContaining, FiscalYearDef, formatDual, validateFiscalYear, addDays } from '@ledgerpro/shared';
import type { Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';

export interface CompanyFySettings {
  country: string;
  calendar_mode: string;
  fy_start_month: number;
}

@Injectable()
export class FiscalService {
  constructor(private readonly audit: AuditService) {}

  defFor(company: CompanyFySettings, adDate: string, withAdjustment = true): FiscalYearDef {
    const def = fiscalYearContaining(
      adDate,
      { country: company.country as Country, calendarMode: company.calendar_mode as 'BS' | 'AD', fyStartMonth: company.fy_start_month },
      withAdjustment,
    );
    validateFiscalYear(def);
    return def;
  }

  /** Create the fiscal year containing `adDate` with its 12 (+1 adjustment) periods. Idempotent. */
  async ensureFiscalYear(trx: Tx, ctx: Pick<CompanyContext, 'companyId' | 'userId' | 'ip' | 'userAgent' | 'requestId'>, adDate: string) {
    const company = await trx.selectFrom('companies').select(['country', 'calendar_mode', 'fy_start_month']).where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    const def = this.defFor(company, adDate);
    const existing = await trx.selectFrom('fiscal_years').selectAll().where('company_id', '=', ctx.companyId).where('label', '=', def.label).executeTakeFirst();
    if (existing) return existing;
    const fy = await trx
      .insertInto('fiscal_years')
      .values({ company_id: ctx.companyId, label: def.label, start_date: def.startDate, end_date: def.endDate, created_by: ctx.userId || null })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('accounting_periods')
      .values(
        def.periods.map((p) => ({
          company_id: ctx.companyId,
          fiscal_year_id: fy.id,
          period_no: p.periodNo,
          name: p.name,
          start_date: p.startDate,
          end_date: p.endDate,
          is_adjustment: p.isAdjustment,
        })),
      )
      .execute();
    await this.audit.log(trx, ctx, 'CREATE', 'fiscal_year', fy.id, null, { label: def.label, start: def.startDate, end: def.endDate });
    return fy;
  }

  /** Create the next fiscal year after the latest one. */
  async createNext(trx: Tx, ctx: CompanyContext) {
    const last = await trx.selectFrom('fiscal_years').select('end_date').where('company_id', '=', ctx.companyId).orderBy('end_date', 'desc').executeTakeFirst();
    if (!last) throw new AppError('ACC_NO_FISCAL_YEAR');
    return this.ensureFiscalYear(trx, ctx, addDays(last.end_date, 1));
  }

  /** Regular (non-adjustment) open period for a posting date; errors match docs/error-handling.md. */
  async periodFor(trx: Tx, companyId: string, adDate: string, adjustment = false) {
    const p = await trx
      .selectFrom('accounting_periods')
      .innerJoin('fiscal_years', 'fiscal_years.id', 'accounting_periods.fiscal_year_id')
      .select([
        'accounting_periods.id',
        'accounting_periods.name',
        'accounting_periods.start_date',
        'accounting_periods.end_date',
        'accounting_periods.is_locked',
        'accounting_periods.fiscal_year_id',
        'fiscal_years.label as fy_label',
        'fiscal_years.status as fy_status',
      ])
      .where('accounting_periods.company_id', '=', companyId)
      .where('accounting_periods.start_date', '<=', adDate)
      .where('accounting_periods.end_date', '>=', adDate)
      .where('accounting_periods.is_adjustment', '=', adjustment)
      .executeTakeFirst();
    if (!p) throw new AppError('ACC_NO_FISCAL_YEAR', `No fiscal year covers ${formatDual(adDate)} — create the fiscal year first`, undefined, [{ field: 'date', message: 'No fiscal year for this date' }]);
    if (p.fy_status === 'CLOSED') throw new AppError('ACC_YEAR_CLOSED', `Fiscal year ${p.fy_label} is closed`);
    if (p.is_locked) {
      throw new AppError('ACC_PERIOD_LOCKED', `${p.name} (${formatDual(p.start_date, 'AD')} – ${formatDual(p.end_date, 'AD')}) is locked. Choose a date in an open period or ask an Admin to unlock it.`, undefined, [
        { field: 'date', message: 'Date falls in a locked period' },
      ]);
    }
    return p;
  }
}
