import { Injectable } from '@nestjs/common';
import { AppError, d, DocType, money } from '@ledgerpro/shared';
import { DatabaseService, Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../settings/numbering.service';
import { DocRow, DocumentRegistry } from './documents';
import { LedgerService } from '../ledger/ledger.service';

interface StepSnap {
  stepNo: number;
  name: string;
  roleId: string | null;
  minAmount: string;
}

/**
 * Maker–checker engine (docs/06 §4): Draft → Submitted → Approved → Posted, Rejected → Draft.
 * Posting happens in the SAME transaction as the final approval.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly registry: DocumentRegistry,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private requirePerm(ctx: CompanyContext, docType: string, action: 'create' | 'approve' | 'view') {
    const p = `${this.registry.perm(docType)}.${action}`;
    if (!ctx.permissions.has(p)) throw new AppError('PERM_DENIED', `You need permission "${p}"`);
  }

  async preview(ctx: CompanyContext, docType: DocType, id: string) {
    this.requirePerm(ctx, docType, 'view');
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const h = this.registry.get(docType);
      const doc = await this.registry.load(trx, docType, id);
      const lines = await h.preview(trx, ctx, doc);
      const accts = lines.length ? await trx.selectFrom('accounts').select(['id', 'code', 'name']).where('id', 'in', [...new Set(lines.map((l) => l.accountId))]).execute() : [];
      return lines.map((l) => ({ ...l, accountCode: accts.find((a) => a.id === l.accountId)?.code, accountName: accts.find((a) => a.id === l.accountId)?.name }));
    });
  }

  /** Maker submits a draft. Validates fully (balanced, open period, tax…) before anyone is asked to approve. */
  async submit(ctx: CompanyContext, docType: DocType, id: string) {
    this.requirePerm(ctx, docType, 'create');
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) => this.submitInTx(trx, ctx, docType, id));
  }

  async submitInTx(trx: Tx, ctx: CompanyContext, docType: DocType, id: string) {
    const h = this.registry.get(docType);
    const doc = await this.registry.lock(trx, docType, id);
    if (!['DRAFT', 'REJECTED'].includes(doc.status)) throw new AppError('APR_INVALID_STATE', `This document is already ${doc.status.toLowerCase()}`);
    await h.validate(trx, ctx, doc);
    const lines = await h.preview(trx, ctx, doc);
    if (lines.length) LedgerService.assertBalanced(lines);
    const amount = money(doc[h.amountField] ?? 0);
    const wf = await trx.selectFrom('approval_workflows').selectAll().where('doc_type', '=', docType).where('is_active', '=', true).executeTakeFirst();
    const steps: StepSnap[] = wf
      ? (await trx.selectFrom('approval_steps').selectAll().where('workflow_id', '=', wf.id).orderBy('step_no').execute())
          .filter((s) => d(amount).gte(s.min_amount))
          .map((s) => ({ stepNo: s.step_no, name: s.name, roleId: s.role_id, minAmount: s.min_amount }))
      : [{ stepNo: 1, name: 'Approval', roleId: null, minAmount: '0' }];

    await this.registry.update(trx, docType, id, { status: 'SUBMITTED', submitted_at: new Date(), updated_by: ctx.userId });
    await this.audit.log(trx, ctx, 'SUBMIT', docType.toLowerCase(), id, { status: doc.status }, { status: 'SUBMITTED', amount });

    if (wf?.auto_approve || steps.length === 0) {
      // Admin-configured low-risk document type: approved by policy (logged), still posted by the system
      const posted = await this.finalize(trx, ctx, docType, id, null);
      return { status: 'POSTED', autoApproved: true, docNo: posted.doc_no };
    }
    const req = await trx
      .insertInto('approval_requests')
      .values({
        company_id: ctx.companyId,
        doc_type: docType,
        doc_id: id,
        doc_ref: h.describe(doc).slice(0, 60),
        amount,
        workflow_id: wf?.id ?? null,
        current_step: 1,
        total_steps: steps.length,
        steps: JSON.stringify(steps),
        status: 'PENDING',
        submitted_by: ctx.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await trx.insertInto('approval_actions').values({ company_id: ctx.companyId, request_id: req.id, step_no: 0, action: 'SUBMIT', acted_by: ctx.userId }).execute();
    await trx
      .insertInto('integration_outbox')
      .values({ company_id: ctx.companyId, target: 'NOTIFY', event_type: 'APPROVAL_REQUESTED', payload: JSON.stringify({ requestId: req.id, docType, docId: id, step: steps[0] }) })
      .execute();
    return { status: 'SUBMITTED', requestId: req.id, steps: steps.length };
  }

  /** Can this user act on the current step? Returns a reason when not. */
  private async approverCheck(trx: Tx, ctx: CompanyContext, req: { submitted_by: string; amount: string; doc_type: string; current_step: number; steps: unknown; id: string }) {
    const perm = `${this.registry.perm(req.doc_type)}.approve`;
    if (!ctx.permissions.has(perm)) return { ok: false as const, code: 'PERM_DENIED' as const, msg: `You need permission "${perm}"` };
    const company = await trx.selectFrom('companies').select('self_approval_allowed').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    if (req.submitted_by === ctx.userId && !company.self_approval_allowed) return { ok: false as const, code: 'APR_SELF_APPROVAL' as const, msg: "You can't approve your own entry" };
    const step = (req.steps as StepSnap[])[req.current_step - 1];
    if (step?.roleId && !ctx.roleIds.includes(step.roleId)) return { ok: false as const, code: 'APR_NOT_APPROVER' as const, msg: `Step "${step.name}" needs a different role` };
    // A person approves at most one step of the same request
    const already = await trx.selectFrom('approval_actions').select('id').where('request_id', '=', req.id).where('action', '=', 'APPROVE').where('acted_by', '=', ctx.userId).executeTakeFirst();
    if (already && !company.self_approval_allowed) return { ok: false as const, code: 'APR_NOT_APPROVER' as const, msg: 'You already approved an earlier step of this document' };
    const roles = ctx.roleIds.length ? await trx.selectFrom('roles').select('approval_limit').where('id', 'in', ctx.roleIds).execute() : [];
    const limits = roles.map((r) => r.approval_limit);
    if (limits.length && limits.every((l) => l !== null) && d(req.amount).gt(limits.reduce((m, l) => (d(l!).gt(m) ? l! : m), '0'))) {
      return { ok: false as const, code: 'APR_LIMIT_EXCEEDED' as const, msg: 'Amount is above your approval limit — needs approval from a higher level' };
    }
    return { ok: true as const };
  }

  async approve(ctx: CompanyContext, requestId: string, comment?: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const req = await trx.selectFrom('approval_requests').selectAll().where('id', '=', requestId).forUpdate().executeTakeFirst();
      if (!req) throw new AppError('NOT_FOUND');
      if (req.status !== 'PENDING') throw new AppError('APR_INVALID_STATE', `This request is already ${req.status.toLowerCase()}`);
      const doc = await this.registry.lock(trx, req.doc_type, req.doc_id);
      if (doc.status !== 'SUBMITTED') throw new AppError('APR_INVALID_STATE', `This document is ${doc.status.toLowerCase()}`);
      const chk = await this.approverCheck(trx, ctx, req);
      if (!chk.ok) throw new AppError(chk.code, chk.msg);
      await trx.insertInto('approval_actions').values({ company_id: ctx.companyId, request_id: req.id, step_no: req.current_step, action: 'APPROVE', acted_by: ctx.userId, comment: comment ?? null }).execute();
      await this.audit.log(trx, ctx, 'APPROVE', req.doc_type.toLowerCase(), req.doc_id, { step: req.current_step }, { step: req.current_step, of: req.total_steps, comment });
      if (req.current_step < req.total_steps) {
        await trx.updateTable('approval_requests').set({ current_step: req.current_step + 1 }).where('id', '=', req.id).execute();
        return { status: 'SUBMITTED', nextStep: req.current_step + 1, of: req.total_steps };
      }
      await trx.updateTable('approval_requests').set({ status: 'APPROVED', completed_at: new Date() }).where('id', '=', req.id).execute();
      const posted = await this.finalize(trx, ctx, req.doc_type as DocType, req.doc_id, ctx.userId);
      return { status: 'POSTED', docNo: posted.doc_no, journalEntryId: posted.journal_entry_id };
    });
  }

  /** Approved → number assigned (gapless) → ledger posting → POSTED, all in one transaction. */
  async finalize(trx: Tx, ctx: CompanyContext, docType: DocType, id: string, approvedBy: string | null): Promise<DocRow> {
    const h = this.registry.get(docType);
    const doc = await this.registry.lock(trx, docType, id);
    await h.validate(trx, ctx, doc); // re-check at posting time (period may have been locked meanwhile)
    const docNo = doc.doc_no ?? (await this.numbering.next(trx, ctx.companyId, docType, doc[h.dateField]));
    await this.registry.update(trx, docType, id, { status: 'APPROVED', approved_by: approvedBy, approved_at: new Date(), doc_no: docNo, updated_by: ctx.userId });
    const fresh = await this.registry.load(trx, docType, id);
    const r = await h.post(trx, ctx, fresh, approvedBy);
    await this.registry.update(trx, docType, id, { status: 'POSTED', posted_at: new Date(), journal_entry_id: r.entryId });
    await this.audit.log(trx, ctx, 'POST', docType.toLowerCase(), id, { status: 'APPROVED' }, { status: 'POSTED', docNo, journalEntryId: r.entryId });
    await trx
      .insertInto('integration_outbox')
      .values({ company_id: ctx.companyId, target: 'NOTIFY', event_type: 'DOCUMENT_POSTED', payload: JSON.stringify({ docType, docId: id, docNo, maker: doc.created_by }) })
      .execute();
    return this.registry.load(trx, docType, id);
  }

  async reject(ctx: CompanyContext, requestId: string, reason: string) {
    if (!reason?.trim()) throw new AppError('VAL_FIELD', 'A reason is required to reject', undefined, [{ field: 'reason', message: 'Required' }]);
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const req = await trx.selectFrom('approval_requests').selectAll().where('id', '=', requestId).forUpdate().executeTakeFirst();
      if (!req) throw new AppError('NOT_FOUND');
      if (req.status !== 'PENDING') throw new AppError('APR_INVALID_STATE', `This request is already ${req.status.toLowerCase()}`);
      const perm = `${this.registry.perm(req.doc_type)}.approve`;
      if (!ctx.permissions.has(perm)) throw new AppError('PERM_DENIED');
      await this.registry.lock(trx, req.doc_type, req.doc_id);
      await trx.insertInto('approval_actions').values({ company_id: ctx.companyId, request_id: req.id, step_no: req.current_step, action: 'REJECT', acted_by: ctx.userId, comment: reason }).execute();
      await trx.updateTable('approval_requests').set({ status: 'REJECTED', completed_at: new Date() }).where('id', '=', req.id).execute();
      await this.registry.update(trx, req.doc_type, req.doc_id, { status: 'REJECTED', updated_by: ctx.userId });
      await this.audit.log(trx, ctx, 'REJECT', req.doc_type.toLowerCase(), req.doc_id, { status: 'SUBMITTED' }, { status: 'REJECTED', reason });
      await trx
        .insertInto('integration_outbox')
        .values({ company_id: ctx.companyId, target: 'NOTIFY', event_type: 'DOCUMENT_REJECTED', payload: JSON.stringify({ docType: req.doc_type, docId: req.doc_id, reason, maker: req.submitted_by }) })
        .execute();
      return { status: 'REJECTED' };
    });
  }

  /** Maker pulls a submitted document back to Draft (also used automatically when a submitted doc is edited). */
  async withdrawInTx(trx: Tx, ctx: CompanyContext, docType: string, docId: string) {
    const req = await trx.selectFrom('approval_requests').selectAll().where('doc_type', '=', docType).where('doc_id', '=', docId).where('status', '=', 'PENDING').forUpdate().executeTakeFirst();
    if (req) {
      await trx.insertInto('approval_actions').values({ company_id: ctx.companyId, request_id: req.id, step_no: req.current_step, action: 'WITHDRAW', acted_by: ctx.userId }).execute();
      await trx.updateTable('approval_requests').set({ status: 'WITHDRAWN', completed_at: new Date() }).where('id', '=', req.id).execute();
    }
    await this.registry.update(trx, docType, docId, { status: 'DRAFT', updated_by: ctx.userId });
    await this.audit.log(trx, ctx, 'WITHDRAW', docType.toLowerCase(), docId, { status: 'SUBMITTED' }, { status: 'DRAFT' });
  }

  async withdraw(ctx: CompanyContext, docType: DocType, docId: string) {
    this.requirePerm(ctx, docType, 'create');
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await this.registry.lock(trx, docType, docId);
      if (doc.status !== 'SUBMITTED') throw new AppError('APR_INVALID_STATE', 'Only submitted documents can be withdrawn');
      await this.withdrawInTx(trx, ctx, docType, docId);
      return { status: 'DRAFT' };
    });
  }

  /** Pending approvals with "can I approve?" for the current user. */
  async queue(ctx: CompanyContext, mineOnly = false) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const rows = await trx
        .selectFrom('approval_requests')
        .innerJoin('users', 'users.id', 'approval_requests.submitted_by')
        .selectAll('approval_requests')
        .select('users.full_name as submitted_by_name')
        .where('status', '=', 'PENDING')
        .orderBy('submitted_at')
        .execute();
      const out = [];
      for (const r of rows) {
        const chk = await this.approverCheck(trx, ctx, r);
        if (mineOnly && !chk.ok) continue;
        const step = (r.steps as unknown as StepSnap[])[r.current_step - 1];
        out.push({ ...r, stepName: step?.name, canApprove: chk.ok, reason: chk.ok ? null : chk.msg });
      }
      return out;
    });
  }

  async history(ctx: CompanyContext, docType: string, docId: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) =>
      trx
        .selectFrom('approval_actions')
        .innerJoin('approval_requests', 'approval_requests.id', 'approval_actions.request_id')
        .innerJoin('users', 'users.id', 'approval_actions.acted_by')
        .select(['approval_actions.id', 'approval_actions.action', 'approval_actions.step_no', 'approval_actions.comment', 'approval_actions.acted_at', 'users.full_name as by'])
        .where('approval_requests.doc_type', '=', docType)
        .where('approval_requests.doc_id', '=', docId)
        .orderBy('approval_actions.acted_at')
        .execute(),
    );
  }
}

