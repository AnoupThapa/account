/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Injectable, OnModuleInit, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AppError, DocType, DOC_TYPES, zAdDate } from '@ledgerpro/shared';
import { DatabaseService } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { Ctx, Perm, Zod } from '../../common/decorators';
import { DocumentRegistry } from '../approvals/documents';
import { ApprovalService } from '../approvals/approval.service';
import { LedgerService } from '../ledger/ledger.service';

const createSchema = z.object({
  targetType: z.string(),
  targetId: z.string().uuid(),
  correctionDate: zAdDate,
  reason: z.string().min(3, 'Give a reason').max(1000),
  submit: z.boolean().default(true),
});

/**
 * Reversal & cancellation (docs/02 §10, docs/06 §4): a correction request is itself a
 * maker–checker document. On approval, the target's ledger entry is reversed (mirror entry, linked),
 * the target becomes CANCELLED (number kept, reason shown) or REVERSED.
 */
@Injectable()
export class CorrectionsService implements OnModuleInit {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly audit: AuditService,
    private readonly registry: DocumentRegistry,
    private readonly approvals: ApprovalService,
    private readonly ledger: LedgerService,
  ) {}

  onModuleInit() {
    const self = this;
    this.registry.register({
      docType: 'CORRECTION',
      table: 'correction_requests',
      dateField: 'correction_date',
      amountField: 'total',
      describe: (doc) => `${doc.kind === 'CANCEL' ? 'Cancel' : 'Reverse'} ${doc.target_ref ?? ''}`,
      async validate(trx, ctx, doc) {
        const th = self.registry.get(doc.target_type);
        const target = await self.registry.lock(trx, doc.target_type, doc.target_id);
        if (target.status !== 'POSTED') throw new AppError('APR_INVALID_STATE', `${doc.target_ref} is ${target.status.toLowerCase()}, not posted`);
        if (!th.correction || th.correction.kind !== doc.kind) throw new AppError('APR_INVALID_STATE', `This document can't be ${doc.kind === 'CANCEL' ? 'cancelled' : 'reversed'} — use ${th.correction?.kind === 'CANCEL' ? 'cancel' : 'a credit/debit note'} instead`);
        await th.correction.check(trx, ctx, target);
      },
      async preview(trx, _ctx, doc) {
        const target = await self.registry.load(trx, doc.target_type, doc.target_id);
        if (!target.journal_entry_id) return [];
        const lines = await trx.selectFrom('journal_lines').selectAll().where('entry_id', '=', target.journal_entry_id).orderBy('line_no').execute();
        return lines.map((l) => ({ accountId: l.account_id, debit: l.credit, credit: l.debit, contactId: l.contact_id, itemId: l.item_id, costCentreId: l.cost_centre_id, projectId: l.project_id, taxCodeId: l.tax_code_id, description: l.description }));
      },
      async post(trx, ctx, doc) {
        const th = self.registry.get(doc.target_type);
        const target = await self.registry.lock(trx, doc.target_type, doc.target_id);
        let entryId: string | null = null;
        if (target.journal_entry_id) {
          const rev = await self.ledger.reverse(trx, ctx, target.journal_entry_id, doc.correction_date, doc.reason, 'REVERSAL', doc.id, doc.doc_no);
          entryId = rev.id;
        }
        const now = new Date();
        if (doc.kind === 'CANCEL') {
          await self.registry.update(trx, doc.target_type, doc.target_id, { status: 'CANCELLED', cancel_reason: doc.reason, cancelled_at: now, cancelled_by: ctx.userId, reversal_entry_id: entryId, reversed_at: now });
        } else {
          await self.registry.update(trx, doc.target_type, doc.target_id, { status: 'REVERSED', reversal_entry_id: entryId, reversed_at: now });
        }
        await self.audit.log(trx, ctx, doc.kind === 'CANCEL' ? 'CANCEL' : 'REVERSE', doc.target_type.toLowerCase(), doc.target_id, { status: 'POSTED' }, { status: doc.kind === 'CANCEL' ? 'CANCELLED' : 'REVERSED', reason: doc.reason, correction: doc.doc_no });
        if (th.correction?.after) await th.correction.after(trx, ctx, target);
        return { entryId };
      },
    });
  }

  async create(ctx: CompanyContext, b: z.infer<typeof createSchema>) {
    if (!(b.targetType in DOC_TYPES) || b.targetType === 'CORRECTION') throw new AppError('VAL_FIELD', 'Unknown document type');
    const th = this.registry.get(b.targetType);
    if (!th.correction) throw new AppError('APR_INVALID_STATE', 'This document type cannot be corrected this way');
    const viewPerm = `${this.registry.perm(b.targetType)}.view`;
    if (!ctx.permissions.has(viewPerm)) throw new AppError('PERM_DENIED');
    const id = await this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const target = await this.registry.load(trx, b.targetType, b.targetId);
      if (target.status !== 'POSTED') throw new AppError('APR_INVALID_STATE', `Only posted documents can be corrected (this one is ${target.status.toLowerCase()})`);
      const pending = await trx.selectFrom('correction_requests').select('id').where('target_id', '=', b.targetId).where('status', 'in', ['DRAFT', 'SUBMITTED']).executeTakeFirst();
      if (pending) throw new AppError('APR_INVALID_STATE', 'A correction for this document is already pending');
      await th.correction!.check(trx, ctx, target);
      const total = (await trx.selectFrom('journal_entries').select('total').where('id', '=', target.journal_entry_id ?? '00000000-0000-0000-0000-000000000000').executeTakeFirst())?.total ?? '0';
      const row = await trx
        .insertInto('correction_requests')
        .values({
          company_id: ctx.companyId,
          kind: th.correction!.kind,
          target_type: b.targetType,
          target_id: b.targetId,
          target_ref: target.doc_no ?? null,
          correction_date: b.correctionDate,
          reason: b.reason,
          total,
          created_by: ctx.userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'correction', row.id, null, b);
      return row.id;
    });
    if (b.submit) {
      const r = await this.approvals.submit(ctx, 'CORRECTION' as DocType, id);
      return { id, ...r };
    }
    return { id, status: 'DRAFT' };
  }

  list(ctx: CompanyContext, targetId?: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) =>
      trx.selectFrom('correction_requests').selectAll().$if(!!targetId, (q) => q.where('target_id', '=', targetId!)).orderBy('created_at', 'desc').limit(500).execute(),
    );
  }
}

@Controller('corrections')
export class CorrectionsController {
  constructor(private readonly svc: CorrectionsService) {}

  @Perm('correction.create')
  @Post()
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(createSchema)) b: z.infer<typeof createSchema>) {
    return this.svc.create(ctx, b);
  }

  @Perm('correction.view')
  @Get()
  list(@Ctx() ctx: CompanyContext, @Query('targetId') targetId?: string) {
    return this.svc.list(ctx, targetId);
  }
}
