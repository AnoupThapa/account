/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Injectable, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError, calcPay, ssfOf, zMoneyNonNeg } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../settings/numbering.service';
import { PrintService } from '../print/print.service';
import { hrSettings, salaryOn } from './staff.controller';
import { payslipHtml } from './staff-print';

const money = zMoneyNonNeg;
const createSchema = z.object({
  employeeId: z.string().uuid(),
  periodId: z.string().uuid(),
  notes: z.string().max(1000).nullish(),
  basicSalary: money.optional(),
  allowance: money.optional(),
  otherAllowance: money.optional(),
  tdsAmount: money.optional(),
  ssfEmployee: money.optional(),
  ssfEmployer: money.optional(),
  otherDeductions: money.optional(),
});
const updateSchema = z.object({
  version: z.number().int(),
  notes: z.string().max(1000).nullish(),
  basicSalary: money.optional(),
  allowance: money.optional(),
  otherAllowance: money.optional(),
  tdsAmount: money.optional(),
  ssfEmployee: money.optional(),
  ssfEmployer: money.optional(),
  otherDeductions: money.optional(),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) });
const periodSchema = z.object({ periodId: z.string().uuid() });

@Injectable()
export class PayslipService {
  constructor(private readonly audit: AuditService, private readonly numbering: NumberingService, private readonly print: PrintService) {}

  /** Amounts for a new payslip: explicit values win, otherwise the salary structure in force at period end and the company SSF rates. */
  private async amountsFor(trx: Tx, ctx: CompanyContext, empId: string, periodEnd: string, o: Partial<Record<'basicSalary' | 'allowance' | 'otherAllowance' | 'tdsAmount' | 'ssfEmployee' | 'ssfEmployer' | 'otherDeductions', string>>) {
    const sal = await salaryOn(trx, empId, periodEnd);
    const basic = o.basicSalary ?? sal?.basic_salary;
    if (basic === undefined) throw new AppError('HR_NO_SALARY', undefined, undefined, [{ field: 'basicSalary', message: 'No salary set' }]);
    const s = await hrSettings(trx, ctx.companyId);
    const ssfOn = sal ? sal.ssf_applicable : true;
    return {
      basicSalary: basic,
      allowance: o.allowance ?? sal?.allowance ?? '0',
      otherAllowance: o.otherAllowance ?? sal?.other_allowance ?? '0',
      tdsAmount: o.tdsAmount ?? '0',
      ssfEmployee: o.ssfEmployee ?? (ssfOn ? ssfOf(basic, s.ssf_employee_pct) : '0'),
      ssfEmployer: o.ssfEmployer ?? (ssfOn ? ssfOf(basic, s.ssf_employer_pct) : '0'),
      otherDeductions: o.otherDeductions ?? sal?.other_deductions ?? '0',
    };
  }

  private async period(trx: Tx, id: string) {
    const p = await trx.selectFrom('accounting_periods').select(['id', 'name', 'start_date', 'end_date', 'is_adjustment']).where('id', '=', id).executeTakeFirst();
    if (!p) throw new AppError('VAL_FIELD', 'Unknown accounting period', undefined, [{ field: 'periodId', message: 'Unknown period' }]);
    return p;
  }

  async create(trx: Tx, ctx: CompanyContext, b: z.infer<typeof createSchema>) {
    const emp = await trx.selectFrom('employees').select(['id', 'status']).where('id', '=', b.employeeId).executeTakeFirst();
    if (!emp) throw new AppError('NOT_FOUND');
    if (emp.status !== 'ACTIVE') throw new AppError('VAL_FIELD', 'This staff member is not active');
    const per = await this.period(trx, b.periodId);
    const dup = await trx.selectFrom('payslips').select('id').where('employee_id', '=', emp.id).where('period_id', '=', per.id).where('status', '!=', 'CANCELLED').executeTakeFirst();
    if (dup) throw new AppError('HR_DUPLICATE_PAYSLIP');
    const a = await this.amountsFor(trx, ctx, emp.id, per.end_date, b);
    const r = calcPay(a);
    const row = await trx
      .insertInto('payslips')
      .values({
        company_id: ctx.companyId, employee_id: emp.id, period_id: per.id, period_label: per.name, period_start: per.start_date, period_end: per.end_date,
        basic_salary: a.basicSalary, allowance: a.allowance, other_allowance: a.otherAllowance, gross_pay: r.grossPay, tds_amount: a.tdsAmount, ssf_employee: a.ssfEmployee,
        ssf_employer: a.ssfEmployer, other_deductions: a.otherDeductions, total_deductions: r.totalDeductions, net_pay: r.netPay, notes: b.notes ?? null, created_by: ctx.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'CREATE', 'payslip', row.id, null, { employeeId: emp.id, period: per.name, net: row.net_pay });
    return row;
  }

  async update(trx: Tx, ctx: CompanyContext, id: string, b: z.infer<typeof updateSchema>) {
    const before = await trx.selectFrom('payslips').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!before) throw new AppError('NOT_FOUND');
    if (before.status !== 'DRAFT') throw new AppError('ACC_IMMUTABLE', 'Only a draft payslip can be edited — cancel it and issue a new one');
    if (before.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
    const a = {
      basicSalary: b.basicSalary ?? before.basic_salary, allowance: b.allowance ?? before.allowance, otherAllowance: b.otherAllowance ?? before.other_allowance,
      tdsAmount: b.tdsAmount ?? before.tds_amount, ssfEmployee: b.ssfEmployee ?? before.ssf_employee, ssfEmployer: b.ssfEmployer ?? before.ssf_employer, otherDeductions: b.otherDeductions ?? before.other_deductions,
    };
    const r = calcPay(a);
    const after = await trx
      .updateTable('payslips')
      .set({ basic_salary: a.basicSalary, allowance: a.allowance, other_allowance: a.otherAllowance, gross_pay: r.grossPay, tds_amount: a.tdsAmount, ssf_employee: a.ssfEmployee, ssf_employer: a.ssfEmployer, other_deductions: a.otherDeductions, total_deductions: r.totalDeductions, net_pay: r.netPay, notes: b.notes === undefined ? before.notes : b.notes, updated_by: ctx.userId })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'UPDATE', 'payslip', id, before, after);
    return after;
  }

