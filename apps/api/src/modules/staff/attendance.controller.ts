/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Injectable, Param, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError, addDays, localParts, statusAtClockIn, statusAtClockOut, zAdDate, zonedToUtc } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { hrSettings } from './staff.controller';

const STATUSES = ['PRESENT', 'LATE', 'HALF_DAY', 'ABSENT', 'LEAVE', 'HOLIDAY', 'WEEKLY_OFF'] as const;
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const markSchema = z.object({
  status: z.enum(STATUSES),
  checkIn: hhmm.nullish(),
  checkOut: hhmm.nullish(),
  remarks: z.string().trim().min(3, 'Give a reason for this change').max(500),
});
const rangeQuery = z.object({ from: zAdDate, to: zAdDate });

function daysBetween(from: string, to: string) {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 63; d = addDays(d, 1)) out.push(d);
  return out;
}
const minutesBetween = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

/** Attendance rules shared by the HR screens and the staff self-service endpoints (docs/13, docs/15 §12). */
@Injectable()
export class AttendanceService {
  constructor(private readonly audit: AuditService) {}

  private async tz(trx: Tx, companyId: string) {
    return (await trx.selectFrom('companies').select('timezone').where('id', '=', companyId).executeTakeFirstOrThrow()).timezone;
  }

  /** Today's record and rules for a staff member (used by the portal's clock-in card). */
  async today(trx: Tx, ctx: CompanyContext, employeeId: string) {
    const tz = await this.tz(trx, ctx.companyId);
    const now = localParts(new Date(), tz);
    const rec = await trx.selectFrom('attendance_days').selectAll().where('employee_id', '=', employeeId).where('work_date', '=', now.date).executeTakeFirst();
    const s = await hrSettings(trx, ctx.companyId);
    return { date: now.date, timezone: tz, weeklyOff: s.weekly_off.includes(now.dow), record: rec ?? null };
  }

