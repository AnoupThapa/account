/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { sql } from 'kysely';
import { AppError, patchSchema, zAdDate, zMoneyNonNeg, zRate } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { hashPassword } from '../auth/auth.service';
import { assertStrongPassword } from '../auth/password-policy';

/** Staff profiles, salary structures, staff logins and HR settings (docs/15 §12). Salary data needs `staff.view_salary`. */

const staffSchema = z.object({
  code: z.string().min(1).max(30).optional(),
  fullName: z.string().min(2).max(150),
  email: z.string().email().max(254).nullish().or(z.literal('')),
  phone: z.string().max(40).nullish(),
  address: z.string().max(500).nullish(),
  designation: z.string().max(100).nullish(),
  department: z.string().max(100).nullish(),
  branchId: z.string().uuid().nullish(),
  employmentType: z.enum(['PERMANENT', 'CONTRACT', 'PART_TIME', 'CASUAL', 'INTERN']).default('PERMANENT'),
  joinDate: zAdDate.nullish(),
  exitDate: zAdDate.nullish(),
  pan: z.string().max(20).nullish(),
  ssfNo: z.string().max(30).nullish(),
  bankName: z.string().max(100).nullish(),
  bankAccount: z.string().max(40).nullish(),
  emergencyContact: z.string().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});
const staffPatch = patchSchema(staffSchema).extend({ version: z.number().int() });

const salarySchema = z.object({
  effectiveFrom: zAdDate,
  basicSalary: zMoneyNonNeg,
  allowance: zMoneyNonNeg.default('0'),
  otherAllowance: zMoneyNonNeg.default('0'),
  otherDeductions: zMoneyNonNeg.default('0'),
  ssfApplicable: z.boolean().default(true),
});

const loginSchema = z.object({ email: z.string().email().optional(), initialPassword: z.string().max(200).optional() });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const settingsSchema = z.object({
  workStart: hhmm,
  graceMinutes: z.number().int().min(0).max(240),
  standardMinutes: z.number().int().min(60).max(1440),
  halfDayMinutes: z.number().int().min(30).max(1440),
  weeklyOff: z.array(z.number().int().min(0).max(6)).max(6),
  ssfEmployeePct: zRate,
  ssfEmployerPct: zRate,
});

/** HR settings row (created with defaults on first use). */
export async function hrSettings(trx: Tx, companyId: string) {
  await trx.insertInto('hr_settings').values({ company_id: companyId }).onConflict((oc) => oc.column('company_id').doNothing()).execute();
  const s = await trx.selectFrom('hr_settings').selectAll().where('company_id', '=', companyId).executeTakeFirstOrThrow();
  return { ...s, work_start: String(s.work_start).slice(0, 5) };
}

/** Salary structure in force on a date (latest effective_from on or before it). */
export async function salaryOn(trx: Tx, employeeId: string, date: string) {
  return trx.selectFrom('salary_structures').selectAll().where('employee_id', '=', employeeId).where('effective_from', '<=', date).orderBy('effective_from', 'desc').executeTakeFirst();
}

const PUBLIC_COLS = ['id', 'code', 'full_name', 'email', 'phone', 'designation', 'department', 'branch_id', 'employment_type', 'join_date', 'exit_date', 'status', 'user_id', 'version'] as const;

@Controller()
export class StaffController {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  @Perm('staff.view')
  @Get('staff')
  list(@Ctx() ctx: CompanyContext, @Query('status') status?: string, @Query('q') q?: string) {
    return this.tx(ctx, async (trx) => {
      let qb = trx.selectFrom('employees').select([...PUBLIC_COLS]).orderBy('code');
      if (status === 'ACTIVE' || status === 'INACTIVE') qb = qb.where('status', '=', status);
      if (q) qb = qb.where((eb) => eb.or([eb('full_name', 'ilike', `%${q}%`), eb('code', 'ilike', `%${q}%`), eb('department', 'ilike', `%${q}%`)]));
      const rows = await qb.execute();
      return rows.map(({ user_id, ...r }) => ({ ...r, has_login: !!user_id }));
    });
  }

