/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { AppError, companyCreateSchema } from '@ledgerpro/shared';
import { Ctx, NoCompany, Perm, StepUp, SuperAdminOnly, Zod } from '../../common/decorators';
import type { CompanyContext, RequestContext } from '../../common/context';
import { DatabaseService } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { ProvisioningService } from './provisioning.service';

const createSchema = companyCreateSchema.extend({ adminUserIds: z.array(z.string().uuid()).optional() });
const updateSchema = z.object({
  name: z.string().min(2).max(150).optional(),
  legalName: z.string().max(200).optional(),
  pan: z.string().max(20).nullish(),
  vatNo: z.string().max(20).nullish(),
  abn: z.string().max(20).nullish(),
  address: z.string().max(500).nullish(),
  phone: z.string().max(40).nullish(),
  email: z.string().email().nullish().or(z.literal('')),
  timezone: z.string().max(60).optional(),
  taxRounding: z.enum(['LINE', 'DOCUMENT']).optional(),
  version: z.number().int(),
});
const controlsSchema = z.object({
  selfApprovalAllowed: z.boolean().optional(),
  enforce2faAll: z.boolean().optional(),
  version: z.number().int(),
});
const branchSchema = z.object({ code: z.string().min(1).max(20), name: z.string().min(1).max(150), address: z.string().max(500).nullish(), isActive: z.boolean().optional() });

@Controller('companies')
export class CompaniesController {
  constructor(private readonly prov: ProvisioningService, private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  @NoCompany()
  @SuperAdminOnly()
  @Post()
  async create(@Ctx() ctx: RequestContext, @Body(new Zod(createSchema)) body: z.infer<typeof createSchema>) {
    return this.prov.createCompany(ctx, body);
  }

  @Perm('member')
  @Get('current')
  current(@Ctx() ctx: CompanyContext) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) => trx.selectFrom('companies').selectAll().where('id', '=', ctx.companyId).executeTakeFirstOrThrow());
  }

  @Perm('company.manage')
  @Patch('current')
  update(@Ctx() ctx: CompanyContext, @Body(new Zod(updateSchema)) b: z.infer<typeof updateSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const before = await trx.selectFrom('companies').selectAll().where('id', '=', ctx.companyId).forUpdate().executeTakeFirstOrThrow();
      if (before.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
      const after = await trx
        .updateTable('companies')
        .set({
          name: b.name ?? before.name,
          legal_name: b.legalName ?? before.legal_name,
          pan: b.pan === undefined ? before.pan : b.pan,
          vat_no: b.vatNo === undefined ? before.vat_no : b.vatNo,
          abn: b.abn === undefined ? before.abn : b.abn,
          address: b.address === undefined ? before.address : b.address,
          phone: b.phone === undefined ? before.phone : b.phone,
          email: b.email === undefined ? before.email : b.email || null,
          timezone: b.timezone ?? before.timezone,
          tax_rounding: b.taxRounding ?? before.tax_rounding,
          updated_by: ctx.userId,
        })
        .where('id', '=', ctx.companyId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'company', ctx.companyId, before, after);
      return after;
    });
  }

  /** Control settings (self-approval for single-user companies, 2FA for everyone) — sensitive: step-up required. */
  @Perm('company.manage')
  @StepUp()
  @Patch('current/controls')
  controls(@Ctx() ctx: CompanyContext, @Body(new Zod(controlsSchema)) b: z.infer<typeof controlsSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const before = await trx.selectFrom('companies').selectAll().where('id', '=', ctx.companyId).forUpdate().executeTakeFirstOrThrow();
      if (before.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
      const after = await trx
        .updateTable('companies')
        .set({
          self_approval_allowed: b.selfApprovalAllowed ?? before.self_approval_allowed,
          enforce_2fa_all: b.enforce2faAll ?? before.enforce_2fa_all,
          updated_by: ctx.userId,
        })
        .where('id', '=', ctx.companyId)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'SETTING_CHANGED', 'company_controls', ctx.companyId,
        { selfApprovalAllowed: before.self_approval_allowed, enforce2faAll: before.enforce_2fa_all },
        { selfApprovalAllowed: after.self_approval_allowed, enforce2faAll: after.enforce_2fa_all });
      return after;
    });
  }

  @Perm('member')
  @Get('current/branches')
  branches(@Ctx() ctx: CompanyContext) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) => trx.selectFrom('branches').selectAll().orderBy('code').execute());
  }

  @Perm('branch.manage')
  @Post('current/branches')
  createBranch(@Ctx() ctx: CompanyContext, @Body(new Zod(branchSchema)) b: z.infer<typeof branchSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const row = await trx
        .insertInto('branches')
        .values({ company_id: ctx.companyId, code: b.code.toUpperCase(), name: b.name, address: b.address ?? null, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'branch', row.id, null, row);
      return row;
    });
  }

  @Perm('branch.manage')
  @Patch('current/branches/:id')
  updateBranch(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(branchSchema.partial())) b: Partial<z.infer<typeof branchSchema>>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const before = await trx.selectFrom('branches').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw new AppError('NOT_FOUND');
      const after = await trx
        .updateTable('branches')
        .set({ name: b.name ?? before.name, address: b.address === undefined ? before.address : b.address, is_active: b.isActive ?? before.is_active, updated_by: ctx.userId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'branch', id, before, after);
      return after;
    });
  }
}

