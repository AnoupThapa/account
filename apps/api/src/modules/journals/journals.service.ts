/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppError, d, money, sum, ManualJournalInput, formatMoney } from '@ledgerpro/shared';
import { DatabaseService, Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { DocHandler, DocRow, DocumentRegistry } from '../approvals/documents';
import { ApprovalService } from '../approvals/approval.service';
import { BuiltLine, LedgerService, PostingComponent } from '../ledger/ledger.service';
import { FiscalService } from '../settings/fiscal.service';

@Injectable()
export class JournalsService implements OnModuleInit {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly audit: AuditService,
    private readonly registry: DocumentRegistry,
    private readonly approvals: ApprovalService,
    private readonly ledger: LedgerService,
    private readonly fiscal: FiscalService,
  ) {}

  onModuleInit() {
    const self = this;
    const handler: DocHandler = {
      docType: 'MANUAL_JOURNAL',
      table: 'manual_journals',
      dateField: 'journal_date',
      amountField: 'total',
      describe: (doc) => `Journal: ${String(doc.narration).slice(0, 40)}`,
      async validate(trx, ctx, doc) {
        const lines = await trx.selectFrom('manual_journal_lines').selectAll().where('journal_id', '=', doc.id).orderBy('line_no').execute();
        await self.validateLines(trx, ctx, lines.map((l) => ({ accountId: l.account_id, debit: l.debit, credit: l.credit, contactId: l.contact_id })), doc.created_by === ctx.userId);
        await self.fiscal.periodFor(trx, ctx.companyId, doc.journal_date);
      },
      preview: (trx, ctx, doc) => self.buildLines(trx, ctx, doc),
      async post(trx, ctx, doc, approvedBy) {
        const lines = await self.buildLines(trx, ctx, doc);
        const e = await self.ledger.postLines(trx, ctx, {
          sourceType: 'MANUAL_JOURNAL',
          sourceId: doc.id,
          sourceNo: doc.doc_no,
          entryDate: doc.journal_date,
          narration: doc.narration,
          branchId: doc.branch_id,
          approvedBy,
          components: [],
        }, lines);
        return { entryId: e.id };
      },
      correction: {
        kind: 'REVERSE',
        async check() {
          /* manual journals can always be reversed */
        },
      },
    };
    this.registry.register(handler);
  }

  private async buildLines(trx: Tx, ctx: CompanyContext, doc: DocRow): Promise<BuiltLine[]> {
    const lines = await trx.selectFrom('manual_journal_lines').selectAll().where('journal_id', '=', doc.id).orderBy('line_no').execute();
    const comps: PostingComponent[] = lines.map((l) => ({
      role: d(l.debit).gt(0) ? 'LINE_DEBIT' : 'LINE_CREDIT',
      amount: d(l.debit).gt(0) ? l.debit : l.credit,
      accountId: l.account_id,
      contactId: l.contact_id,
      costCentreId: l.cost_centre_id,
      description: l.description,
    }));
    return this.ledger.buildLines(trx, ctx.companyId, 'MANUAL_JOURNAL', comps);
  }

  /** Balanced, ledger accounts only, control accounts need a contact AND journal.post_control (docs/02 §2.8). */
  async validateLines(trx: Tx, ctx: CompanyContext, lines: { accountId: string; debit: string; credit: string; contactId?: string | null }[], checkMakerPerms = true) {
    if (lines.length < 2) throw new AppError('ACC_UNBALANCED', 'A journal needs at least two lines');
    for (const [i, l] of lines.entries()) {
      if (d(l.debit).gt(0) === d(l.credit).gt(0)) throw new AppError('VAL_FIELD', `Line ${i + 1}: enter either a debit or a credit`, undefined, [{ field: `lines.${i}`, message: 'Debit or credit (not both)' }]);
    }
    const dr = sum(lines.map((l) => l.debit));
    const cr = sum(lines.map((l) => l.credit));
    if (!dr.eq(cr)) throw new AppError('ACC_UNBALANCED', `Debits and credits must be equal (difference: ${formatMoney(dr.minus(cr).abs())})`, { difference: money(dr.minus(cr)) });
    const accts = await trx.selectFrom('accounts').selectAll().where('id', 'in', [...new Set(lines.map((l) => l.accountId))]).execute();
    for (const [i, l] of lines.entries()) {
      const a = accts.find((x) => x.id === l.accountId);
      if (!a) throw new AppError('VAL_FIELD', `Line ${i + 1}: unknown account`);
      if (!a.is_active) throw new AppError('ACC_ACCOUNT_INACTIVE', `Line ${i + 1}: ${a.code} ${a.name} is inactive`);
      if (!a.is_postable) throw new AppError('ACC_NOT_POSTABLE', `Line ${i + 1}: ${a.code} ${a.name} is a heading`);
      if ((a.is_control || a.requires_contact) && checkMakerPerms && !ctx.permissions.has('journal.post_control')) {
        throw new AppError('ACC_CONTROL_ACCOUNT', `${a.code} ${a.name} is a control account — post it through invoices/bills, or ask for the "journal.post_control" permission`);
      }
      if (a.requires_contact && !l.contactId) throw new AppError('ACC_CONTROL_ACCOUNT', `Line ${i + 1}: select a customer/supplier for ${a.code} ${a.name}`, undefined, [{ field: `lines.${i}.contactId`, message: 'Required for this account' }]);
    }
    return money(dr);
  }

  list(ctx: CompanyContext, status?: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) =>
      trx
        .selectFrom('manual_journals')
        .innerJoin('users', 'users.id', 'manual_journals.created_by')
        .selectAll('manual_journals')
        .select('users.full_name as created_by_name')
        .$if(!!status, (q) => q.where('status', '=', status!))
        .orderBy('journal_date', 'desc')
        .orderBy('created_at', 'desc')
        .limit(500)
        .execute(),
    );
  }

  get(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const j = await trx.selectFrom('manual_journals').selectAll().where('id', '=', id).executeTakeFirst();
      if (!j) throw new AppError('NOT_FOUND');
      const lines = await trx
        .selectFrom('manual_journal_lines')
        .innerJoin('accounts', 'accounts.id', 'manual_journal_lines.account_id')
        .leftJoin('contacts', 'contacts.id', 'manual_journal_lines.contact_id')
        .selectAll('manual_journal_lines')
        .select(['accounts.code as account_code', 'accounts.name as account_name', 'contacts.name as contact_name'])
        .where('journal_id', '=', id)
        .orderBy('line_no')
        .execute();
      return { ...j, lines };
    });
  }

  async create(ctx: CompanyContext, input: ManualJournalInput) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const total = await this.validateLines(trx, ctx, input.lines);
      const j = await trx
        .insertInto('manual_journals')
        .values({ company_id: ctx.companyId, branch_id: input.branchId ?? null, journal_date: input.journalDate, reference: input.reference ?? null, narration: input.narration, total, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.insertLines(trx, ctx, j.id, input);
      await this.audit.log(trx, ctx, 'CREATE', 'manual_journal', j.id, null, input);
      return j;
    });
  }

  private async insertLines(trx: Tx, ctx: CompanyContext, id: string, input: ManualJournalInput) {
    await trx
      .insertInto('manual_journal_lines')
      .values(
        input.lines.map((l, i) => ({
          company_id: ctx.companyId,
          journal_id: id,
          line_no: i + 1,
          account_id: l.accountId,
          debit: money(l.debit),
          credit: money(l.credit),
          contact_id: l.contactId ?? null,
          cost_centre_id: l.costCentreId ?? null,
          description: l.description ?? null,
        })),
      )
      .execute();
  }

  /** Editing a submitted journal sends it back to Draft (docs/06 §4.4). */
  async update(ctx: CompanyContext, id: string, input: ManualJournalInput & { version: number }) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const j = await this.registry.lock(trx, 'MANUAL_JOURNAL', id);
      if (j.version !== input.version) throw new AppError('DOC_VERSION_CONFLICT');
      if (j.status === 'SUBMITTED') await this.approvals.withdrawInTx(trx, ctx, 'MANUAL_JOURNAL', id);
      else if (!['DRAFT', 'REJECTED'].includes(j.status)) throw new AppError('ACC_IMMUTABLE');
      const total = await this.validateLines(trx, ctx, input.lines);
      const before = { ...j, lines: await trx.selectFrom('manual_journal_lines').selectAll().where('journal_id', '=', id).execute() };
      await trx.deleteFrom('manual_journal_lines').where('journal_id', '=', id).execute();
      await this.insertLines(trx, ctx, id, input);
      const after = await trx
        .updateTable('manual_journals')
        .set({ journal_date: input.journalDate, branch_id: input.branchId ?? null, reference: input.reference ?? null, narration: input.narration, total, status: 'DRAFT', updated_by: ctx.userId })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', 'manual_journal', id, before, input);
      return after;
    });
  }

  async remove(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const j = await this.registry.lock(trx, 'MANUAL_JOURNAL', id);
      if (!['DRAFT', 'REJECTED'].includes(j.status)) throw new AppError('ACC_IMMUTABLE', 'Only drafts can be deleted');
      await trx.deleteFrom('manual_journals').where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'DELETE', 'manual_journal', id, j, null);
      return { ok: true };
    });
  }
}
