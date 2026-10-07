/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError, DocType, DOC_TYPES, zMoneyNonNeg } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { ApprovalService } from './approval.service';

const commentSchema = z.object({ comment: z.string().max(1000).optional() });
const rejectSchema = z.object({ reason: z.string().min(1, 'A reason is required').max(1000) });
const workflowSchema = z.object({
  autoApprove: z.boolean().optional(),
  isActive: z.boolean().optional(),
  steps: z
    .array(z.object({ name: z.string().min(1).max(80), roleId: z.string().uuid().nullish(), minAmount: zMoneyNonNeg.default('0') }))
    .min(1)
    .max(5)
    .optional(),
});

function docType(t: string): DocType {
  if (!(t in DOC_TYPES)) throw new AppError('NOT_FOUND', 'Unknown document type');
  return t as DocType;
}

@Controller()
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalService, private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  @Perm('approval.view')
  @Get('approvals')
  queue(@Ctx() ctx: CompanyContext, @Query('mine') mine?: string) {
    return this.approvals.queue(ctx, mine === 'true');
  }

  @Perm('approval.view')
  @Post('approvals/:id/approve')
  approve(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(commentSchema)) b: z.infer<typeof commentSchema>) {
    return this.approvals.approve(ctx, id, b.comment);
  }

  @Perm('approval.view')
  @Post('approvals/:id/reject')
  reject(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(rejectSchema)) b: z.infer<typeof rejectSchema>) {
    return this.approvals.reject(ctx, id, b.reason);
  }

  /** Generic document actions; permission `<doc>.create` / `<doc>.view` is checked inside. */
  @Perm('member')
  @Post('documents/:type/:id/submit')
  submit(@Ctx() ctx: CompanyContext, @Param('type') t: string, @Param('id') id: string) {
    return this.approvals.submit(ctx, docType(t), id);
  }

  @Perm('member')
  @Post('documents/:type/:id/withdraw')
  withdraw(@Ctx() ctx: CompanyContext, @Param('type') t: string, @Param('id') id: string) {
    return this.approvals.withdraw(ctx, docType(t), id);
  }

  @Perm('member')
  @Get('documents/:type/:id/journal-preview')
  preview(@Ctx() ctx: CompanyContext, @Param('type') t: string, @Param('id') id: string) {
    return this.approvals.preview(ctx, docType(t), id);
  }

  @Perm('approval.view')
  @Get('documents/:type/:id/history')
  history(@Ctx() ctx: CompanyContext, @Param('type') t: string, @Param('id') id: string) {
    return this.approvals.history(ctx, docType(t), id);
  }

  // -------------------------------------------------- workflow configuration
  @Perm('workflow.manage')
  @Get('approval-workflows')
  workflows(@Ctx() ctx: CompanyContext) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const wfs = await trx.selectFrom('approval_workflows').selectAll().orderBy('doc_type').execute();
      const steps = await trx.selectFrom('approval_steps').selectAll().orderBy('step_no').execute();
      return wfs.map((w) => ({ ...w, steps: steps.filter((s) => s.workflow_id === w.id) }));
    });
  }

  @Perm('workflow.manage')
  @Patch('approval-workflows/:id')
  updateWorkflow(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(workflowSchema)) b: z.infer<typeof workflowSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const wf = await trx.selectFrom('approval_workflows').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!wf) throw new AppError('NOT_FOUND');
      const beforeSteps = await trx.selectFrom('approval_steps').selectAll().where('workflow_id', '=', id).orderBy('step_no').execute();
      await trx.updateTable('approval_workflows').set({ auto_approve: b.autoApprove ?? wf.auto_approve, is_active: b.isActive ?? wf.is_active, updated_by: ctx.userId }).where('id', '=', id).execute();
      if (b.steps) {
        await trx.deleteFrom('approval_steps').where('workflow_id', '=', id).execute();
        await trx
          .insertInto('approval_steps')
          .values(b.steps.map((s, i) => ({ company_id: ctx.companyId, workflow_id: id, step_no: i + 1, name: s.name, role_id: s.roleId ?? null, min_amount: s.minAmount })))
          .execute();
      }
      await this.audit.log(trx, ctx, 'SETTING_CHANGED', 'approval_workflow', id, { ...wf, steps: beforeSteps }, b);
      return { ok: true };
    });
  }
}
