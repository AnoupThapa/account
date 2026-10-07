import { Injectable } from '@nestjs/common';
import { AppError, d, money, sum, formatMoney } from '@ledgerpro/shared';
import { sql } from 'kysely';
import type { Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { FiscalService } from '../settings/fiscal.service';
import { NumberingService } from '../settings/numbering.service';

/** A document's posting component: a role (e.g. RECEIVABLE) with an amount; the posting rule decides side & account. */
export interface PostingComponent {
  role: string;
  amount: string; // positive = rule side; negative = opposite side
  accountId?: string | null; // required when rule account_ref = LINE
  contactId?: string | null;
  itemId?: string | null;
  costCentreId?: string | null;
  projectId?: string | null;
  taxCodeId?: string | null;
  description?: string | null;
}

export interface PostRequest {
  sourceType: string;
  sourceId: string | null;
  sourceNo?: string | null;
  entryDate: string;
  narration?: string | null;
  branchId?: string | null;
  isOpening?: boolean;
  approvedBy?: string | null;
  adjustmentPeriod?: boolean;
  reversalOf?: string | null;
  components: PostingComponent[];
}

export interface BuiltLine {
  accountId: string;
  debit: string;
  credit: string;
  contactId: string | null;
  itemId: string | null;
  costCentreId: string | null;
  projectId: string | null;
  taxCodeId: string | null;
  description: string | null;
}

/**
 * THE ONLY code that writes journal_entries / journal_lines (architecture.md §3 golden rule).
 * Always called inside the caller's transaction so document status + ledger change commit together.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly fiscal: FiscalService, private readonly numbering: NumberingService, private readonly audit: AuditService) {}

  /** Resolve posting rules → balanced journal lines (pure preview, no writes). */
  async buildLines(trx: Tx, companyId: string, sourceType: string, components: PostingComponent[]): Promise<BuiltLine[]> {
    const rules = await trx
      .selectFrom('posting_rules')
      .selectAll()
      .where('source_type', '=', sourceType)
      .where((eb) => eb.or([eb('company_id', 'is', null), eb('company_id', '=', companyId)]))
      .execute();
    const ruleFor = (role: string) => rules.find((r) => r.role === role && r.company_id === companyId) ?? rules.find((r) => r.role === role && r.company_id === null);

    const systemKeys = [...new Set(rules.filter((r) => r.account_ref.startsWith('SYSTEM:')).map((r) => r.account_ref.slice(7)))];
    const sysAccounts = systemKeys.length
      ? await trx.selectFrom('accounts').select(['id', 'system_key']).where('company_id', '=', companyId).where('system_key', 'in', systemKeys).execute()
      : [];

    const lines: BuiltLine[] = [];
    for (const c of components) {
      const amt = d(c.amount);
      if (amt.isZero()) continue;
      const rule = ruleFor(c.role);
      if (!rule) throw new AppError('SYS_UNEXPECTED', `No posting rule for ${sourceType}/${c.role}`);
      let accountId: string | null | undefined;
      if (rule.account_ref === 'LINE') accountId = c.accountId;
      else if (rule.account_ref.startsWith('SYSTEM:')) {
        accountId = c.accountId ?? sysAccounts.find((a) => a.system_key === rule.account_ref.slice(7))?.id;
        if (!accountId) throw new AppError('VAL_FIELD', `The system account ${rule.account_ref.slice(7)} is missing from the chart of accounts`);
      }
      if (!accountId) throw new AppError('VAL_FIELD', `Choose an account for ${c.role.toLowerCase().replace(/_/g, ' ')}`);
      const debitSide = (rule.side === 'DEBIT') !== amt.isNeg();
      const abs = money(amt.abs());
      lines.push({
        accountId,
        debit: debitSide ? abs : '0.00',
        credit: debitSide ? '0.00' : abs,
        contactId: c.contactId ?? null,
        itemId: c.itemId ?? null,
        costCentreId: c.costCentreId ?? null,
        projectId: c.projectId ?? null,
        taxCodeId: c.taxCodeId ?? null,
        description: c.description ?? null,
      });
    }
    return lines;
  }

  static assertBalanced(lines: BuiltLine[]) {
    const dr = sum(lines.map((l) => l.debit));
    const cr = sum(lines.map((l) => l.credit));
    if (lines.length < 2 || dr.isZero()) throw new AppError('ACC_UNBALANCED', 'A journal needs at least one debit and one credit');
    if (!dr.eq(cr)) {
      const diff = dr.minus(cr);
      throw new AppError('ACC_UNBALANCED', `Debits and credits must be equal (difference: ${formatMoney(diff.abs())})`, { difference: money(diff) });
    }
    return money(dr);
  }

  /** Validate accounts up-front for friendly errors (the DB re-checks everything at insert/commit). */
  private async checkAccounts(trx: Tx, companyId: string, lines: BuiltLine[]) {
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accts = await trx.selectFrom('accounts').select(['id', 'code', 'name', 'is_active', 'is_postable', 'requires_contact']).where('company_id', '=', companyId).where('id', 'in', ids).execute();
    for (const l of lines) {
      const a = accts.find((x) => x.id === l.accountId);
      if (!a) throw new AppError('VAL_FIELD', 'Unknown account');
      if (!a.is_active) throw new AppError('ACC_ACCOUNT_INACTIVE', `Account ${a.code} ${a.name} is inactive`);
      if (!a.is_postable) throw new AppError('ACC_NOT_POSTABLE', `${a.code} ${a.name} is a heading — choose a ledger account under it`);
      if (a.requires_contact && !l.contactId) throw new AppError('ACC_CONTROL_ACCOUNT', `Select a customer/supplier for ${a.code} ${a.name}`);
    }
  }

  async post(trx: Tx, ctx: CompanyContext, req: PostRequest) {
    const lines = await this.buildLines(trx, ctx.companyId, req.sourceType, req.components);
    return this.postLines(trx, ctx, req, lines);
  }

  async postLines(trx: Tx, ctx: CompanyContext, req: PostRequest, lines: BuiltLine[]) {
    const total = LedgerService.assertBalanced(lines);
    await this.checkAccounts(trx, ctx.companyId, lines);
    const period = await this.fiscal.periodFor(trx, ctx.companyId, req.entryDate, !!req.adjustmentPeriod);
    const company = await trx.selectFrom('companies').select('base_currency').where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    const entryNo = await this.numbering.next(trx, ctx.companyId, 'JOURNAL_ENTRY', req.entryDate);

    await sql`SELECT set_config('app.ledger_writer', 'on', true)`.execute(trx);
    const entry = await trx
      .insertInto('journal_entries')
      .values({
        company_id: ctx.companyId,
        branch_id: req.branchId ?? null,
        entry_no: entryNo,
        entry_date: req.entryDate,
        period_id: period.id,
        source_type: req.sourceType,
        source_id: req.sourceId,
        source_no: req.sourceNo ?? null,
        narration: req.narration ?? null,
        is_opening: !!req.isOpening,
        total,
        posted_by: ctx.userId,
        approved_by: req.approvedBy ?? null,
        reversal_of: req.reversalOf ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('journal_lines')
      .values(
        lines.map((l, i) => ({
          entry_id: entry.id,
          company_id: ctx.companyId,
          line_no: i + 1,
          account_id: l.accountId,
          debit: l.debit,
          credit: l.credit,
          currency_code: company.base_currency,
          contact_id: l.contactId,
          item_id: l.itemId,
          cost_centre_id: l.costCentreId,
          project_id: l.projectId,
          tax_code_id: l.taxCodeId,
          description: l.description,
          entry_date: req.entryDate,
        })),
      )
      .execute();
    await sql`SELECT set_config('app.ledger_writer', '', true)`.execute(trx);
    await this.audit.log(trx, ctx, 'POST', 'journal_entry', entry.id, null, { entryNo, source: `${req.sourceType}:${req.sourceNo ?? req.sourceId}`, total, lines: lines.length });
    return entry;
  }

  /** Mirror entry dated `date` (in an open period), linked to the original (docs/02 §10). */
  async reverse(trx: Tx, ctx: CompanyContext, entryId: string, date: string, reason: string, sourceType = 'REVERSAL', sourceId: string | null = null, sourceNo: string | null = null) {
    const orig = await trx.selectFrom('journal_entries').selectAll().where('id', '=', entryId).forUpdate().executeTakeFirst();
    if (!orig) throw new AppError('NOT_FOUND');
    if (orig.status === 'REVERSED') throw new AppError('APR_INVALID_STATE', `Entry ${orig.entry_no} is already reversed`);
    if (date < orig.entry_date) throw new AppError('VAL_FIELD', 'Reversal date cannot be before the original entry date');
    const lines = await trx.selectFrom('journal_lines').selectAll().where('entry_id', '=', entryId).orderBy('line_no').execute();
    const mirrored: BuiltLine[] = lines.map((l) => ({
      accountId: l.account_id,
      debit: l.credit,
      credit: l.debit,
      contactId: l.contact_id,
      itemId: l.item_id,
      costCentreId: l.cost_centre_id,
      projectId: l.project_id,
      taxCodeId: l.tax_code_id,
      description: l.description,
    }));
    const rev = await this.postLines(trx, ctx, {
      sourceType,
      sourceId: sourceId ?? orig.source_id,
      sourceNo: sourceNo ?? orig.source_no,
      entryDate: date,
      narration: `Reversal of ${orig.entry_no}: ${reason}`,
      branchId: orig.branch_id,
      approvedBy: ctx.userId,
      reversalOf: orig.id,
      components: [],
    }, mirrored);
    await sql`SELECT set_config('app.ledger_writer', 'on', true)`.execute(trx);
    await trx.updateTable('journal_entries').set({ status: 'REVERSED', reversed_by_entry_id: rev.id }).where('id', '=', entryId).execute();
    await sql`SELECT set_config('app.ledger_writer', '', true)`.execute(trx);
    await this.audit.log(trx, ctx, 'REVERSE', 'journal_entry', entryId, { status: 'POSTED' }, { status: 'REVERSED', reversalEntryId: rev.id, reason });
    return rev;
  }

  async entryWithLines(trx: Tx, entryId: string) {
    const entry = await trx.selectFrom('journal_entries').selectAll().where('id', '=', entryId).executeTakeFirst();
    if (!entry) throw new AppError('NOT_FOUND');
    const lines = await trx
      .selectFrom('journal_lines')
      .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
      .leftJoin('contacts', 'contacts.id', 'journal_lines.contact_id')
      .select(['journal_lines.id', 'line_no', 'account_id', 'accounts.code as account_code', 'accounts.name as account_name', 'debit', 'credit', 'journal_lines.contact_id', 'contacts.name as contact_name', 'journal_lines.description', 'journal_lines.cost_centre_id'])
      .where('entry_id', '=', entryId)
      .orderBy('line_no')
      .execute();
    return { ...entry, lines };
  }
}
