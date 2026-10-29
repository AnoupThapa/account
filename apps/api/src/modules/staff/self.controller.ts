/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError, localParts, zAdDate } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { AttendanceService } from './attendance.controller';
import { PayslipService } from './payslips.controller';
import { CertificateService } from './certificates.controller';
import { salaryOn } from './staff.controller';

const range = z.object({ from: zAdDate, to: zAdDate });

/**
 * Staff self-service ("My profile"). SECURITY: the employee is ALWAYS derived from the signed-in user —
 * no endpoint here accepts an employee id from the client, so one staff member can never reach another's records.
 */
@Controller('me')
export class SelfController {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly audit: AuditService,
    private readonly att: AttendanceService,
    private readonly slips: PayslipService,
    private readonly certs: CertificateService,
  ) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  private async me(trx: Tx, ctx: CompanyContext) {
    const e = await trx.selectFrom('employees').selectAll().where('user_id', '=', ctx.userId).executeTakeFirst();
    if (!e) throw new AppError('HR_NOT_STAFF');
    return e;
  }

  @Perm('self.view')
  @Get('staff')
  profile(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const { user_id: _u, created_by: _c, updated_by: _x, ...e } = await this.me(trx, ctx);
      const today = localParts(new Date(), (await trx.selectFrom('companies').select('timezone').where('id', '=', ctx.companyId).executeTakeFirstOrThrow()).timezone).date;
      return { ...e, salary: (await salaryOn(trx, e.id, today)) ?? null, today: await this.att.today(trx, ctx, e.id) };
    });
  }

  // -------------------------------------------------------------- attendance
  @Perm('self.view')
  @Get('attendance')
  attendance(@Ctx() ctx: CompanyContext, @Query(new Zod(range)) q: z.infer<typeof range>) {
    return this.tx(ctx, async (trx) => {
      const e = await this.me(trx, ctx);
      const days = await this.att.days(trx, ctx, e.id, q.from, q.to);
      return { today: await this.att.today(trx, ctx, e.id), days, summary: this.att.summarise(days) };
    });
  }

  @Perm('self.view')
  @Post('attendance/clock-in')
  clockIn(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => this.att.clockIn(trx, ctx, await this.me(trx, ctx)));
  }

  @Perm('self.view')
  @Post('attendance/clock-out')
  clockOut(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => this.att.clockOut(trx, ctx, await this.me(trx, ctx)));
  }

  // -------------------------------------------------------------- payslips
  @Perm('self.view')
  @Get('payslips')
  payslips(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const e = await this.me(trx, ctx);
      return trx.selectFrom('payslips').selectAll().where('employee_id', '=', e.id).where('status', '=', 'SENT').orderBy('period_start', 'desc').execute();
    });
  }

  /** Opening a payslip marks it as viewed. */
  @Perm('self.view')
  @Get('payslips/:id')
  payslip(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, async (trx) => {
      const e = await this.me(trx, ctx);
      const p = await trx.selectFrom('payslips').selectAll().where('id', '=', id).where('employee_id', '=', e.id).where('status', '=', 'SENT').forUpdate().executeTakeFirst();
      if (!p) throw new AppError('NOT_FOUND');
      if (!p.viewed_at) {
        await trx.updateTable('payslips').set({ viewed_at: new Date() }).where('id', '=', id).execute();
        await this.audit.log(trx, ctx, 'UPDATE', 'payslip_viewed', id, null, { by: 'staff' });
        return { ...p, viewed_at: new Date().toISOString() };
      }
      return p;
    });
  }

  @Perm('self.view')
  @Post('payslips/:id/acknowledge')
  acknowledge(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, async (trx) => {
      const e = await this.me(trx, ctx);
      const p = await trx.selectFrom('payslips').select(['id', 'acknowledged_at']).where('id', '=', id).where('employee_id', '=', e.id).where('status', '=', 'SENT').forUpdate().executeTakeFirst();
      if (!p) throw new AppError('NOT_FOUND');
      if (p.acknowledged_at) return { ok: true, acknowledgedAt: p.acknowledged_at };
      const row = await trx.updateTable('payslips').set({ acknowledged_at: new Date(), viewed_at: new Date() }).where('id', '=', id).returning('acknowledged_at').executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'payslip_acknowledged', id, null, { by: 'staff' });
      return { ok: true, acknowledgedAt: row.acknowledged_at };
    });
  }

  @Perm('self.view')
  @Get('payslips/:id/print')
  async printPayslip(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const out = await this.tx(ctx, async (trx) => this.slips.render(trx, ctx, id, { employeeId: (await this.me(trx, ctx)).id, count: format !== 'preview' }));
    await this.slips.send_response(res, format, out);
  }

  // -------------------------------------------------------------- TDS certificates
  @Perm('self.view')
  @Get('tds-certificates')
  certificates(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const e = await this.me(trx, ctx);
      return trx.selectFrom('tds_certificates').selectAll().where('employee_id', '=', e.id).where('status', '=', 'ISSUED').orderBy('issued_at', 'desc').execute();
    });
  }

  @Perm('self.view')
  @Get('tds-certificates/:id/print')
  async printCertificate(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const out = await this.tx(ctx, async (trx) => this.certs.render(trx, ctx, id, { employeeId: (await this.me(trx, ctx)).id, count: format !== 'preview' }));
    await this.slips.send_response(res, format, out);
  }
}
