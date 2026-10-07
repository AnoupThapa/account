import { Body, Controller, Delete, Get, Injectable, OnModuleInit, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { sql } from 'kysely';
import { AppError, d, money, sum, zAdDate, zMoneyNonNeg, formatMoney, DocType } from '@ledgerpro/shared';
import { DatabaseService, Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { Ctx, Perm, Zod } from '../../common/decorators';
import { DocRow, DocumentRegistry } from '../approvals/documents';
import { ApprovalService } from '../approvals/approval.service';
import { LedgerService, PostingComponent } from '../ledger/ledger.service';
import { JournalsService } from '../journals/journals.service';

const lineSchema = z.object({
  kind: z.enum(['ACCOUNT', 'CUSTOMER', 'SUPPLIER']),
  accountId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  reference: z.string().max(60).nullish(),
  docDate: zAdDate.nullish(),
  dueDate: zAdDate.nullish(),
  debit: zMoneyNonNeg.default('0'),
  credit: zMoneyNonNeg.default('0'),
  description: z.string().max(500).nullish(),
});
const openingSchema = z.object({ asOfDate: zAdDate, narration: z.string().max(1000).nullish(), lines: z.array(lineSchema).min(1) });
type OpeningInput = z.infer<typeof openingSchema>;

/**
 * Opening balance wizard (docs/02 §8): trial-balance lines + customer/supplier open items.
 * Sub-ledger items post to AR/AP control; the difference posts to Opening Balance Equity (3900).
 * Go-live is blocked until Opening Balance Equity = 0.
 */
@Injectable()
export class OpeningService implements OnModuleInit {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly audit: AuditService,
    private readonly registry: DocumentRegistry,
    private readonly approvals: ApprovalService,
    private readonly ledger: LedgerService,
    private readonly journals: JournalsService,
  ) {}

  onModuleInit() {
    const self = this;
    this.registry.register({
      docType: 'OPENING_BALANCE',
      table: 'opening_balances',
      dateField: 'as_of_date',
      amountField: 'total',
      describe: (doc) => `Opening balances as of ${doc.as_of_date}`,
      async validate(trx, ctx) {
        const c = await trx.selectFrom('companies').select('go_live_status').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
        if (c.go_live_status === 'LIVE') throw new AppError('ACC_ALREADY_LIVE');
      },
      preview: (trx, ctx, doc) => self.components(trx, doc).then((c) => self.ledger.buildLines(trx, ctx.companyId, 'OPENING_BALANCE', c)),
      async post(trx, ctx, doc, approvedBy) {
        const comps = await self.components(trx, doc);
        const e = await self.ledger.post(trx, ctx, { sourceType: 'OPENING_BALANCE', sourceId: doc.id, sourceNo: doc.doc_no, entryDate: doc.as_of_date, narration: doc.narration ?? 'Opening balances', isOpening: true, approvedBy, components: comps });
        await self.createOpenItems(trx, ctx, doc, e.id, approvedBy);
        return { entryId: e.id };
      },
      correction: {
        kind: 'REVERSE',
        async check(trx, ctx, doc) {
          const c = await trx.selectFrom('companies').select('go_live_status').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
          if (c.go_live_status === 'LIVE') throw new AppError('ACC_ALREADY_LIVE', 'Company is live — correct opening balances with a journal instead');
          const used = await trx
            .selectFrom('allocations')
            .innerJoin('sales_invoices', 'sales_invoices.id', 'allocations.target_id')
            .select('allocations.id')
            .where('sales_invoices.journal_entry_id', '=', doc.journal_entry_id)
            .where('allocations.reversed_at', 'is', null)
            .executeTakeFirst();
          if (used) throw new AppError('DOC_CANCEL_HAS_PAYMENTS');
        },
        async after(trx, _ctx, doc) {
          // opening open-items die with the reversed opening entry
          await trx.updateTable('sales_invoices').set({ status: 'REVERSED', reversed_at: new Date() }).where('journal_entry_id', '=', doc.journal_entry_id).where('is_opening', '=', true).execute();
          await trx.updateTable('purchase_bills').set({ status: 'REVERSED', reversed_at: new Date() }).where('journal_entry_id', '=', doc.journal_entry_id).where('is_opening', '=', true).execute();
        },
      },
    });
  }

  private async components(trx: Tx, doc: DocRow): Promise<PostingComponent[]> {
    const lines = await trx.selectFrom('opening_balance_lines').selectAll().where('opening_id', '=', doc.id).orderBy('line_no').execute();
    const comps: PostingComponent[] = [];
    let diff = d(0); // debits − credits
    for (const l of lines) {
      const amt = d(l.debit).minus(l.credit);
      diff = diff.plus(amt);
      if (l.kind === 'ACCOUNT') {
        comps.push({ role: amt.gt(0) ? 'LINE_DEBIT' : 'LINE_CREDIT', amount: money(amt.abs()), accountId: l.account_id, contactId: l.contact_id, description: l.description });
      } else if (l.kind === 'CUSTOMER') {
        comps.push({ role: 'RECEIVABLE', amount: money(amt), contactId: l.contact_id, description: l.reference ? `Opening ${l.reference}` : 'Opening balance' });
      } else {
        comps.push({ role: 'PAYABLE', amount: money(amt.neg()), contactId: l.contact_id, description: l.reference ? `Opening ${l.reference}` : 'Opening balance' });
      }
    }
    if (!diff.isZero()) comps.push({ role: 'OBE', amount: money(diff), description: 'Opening balance difference' });
    return comps;
  }

  /** Customer/supplier open items become opening invoices/bills so aging & allocation work from day one. */
  private async createOpenItems(trx: Tx, ctx: CompanyContext, doc: DocRow, entryId: string, approvedBy: string | null) {
    const company = await trx.selectFrom('companies').select('base_currency').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    const lines = await trx.selectFrom('opening_balance_lines').selectAll().where('opening_id', '=', doc.id).where('kind', '<>', 'ACCOUNT').orderBy('line_no').execute();
    for (const l of lines) {
      const ref = l.reference || `${doc.doc_no}-${l.line_no}`;
      const common = {
        company_id: ctx.companyId,
        doc_no: `OPEN-${ref}`.slice(0, 40),
        contact_id: l.contact_id!,
        currency_code: company.base_currency,
        is_opening: true,
        status: 'POSTED',
        journal_entry_id: entryId,
        created_by: doc.created_by,
        approved_by: approvedBy,
        posted_at: new Date(),
        notes: l.description ?? 'Opening balance',
      };
      if (l.kind === 'CUSTOMER' && d(l.debit).gt(0)) {
        await trx.insertInto('sales_invoices').values({ ...common, invoice_date: l.doc_date ?? doc.as_of_date, due_date: l.due_date ?? l.doc_date ?? doc.as_of_date, subtotal: l.debit, exempt_total: '0', grand_total: l.debit, amount_due: l.debit }).execute();
      } else if (l.kind === 'SUPPLIER' && d(l.credit).gt(0)) {
        await trx.insertInto('purchase_bills').values({ ...common, bill_date: l.doc_date ?? doc.as_of_date, due_date: l.due_date ?? l.doc_date ?? doc.as_of_date, supplier_invoice_no: ref, subtotal: l.credit, grand_total: l.credit, amount_due: l.credit }).execute();
      }
    }
  }

  private async saveLines(trx: Tx, ctx: CompanyContext, id: string, input: OpeningInput) {
    for (const [i, l] of input.lines.entries()) {
      if (d(l.debit).gt(0) === d(l.credit).gt(0)) throw new AppError('VAL_FIELD', `Line ${i + 1}: enter a debit or a credit`);
      if (l.kind === 'ACCOUNT' && !l.accountId) throw new AppError('VAL_FIELD', `Line ${i + 1}: choose an account`);
      if (l.kind !== 'ACCOUNT' && !l.contactId) throw new AppError('VAL_FIELD', `Line ${i + 1}: choose a customer/supplier`);
    }
    const accts = await trx.selectFrom('accounts').select(['id', 'code', 'name', 'is_control', 'system_key', 'requires_contact']).where('id', 'in', input.lines.filter((l) => l.accountId).map((l) => l.accountId!).concat(['00000000-0000-0000-0000-000000000000'])).execute();
    for (const [i, l] of input.lines.entries()) {
      const a = accts.find((x) => x.id === l.accountId);
      if (a && ['AR_CONTROL', 'AP_CONTROL'].includes(a.system_key ?? '')) throw new AppError('ACC_CONTROL_ACCOUNT', `Line ${i + 1}: enter receivables/payables as customer/supplier open items, not on ${a.code}`);
      if (a && a.system_key === 'OPENING_BALANCE_EQUITY') throw new AppError('VAL_FIELD', `Line ${i + 1}: Opening Balance Equity is calculated automatically`);
      if (a?.requires_contact && !l.contactId) throw new AppError('ACC_CONTROL_ACCOUNT', `Line ${i + 1}: select a contact for ${a.code}`);
    }
    await trx.deleteFrom('opening_balance_lines').where('opening_id', '=', id).execute();
    await trx
      .insertInto('opening_balance_lines')
      .values(input.lines.map((l, i) => ({ company_id: ctx.companyId, opening_id: id, line_no: i + 1, kind: l.kind, account_id: l.accountId ?? null, contact_id: l.contactId ?? null, reference: l.reference ?? null, doc_date: l.docDate ?? null, due_date: l.dueDate ?? null, debit: money(l.debit), credit: money(l.credit), description: l.description ?? null })))
      .execute();
    const dr = sum(input.lines.map((l) => l.debit));
    const cr = sum(input.lines.map((l) => l.credit));
    return { total: money(dr.gt(cr) ? dr : cr), obe: money(dr.minus(cr)) };
  }

  async create(ctx: CompanyContext, input: OpeningInput) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const c = await trx.selectFrom('companies').select('go_live_status').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
      if (c.go_live_status === 'LIVE') throw new AppError('ACC_ALREADY_LIVE');
      const row = await trx.insertInto('opening_balances').values({ company_id: ctx.companyId, as_of_date: input.asOfDate, narration: input.narration ?? null, created_by: ctx.userId }).returning('id').executeTakeFirstOrThrow();
      const t = await this.saveLines(trx, ctx, row.id, input);
      await trx.updateTable('opening_balances').set({ total: t.total, obe_difference: t.obe }).where('id', '=', row.id).execute();
      await trx.updateTable('companies').set({ go_live_date: input.asOfDate }).where('id', '=', ctx.companyId).execute();
      await this.audit.log(trx, ctx, 'CREATE', 'opening_balance', row.id, null, input);
      return { id: row.id, ...t };
    });
  }

  async update(ctx: CompanyContext, id: string, input: OpeningInput & { version: number }) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await this.registry.lock(trx, 'OPENING_BALANCE', id);
      if (doc.version !== input.version) throw new AppError('DOC_VERSION_CONFLICT');
      if (doc.status === 'SUBMITTED') await this.approvals.withdrawInTx(trx, ctx, 'OPENING_BALANCE', id);
      else if (!['DRAFT', 'REJECTED'].includes(doc.status)) throw new AppError('ACC_IMMUTABLE');
      const t = await this.saveLines(trx, ctx, id, input);
      await trx.updateTable('opening_balances').set({ as_of_date: input.asOfDate, narration: input.narration ?? null, total: t.total, obe_difference: t.obe, status: 'DRAFT', updated_by: ctx.userId }).where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'UPDATE', 'opening_balance', id, doc, input);
      return { id, ...t };
    });
  }

  async status(ctx: CompanyContext) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const c = await trx.selectFrom('companies').select(['go_live_status', 'go_live_date']).where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
      const obe = await this.obeBalance(trx);
      const docs = await trx.selectFrom('opening_balances').selectAll().orderBy('created_at', 'desc').execute();
      return { goLiveStatus: c.go_live_status, goLiveDate: c.go_live_date, openingBalanceEquity: obe, canGoLive: d(obe).isZero() && docs.some((x) => x.status === 'POSTED'), documents: docs };
    });
  }

  private async obeBalance(trx: Tx) {
    const r = await trx
      .selectFrom('journal_lines')
      .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
      .select(sql<string>`coalesce(sum(debit - credit), 0)`.as('bal'))
      .where('accounts.system_key', '=', 'OPENING_BALANCE_EQUITY')
      .executeTakeFirstOrThrow();
    return money(r.bal);
  }

  async goLive(ctx: CompanyContext) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const c = await trx.selectFrom('companies').select(['go_live_status']).where('id', '=', ctx.companyId).forUpdate().executeTakeFirstOrThrow();
      if (c.go_live_status === 'LIVE') throw new AppError('ACC_ALREADY_LIVE');
      const pending = await trx.selectFrom('opening_balances').select('id').where('status', 'in', ['DRAFT', 'SUBMITTED', 'APPROVED']).executeTakeFirst();
      if (pending) throw new AppError('APR_INVALID_STATE', 'Post or delete pending opening balance documents first');
      const obe = await this.obeBalance(trx);
      if (!d(obe).isZero()) {
        throw new AppError('ACC_OPENING_UNBALANCED', `Opening balances differ by ${formatMoney(d(obe).abs())} (Opening Balance Equity must be zero). Fix the balances, or transfer the difference to Capital/Retained Earnings with an approved journal.`, { difference: obe });
      }
      await trx.updateTable('companies').set({ go_live_status: 'LIVE', updated_by: ctx.userId }).where('id', '=', ctx.companyId).execute();
      await this.audit.log(trx, ctx, 'GO_LIVE', 'company', ctx.companyId, { go_live_status: 'SETUP' }, { go_live_status: 'LIVE' });
      return { goLiveStatus: 'LIVE' };
    });
  }

  /** Admin explicitly accepts the difference: drafts (and submits) a journal moving OBE to Capital or Retained Earnings. */
  async transferObe(ctx: CompanyContext, target: 'CAPITAL' | 'RETAINED_EARNINGS', date: string) {
    const draft = await this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const obe = d(await this.obeBalance(trx));
      if (obe.isZero()) throw new AppError('VAL_FIELD', 'Opening Balance Equity is already zero');
      const accts = await trx.selectFrom('accounts').select(['id', 'system_key']).where('system_key', 'in', ['OPENING_BALANCE_EQUITY', target]).execute();
      const obeId = accts.find((a) => a.system_key === 'OPENING_BALANCE_EQUITY')!.id;
      const tgt = accts.find((a) => a.system_key === target)!.id;
      return {
        journalDate: date,
        narration: `Transfer opening balance difference to ${target === 'CAPITAL' ? 'Capital' : 'Retained Earnings'} (accepted by Admin)`,
        lines: obe.gt(0)
          ? [{ accountId: tgt, debit: money(obe), credit: '0' }, { accountId: obeId, debit: '0', credit: money(obe) }]
          : [{ accountId: obeId, debit: money(obe.abs()), credit: '0' }, { accountId: tgt, debit: '0', credit: money(obe.abs()) }],
      };
    });
    const j = await this.journals.create(ctx, draft as any);
    const s = await this.approvals.submit(ctx, 'MANUAL_JOURNAL' as DocType, j.id);
    return { journalId: j.id, ...s };
  }

  async get(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await trx.selectFrom('opening_balances').selectAll().where('id', '=', id).executeTakeFirst();
      if (!doc) throw new AppError('NOT_FOUND');
      const lines = await trx
        .selectFrom('opening_balance_lines')
        .leftJoin('accounts', 'accounts.id', 'opening_balance_lines.account_id')
        .leftJoin('contacts', 'contacts.id', 'opening_balance_lines.contact_id')
        .selectAll('opening_balance_lines')
        .select(['accounts.code as account_code', 'accounts.name as account_name', 'contacts.name as contact_name'])
        .where('opening_id', '=', id)
        .orderBy('line_no')
        .execute();
      return { ...doc, lines };
    });
  }

  async remove(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await this.registry.lock(trx, 'OPENING_BALANCE', id);
      if (!['DRAFT', 'REJECTED'].includes(doc.status)) throw new AppError('ACC_IMMUTABLE');
      await trx.deleteFrom('opening_balances').where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'DELETE', 'opening_balance', id, doc, null);
      return { ok: true };
    });
  }
}