  @Perm('staff.manage')
  @Post('staff')
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(staffSchema)) b: z.infer<typeof staffSchema>) {
    return this.tx(ctx, async (trx) => {
      const code = b.code ?? (await this.nextCode(trx));
      const row = await trx
        .insertInto('employees')
        .values({
          company_id: ctx.companyId, code, full_name: b.fullName, email: b.email || null, phone: b.phone ?? null, address: b.address ?? null,
          designation: b.designation ?? null, department: b.department ?? null, branch_id: b.branchId ?? null, employment_type: b.employmentType,
          join_date: b.joinDate ?? null, exit_date: b.exitDate ?? null, pan: b.pan ?? null, ssf_no: b.ssfNo ?? null, bank_name: b.bankName ?? null,
          bank_account: b.bankAccount ?? null, emergency_contact: b.emergencyContact ?? null, notes: b.notes ?? null, status: b.status, created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((e) => {
          if (String(e.message).includes('employees_company_id_code_key')) throw new AppError('DOC_DUPLICATE', `Staff code ${code} already exists`);
          throw e;
        });
      await this.audit.log(trx, ctx, 'CREATE', 'employee', row.id, null, { code: row.code, fullName: row.full_name });
      return row;
    });
  }

  private async nextCode(trx: Tx) {
    const r = await sql<{ n: number }>`SELECT coalesce(max(substring(code from '[0-9]+$')::int), 0) + 1 AS n FROM employees WHERE code ~ '[0-9]+$'`.execute(trx);
    return `EMP-${String(r.rows[0].n).padStart(4, '0')}`;
  }

  @Perm('staff.view')
  @Get('staff/:id')
  get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, async (trx) => {
      const { user_id, ...e } = (await trx.selectFrom('employees').selectAll().where('id', '=', id).executeTakeFirst()) ?? ({} as never);
      if (!(e as { id?: string }).id) throw new AppError('NOT_FOUND');
      const out: Record<string, unknown> = { ...e, has_login: !!user_id };
      if (user_id) out.login_email = (await trx.selectFrom('users').select('email').where('id', '=', user_id).executeTakeFirst())?.email ?? null;
      if (ctx.permissions.has('staff.view_salary')) out.salary = await trx.selectFrom('salary_structures').selectAll().where('employee_id', '=', id).orderBy('effective_from', 'desc').execute();
      else {
        // bank details and PAN are part of pay data
        delete out.bank_name;
        delete out.bank_account;
      }
      return out;
    });
  }

  @Perm('staff.manage')
  @Patch('staff/:id')
  update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(staffPatch)) b: z.infer<typeof staffPatch>) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('employees').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      if (before.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
      const pick = <K extends keyof typeof b>(k: K, cur: unknown) => (b[k] === undefined ? cur : b[k]);
      const status = (b.status ?? before.status) as 'ACTIVE' | 'INACTIVE';
      const after = await trx
        .updateTable('employees')
        .set({
          full_name: (b.fullName as string | undefined) ?? before.full_name, email: (pick('email', before.email) as string | null) || null, phone: pick('phone', before.phone) as string | null,
          address: pick('address', before.address) as string | null, designation: pick('designation', before.designation) as string | null, department: pick('department', before.department) as string | null,
          branch_id: pick('branchId', before.branch_id) as string | null, employment_type: (b.employmentType as string | undefined) ?? before.employment_type,
          join_date: pick('joinDate', before.join_date) as string | null, exit_date: pick('exitDate', before.exit_date) as string | null, pan: pick('pan', before.pan) as string | null,
          ssf_no: pick('ssfNo', before.ssf_no) as string | null, bank_name: pick('bankName', before.bank_name) as string | null, bank_account: pick('bankAccount', before.bank_account) as string | null,
          emergency_contact: pick('emergencyContact', before.emergency_contact) as string | null, notes: pick('notes', before.notes) as string | null, status, updated_by: ctx.userId,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      // an inactive staff member can no longer sign in to this company; re-activating restores access
      if (before.user_id && status !== before.status) {
        await trx.updateTable('user_companies').set({ is_active: status === 'ACTIVE' }).where('user_id', '=', before.user_id).where('company_id', '=', ctx.companyId).execute();
      }
      await this.audit.log(trx, ctx, 'UPDATE', 'employee', id, { ...before, bank_account: before.bank_account ? '***' : null }, { ...after, bank_account: after.bank_account ? '***' : null });
      return after;
    });
  }

  // ------------------------------------------------------------------ salary structure
  @Perm('staff.view_salary')
  @Get('staff/:id/salary')
  salary(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, (trx) => trx.selectFrom('salary_structures').selectAll().where('employee_id', '=', id).orderBy('effective_from', 'desc').execute());
  }

  /** A raise is a new row from a date; the old rows stay as history. */
  @Perm('staff.manage', 'staff.view_salary')
  @Post('staff/:id/salary')
  setSalary(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(salarySchema)) b: z.infer<typeof salarySchema>) {
    return this.tx(ctx, async (trx) => {
      const emp = await trx.selectFrom('employees').select('id').where('id', '=', id).executeTakeFirst();
      if (!emp) throw new AppError('NOT_FOUND');
      const row = await trx
        .insertInto('salary_structures')
        .values({ company_id: ctx.companyId, employee_id: id, effective_from: b.effectiveFrom, basic_salary: b.basicSalary, allowance: b.allowance, other_allowance: b.otherAllowance, other_deductions: b.otherDeductions, ssf_applicable: b.ssfApplicable, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow()
        .catch((e) => {
          if (String(e.message).includes('salary_structures_employee_id_effective_from_key')) throw new AppError('DOC_DUPLICATE', 'A salary is already set from that date — choose a later date');
          throw e;
        });
      await this.audit.log(trx, ctx, 'CREATE', 'salary_structure', row.id, null, row);
      return row;
    });
  }

  // ------------------------------------------------------------------ staff login
  /** Create (or link) the login of a staff member. The login gets the Staff role and is tied to this one employee record. */
  @Perm('staff.manage_login')
  @Post('staff/:id/login')
  createLogin(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(loginSchema)) b: z.infer<typeof loginSchema>) {
    return this.tx(ctx, async (trx) => {
      const emp = await trx.selectFrom('employees').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!emp) throw new AppError('NOT_FOUND');
      if (emp.user_id) throw new AppError('DOC_DUPLICATE', 'This staff member already has a login');
      if (emp.status !== 'ACTIVE') throw new AppError('VAL_FIELD', 'Activate the staff member first');
      const email = (b.email ?? emp.email ?? '').trim().toLowerCase();
      if (!email) throw new AppError('VAL_FIELD', 'Enter the staff member’s email address', undefined, [{ field: 'email', message: 'Required' }]);
      let user = await trx.selectFrom('users').select(['id', 'email']).where(sql`lower(email)`, '=', email).executeTakeFirst();
      if (!user) {
        if (!b.initialPassword) throw new AppError('VAL_FIELD', 'Set an initial password — the staff member must change it at first sign-in', undefined, [{ field: 'initialPassword', message: 'Required for a new login' }]);
        assertStrongPassword(b.initialPassword, email, emp.full_name);
        user = await trx.insertInto('users').values({ email, full_name: emp.full_name, password_hash: await hashPassword(b.initialPassword), must_change_password: true }).returning(['id', 'email']).executeTakeFirstOrThrow();
        await this.audit.log(trx, ctx, 'CREATE', 'user', user.id, null, { email, fullName: emp.full_name, via: 'staff login' });
      }
      const taken = await trx.selectFrom('employees').select('id').where('user_id', '=', user.id).executeTakeFirst();
      if (taken) throw new AppError('DOC_DUPLICATE', 'That login already belongs to another staff member');
      const m = await trx.selectFrom('user_companies').select('user_id').where('user_id', '=', user.id).where('company_id', '=', ctx.companyId).executeTakeFirst();
      if (m) await trx.updateTable('user_companies').set({ is_active: true }).where('user_id', '=', user.id).where('company_id', '=', ctx.companyId).execute();
      else await trx.insertInto('user_companies').values({ user_id: user.id, company_id: ctx.companyId }).execute();
      const role = await trx.selectFrom('roles').select('id').where('key', '=', 'STAFF').executeTakeFirst();
      if (!role) throw new AppError('SYS_UNEXPECTED', 'The Staff role is missing — run the database update');
      const has = await trx.selectFrom('user_roles').select('user_id').where('user_id', '=', user.id).where('role_id', '=', role.id).executeTakeFirst();
      if (!has) await trx.insertInto('user_roles').values({ company_id: ctx.companyId, user_id: user.id, role_id: role.id }).execute();
      await trx.updateTable('employees').set({ user_id: user.id, email: emp.email ?? email, updated_by: ctx.userId }).where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'ROLE_ASSIGNED', 'employee_login', id, null, { userId: user.id, email, role: 'STAFF' });
      return { employeeId: id, userId: user.id, email };
    });
  }

  // ------------------------------------------------------------------ HR settings
  @Perm('hr.settings')
  @Get('hr/settings')
  settings(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, (trx) => hrSettings(trx, ctx.companyId));
  }

  @Perm('hr.settings')
  @Patch('hr/settings')
  updateSettings(@Ctx() ctx: CompanyContext, @Body(new Zod(patchSchema(settingsSchema))) b: Partial<z.infer<typeof settingsSchema>>) {
    return this.tx(ctx, async (trx) => {
      const before = await hrSettings(trx, ctx.companyId);
      await trx
        .updateTable('hr_settings')
        .set({
          work_start: b.workStart ?? before.work_start, grace_minutes: b.graceMinutes ?? before.grace_minutes, standard_minutes: b.standardMinutes ?? before.standard_minutes,
          half_day_minutes: b.halfDayMinutes ?? before.half_day_minutes, weekly_off: b.weeklyOff ?? before.weekly_off, ssf_employee_pct: b.ssfEmployeePct ?? before.ssf_employee_pct,
          ssf_employer_pct: b.ssfEmployerPct ?? before.ssf_employer_pct, updated_at: new Date(), updated_by: ctx.userId,
        })
        .where('company_id', '=', ctx.companyId)
        .execute();
      const after = await hrSettings(trx, ctx.companyId);
      await this.audit.log(trx, ctx, 'UPDATE', 'hr_settings', ctx.companyId, before, after);
      return after;
    });
  }
}
