import { Injectable } from '@nestjs/common';
import { AppError, d, money, sum, addDays, diffDays, formatDual, toBS, formatBs } from '@ledgerpro/shared';
import { sql } from 'kysely';
import { DatabaseService, Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';

const PL = ['INCOME', 'EXPENSE'];

function bs(ad: string) {
  try {
    return formatBs(toBS(ad));
  } catch {
    return null;
  }
}

/** All reports read from the ledger (docs/02 §2.2) and are filtered by the RLS tenant. */
@Injectable()
export class ReportsService {
  constructor(private readonly dbs: DatabaseService) {}

  private tx<T>(ctx: CompanyContext, fn: (trx: Tx) => Promise<T>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, fn);
  }

  private async fyStart(trx: Tx, date: string): Promise<string> {
    const fy = await trx.selectFrom('fiscal_years').select('start_date').where('start_date', '<=', date).where('end_date', '>=', date).executeTakeFirst();
    if (!fy) throw new AppError('ACC_NO_FISCAL_YEAR', `No fiscal year covers ${formatDual(date)}`);
    return fy.start_date;
  }

  private periodLabel(from: string, to: string) {
    return { from, to, fromBs: bs(from), toBs: bs(to), label: `${formatDual(from)} to ${formatDual(to)}` };
  }

  // -------------------------------------------------------------- Trial Balance
  /**
   * Opening / Period / Closing per account. Income & expense accounts open from the start of the
   * fiscal year containing `from`; earlier years' profit is shown in Retained Earnings' opening
   * (until year-end close is posted in Phase 8), so the TB always agrees.
   */
  async trialBalance(ctx: CompanyContext, from: string, to: string, opts: { includeZero?: boolean; branchId?: string; costCentreId?: string } = {}) {
    if (to < from) throw new AppError('VAL_FIELD', '"To" date is before "From" date');
    return this.tx(ctx, async (trx) => {
      const fyStart = await this.fyStart(trx, from);
      const accounts = await trx.selectFrom('accounts').selectAll().orderBy('code').execute();
      const agg = await sql<{ account_id: string; class: string; bs_open: string; pl_open: string; pl_prior: string; pdr: string; pcr: string }>`
        SELECT jl.account_id, a.class,
          coalesce(sum(jl.debit - jl.credit) FILTER (WHERE jl.entry_date < ${from}), 0) AS bs_open,
          coalesce(sum(jl.debit - jl.credit) FILTER (WHERE jl.entry_date >= ${fyStart} AND jl.entry_date < ${from}), 0) AS pl_open,
          coalesce(sum(jl.debit - jl.credit) FILTER (WHERE jl.entry_date < ${fyStart}), 0) AS pl_prior,
          coalesce(sum(jl.debit) FILTER (WHERE jl.entry_date BETWEEN ${from} AND ${to}), 0) AS pdr,
          coalesce(sum(jl.credit) FILTER (WHERE jl.entry_date BETWEEN ${from} AND ${to}), 0) AS pcr
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.entry_date <= ${to}
          ${opts.branchId ? sql`AND je.branch_id = ${opts.branchId}` : sql``}
          ${opts.costCentreId ? sql`AND jl.cost_centre_id = ${opts.costCentreId}` : sql``}
        GROUP BY jl.account_id, a.class`.execute(trx);
      const byId = new Map(agg.rows.map((r) => [r.account_id, r]));
      const priorProfit = sum(agg.rows.filter((r) => PL.includes(r.class)).map((r) => r.pl_prior)); // debit-positive
      const re = accounts.find((a) => a.system_key === 'RETAINED_EARNINGS');

      const rows = accounts
        .filter((a) => a.is_postable)
        .map((a) => {
          const r = byId.get(a.id);
          let open = d(0);
          if (r) open = PL.includes(a.class) ? d(r.pl_open) : d(r.bs_open);
          if (re && a.id === re.id) open = open.plus(priorProfit);
          const pdr = d(r?.pdr ?? 0);
          const pcr = d(r?.pcr ?? 0);
          const close = open.plus(pdr).minus(pcr);
          return {
            accountId: a.id,
            code: a.code,
            name: a.name,
            class: a.class,
            parentId: a.parent_id,
            openingDebit: money(open.gt(0) ? open : 0),
            openingCredit: money(open.lt(0) ? open.neg() : 0),
            periodDebit: money(pdr),
            periodCredit: money(pcr),
            closingDebit: money(close.gt(0) ? close : 0),
            closingCredit: money(close.lt(0) ? close.neg() : 0),
          };
        })
        .filter((r) => opts.includeZero || [r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit, r.closingDebit, r.closingCredit].some((v) => v !== '0.00'));

      const tot = (k: keyof (typeof rows)[number]) => money(sum(rows.map((r) => r[k] as string)));
      const totals = {
        openingDebit: tot('openingDebit'),
        openingCredit: tot('openingCredit'),
        periodDebit: tot('periodDebit'),
        periodCredit: tot('periodCredit'),
        closingDebit: tot('closingDebit'),
        closingCredit: tot('closingCredit'),
      };
      const balanced = totals.openingDebit === totals.openingCredit && totals.periodDebit === totals.periodCredit && totals.closingDebit === totals.closingCredit;
      // Grouped view: roll up to headings
      const headings = accounts
        .filter((a) => !a.is_postable)
        .map((h) => {
          const desc = new Set<string>();
          const walk = (pid: string) => accounts.filter((x) => x.parent_id === pid).forEach((c) => (desc.add(c.id), walk(c.id)));
          walk(h.id);
          const sub = rows.filter((r) => desc.has(r.accountId));
          const net = sum(sub.map((r) => d(r.closingDebit).minus(r.closingCredit)));
          return { accountId: h.id, code: h.code, name: h.name, parentId: h.parent_id, closingDebit: money(net.gt(0) ? net : 0), closingCredit: money(net.lt(0) ? net.neg() : 0) };
        })
        .filter((h) => h.closingDebit !== '0.00' || h.closingCredit !== '0.00');
      return { period: this.periodLabel(from, to), rows, headings, totals, balanced };
    });
  }

  // ------------------------------------------------------------- General Ledger
  async generalLedger(ctx: CompanyContext, accountId: string, from: string, to: string, contactId?: string) {
    return this.tx(ctx, async (trx) => {
      const a = await trx.selectFrom('accounts').selectAll().where('id', '=', accountId).executeTakeFirst();
      if (!a) throw new AppError('NOT_FOUND');
      const fyStart = await this.fyStart(trx, from);
      const openFrom = PL.includes(a.class) ? fyStart : '0001-01-01';
      const op = await trx
        .selectFrom('journal_lines')
        .select(sql<string>`coalesce(sum(debit - credit), 0)`.as('bal'))
        .where('account_id', '=', accountId)
        .where('entry_date', '>=', openFrom)
        .where('entry_date', '<', from)
        .$if(!!contactId, (q) => q.where('contact_id', '=', contactId!))
        .executeTakeFirstOrThrow();
      let running = d(op.bal);
      const lines = await trx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.entry_id')
        .leftJoin('contacts', 'contacts.id', 'journal_lines.contact_id')
        .select([
          'journal_lines.id',
          'journal_lines.entry_date',
          'journal_entries.id as entry_id',
          'journal_entries.entry_no',
          'journal_entries.source_type',
          'journal_entries.source_id',
          'journal_entries.source_no',
          'journal_entries.narration',
          'journal_entries.status',
          'journal_lines.description',
          'journal_lines.debit',
          'journal_lines.credit',
          'contacts.name as contact_name',
        ])
        .where('journal_lines.account_id', '=', accountId)
        .where('journal_lines.entry_date', '>=', from)
        .where('journal_lines.entry_date', '<=', to)
        .$if(!!contactId, (q) => q.where('journal_lines.contact_id', '=', contactId!))
        .orderBy('journal_lines.entry_date')
        .orderBy('journal_entries.posted_at')
        .orderBy('journal_lines.line_no')
        .execute();
      const out = lines.map((l) => {
        running = running.plus(l.debit).minus(l.credit);
        return { ...l, dateBs: bs(l.entry_date), balance: money(running) };
      });
      return {
        account: { id: a.id, code: a.code, name: a.name, class: a.class },
        period: this.periodLabel(from, to),
        openingBalance: money(op.bal),
        lines: out,
        totalDebit: money(sum(lines.map((l) => l.debit))),
        totalCredit: money(sum(lines.map((l) => l.credit))),
        closingBalance: money(running),
      };
    });
  }

  // --------------------------------------------------- Journal register / Day Book
  async journalRegister(ctx: CompanyContext, from: string, to: string, sourceType?: string) {
    return this.tx(ctx, async (trx) => {
      const entries = await trx
        .selectFrom('journal_entries')
        .leftJoin('users', 'users.id', 'journal_entries.posted_by')
        .selectAll('journal_entries')
        .select('users.full_name as posted_by_name')
        .where('entry_date', '>=', from)
        .where('entry_date', '<=', to)
        .$if(!!sourceType, (q) => q.where('source_type', '=', sourceType!))
        .orderBy('entry_date')
        .orderBy('posted_at')
        .limit(5000)
        .execute();
      const ids = entries.map((e) => e.id);
      const lines = ids.length
        ? await trx
            .selectFrom('journal_lines')
            .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
            .leftJoin('contacts', 'contacts.id', 'journal_lines.contact_id')
            .select(['journal_lines.entry_id', 'line_no', 'accounts.code', 'accounts.name', 'debit', 'credit', 'contacts.name as contact_name', 'journal_lines.description'])
            .where('entry_id', 'in', ids)
            .orderBy('line_no')
            .execute()
        : [];
      return {
        period: this.periodLabel(from, to),
        entries: entries.map((e) => ({ ...e, dateBs: bs(e.entry_date), lines: lines.filter((l) => l.entry_id === e.id) })),
        totalDebit: money(sum(entries.map((e) => e.total))),
      };
    });
  }

  async dayBook(ctx: CompanyContext, from: string, to: string) {
    const r = await this.journalRegister(ctx, from, to);
    const days = new Map<string, { date: string; dateBs: string | null; count: number; total: string }>();
    for (const e of r.entries) {
      const x = days.get(e.entry_date) ?? { date: e.entry_date, dateBs: e.dateBs, count: 0, total: '0.00' };
      x.count++;
      x.total = money(d(x.total).plus(e.total));
      days.set(e.entry_date, x);
    }
    return { ...r, days: [...days.values()] };
  }

  // ------------------------------------------------- Sales / Purchase Books (IRD layout)
  async salesBook(ctx: CompanyContext, from: string, to: string) {
    return this.tx(ctx, async (trx) => {
      const inv = await trx
        .selectFrom('sales_invoices')
        .innerJoin('contacts', 'contacts.id', 'sales_invoices.contact_id')
        .select(['sales_invoices.id', 'doc_no', 'invoice_date as date', 'status', 'cancel_reason', sql<string>`coalesce(buyer_name, contacts.name)`.as('buyer_name'), sql<string>`coalesce(buyer_pan, contacts.pan)`.as('buyer_pan'), 'grand_total', 'exempt_total', 'zero_rated_total', 'taxable_total', 'tax_total'])
        .where('invoice_date', '>=', from)
        .where('invoice_date', '<=', to)
        .where('status', 'in', ['POSTED', 'CANCELLED'])
        .where('is_opening', '=', false)
        .orderBy('invoice_date')
        .orderBy('doc_no')
        .execute();
      const cn = await trx
        .selectFrom('credit_notes')
        .innerJoin('contacts', 'contacts.id', 'credit_notes.contact_id')
        .leftJoin('sales_invoices', 'sales_invoices.id', 'credit_notes.original_invoice_id')
        .select(['credit_notes.id', 'credit_notes.doc_no', 'credit_notes.note_date as date', 'credit_notes.status', 'contacts.name as buyer_name', 'contacts.pan as buyer_pan', 'credit_notes.grand_total', 'credit_notes.exempt_total', 'credit_notes.zero_rated_total', 'credit_notes.taxable_total', 'credit_notes.tax_total', 'sales_invoices.doc_no as original_doc_no'])
        .where('credit_notes.note_date', '>=', from)
        .where('credit_notes.note_date', '<=', to)
        .where('credit_notes.status', 'in', ['POSTED', 'CANCELLED'])
        .orderBy('credit_notes.note_date')
        .execute();
      return this.book(from, to, inv as any[], cn as any[]);
    });
  }

  async purchaseBook(ctx: CompanyContext, from: string, to: string) {
    return this.tx(ctx, async (trx) => {
      const bills = await trx
        .selectFrom('purchase_bills')
        .innerJoin('contacts', 'contacts.id', 'purchase_bills.contact_id')
        .select(['purchase_bills.id', 'doc_no', 'bill_date as date', 'status', 'cancel_reason', 'supplier_invoice_no', 'contacts.name as supplier_name', sql<string>`coalesce(supplier_pan, contacts.pan)`.as('supplier_pan'), 'grand_total', 'exempt_total', 'zero_rated_total', 'taxable_total', 'tax_total', 'non_claimable_tax'])
        .where('bill_date', '>=', from)
        .where('bill_date', '<=', to)
        .where('status', 'in', ['POSTED', 'CANCELLED'])
        .where('is_opening', '=', false)
        .orderBy('bill_date')
        .execute();
      const exp = await trx
        .selectFrom('expenses')
        .leftJoin('contacts', 'contacts.id', 'expenses.contact_id')
        .select(['expenses.id', 'expenses.doc_no', 'expense_date as date', 'expenses.status', 'expenses.supplier_invoice_no', sql<string>`coalesce(contacts.name, 'Direct expense')`.as('supplier_name'), sql<string>`coalesce(expenses.supplier_pan, contacts.pan)`.as('supplier_pan'), 'grand_total', 'exempt_total', 'zero_rated_total', 'taxable_total', 'tax_total', 'non_claimable_tax'])
        .where('expense_date', '>=', from)
        .where('expense_date', '<=', to)
        .where('expenses.status', 'in', ['POSTED', 'CANCELLED'])
        .where('expenses.tax_total', '>', '0')
        .orderBy('expense_date')
        .execute();
      const dn = await trx
        .selectFrom('debit_notes')
        .innerJoin('contacts', 'contacts.id', 'debit_notes.contact_id')
        .select(['debit_notes.id', 'debit_notes.doc_no', 'note_date as date', 'debit_notes.status', 'contacts.name as supplier_name', 'contacts.pan as supplier_pan', 'grand_total', 'exempt_total', 'zero_rated_total', 'taxable_total', 'tax_total'])
        .where('note_date', '>=', from)
        .where('note_date', '<=', to)
        .where('debit_notes.status', 'in', ['POSTED', 'CANCELLED'])
        .orderBy('note_date')
        .execute();
      return this.book(from, to, ([...bills, ...exp] as any[]).sort((a, b) => (a.date < b.date ? -1 : 1)), dn as any[]);
    });
  }

  private book<T extends { date: string; status: string; grand_total: string; exempt_total: string; zero_rated_total: string; taxable_total: string; tax_total: string }>(from: string, to: string, main: T[], returns: T[]) {
    const live = (r: T) => r.status !== 'CANCELLED';
    const row = (r: T) => ({ ...r, dateBs: bs(r.date), cancelled: r.status === 'CANCELLED' });
    const tot = (rs: T[]) => ({
      total: money(sum(rs.filter(live).map((r) => r.grand_total))),
      exempt: money(sum(rs.filter(live).map((r) => r.exempt_total))),
      zeroRated: money(sum(rs.filter(live).map((r) => r.zero_rated_total))),
      taxable: money(sum(rs.filter(live).map((r) => r.taxable_total))),
      tax: money(sum(rs.filter(live).map((r) => r.tax_total))),
    });
    return { period: this.periodLabel(from, to), rows: main.map(row), totals: tot(main), returns: returns.map(row), returnTotals: tot(returns) };
  }

  // ---------------------------------------------------------- VAT/GST summary
  async taxSummary(ctx: CompanyContext, from: string, to: string) {
    return this.tx(ctx, async (trx) => {
      const r = await sql<{ code: string; name: string; system_key: string; net: string }>`
        SELECT tc.code, tc.name, a.system_key, sum(jl.debit - jl.credit) AS net
        FROM journal_lines jl
        JOIN accounts a ON a.id = jl.account_id
        LEFT JOIN tax_codes tc ON tc.id = jl.tax_code_id
        WHERE a.system_key IN ('OUTPUT_TAX','INPUT_TAX') AND jl.entry_date BETWEEN ${from} AND ${to}
        GROUP BY tc.code, tc.name, a.system_key ORDER BY a.system_key, tc.code`.execute(trx);
      const output = r.rows.filter((x) => x.system_key === 'OUTPUT_TAX').map((x) => ({ code: x.code, name: x.name, amount: money(d(x.net).neg()) }));
      const input = r.rows.filter((x) => x.system_key === 'INPUT_TAX').map((x) => ({ code: x.code, name: x.name, amount: money(x.net) }));
      const outT = sum(output.map((x) => x.amount));
      const inT = sum(input.map((x) => x.amount));
      return { period: this.periodLabel(from, to), output, input, outputTotal: money(outT), inputTotal: money(inT), netPayable: money(outT.minus(inT)) };
    });
  }

  // -------------------------------------------------------------- Aging (AR/AP)
  async aging(ctx: CompanyContext, side: 'AR' | 'AP', asOf: string) {
    return this.tx(ctx, async (trx) => {
      const docs =
        side === 'AR'
          ? await trx.selectFrom('sales_invoices').innerJoin('contacts', 'contacts.id', 'sales_invoices.contact_id').select(['sales_invoices.id', 'doc_no', 'invoice_date as date', 'due_date', 'amount_due', 'grand_total', 'contact_id', 'contacts.name as contact_name']).where('status', '=', 'POSTED').where('amount_due', '>', '0').where('invoice_date', '<=', asOf).execute()
          : [
              ...(await trx.selectFrom('purchase_bills').innerJoin('contacts', 'contacts.id', 'purchase_bills.contact_id').select(['purchase_bills.id', 'doc_no', 'bill_date as date', 'due_date', 'amount_due', 'grand_total', 'contact_id', 'contacts.name as contact_name']).where('status', '=', 'POSTED').where('amount_due', '>', '0').where('bill_date', '<=', asOf).execute()),
              ...(await trx.selectFrom('expenses').innerJoin('contacts', 'contacts.id', 'expenses.contact_id').select(['expenses.id', 'doc_no', 'expense_date as date', sql<string>`expense_date`.as('due_date'), 'amount_due', 'grand_total', 'contact_id', 'contacts.name as contact_name']).where('kind', '=', 'CLAIM').where('status', '=', 'POSTED').where('amount_due', '>', '0').where('expense_date', '<=', asOf).execute()),
            ];
      const buckets = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
      const bucketOf = (due: string) => {
        const late = diffDays(due, asOf);
        return late <= 0 ? 'current' : late <= 30 ? 'd1_30' : late <= 60 ? 'd31_60' : late <= 90 ? 'd61_90' : 'd90_plus';
      };
      type Row = { contactId: string; contactName: string; total: string; [k: string]: string };
      const byContact = new Map<string, Row>();
      const items = (docs as { id: string; doc_no: string | null; date: string; due_date: string | null; amount_due: string; grand_total: string; contact_id: string; contact_name: string }[]).map((x) => {
        const due = x.due_date ?? x.date;
        const b = bucketOf(due);
        const c = byContact.get(x.contact_id) ?? { contactId: x.contact_id, contactName: x.contact_name, total: '0.00', current: '0.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00' };
        c[b] = money(d(c[b]).plus(x.amount_due));
        c.total = money(d(c.total).plus(x.amount_due));
        byContact.set(x.contact_id, c);
        return { ...x, dueDate: due, daysOverdue: Math.max(0, diffDays(due, asOf)), bucket: b, dateBs: bs(x.date) };
      });
      // Unallocated credits (receipts / credit notes / payments / debit notes) reduce the net balance
      const credits =
        side === 'AR'
          ? await sql<{ contact_id: string; amt: string }>`SELECT contact_id, sum(unallocated_amount) amt FROM (
              SELECT contact_id, unallocated_amount FROM receipts WHERE status='POSTED' AND kind='RECEIPT' AND receipt_date <= ${asOf}
              UNION ALL SELECT contact_id, unallocated_amount FROM credit_notes WHERE status='POSTED' AND refund_account_id IS NULL AND note_date <= ${asOf}) x GROUP BY contact_id`.execute(trx)
          : await sql<{ contact_id: string; amt: string }>`SELECT contact_id, sum(unallocated_amount) amt FROM (
              SELECT contact_id, unallocated_amount FROM payments WHERE status='POSTED' AND kind IN ('PAYMENT','CLAIM') AND payment_date <= ${asOf}
              UNION ALL SELECT contact_id, unallocated_amount FROM debit_notes WHERE status='POSTED' AND refund_account_id IS NULL AND note_date <= ${asOf}) x GROUP BY contact_id`.execute(trx);
      const contacts: (Row & { unallocatedCredits: string; net: string })[] = [...byContact.values()].map((c) => {
        const cr = credits.rows.find((x) => x.contact_id === c.contactId)?.amt ?? '0';
        return { ...c, unallocatedCredits: money(cr), net: money(d(c.total).minus(cr)) };
      });
      for (const cr of credits.rows) {
        if (!byContact.has(cr.contact_id) && d(cr.amt).gt(0)) {
          const n = await trx.selectFrom('contacts').select('name').where('id', '=', cr.contact_id).executeTakeFirstOrThrow();
          contacts.push({ contactId: cr.contact_id, contactName: n.name, total: '0.00', current: '0.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90_plus: '0.00', unallocatedCredits: money(cr.amt), net: money(d(cr.amt).neg()) });
        }
      }
      contacts.sort((a, b) => a.contactName.localeCompare(b.contactName));
      const totals = Object.fromEntries([...buckets, 'total', 'unallocatedCredits', 'net'].map((k) => [k, money(sum(contacts.map((c) => (c as Record<string, string>)[k])))]));
      return { side, asOf, asOfBs: bs(asOf), contacts, items, totals };
    });
  }

  // ----------------------------------------------------- Customer / supplier statement
  async statement(ctx: CompanyContext, contactId: string, from: string, to: string) {
    return this.tx(ctx, async (trx) => {
      const c = await trx.selectFrom('contacts').selectAll().where('id', '=', contactId).executeTakeFirst();
      if (!c) throw new AppError('NOT_FOUND');
      const keys = ['AR_CONTROL', 'AP_CONTROL', 'CUSTOMER_ADVANCES', 'SUPPLIER_ADVANCES', 'STAFF_PAYABLES'];
      const acctIds = (await trx.selectFrom('accounts').select('id').where('system_key', 'in', keys).execute()).map((a) => a.id);
      const op = await trx
        .selectFrom('journal_lines')
        .select(sql<string>`coalesce(sum(debit - credit), 0)`.as('bal'))
        .where('contact_id', '=', contactId)
        .where('account_id', 'in', acctIds)
        .where('entry_date', '<', from)
        .executeTakeFirstOrThrow();
      let run = d(op.bal);
      const lines = await trx
        .selectFrom('journal_lines')
        .innerJoin('journal_entries', 'journal_entries.id', 'journal_lines.entry_id')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .select(['journal_lines.entry_date', 'journal_entries.source_type', 'journal_entries.source_id', 'journal_entries.source_no', 'journal_entries.narration', 'journal_lines.description', 'journal_lines.debit', 'journal_lines.credit', 'accounts.name as account_name'])
        .where('journal_lines.contact_id', '=', contactId)
        .where('journal_lines.account_id', 'in', acctIds)
        .where('journal_lines.entry_date', '>=', from)
        .where('journal_lines.entry_date', '<=', to)
        .orderBy('journal_lines.entry_date')
        .orderBy('journal_entries.posted_at')
        .execute();
      return {
        contact: { id: c.id, name: c.name, code: c.code, pan: c.pan, abn: c.abn, address: c.address, type: c.type },
        period: this.periodLabel(from, to),
        openingBalance: money(op.bal),
        lines: lines.map((l) => {
          run = run.plus(l.debit).minus(l.credit);
          return { ...l, dateBs: bs(l.entry_date), balance: money(run) };
        }),
        closingBalance: money(run),
        note: 'Positive balance = the contact owes us; negative = we owe the contact.',
      };
    });
  }

  // ------------------------------------------------------- Integrity checks (database.md §6)
  async integrity(ctx: CompanyContext) {
    return this.tx(ctx, async (trx) => {
      const all = await trx.selectFrom('journal_lines').select([sql<string>`coalesce(sum(debit),0)`.as('dr'), sql<string>`coalesce(sum(credit),0)`.as('cr')]).executeTakeFirstOrThrow();
      const ctl = async (key: string) =>
        (await trx.selectFrom('journal_lines').innerJoin('accounts', 'accounts.id', 'journal_lines.account_id').select(sql<string>`coalesce(sum(debit - credit),0)`.as('b')).where('accounts.system_key', '=', key).executeTakeFirstOrThrow()).b;
      const arControl = await ctl('AR_CONTROL');
      const apControl = await ctl('AP_CONTROL');
      const arOpen = await sql<{ v: string }>`SELECT
          (SELECT coalesce(sum(amount_due),0) FROM sales_invoices WHERE status='POSTED' AND cash_account_id IS NULL)
        - (SELECT coalesce(sum(unallocated_amount),0) FROM receipts WHERE status='POSTED' AND kind='RECEIPT')
        - (SELECT coalesce(sum(unallocated_amount),0) FROM credit_notes WHERE status='POSTED' AND refund_account_id IS NULL) AS v`.execute(trx);
      const apOpen = await sql<{ v: string }>`SELECT
          (SELECT coalesce(sum(amount_due),0) FROM purchase_bills WHERE status='POSTED')
        - (SELECT coalesce(sum(unallocated_amount),0) FROM payments WHERE status='POSTED' AND kind='PAYMENT')
        - (SELECT coalesce(sum(unallocated_amount),0) FROM debit_notes WHERE status='POSTED' AND refund_account_id IS NULL) AS v`.execute(trx);
      const apb = await sql<{ n: string }>`SELECT count(*) n FROM (
          SELECT jl.account_id, je.period_id, sum(jl.debit) dr, sum(jl.credit) cr FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id GROUP BY 1,2) x
        FULL JOIN (SELECT account_id, period_id, sum(debit_total) dr, sum(credit_total) cr FROM account_period_balances GROUP BY 1,2) y USING (account_id, period_id)
        WHERE coalesce(x.dr,0) <> coalesce(y.dr,0) OR coalesce(x.cr,0) <> coalesce(y.cr,0)`.execute(trx);
      const audit = await sql<{ first_broken_id: string | null }>`SELECT * FROM verify_audit_chain(${ctx.companyId}::uuid)`.execute(trx);
      const checks = [
        { check: 'Ledger balances (total debits = total credits)', ok: d(all.dr).eq(all.cr), detail: `${money(all.dr)} / ${money(all.cr)}` },
        { check: 'AR control = open customer items', ok: d(arControl).eq(arOpen.rows[0].v), detail: `${money(arControl)} vs ${money(arOpen.rows[0].v)}` },
        { check: 'AP control = open supplier items', ok: d(apControl).neg().eq(apOpen.rows[0].v), detail: `${money(d(apControl).neg())} vs ${money(apOpen.rows[0].v)}` },
        { check: 'Balance snapshots match ledger lines', ok: Number(apb.rows[0].n) === 0, detail: `${apb.rows[0].n} mismatches` },
        { check: 'Audit log hash chain intact', ok: audit.rows[0].first_broken_id === null, detail: audit.rows[0].first_broken_id ? `broken at ${audit.rows[0].first_broken_id}` : 'ok' },
      ];
      return { ok: checks.every((c) => c.ok), checks };
    });
  }

  /** Simple home-page figures (full dashboard is Phase 4). */
  async summary(ctx: CompanyContext, asOf: string) {
    return this.tx(ctx, async (trx) => {
      const bal = async (subtypes: string[]) =>
        (await trx.selectFrom('journal_lines').innerJoin('accounts', 'accounts.id', 'journal_lines.account_id').select(sql<string>`coalesce(sum(debit - credit),0)`.as('b')).where('accounts.subtype', 'in', subtypes).where('journal_lines.entry_date', '<=', asOf).executeTakeFirstOrThrow()).b;
      const fyStart = await this.fyStart(trx, asOf).catch(() => addDays(asOf, -365));
      const pl = await sql<{ class: string; net: string }>`SELECT a.class, sum(jl.debit - jl.credit) net FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
        WHERE a.class IN ('INCOME','EXPENSE') AND jl.entry_date BETWEEN ${fyStart} AND ${asOf} GROUP BY a.class`.execute(trx);
      const income = d(pl.rows.find((r) => r.class === 'INCOME')?.net ?? 0).neg();
      const expense = d(pl.rows.find((r) => r.class === 'EXPENSE')?.net ?? 0);
      const pending = await trx.selectFrom('approval_requests').select(sql<string>`count(*)`.as('n')).where('status', '=', 'PENDING').executeTakeFirstOrThrow();
      const ar = await trx.selectFrom('sales_invoices').select([sql<string>`coalesce(sum(amount_due),0)`.as('due'), sql<string>`coalesce(sum(amount_due) FILTER (WHERE due_date < ${asOf}),0)`.as('overdue')]).where('status', '=', 'POSTED').executeTakeFirstOrThrow();
      const ap = await trx.selectFrom('purchase_bills').select([sql<string>`coalesce(sum(amount_due),0)`.as('due'), sql<string>`coalesce(sum(amount_due) FILTER (WHERE due_date <= ${addDays(asOf, 7)}),0)`.as('due7')]).where('status', '=', 'POSTED').executeTakeFirstOrThrow();
      return {
        asOf,
        cashAndBank: money(await bal(['CASH', 'BANK', 'WALLET'])),
        receivables: money(ar.due),
        receivablesOverdue: money(ar.overdue),
        payables: money(ap.due),
        payablesDueIn7Days: money(ap.due7),
        incomeYtd: money(income),
        expenseYtd: money(expense),
        profitYtd: money(income.minus(expense)),
        pendingApprovals: Number(pending.n),
      };
    });
  }
}