@Controller('opening-balances')
export class OpeningController {
  constructor(private readonly svc: OpeningService) {}

  @Perm('opening.view')
  @Get()
  status(@Ctx() ctx: CompanyContext) {
    return this.svc.status(ctx);
  }

  @Perm('opening.view')
  @Get(':id')
  get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }

  @Perm('opening.create')
  @Post()
  create(@Ctx() ctx: CompanyContext, @Body(new Zod(openingSchema)) b: OpeningInput) {
    return this.svc.create(ctx, b);
  }

  @Perm('opening.create')
  @Patch(':id')
  update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(openingSchema.extend({ version: z.number().int() }))) b: OpeningInput & { version: number }) {
    return this.svc.update(ctx, id, b);
  }

  @Perm('opening.create')
  @Delete(':id')
  remove(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.remove(ctx, id);
  }

  @Perm('opening.go_live')
  @Post('go-live')
  goLive(@Ctx() ctx: CompanyContext) {
    return this.svc.goLive(ctx);
  }

  @Perm('opening.go_live', 'journal.create', 'journal.post_control')
  @Post('transfer-difference')
  transfer(@Ctx() ctx: CompanyContext, @Body(new Zod(z.object({ target: z.enum(['CAPITAL', 'RETAINED_EARNINGS']), date: zAdDate }))) b: { target: 'CAPITAL' | 'RETAINED_EARNINGS'; date: string }) {
    return this.svc.transferObe(ctx, b.target, b.date);
  }
}