  /** Number it, lock the amounts, tell the staff member (email via outbox) — it then shows in their portal. */
  async send(trx: Tx, ctx: CompanyContext, id: string) {
    const p = await trx.selectFrom('payslips').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    if (p.status !== 'DRAFT') throw new AppError('APR_INVALID_STATE', 'Only a draft payslip can be sent');
    const emp = await trx.selectFrom('employees').select(['full_name', 'email', 'user_id']).where('id', '=', p.employee_id).executeTakeFirstOrThrow();
    const no = await this.numbering.next(trx, ctx.companyId, 'PAYSLIP', p.period_end);
    const row = await trx.updateTable('payslips').set({ status: 'SENT', payslip_no: no, sent_at: new Date(), sent_by: ctx.userId, updated_by: ctx.userId }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    const co = await trx.selectFrom('companies').select('name').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    if (emp.email) {
      await trx.insertInto('integration_outbox').values({ company_id: ctx.companyId, target: 'EMAIL', event_type: 'PAYSLIP_SENT', payload: JSON.stringify({ to: emp.email, name: emp.full_name, company: co.name, period: p.period_label, payslipNo: no, hasLogin: !!emp.user_id }) }).execute();
    }
    await this.audit.log(trx, ctx, 'UPDATE', 'payslip_sent', id, { status: 'DRAFT' }, { status: 'SENT', payslipNo: no, to: emp.email ?? null });
    return { ...row, hasLogin: !!emp.user_id, emailQueued: !!emp.email };
  }

  async cancel(trx: Tx, ctx: CompanyContext, id: string, reason: string) {
    const p = await trx.selectFrom('payslips').select(['id', 'status']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    if (p.status === 'CANCELLED') throw new AppError('APR_INVALID_STATE', 'This payslip is already cancelled');
    const row = await trx.updateTable('payslips').set({ status: 'CANCELLED', cancel_reason: reason, cancelled_at: new Date(), cancelled_by: ctx.userId, updated_by: ctx.userId }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'UPDATE', 'payslip_cancelled', id, { status: p.status }, { status: 'CANCELLED', reason });
    return row;
  }

  /** HTML (or PDF) of a payslip. `employeeId` is given for staff self-service so a payslip of someone else can never be rendered. */
  async render(trx: Tx, ctx: CompanyContext, id: string, opts: { employeeId?: string; count: boolean }) {
    let q = trx.selectFrom('payslips').selectAll().where('id', '=', id);
    if (opts.employeeId) q = q.where('employee_id', '=', opts.employeeId).where('status', '=', 'SENT');
    const p = await q.forUpdate().executeTakeFirst();
    if (!p) throw new AppError('NOT_FOUND');
    const co = await trx.selectFrom('companies').selectAll().where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    const emp = await trx.selectFrom('employees').selectAll().where('id', '=', p.employee_id).executeTakeFirstOrThrow();
    let n = p.print_count;
    if (opts.count && p.status === 'SENT') {
      n += 1;
      await trx.updateTable('payslips').set({ print_count: n }).where('id', '=', id).execute();
    }
    const copy = p.status === 'DRAFT' ? 'DRAFT — NOT ISSUED' : n <= 1 ? 'Original' : `Copy of original (${n - 1})`;
    return { html: payslipHtml(co, emp, p, copy, new Date().toISOString().slice(0, 16).replace('T', ' ')), name: p.payslip_no ?? 'payslip-draft' };
  }

  async send_response(res: Response, format: string | undefined, out: { html: string; name: string }) {
    if (format === 'pdf') {
      const pdf = await this.print.pdf(out.html);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${out.name.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`);
      res.send(pdf);
      return;
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.type('text/html').send(out.html);
  }
}

@Controller('payslips')
export class PayslipsController {
  constructor(private readonly dbs: DatabaseService, private readonly svc: PayslipService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  @Perm('payslip.view_all')
  @Get()
  list(@Ctx() ctx: CompanyContext, @Query('periodId') periodId?: string, @Query('employeeId') employeeId?: string, @Query('status') status?: string) {
    return this.tx(ctx, async (trx) => {
      let q = trx
        .selectFrom('payslips')
        .innerJoin('employees', 'employees.id', 'payslips.employee_id')
        .select(['payslips.id', 'payslips.payslip_no', 'payslips.period_label', 'payslips.period_start', 'payslips.period_end', 'payslips.employee_id', 'employees.full_name', 'employees.code', 'employees.user_id', 'payslips.gross_pay', 'payslips.total_deductions', 'payslips.net_pay', 'payslips.tds_amount', 'payslips.status', 'payslips.sent_at', 'payslips.viewed_at', 'payslips.acknowledged_at', 'payslips.version'])
        .orderBy('payslips.period_start', 'desc')
        .orderBy('employees.code');
      if (periodId) q = q.where('payslips.period_id', '=', periodId);
      if (employeeId) q = q.where('payslips.employee_id', '=', employeeId);
      if (status) q = q.where('payslips.status', '=', status);
      return (await q.limit(500).execute()).map(({ user_id, ...r }) => ({ ...r, has_login: !!user_id }));
    });
  }

  @Perm('payslip.view_all')
  @Get(':id')
  one(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, async (trx) => {
      const p = await trx.selectFrom('payslips').innerJoin('employees', 'employees.id', 'payslips.employee_id').selectAll('payslips').select(['employees.full_name', 'employees.code']).where('payslips.id', '=', id).executeTakeFirst();
      if (!p) throw new AppError('NOT_FOUND');
      return p;
    });
  }

  @Perm('payslip.generate')
  @Post()
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(createSchema)) b: z.infer<typeof createSchema>) {
    return this.tx(ctx, (trx) => this.svc.create(trx, ctx, b));
  }

  /** One draft per active staff member that has a salary and no payslip yet for the period. */
  @Perm('payslip.generate')
  @Post('draft-all')
  draftAll(@Ctx() ctx: CompanyContext, @Body(new Zod(periodSchema)) b: z.infer<typeof periodSchema>) {
    return this.tx(ctx, async (trx) => {
      const emps = await trx.selectFrom('employees').select(['id', 'full_name']).where('status', '=', 'ACTIVE').orderBy('code').execute();
      const created: string[] = [];
      const skipped: { name: string; reason: string }[] = [];
      for (const e of emps) {
        const dup = await trx.selectFrom('payslips').select('id').where('employee_id', '=', e.id).where('period_id', '=', b.periodId).where('status', '!=', 'CANCELLED').executeTakeFirst();
        if (dup) { skipped.push({ name: e.full_name, reason: 'Payslip already exists' }); continue; }
        const per = await trx.selectFrom('accounting_periods').select('end_date').where('id', '=', b.periodId).executeTakeFirst();
        if (!per) throw new AppError('VAL_FIELD', 'Unknown accounting period');
        const sal = await salaryOn(trx, e.id, per.end_date);
        if (!sal) { skipped.push({ name: e.full_name, reason: 'No salary set' }); continue; }
        const row = await this.svc.create(trx, ctx, { employeeId: e.id, periodId: b.periodId });
        created.push(row.id);
      }
      return { created: created.length, skipped };
    });
  }

  /** Send every draft payslip of a period to its staff member. */
  @Perm('payslip.generate')
  @Post('send-all')
  sendAll(@Ctx() ctx: CompanyContext, @Body(new Zod(periodSchema)) b: z.infer<typeof periodSchema>) {
    return this.tx(ctx, async (trx) => {
      const drafts = await trx.selectFrom('payslips').select('id').where('period_id', '=', b.periodId).where('status', '=', 'DRAFT').orderBy('created_at').execute();
      for (const d of drafts) await this.svc.send(trx, ctx, d.id);
      return { sent: drafts.length };
    });
  }

  @Perm('payslip.generate')
  @Patch(':id')
  update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.tx(ctx, (trx) => this.svc.update(trx, ctx, id, b));
  }

  @Perm('payslip.generate')
  @Post(':id/send')
  send(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, (trx) => this.svc.send(trx, ctx, id));
  }

  @Perm('payslip.generate')
  @Post(':id/cancel')
  cancel(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(reasonSchema)) b: z.infer<typeof reasonSchema>) {
    return this.tx(ctx, (trx) => this.svc.cancel(trx, ctx, id, b.reason));
  }

  @Perm('payslip.view_all')
  @Get(':id/print')
  async print(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const out = await this.tx(ctx, (trx) => this.svc.render(trx, ctx, id, { count: format !== 'preview' }));
    await this.svc.send_response(res, format, out);
  }
}