  async clockIn(trx: Tx, ctx: CompanyContext, emp: { id: string; status: string }) {
    if (emp.status !== 'ACTIVE') throw new AppError('HR_ATTENDANCE_STATE', 'Your staff record is not active');
    const tz = await this.tz(trx, ctx.companyId);
    const at = new Date();
    const now = localParts(at, tz);
    const s = await hrSettings(trx, ctx.companyId);
    const existing = await trx.selectFrom('attendance_days').selectAll().where('employee_id', '=', emp.id).where('work_date', '=', now.date).forUpdate().executeTakeFirst();
    if (existing?.check_in) throw new AppError('HR_ATTENDANCE_STATE', 'You have already clocked in today');
    const status = statusAtClockIn(now.minutes, { workStart: s.work_start, graceMinutes: s.grace_minutes, halfDayMinutes: s.half_day_minutes });
    const row = existing
      ? await trx.updateTable('attendance_days').set({ status, check_in: at, source: 'WEB' }).where('id', '=', existing.id).returningAll().executeTakeFirstOrThrow()
      : await trx.insertInto('attendance_days').values({ company_id: ctx.companyId, employee_id: emp.id, work_date: now.date, status, check_in: at, source: 'WEB' }).returningAll().executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'CREATE', 'attendance_clock_in', row.id, null, { employeeId: emp.id, date: now.date, status });
    return row;
  }

  async clockOut(trx: Tx, ctx: CompanyContext, emp: { id: string; status: string }) {
    const tz = await this.tz(trx, ctx.companyId);
    const at = new Date();
    const now = localParts(at, tz);
    const s = await hrSettings(trx, ctx.companyId);
    const rec = await trx.selectFrom('attendance_days').selectAll().where('employee_id', '=', emp.id).where('work_date', '=', now.date).forUpdate().executeTakeFirst();
    if (!rec?.check_in) throw new AppError('HR_ATTENDANCE_STATE', 'Clock in first');
    if (rec.check_out) throw new AppError('HR_ATTENDANCE_STATE', 'You have already clocked out today — ask HR if a correction is needed');
    const worked = minutesBetween(rec.check_in, at);
    const status = statusAtClockOut(rec.status, worked, { workStart: s.work_start, graceMinutes: s.grace_minutes, halfDayMinutes: s.half_day_minutes });
    const row = await trx.updateTable('attendance_days').set({ check_out: at, worked_minutes: worked, status }).where('id', '=', rec.id).returningAll().executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'UPDATE', 'attendance_clock_out', row.id, null, { employeeId: emp.id, date: now.date, workedMinutes: worked, status });
    return row;
  }

  /** One employee's days in a range, with weekly-off and not-marked days filled in. */
  async days(trx: Tx, ctx: CompanyContext, employeeId: string, from: string, to: string) {
    const s = await hrSettings(trx, ctx.companyId);
    const tz = await this.tz(trx, ctx.companyId);
    const today = localParts(new Date(), tz).date;
    const recs = await trx.selectFrom('attendance_days').selectAll().where('employee_id', '=', employeeId).where('work_date', '>=', from).where('work_date', '<=', to).execute();
    return daysBetween(from, to).map((date) => {
      const r = recs.find((x) => x.work_date === date);
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      if (r) return { date, status: r.status, check_in: r.check_in, check_out: r.check_out, worked_minutes: r.worked_minutes, source: r.source, remarks: r.remarks, derived: false };
      if (s.weekly_off.includes(dow)) return { date, status: 'WEEKLY_OFF', check_in: null, check_out: null, worked_minutes: 0, source: null, remarks: null, derived: true };
      return { date, status: date < today ? 'ABSENT' : 'NOT_MARKED', check_in: null, check_out: null, worked_minutes: 0, source: null, remarks: null, derived: true };
    });
  }

  summarise(days: { status: string }[]) {
    const n = (s: string) => days.filter((d) => d.status === s).length;
    return { present: n('PRESENT'), late: n('LATE'), halfDay: n('HALF_DAY'), absent: n('ABSENT'), leave: n('LEAVE'), holiday: n('HOLIDAY'), weeklyOff: n('WEEKLY_OFF') };
  }

  /** HR correction / marking of a day. Always needs a reason and is audit-logged with before/after. */
  async mark(trx: Tx, ctx: CompanyContext, employeeId: string, date: string, b: z.infer<typeof markSchema>) {
    const emp = await trx.selectFrom('employees').select(['id']).where('id', '=', employeeId).executeTakeFirst();
    if (!emp) throw new AppError('NOT_FOUND');
    const tz = await this.tz(trx, ctx.companyId);
    if (date > localParts(new Date(), tz).date) throw new AppError('VAL_FIELD', 'You cannot mark a future date', undefined, [{ field: 'date', message: 'Future date' }]);
    const cin = b.checkIn ? zonedToUtc(date, b.checkIn, tz) : null;
    let cout = b.checkOut ? zonedToUtc(date, b.checkOut, tz) : null;
    if (cin && cout && cout < cin) cout = zonedToUtc(addDays(date, 1), b.checkOut!, tz); // overnight shift
    const worked = cin && cout ? minutesBetween(cin, cout) : 0;
    const before = await trx.selectFrom('attendance_days').selectAll().where('employee_id', '=', employeeId).where('work_date', '=', date).forUpdate().executeTakeFirst();
    const vals = { status: b.status, check_in: cin, check_out: cout, worked_minutes: worked, source: 'MANUAL' as const, remarks: b.remarks, edited_by: ctx.userId, edited_at: new Date() };
    const row = before
      ? await trx.updateTable('attendance_days').set(vals).where('id', '=', before.id).returningAll().executeTakeFirstOrThrow()
      : await trx.insertInto('attendance_days').values({ company_id: ctx.companyId, employee_id: employeeId, work_date: date, ...vals }).returningAll().executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, before ? 'UPDATE' : 'CREATE', 'attendance_day', row.id, before ?? null, row);
    return row;
  }
}

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly dbs: DatabaseService, private readonly svc: AttendanceService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  /** Daily sheet: every active staff member for one date. */
  @Perm('attendance.view_all')
  @Get('daily')
  daily(@Ctx() ctx: CompanyContext, @Query('date', new Zod(zAdDate)) date: string) {
    return this.tx(ctx, async (trx) => {
      const emps = await trx.selectFrom('employees').select(['id', 'code', 'full_name', 'designation', 'department']).where('status', '=', 'ACTIVE').orderBy('code').execute();
      const rows = [];
      for (const e of emps) rows.push({ ...e, ...(await this.svc.days(trx, ctx, e.id, date, date))[0] });
      return { date, rows };
    });
  }

  /** Monthly register: one summary line per active staff member for a date range (≤ 63 days). */
  @Perm('attendance.view_all')
  @Get('register')
  register(@Ctx() ctx: CompanyContext, @Query(new Zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.tx(ctx, async (trx) => {
      if (q.to < q.from) throw new AppError('VAL_FIELD', 'The end date is before the start date');
      const emps = await trx.selectFrom('employees').select(['id', 'code', 'full_name', 'department']).where('status', '=', 'ACTIVE').orderBy('code').execute();
      const rows = [];
      for (const e of emps) {
        const days = await this.svc.days(trx, ctx, e.id, q.from, q.to);
        rows.push({ ...e, summary: this.svc.summarise(days), days: days.map((d) => ({ date: d.date, status: d.status })) });
      }
      return { from: q.from, to: q.to, rows };
    });
  }

  @Perm('attendance.view_all')
  @Get('staff/:employeeId')
  one(@Ctx() ctx: CompanyContext, @Param('employeeId') employeeId: string, @Query(new Zod(rangeQuery)) q: z.infer<typeof rangeQuery>) {
    return this.tx(ctx, async (trx) => {
      const e = await trx.selectFrom('employees').select('id').where('id', '=', employeeId).executeTakeFirst();
      if (!e) throw new AppError('NOT_FOUND');
      const days = await this.svc.days(trx, ctx, employeeId, q.from, q.to);
      return { days, summary: this.svc.summarise(days) };
    });
  }

  @Perm('attendance.manage')
  @Put('staff/:employeeId/:date')
  mark(@Ctx() ctx: CompanyContext, @Param('employeeId') employeeId: string, @Param('date', new Zod(zAdDate)) date: string, @Body(new Zod(markSchema)) b: z.infer<typeof markSchema>) {
    return this.tx(ctx, (trx) => this.svc.mark(trx, ctx, employeeId, date, b));
  }
}
