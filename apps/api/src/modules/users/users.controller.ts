import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { sql } from 'kysely';
import { AppError, ALL_PERMISSIONS, PERMISSIONS, zMoneyNonNeg, zPassword } from '@ledgerpro/shared';
import { Ctx, Perm, StepUp, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { hashPassword } from '../auth/auth.service';
import { assertStrongPassword } from '../auth/password-policy';

const inviteSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2).max(150),
  initialPassword: zPassword.optional(),
  roleIds: z.array(z.string().uuid()).min(1, 'Assign at least one role'),
});
const rolesSchema = z.object({ roleIds: z.array(z.string().uuid()) });
const roleSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).nullish(),
  requires2fa: z.boolean().default(false),
  approvalLimit: zMoneyNonNeg.nullish(),
  permissions: z.array(z.string()).default([]),
});
const auditQuery = z.object({
  entity: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().max(40).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  beforeId: z.coerce.number().int().optional(),
});

@Controller()
export class UsersController {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  // ------------------------------------------------------------- users
  @Perm('user.view')
  @Get('users')
  list(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const users = await trx
        .selectFrom('user_companies')
        .innerJoin('users', 'users.id', 'user_companies.user_id')
        .select(['users.id', 'users.email', 'users.full_name', 'users.mfa_enabled', 'users.last_login_at', 'users.is_active', 'user_companies.is_active as member_active'])
        .where('user_companies.company_id', '=', ctx.companyId)
        .orderBy('users.full_name')
        .execute();
      const roles = await trx.selectFrom('user_roles').innerJoin('roles', 'roles.id', 'user_roles.role_id').select(['user_roles.user_id', 'roles.id', 'roles.name']).execute();
      return users.map((u) => ({ ...u, roles: roles.filter((r) => r.user_id === u.id).map((r) => ({ id: r.id, name: r.name })) }));
    });
  }

  /** Add a user to this company. Existing accounts (same email) are linked; new ones get an initial password and must change it. */
  @Perm('user.manage')
  @Post('users')
  invite(@Ctx() ctx: CompanyContext, @Body(new Zod(inviteSchema)) b: z.infer<typeof inviteSchema>) {
    return this.tx(ctx, async (trx) => {
      const email = b.email.trim().toLowerCase();
      let user = await trx.selectFrom('users').select(['id', 'email']).where(sql`lower(email)`, '=', email).executeTakeFirst();
      if (!user) {
        if (!b.initialPassword) throw new AppError('VAL_FIELD', 'Set an initial password for a new user', undefined, [{ field: 'initialPassword', message: 'Required for a new user' }]);
        assertStrongPassword(b.initialPassword, email, b.fullName);
        user = await trx
          .insertInto('users')
          .values({ email, full_name: b.fullName, password_hash: await hashPassword(b.initialPassword), must_change_password: true })
          .returning(['id', 'email'])
          .executeTakeFirstOrThrow();
        await this.audit.log(trx, ctx, 'CREATE', 'user', user.id, null, { email, fullName: b.fullName });
      }
      const existing = await trx.selectFrom('user_companies').select('is_active').where('user_id', '=', user.id).where('company_id', '=', ctx.companyId).executeTakeFirst();
      if (existing) {
        await trx.updateTable('user_companies').set({ is_active: true }).where('user_id', '=', user.id).where('company_id', '=', ctx.companyId).execute();
      } else {
        await trx.insertInto('user_companies').values({ user_id: user.id, company_id: ctx.companyId }).execute();
      }
      await this.setRoles(trx, ctx, user.id, b.roleIds);
      return { id: user.id, email: user.email };
    });
  }

  private async setRoles(trx: Tx, ctx: CompanyContext, userId: string, roleIds: string[]) {
    const valid = roleIds.length ? await trx.selectFrom('roles').select('id').where('id', 'in', roleIds).execute() : [];
    if (valid.length !== roleIds.length) throw new AppError('VAL_FIELD', 'Unknown role');
    const before = await trx.selectFrom('user_roles').select('role_id').where('user_id', '=', userId).execute();
    // Never remove the last Company Admin
    const adminRole = await trx.selectFrom('roles').select('id').where('key', '=', 'COMPANY_ADMIN').executeTakeFirst();
    if (adminRole && before.some((r) => r.role_id === adminRole.id) && !roleIds.includes(adminRole.id)) {
      const admins = await trx.selectFrom('user_roles').select(sql<number>`count(*)::int`.as('n')).where('role_id', '=', adminRole.id).executeTakeFirstOrThrow();
      if (admins.n <= 1) throw new AppError('VAL_FIELD', 'A company must keep at least one Company Admin');
    }
    await trx.deleteFrom('user_roles').where('user_id', '=', userId).execute();
    if (roleIds.length) await trx.insertInto('user_roles').values(roleIds.map((r) => ({ company_id: ctx.companyId, user_id: userId, role_id: r }))).execute();
    await this.audit.log(trx, ctx, 'ROLE_ASSIGNED', 'user_roles', userId, { roleIds: before.map((r) => r.role_id) }, { roleIds });
  }

  @Perm('user.manage', 'role.manage')
  @StepUp()
  @Patch('users/:id/roles')
  updateRoles(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(rolesSchema)) b: z.infer<typeof rolesSchema>) {
    return this.tx(ctx, async (trx) => {
      const m = await trx.selectFrom('user_companies').select('user_id').where('user_id', '=', id).where('company_id', '=', ctx.companyId).executeTakeFirst();
      if (!m) throw new AppError('NOT_FOUND');
      await this.setRoles(trx, ctx, id, b.roleIds);
      return { ok: true };
    });
  }

  @Perm('user.manage')
  @Delete('users/:id')
  deactivate(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    if (id === ctx.userId) throw new AppError('VAL_FIELD', "You can't remove yourself");
    return this.tx(ctx, async (trx) => {
      const r = await trx.updateTable('user_companies').set({ is_active: false }).where('user_id', '=', id).where('company_id', '=', ctx.companyId).executeTakeFirst();
      if (!Number(r.numUpdatedRows)) throw new AppError('NOT_FOUND');
      await this.audit.log(trx, ctx, 'UPDATE', 'user_company', id, { active: true }, { active: false });
      return { ok: true };
    });
  }

  /** Admin force-logout (security.md §1). */
  @Perm('user.manage')
  @Post('users/:id/force-logout')
  forceLogout(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.tx(ctx, async (trx) => {
      const m = await trx.selectFrom('user_companies').select('user_id').where('user_id', '=', id).where('company_id', '=', ctx.companyId).executeTakeFirst();
      if (!m) throw new AppError('NOT_FOUND');
      await trx.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: 'ADMIN_FORCE_LOGOUT' }).where('user_id', '=', id).where('revoked_at', 'is', null).execute();
      await this.audit.log(trx, ctx, 'FORCE_LOGOUT', 'user', id);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------- roles
  @Perm('member')
  @Get('permissions')
  permissions() {
    return ALL_PERMISSIONS.map((code) => ({ code, description: PERMISSIONS[code] }));
  }

  @Perm('user.view')
  @Get('roles')
  roles(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const roles = await trx.selectFrom('roles').selectAll().orderBy('name').execute();
      const perms = await trx.selectFrom('role_permissions').select(['role_id', 'permission_code']).execute();
      return roles.map((r) => ({ ...r, permissions: perms.filter((p) => p.role_id === r.id).map((p) => p.permission_code) }));
    });
  }

  @Perm('role.manage')
  @StepUp()
  @Post('roles')
  createRole(@Ctx() ctx: CompanyContext, @Body(new Zod(roleSchema)) b: z.infer<typeof roleSchema>) {
    return this.tx(ctx, async (trx) => {
      this.checkPerms(b.permissions);
      const role = await trx
        .insertInto('roles')
        .values({ company_id: ctx.companyId, name: b.name, description: b.description ?? null, requires_2fa: b.requires2fa, approval_limit: b.approvalLimit ?? null, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (b.permissions.length) await trx.insertInto('role_permissions').values(b.permissions.map((p) => ({ company_id: ctx.companyId, role_id: role.id, permission_code: p }))).execute();
      await this.audit.log(trx, ctx, 'CREATE', 'role', role.id, null, { ...role, permissions: b.permissions });
      return role;
    });
  }

  @Perm('role.manage')
  @StepUp()
  @Patch('roles/:id')
  updateRole(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(roleSchema.partial())) b: Partial<z.infer<typeof roleSchema>>) {
    return this.tx(ctx, async (trx) => {
      const before = await trx.selectFrom('roles').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      const beforePerms = (await trx.selectFrom('role_permissions').select('permission_code').where('role_id', '=', id).execute()).map((p) => p.permission_code);
      const after = await trx
        .updateTable('roles')
        .set({
          name: b.name ?? before.name,
          description: b.description === undefined ? before.description : b.description,
          requires_2fa: b.requires2fa ?? before.requires_2fa,
          approval_limit: b.approvalLimit === undefined ? before.approval_limit : b.approvalLimit,
          updated_by: ctx.userId,
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      if (b.permissions) {
        this.checkPerms(b.permissions);
        if (before.key === 'COMPANY_ADMIN' && !b.permissions.includes('role.manage')) throw new AppError('VAL_FIELD', 'Company Admin must keep role.manage');
        await trx.deleteFrom('role_permissions').where('role_id', '=', id).execute();
        if (b.permissions.length) await trx.insertInto('role_permissions').values(b.permissions.map((p) => ({ company_id: ctx.companyId, role_id: id, permission_code: p }))).execute();
      }
      await this.audit.log(trx, ctx, 'UPDATE', 'role', id, { ...before, permissions: beforePerms }, { ...after, permissions: b.permissions ?? beforePerms });
      return after;
    });
  }

  private checkPerms(perms: string[]) {
    const bad = perms.filter((p) => !PERMISSIONS[p] || p === 'company.create');
    if (bad.length) throw new AppError('VAL_FIELD', `Unknown permission(s): ${bad.join(', ')}`);
  }

  // ------------------------------------------------------------- audit log
  @Perm('audit.view')
  @Get('audit-logs')
  auditLogs(@Ctx() ctx: CompanyContext, @Query(new Zod(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.tx(ctx, (trx) =>
      trx
        .selectFrom('audit_logs')
        .leftJoin('users', 'users.id', 'audit_logs.user_id')
        .select(['audit_logs.id', 'audit_logs.action', 'audit_logs.entity', 'audit_logs.entity_id', 'audit_logs.before', 'audit_logs.after', 'audit_logs.ip', 'audit_logs.at', 'audit_logs.request_id', 'users.full_name as user_name', 'audit_logs.hash'])
        .where('audit_logs.company_id', '=', ctx.companyId)
        .$if(!!q.entity, (x) => x.where('audit_logs.entity', '=', q.entity!))
        .$if(!!q.entityId, (x) => x.where('audit_logs.entity_id', '=', q.entityId!))
        .$if(!!q.userId, (x) => x.where('audit_logs.user_id', '=', q.userId!))
        .$if(!!q.action, (x) => x.where('audit_logs.action', '=', q.action!))
        .$if(!!q.from, (x) => x.where('audit_logs.at', '>=', new Date(q.from!)))
        .$if(!!q.to, (x) => x.where('audit_logs.at', '<', new Date(q.to!)))
        .$if(!!q.beforeId, (x) => x.where('audit_logs.id', '<', String(q.beforeId!)))
        .orderBy('audit_logs.id', 'desc')
        .limit(q.limit)
        .execute(),
    );
  }

  @Perm('audit.view')
  @Get('audit-logs/verify')
  verify(@Ctx() ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const r = await sql<{ rows_checked: string; first_broken_id: string | null }>`SELECT * FROM verify_audit_chain(${ctx.companyId}::uuid)`.execute(trx);
      const row = r.rows[0];
      return { rowsChecked: Number(row.rows_checked), intact: row.first_broken_id === null, firstBrokenId: row.first_broken_id };
    });
  }
}
