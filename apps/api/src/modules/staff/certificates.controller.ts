/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Injectable, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError, calcPay, d, money, sum, zAdDate, zMoneyNonNeg } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../settings/numbering.service';
import { certificateHtml } from './staff-print';
import { PayslipService } from './payslips.controller';

const issueSchema = z.object({
  employeeId: z.string().uuid(),
  periodFrom: zAdDate,
  periodTo: zAdDate,
  /** MANUAL: the admin types every amount. PAYSLIPS: amounts are summed from the staff member's sent payslips in the period. */
  source: z.enum(['MANUAL', 'PAYSLIPS']).default('MANUAL'),
  basicSalary: zMoneyNonNeg.default('0'),
  allowance: zMoneyNonNeg.default('0'),
  otherAllowance: zMoneyNonNeg.default('0'),
  tdsDeducted: zMoneyNonNeg.default('0'),
  ssfEmployee: zMoneyNonNeg.default('0'),
  ssfEmployer: zMoneyNonNeg.default('0'),
  otherDeductions: zMoneyNonNeg.default('0'),
  tdsDepositRef: z.string().max(100).nullish(),
  tdsDepositDate: zAdDate.nullish(),
  notes: z.string().max(1000).nullish(),
});
const suggestQuery = z.object({ employeeId: z.string().uuid(), from: zAdDate, to: zAdDate });
const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });

@Injectable()
export class CertificateService {
  constructor(private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  /** Totals of an employee's SENT payslips whose period lies inside [from, to]. */
  async fromPayslips(trx: Tx, employeeId: string, from: string, to: string) {
    const rows = await trx.selectFrom('payslips').selectAll().where('employee_id', '=', employeeId).where('status', '=', 'SENT').where('period_start', '>=', from).where('period_end', '<=', to).orderBy('period_start').execute();
    const t = (k: 'basic_salary' | 'allowance' | 'other_allowance' | 'tds_amount' | 'ssf_employee' | 'ssf_employer' | 'other_deductions') => money(sum(rows.map((r) => r[k])));
    return { payslips: rows.length, basicSalary: t('basic_salary'), allowance: t('allowance'), otherAllowance: t('other_allowance'), tdsDeducted: t('tds_amount'), ssfEmployee: t('ssf_employee'), ssfEmployer: t('ssf_employer'), otherDeductions: t('other_deductions') };
  }

  async issue(trx: Tx, ctx: CompanyContext, b: z.infer<typeof issueSchema>) {
    if (b.periodTo < b.periodFrom) throw new AppError('VAL_FIELD', 'The end date is before the start date', undefined, [{ field: 'periodTo', message: 'Before start' }]);
    const emp = await trx.selectFrom('employees').select(['id']).where('id', '=', b.employeeId).executeTakeFirst();
    if (!emp) throw new AppError('NOT_FOUND');
    let a = { basicSalary: b.basicSalary, allowance: b.allowance, otherAllowance: b.otherAllowance, tdsDeducted: b.tdsDeducted, ssfEmployee: b.ssfEmployee, ssfEmployer: b.ssfEmployer, otherDeductions: b.otherDeductions };
    if (b.source === 'PAYSLIPS') {
      const s = await this.fromPayslips(trx, emp.id, b.periodFrom, b.periodTo);
      if (!s.payslips) throw new AppError('VAL_FIELD', 'This staff member has no sent payslips inside that period — type the amounts manually instead');
      a = s;
    } else if (d(a.basicSalary).plus(a.allowance).plus(a.otherAllowance).lte(0)) {
      throw new AppError('VAL_FIELD', 'Enter the remuneration (basic salary, allowance …)', undefined, [{ field: 'basicSalary', message: 'Required' }]);
    }
    const r = calcPay({ basicSalary: a.basicSalary, allowance: a.allowance, otherAllowance: a.otherAllowance, tdsAmount: a.tdsDeducted, ssfEmployee: a.ssfEmployee, ssfEmployer: a.ssfEmployer, otherDeductions: a.otherDeductions });
    const fy = await trx.selectFrom('fiscal_years').select(['id', 'label']).where('start_date', '<=', b.periodTo).where('end_date', '>=', b.periodTo).executeTakeFirst();
    const certNo = await this.numbering.next(trx, ctx.companyId, 'TDS_CERTIFICATE', b.periodTo);
    const row = await trx
      .insertInto('tds_certificates')
      .values({
        company_id: ctx.companyId, employee_id: emp.id, cert_no: certNo, fiscal_year_id: fy?.id ?? null, period_from: b.periodFrom, period_to: b.periodTo,
        basic_salary: a.basicSalary, allowance: a.allowance, other_allowance: a.otherAllowance, total_remuneration: r.grossPay, tds_deducted: a.tdsDeducted,
        ssf_employee: a.ssfEmployee, ssf_employer: a.ssfEmployer, other_deductions: a.otherDeductions, total_receivable: r.netPay,
        tds_deposit_ref: b.tdsDepositRef ?? null, tds_deposit_date: b.tdsDepositDate ?? null, source: b.source, notes: b.notes ?? null, issued_by: ctx.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'CREATE', 'tds_certificate', row.id, null, { certNo, employeeId: emp.id, source: b.source, totalRemuneration: row.total_remuneration, tds: row.tds_deducted, totalReceivable: row.total_receivable });
    return row;
  }

  async cancel(trx: Tx, ctx: CompanyContext, id: string, reason: string) {
    const c = await trx.selectFrom('tds_certificates').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!c) throw new AppError('NOT_FOUND');
    if (c.status === 'CANCELLED') throw new AppError('APR_INVALID_STATE', 'This certificate is already cancelled');
    const row = await trx.updateTable('tds_certificates').set({ status: 'CANCELLED', cancel_reason: reason, cancelled_at: new Date(), cancelled_by: ctx.userId, updated_by: ctx.userId }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'UPDATE', 'tds_certificate_cancelled', id, { status: c.status }, { status: 'CANCELLED', reason });
    return row;
  }

  async render(trx: Tx, ctx: CompanyContext, id: string, opts: { employeeId?: string; count: boolean }) {
    let q = trx.selectFrom('tds_certificates').selectAll().where('id', '=', id);
    if (opts.employeeId) q = q.where('employee_id', '=', opts.employeeId).where('status', '=', 'ISSUED');
    const c = await q.forUpdate().executeTakeFirst();
    if (!c) throw new AppError('NOT_FOUND');
    const co = await trx.selectFrom('companies').selectAll().where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    const emp = await trx.selectFrom('employees').selectAll().where('id', '=', c.employee_id).executeTakeFirstOrThrow();
    const fy = c.fiscal_year_id ? (await trx.selectFrom('fiscal_years').select('label').where('id', '=', c.fiscal_year_id).executeTakeFirst())?.label ?? null : null;
    let n = c.print_count;
    if (opts.count && c.status === 'ISSUED') {
      n += 1;
      await trx.updateTable('tds_certificates').set({ print_count: n }).where('id', '=', id).execute();
    }
    const copy = n <= 1 ? 'Original' : `Copy of original (${n - 1})`;
    return { html: certificateHtml(co, emp, c, fy, copy, new Date().toISOString().slice(0, 16).replace('T', ' ')), name: c.cert_no };
  }
}

@Controller('tds-certificates')
export class TdsCertificatesController {
  constructor(private readonly dbs: DatabaseService, private readonly svc: CertificateService, private readonly slips: PayslipService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  @Perm('tds_certificate.view')
  @Get()
  list(@Ctx() ctx: CompanyContext, @Query('employeeId') employeeId?: string) {
    return this.tx(ctx, async (trx) => {
      let q = trx
        .selectFrom('tds_certificates')
        .innerJoin('employees', 'employees.id', 'tds_certificates.employee_id')
        .select(['tds_certificates.id', 'tds_certificates.cert_no', 'tds_certificates.employee_id', 'employees.full_name', 'employees.code', 'tds_certificates.period_from', 'tds_certificates.period_to', 'tds_certificates.total_remuneration', 'tds_certificates.tds_deducted', 'tds_certificates.total_receivable', 'tds_certificates.status', 'tds_certificates.source', 'tds_certificates.issued_at'])
        .orderBy('tds_certificates.issued_at', 'desc');
      if (employeeId) q = q.where('tds_certificates.employee_id', '=', employeeId);
      return q.limit(500).execute();
    });
  }

  /** Pre-fill helper for the "issue" form: the staff member's sent payslips summed over a period. */
  @Perm('tds_certificate.issue')
  @Get('suggest')
  suggest(@Ctx() ctx: CompanyContext, @Query(new Zod(suggestQuery)) q: z.infer<typeof suggestQuery>) {
    return this.tx(ctx, (trx) => this.svc.fromPayslips(trx, q.employeeId, q.from, q.to));
  }

  @Perm('tds_certificate.view')
  @Get(':id')
  one(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, async (trx) => {
      const c = await trx.selectFrom('tds_certificates').innerJoin('employees', 'employees.id', 'tds_certificates.employee_id').selectAll('tds_certificates').select(['employees.full_name', 'employees.code', 'employees.pan']).where('tds_certificates.id', '=', id).executeTakeFirst();
      if (!c) throw new AppError('NOT_FOUND');
      return c;
    });
  }

  @Perm('tds_certificate.issue')
  @Post()
  issue(@Ctx() ctx: CompanyContext, @Body(new Zod(issueSchema)) b: z.infer<typeof issueSchema>) {
    return this.tx(ctx, (trx) => this.svc.issue(trx, ctx, b));
  }

  @Perm('tds_certificate.issue')
  @Post(':id/cancel')
  cancel(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.tx(ctx, (trx) => this.svc.cancel(trx, ctx, id, b.reason));
  }

  @Perm('tds_certificate.view')
  @Get(':id/print')
  async print(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const out = await this.tx(ctx, (trx) => this.svc.render(trx, ctx, id, { count: format !== 'preview' }));
    await this.slips.send_response(res, format, out);
  }
}
