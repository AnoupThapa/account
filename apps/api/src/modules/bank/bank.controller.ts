/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { z } from 'zod';
import { AppError, d, groupBalances, money, sum, suggestMatches, zAdDate, zMoneyNonNeg, type BookItem, type StmtItem } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { JournalsService } from '../journals/journals.service';
import { ApprovalService } from '../approvals/approval.service';

const uuid = z.string().uuid();
const importSchema = z.object({
  fileName: z.string().max(200).optional(),
  lines: z
    .array(
      z.object({
        txnDate: zAdDate,
        description: z.string().max(500).default(''),
        reference: z.string().max(100).nullish(),
        chequeNo: z.string().max(40).nullish(),
        moneyIn: zMoneyNonNeg.default('0'),
        moneyOut: zMoneyNonNeg.default('0'),
        balance: z.string().regex(/^-?\d+(\.\d{1,2})?$/).nullish(),
      }),
    )
    .min(1, 'The file has no transactions')
    .max(5000, 'Please import at most 5,000 lines at a time'),
});
const matchSchema = z.object({ statementLineIds: z.array(uuid).min(1).max(200), journalLineIds: z.array(uuid).min(1).max(200) });
const ignoreSchema = z.object({ reason: z.string().trim().min(3, 'Give a short reason').max(200) });
const linkSchema = z.object({ docType: z.enum(['RECEIPT', 'PAYMENT', 'EXPENSE', 'MANUAL_JOURNAL']), docId: uuid });
const journalSchema = z.object({
  kind: z.enum(['CHARGE', 'INTEREST', 'OTHER', 'UNIDENTIFIED']),
  accountId: uuid.optional(),
  description: z.string().trim().max(500).optional(),
});
const finishSchema = z.object({ statementDate: zAdDate, statementBalance: z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Enter the closing balance'), note: z.string().max(500).optional() });
const listQuery = z.object({ status: z.enum(['UNMATCHED', 'MATCHED', 'IGNORED', 'ALL']).default('UNMATCHED'), from: zAdDate.optional(), to: zAdDate.optional() });
const bookQuery = z.object({ status: z.enum(['unmatched', 'matched']).default('unmatched'), includeOlder: z.enum(['true', 'false']).default('false'), asAt: zAdDate.optional() });
const previewQuery = z.object({ date: zAdDate, balance: z.string().regex(/^-?\d+(\.\d{1,2})?$/) });

interface BookRow {
  id: string;
  entryId: string;
  date: string;
  amount: string;
  description: string;
  entryNo: string;
  sourceType: string;
  sourceNo: string | null;
  contactId: string | null;
  contactName: string | null;
  matched: boolean;
  groupId: string | null;
}

/** Bank reconciliation rules (docs/16). Never writes journal entries itself. */
@Injectable()
export class BankService {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService, private readonly journals: JournalsService, private readonly approvals: ApprovalService) {}

  // ------------------------------------------------------------------ helpers
  async bankAccount(trx: Tx, accountId: string) {
    const a = await trx.selectFrom('accounts').select(['id', 'code', 'name', 'subtype', 'is_active', 'is_postable']).where('id', '=', accountId).executeTakeFirst();
    if (!a) throw new AppError('NOT_FOUND');
    if (!a.is_postable || !['BANK', 'CASH', 'WALLET'].includes(a.subtype ?? '')) throw new AppError('BANK_NOT_BANK_ACCOUNT');
    return a;
  }

  private async firstStatementDate(trx: Tx, accountId: string) {
    const r = await trx.selectFrom('bank_statement_lines').select((eb) => eb.fn.min('txn_date').as('d')).where('account_id', '=', accountId).executeTakeFirst();
    return (r?.d as string | null) ?? null;
  }

  /** Book side: every ledger line on the bank account, with matched state; reversed/cancelled pairs that net to zero are hidden. */
  async bookLines(trx: Tx, accountId: string, o: { asAt?: string; includeOlder?: boolean; status?: 'unmatched' | 'matched' | 'all' } = {}): Promise<BookRow[]> {
    const asAt = o.asAt ?? '9999-12-31';
    const res = await sql<{
      id: string; entry_id: string; entry_date: string; debit: string; credit: string; line_desc: string | null; narration: string | null; entry_no: string;
      source_type: string; source_no: string | null; contact_id: string | null; contact_name: string | null; reversed_by: string | null; reversal_of: string | null;
      partner_date: string | null; group_id: string | null;
    }>`
      SELECT jl.id, jl.entry_id, to_char(jl.entry_date, 'YYYY-MM-DD') AS entry_date, jl.debit::text, jl.credit::text, jl.description AS line_desc, e.narration, e.entry_no,
             e.source_type, e.source_no, jl.contact_id, c.name AS contact_name, e.reversed_by_entry_id AS reversed_by, e.reversal_of,
             to_char(pe.entry_date, 'YYYY-MM-DD') AS partner_date, rm.group_id
        FROM journal_lines jl
        JOIN journal_entries e ON e.id = jl.entry_id
        LEFT JOIN contacts c ON c.id = jl.contact_id
        LEFT JOIN journal_entries pe ON pe.id = COALESCE(e.reversed_by_entry_id, e.reversal_of)
        LEFT JOIN reconciliation_matches rm ON rm.journal_line_id = jl.id
       WHERE jl.account_id = ${accountId} AND jl.entry_date <= ${asAt}::date
       ORDER BY jl.entry_date, e.entry_no, jl.line_no`.execute(trx);
    const matchedEntries = new Set(res.rows.filter((r) => r.group_id).map((r) => r.entry_id));
    const first = o.includeOlder ? null : await this.firstStatementDate(trx, accountId);
    const rows: BookRow[] = [];
    for (const r of res.rows) {
      const partnerId = r.reversed_by ?? r.reversal_of;
      if (partnerId && r.partner_date && r.partner_date <= asAt && !matchedEntries.has(r.entry_id) && !matchedEntries.has(partnerId)) continue; // cancelled pair nets to zero
      const matched = !!r.group_id;
      if (o.status === 'unmatched' && matched) continue;
      if (o.status === 'matched' && !matched) continue;
      if (o.status !== 'matched' && !matched && first && r.entry_date < first) continue; // cleared before the statement started
      rows.push({
        id: r.id, entryId: r.entry_id, date: r.entry_date, amount: money(d(r.debit).minus(r.credit)),
        description: [r.line_desc, r.narration].filter((x, i, a) => x && a.indexOf(x) === i).join(' — '),
        entryNo: r.entry_no, sourceType: r.source_type, sourceNo: r.source_no, contactId: r.contact_id, contactName: r.contact_name, matched, groupId: r.group_id,
      });
    }
    return rows;
  }

  private stmtSigned(l: { money_in: string; money_out: string }) {
    return money(d(l.money_in).minus(l.money_out));
  }

  // ------------------------------------------------------------------ accounts overview
  async accountsOverview(ctx: CompanyContext) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const accts = await trx.selectFrom('accounts').select(['id', 'code', 'name', 'subtype']).where('subtype', 'in', ['BANK', 'CASH', 'WALLET']).where('is_postable', '=', true).where('is_active', '=', true).orderBy('code').execute();
      const out = [];
      for (const a of accts) {
        const bal = await sql<{ b: string }>`SELECT COALESCE(SUM(debit - credit), 0)::text AS b FROM journal_lines WHERE account_id = ${a.id}`.execute(trx);
        const st = await sql<{ status: string; n: string }>`SELECT status, count(*)::text AS n FROM bank_statement_lines WHERE account_id = ${a.id} GROUP BY status`.execute(trx);
        const n = (s: string) => Number(st.rows.find((x) => x.status === s)?.n ?? 0);
        const last = await trx.selectFrom('reconciliations').select(['statement_date', 'statement_balance']).where('account_id', '=', a.id).orderBy('statement_date', 'desc').orderBy('created_at', 'desc').executeTakeFirst();
        out.push({ ...a, bookBalance: money(bal.rows[0].b), unmatchedStatement: n('UNMATCHED'), matchedStatement: n('MATCHED'), ignored: n('IGNORED'), lastReconciled: last ? { date: last.statement_date, balance: last.statement_balance } : null });
      }
      return out;
    });
  }

  // ------------------------------------------------------------------ import
  async importStatement(ctx: CompanyContext, accountId: string, b: z.infer<typeof importSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      const lines = b.lines.map((l) => {
        const inn = d(l.moneyIn);
        const out = d(l.moneyOut);
        if (inn.isZero() === out.isZero()) throw new AppError('BANK_IMPORT_FORMAT', 'Each line must have either money in or money out');
        return { ...l, moneyIn: money(inn), moneyOut: money(out) };
      });
      const hashes = new Map<string, number>(); // identical lines in one file are legitimate (e.g. two equal fees), so number repeats
      const prepared = lines.map((l) => {
        const key = [l.txnDate, l.description.trim().toLowerCase(), l.reference ?? '', l.chequeNo ?? '', l.moneyIn, l.moneyOut, l.balance ?? ''].join('|');
        const seq = (hashes.get(key) ?? 0) + 1;
        hashes.set(key, seq);
        return { ...l, hash: createHash('sha256').update(`${key}|${seq}`).digest('hex') };
      });
      const imp = await trx.insertInto('bank_statement_imports').values({ company_id: ctx.companyId, account_id: accountId, file_name: b.fileName ?? null, rows_total: lines.length, created_by: ctx.userId }).returning('id').executeTakeFirstOrThrow();
      let imported = 0;
      for (let i = 0; i < prepared.length; i += 500) {
        const chunk = prepared.slice(i, i + 500);
        const r = await trx
          .insertInto('bank_statement_lines')
          .values(chunk.map((l) => ({ company_id: ctx.companyId, import_id: imp.id, account_id: accountId, txn_date: l.txnDate, description: l.description, reference: l.reference ?? null, cheque_no: l.chequeNo ?? null, money_in: l.moneyIn, money_out: l.moneyOut, balance: l.balance ? money(l.balance) : null, line_hash: l.hash })))
          .onConflict((oc) => oc.columns(['company_id', 'account_id', 'line_hash']).doNothing())
          .returning('id')
          .execute();
        imported += r.length;
      }
      await trx.updateTable('bank_statement_imports').set({ rows_imported: imported, rows_skipped: lines.length - imported }).where('id', '=', imp.id).execute();
      await this.audit.log(trx, ctx, 'CREATE', 'bank_statement_import', imp.id, null, { accountId, fileName: b.fileName, total: lines.length, imported });
      return { importId: imp.id, total: lines.length, imported, skipped: lines.length - imported };
    });
  }

  // ------------------------------------------------------------------ statement lines
  async statementLines(ctx: CompanyContext, accountId: string, q: z.infer<typeof listQuery>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      if (ctx.permissions.has('bank.reconcile')) await this.settlePending(trx, ctx, accountId);
      const rows = await trx
        .selectFrom('bank_statement_lines as l')
        .leftJoin('reconciliation_matches as rm', 'rm.statement_line_id', 'l.id')
        .select(['l.id', 'l.txn_date', 'l.description', 'l.reference', 'l.cheque_no', 'l.money_in', 'l.money_out', 'l.balance', 'l.status', 'l.ignore_reason', 'l.pending_doc_type', 'l.pending_doc_id', 'rm.group_id'])
        .where('l.account_id', '=', accountId)
        .$if(q.status !== 'ALL', (x) => x.where('l.status', '=', q.status))
        .$if(!!q.from, (x) => x.where('l.txn_date', '>=', q.from!))
        .$if(!!q.to, (x) => x.where('l.txn_date', '<=', q.to!))
        .orderBy('l.txn_date')
        .orderBy('l.created_at')
        .limit(2000)
        .execute();
      const pend = rows.filter((r) => r.pending_doc_id);
      const docInfo = new Map<string, { no: string | null; status: string }>();
      for (const p of pend) {
        const table = ({ RECEIPT: 'receipts', PAYMENT: 'payments', EXPENSE: 'expenses', MANUAL_JOURNAL: 'manual_journals' } as Record<string, string>)[p.pending_doc_type!];
        const doc = await (trx as any).selectFrom(table).select(['doc_no', 'status']).where('id', '=', p.pending_doc_id).executeTakeFirst();
        if (doc) docInfo.set(p.pending_doc_id!, { no: doc.doc_no, status: doc.status });
      }
      return rows.map((r) => ({ ...r, amount: this.stmtSigned(r), pendingDoc: r.pending_doc_id ? { type: r.pending_doc_type, id: r.pending_doc_id, ...(docInfo.get(r.pending_doc_id) ?? { no: null, status: 'UNKNOWN' }) } : null }));
    });
  }

  async bookLinesFor(ctx: CompanyContext, accountId: string, q: z.infer<typeof bookQuery>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      return this.bookLines(trx, accountId, { asAt: q.asAt, includeOlder: q.includeOlder === 'true', status: q.status });
    });
  }

  // ------------------------------------------------------------------ matching
  private async openLines(trx: Tx, accountId: string) {
    const stmt = await trx.selectFrom('bank_statement_lines').selectAll().where('account_id', '=', accountId).where('status', '=', 'UNMATCHED').orderBy('txn_date').execute();
    const book = await this.bookLines(trx, accountId, { status: 'unmatched' });
    return { stmt, book };
  }

  async suggestions(ctx: CompanyContext, accountId: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      const { stmt, book } = await this.openLines(trx, accountId);
      return this.compute(stmt, book);
    });
  }

  private compute(stmt: { id: string; txn_date: string; money_in: string; money_out: string; description: string; reference: string | null; cheque_no: string | null }[], book: BookRow[]) {
    const s: StmtItem[] = stmt.map((l) => ({ id: l.id, date: l.txn_date, amount: this.stmtSigned(l), description: l.description, reference: l.reference, chequeNo: l.cheque_no }));
    const bk: BookItem[] = book.map((b) => ({ id: b.id, date: b.date, amount: b.amount, description: b.description, sourceNo: b.sourceNo ?? b.entryNo, contactId: b.contactId, contactName: b.contactName }));
    return suggestMatches(s, bk);
  }

  async match(ctx: CompanyContext, accountId: string, b: z.infer<typeof matchSchema>, method: 'AUTO' | 'MANUAL' | 'LINKED' = 'MANUAL') {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      return this.matchInTx(trx, ctx, accountId, b.statementLineIds, b.journalLineIds, method);
    });
  }

  async matchInTx(trx: Tx, ctx: CompanyContext, accountId: string, stmtIds: string[], jlIds: string[], method: 'AUTO' | 'MANUAL' | 'LINKED') {
    const sIds = [...new Set(stmtIds)];
    const jIds = [...new Set(jlIds)];
    const stmt = await trx.selectFrom('bank_statement_lines').selectAll().where('id', 'in', sIds).forUpdate().execute();
    if (stmt.length !== sIds.length || stmt.some((l) => l.account_id !== accountId)) throw new AppError('NOT_FOUND', 'Unknown statement line');
    if (stmt.some((l) => l.status !== 'UNMATCHED')) throw new AppError('BANK_ALREADY_MATCHED', 'A statement line is already matched or ignored');
    const jl = await trx.selectFrom('journal_lines').select(['id', 'account_id', 'debit', 'credit']).where('id', 'in', jIds).execute();
    if (jl.length !== jIds.length || jl.some((l) => l.account_id !== accountId)) throw new AppError('NOT_FOUND', 'Unknown book transaction');
    const already = await trx.selectFrom('reconciliation_matches').select('id').where('journal_line_id', 'in', jIds).executeTakeFirst();
    if (already) throw new AppError('BANK_ALREADY_MATCHED');
    const sAmts = stmt.map((l) => this.stmtSigned(l));
    const jAmts = jl.map((l) => money(d(l.debit).minus(l.credit)));
    if (!groupBalances(sAmts, jAmts)) {
      const diff = sum(sAmts).minus(sum(jAmts));
      throw new AppError('BANK_MATCH_UNBALANCED', `Statement total ${money(sum(sAmts))} and books total ${money(sum(jAmts))} differ by ${money(diff.abs())}`, { difference: money(diff) });
    }
    const g = await trx.insertInto('bank_match_groups').values({ company_id: ctx.companyId, account_id: accountId, method, created_by: ctx.userId }).returning('id').executeTakeFirstOrThrow();
    await trx.insertInto('reconciliation_matches').values([
      ...stmt.map((l, i) => ({ company_id: ctx.companyId, group_id: g.id, statement_line_id: l.id, journal_line_id: null, amount: sAmts[i] })),
      ...jl.map((l, i) => ({ company_id: ctx.companyId, group_id: g.id, statement_line_id: null, journal_line_id: l.id, amount: jAmts[i] })),
    ]).execute();
    await trx.updateTable('bank_statement_lines').set({ status: 'MATCHED', pending_doc_type: null, pending_doc_id: null }).where('id', 'in', sIds).execute();
    await this.audit.log(trx, ctx, 'CREATE', 'bank_match', g.id, null, { accountId, method, statementLineIds: sIds, journalLineIds: jIds, total: money(sum(sAmts)) });
    return { groupId: g.id, total: money(sum(sAmts)) };
  }

  async autoMatch(ctx: CompanyContext, accountId: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      const { stmt, book } = await this.openLines(trx, accountId);
      const sug = this.compute(stmt, book);
      let applied = 0;
      for (const s of sug.filter((x) => x.auto)) {
        await this.matchInTx(trx, ctx, accountId, [s.statementLineId], s.journalLineIds, 'AUTO');
        applied++;
      }
      const left = sug.filter((x) => !x.auto).length;
      await this.audit.log(trx, ctx, 'UPDATE', 'bank_auto_match', accountId, null, { applied, suggestionsLeft: left });
      return { applied, needConfirmation: left };
    });
  }

  async unmatch(ctx: CompanyContext, groupId: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const g = await trx.selectFrom('bank_match_groups').selectAll().where('id', '=', groupId).forUpdate().executeTakeFirst();
      if (!g) throw new AppError('NOT_FOUND');
      if (g.reconciliation_id) {
        if (!ctx.permissions.has('bank.unreconcile')) throw new AppError('BANK_ALREADY_RECONCILED');
        await sql`SELECT set_config('app.unreconcile', 'on', true)`.execute(trx);
      }
      const items = await trx.selectFrom('reconciliation_matches').selectAll().where('group_id', '=', groupId).execute();
      await trx.deleteFrom('reconciliation_matches').where('group_id', '=', groupId).execute();
      await trx.deleteFrom('bank_match_groups').where('id', '=', groupId).execute();
      const sIds = items.filter((i) => i.statement_line_id).map((i) => i.statement_line_id!) as string[];
      if (sIds.length) await trx.updateTable('bank_statement_lines').set({ status: 'UNMATCHED' }).where('id', 'in', sIds).execute();
      await sql`SELECT set_config('app.unreconcile', '', true)`.execute(trx);
      await this.audit.log(trx, ctx, 'DELETE', 'bank_match', groupId, { ...g, items }, null);
      return { ok: true, wasReconciled: !!g.reconciliation_id };
    });
  }

  async groupOf(ctx: CompanyContext, accountId: string) {
    // matched groups with both sides, for the "Matched" tab
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      const groups = await trx.selectFrom('bank_match_groups').selectAll().where('account_id', '=', accountId).orderBy('created_at', 'desc').limit(300).execute();
      if (!groups.length) return [];
      const ids = groups.map((g) => g.id);
      const items = await trx.selectFrom('reconciliation_matches').selectAll().where('group_id', 'in', ids).execute();
      const sl = await trx.selectFrom('bank_statement_lines').select(['id', 'txn_date', 'description']).where('id', 'in', items.filter((i) => i.statement_line_id).map((i) => i.statement_line_id!) as string[]).execute();
      const book = await this.bookLines(trx, accountId, { status: 'matched', includeOlder: true });
      return groups.map((g) => ({
        id: g.id, method: g.method, reconciled: !!g.reconciliation_id, at: g.created_at,
        statement: items.filter((i) => i.group_id === g.id && i.statement_line_id).map((i) => ({ ...sl.find((s) => s.id === i.statement_line_id), amount: i.amount })),
        books: items.filter((i) => i.group_id === g.id && i.journal_line_id).map((i) => book.find((b) => b.id === i.journal_line_id)).filter(Boolean),
      }));
    });
  }

  // ------------------------------------------------------------------ ignore
  async ignore(ctx: CompanyContext, lineId: string, reason: string | null) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const l = await trx.selectFrom('bank_statement_lines').selectAll().where('id', '=', lineId).forUpdate().executeTakeFirst();
      if (!l) throw new AppError('NOT_FOUND');
      if (reason !== null) {
        if (l.status !== 'UNMATCHED') throw new AppError('BANK_ALREADY_MATCHED', 'Only an unmatched line can be ignored');
        await trx.updateTable('bank_statement_lines').set({ status: 'IGNORED', ignore_reason: reason }).where('id', '=', lineId).execute();
      } else {
        if (l.status !== 'IGNORED') throw new AppError('APR_INVALID_STATE', 'This line is not ignored');
        await trx.updateTable('bank_statement_lines').set({ status: 'UNMATCHED', ignore_reason: null }).where('id', '=', lineId).execute();
      }
      await this.audit.log(trx, ctx, 'UPDATE', 'bank_statement_line', lineId, { status: l.status }, { status: reason !== null ? 'IGNORED' : 'UNMATCHED', reason });
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ create-from-statement
  /** Remember the document made for this statement line; it is matched automatically once it is posted. */
  async linkDoc(ctx: CompanyContext, lineId: string, b: z.infer<typeof linkSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const l = await trx.selectFrom('bank_statement_lines').selectAll().where('id', '=', lineId).forUpdate().executeTakeFirst();
      if (!l) throw new AppError('NOT_FOUND');
      if (l.status !== 'UNMATCHED') throw new AppError('BANK_ALREADY_MATCHED', 'This line is already matched or ignored');
      const amt = d(this.stmtSigned(l));
      const t = ({ RECEIPT: 'receipts', PAYMENT: 'payments', EXPENSE: 'expenses', MANUAL_JOURNAL: 'manual_journals' } as const)[b.docType];
      const doc = await (trx as any).selectFrom(t).selectAll().where('id', '=', b.docId).executeTakeFirst();
      if (!doc) throw new AppError('NOT_FOUND', 'Unknown document');
      if (['CANCELLED', 'REJECTED', 'REVERSED'].includes(doc.status)) throw new AppError('VAL_FIELD', 'That document is cancelled or rejected');
      const mismatch = () => new AppError('VAL_FIELD', 'The document does not match this bank line (account or amount differs)');
      if (b.docType === 'RECEIPT' && (!amt.gt(0) || doc.deposit_account_id !== l.account_id || !d(doc.amount).eq(amt))) throw mismatch();
      if (b.docType === 'PAYMENT' && (!amt.lt(0) || doc.paid_from_account_id !== l.account_id || !d(doc.amount).eq(amt.abs()))) throw mismatch();
      if (b.docType === 'EXPENSE' && (!amt.lt(0) || doc.kind !== 'PAID' || doc.paid_from_account_id !== l.account_id || !d(doc.grand_total).eq(amt.abs()))) throw mismatch();
      await trx.updateTable('bank_statement_lines').set({ pending_doc_type: b.docType, pending_doc_id: b.docId }).where('id', '=', lineId).execute();
      await this.audit.log(trx, ctx, 'UPDATE', 'bank_statement_line', lineId, null, { linkedDoc: b });
      const matched = await this.settleLine(trx, ctx, { ...l, pending_doc_type: b.docType, pending_doc_id: b.docId });
      return { linked: true, matched, docStatus: doc.status, docNo: doc.doc_no };
    });
  }

  /** If the document made from a statement line has been posted, match the line to the document's bank entry. */
  private async settleLine(trx: Tx, ctx: CompanyContext, l: { id: string; account_id: string; money_in: string; money_out: string; pending_doc_type: string | null; pending_doc_id: string | null; status: string }) {
    if (!l.pending_doc_id || l.status !== 'UNMATCHED') return false;
    const t = ({ RECEIPT: 'receipts', PAYMENT: 'payments', EXPENSE: 'expenses', MANUAL_JOURNAL: 'manual_journals' } as Record<string, string>)[l.pending_doc_type!];
    const doc = await (trx as any).selectFrom(t).select(['status', 'journal_entry_id']).where('id', '=', l.pending_doc_id).executeTakeFirst();
    if (!doc || ['CANCELLED', 'REJECTED', 'REVERSED'].includes(doc.status)) {
      await trx.updateTable('bank_statement_lines').set({ pending_doc_type: null, pending_doc_id: null }).where('id', '=', l.id).execute();
      return false;
    }
    if (doc.status !== 'POSTED' || !doc.journal_entry_id) return false;
    const amount = this.stmtSigned(l);
    const cands = await sql<{ id: string }>`
      SELECT jl.id FROM journal_lines jl
       WHERE jl.entry_id = ${doc.journal_entry_id} AND jl.account_id = ${l.account_id} AND (jl.debit - jl.credit) = ${amount}::numeric
         AND NOT EXISTS (SELECT 1 FROM reconciliation_matches rm WHERE rm.journal_line_id = jl.id)
       ORDER BY jl.line_no LIMIT 1`.execute(trx);
    if (!cands.rows.length) return false;
    await this.matchInTx(trx, ctx, l.account_id, [l.id], [cands.rows[0].id], 'LINKED');
    return true;
  }

  private async settlePending(trx: Tx, ctx: CompanyContext, accountId: string) {
    const rows = await trx.selectFrom('bank_statement_lines').selectAll().where('account_id', '=', accountId).where('status', '=', 'UNMATCHED').where('pending_doc_id', 'is not', null).forUpdate().execute();
    for (const l of rows) await this.settleLine(trx, ctx, l);
  }

  /** Draft (and submit) a journal for bank charges, interest, other items, or an unidentified item that goes to Suspense. */
  async createJournal(ctx: CompanyContext, lineId: string, b: z.infer<typeof journalSchema>) {
    const need = ['journal.create'];
    for (const p of need) if (!ctx.permissions.has(p)) throw new AppError('PERM_DENIED', `You need permission "${p}"`);
    const prep = await this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const l = await trx.selectFrom('bank_statement_lines').selectAll().where('id', '=', lineId).executeTakeFirst();
      if (!l) throw new AppError('NOT_FOUND');
      if (l.status !== 'UNMATCHED') throw new AppError('BANK_ALREADY_MATCHED', 'This line is already matched or ignored');
      if (l.pending_doc_id) throw new AppError('VAL_FIELD', 'A document has already been created for this line');
      const isIn = d(l.money_in).gt(0);
      let counter = b.accountId;
      if (b.kind === 'UNIDENTIFIED' || (b.kind === 'CHARGE' && !counter)) {
        const key = b.kind === 'CHARGE' ? 'BANK_CHARGES' : isIn ? 'SUSPENSE_RECEIPTS' : 'SUSPENSE_PAYMENTS';
        const a = await trx.selectFrom('accounts').select('id').where('system_key', '=', key).executeTakeFirst();
        if (!a) throw new AppError('VAL_FIELD', `The account ${key} is missing from the chart of accounts`);
        counter = a.id;
      }
      if (!counter) throw new AppError('VAL_FIELD', 'Choose the account for this item', undefined, [{ field: 'accountId', message: 'Required' }]);
      if (counter === l.account_id) throw new AppError('VAL_FIELD', 'Choose a different account than the bank account itself');
      return { l, isIn, counter };
    });
    const { l, isIn, counter } = prep;
    const amount = isIn ? l.money_in : l.money_out;
    const label = { CHARGE: 'Bank charges', INTEREST: 'Bank interest', OTHER: 'Bank item', UNIDENTIFIED: 'Unidentified bank item' }[b.kind];
    const narration = `${label}: ${b.description || l.description || 'per bank statement'} (${l.txn_date})`.slice(0, 2000);
    const bankLine = { accountId: l.account_id, debit: isIn ? amount : '0', credit: isIn ? '0' : amount, description: l.description.slice(0, 500) };
    const otherLine = { accountId: counter, debit: isIn ? '0' : amount, credit: isIn ? amount : '0', description: b.description || l.description.slice(0, 500) };
    const j = await this.journals.create(ctx, { journalDate: l.txn_date, narration, reference: l.reference ?? l.cheque_no ?? undefined, lines: [bankLine, otherLine] } as any);
    await this.linkDoc(ctx, lineId, { docType: 'MANUAL_JOURNAL', docId: j.id });
    let submit: unknown = { status: 'DRAFT' };
    if (ctx.permissions.has('journal.create')) submit = await this.approvals.submit(ctx, 'MANUAL_JOURNAL', j.id);
    await this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const fresh = await trx.selectFrom('bank_statement_lines').selectAll().where('id', '=', lineId).executeTakeFirstOrThrow();
      await this.settleLine(trx, ctx, fresh);
    });
    return { journalId: j.id, submit };
  }

  // ------------------------------------------------------------------ finish
  async compute_(trx: Tx, accountId: string, date: string, statementBalance: string) {
    const bal = await sql<{ b: string }>`SELECT COALESCE(SUM(debit - credit), 0)::text AS b FROM journal_lines WHERE account_id = ${accountId} AND entry_date <= ${date}::date`.execute(trx);
    const book = d(bal.rows[0].b);
    const unmatchedBook = await this.bookLines(trx, accountId, { asAt: date, status: 'unmatched' });
    const ubook = sum(unmatchedBook.map((b) => b.amount));
    const stmtRows = await trx.selectFrom('bank_statement_lines').selectAll().where('account_id', '=', accountId).where('txn_date', '<=', date).execute();
    const open = stmtRows.filter((l) => l.status === 'UNMATCHED');
    const ignored = stmtRows.filter((l) => l.status === 'IGNORED');
    const ustmt = sum(ignored.map((l) => this.stmtSigned(l)));
    const expected = book.minus(ubook).plus(ustmt);
    const difference = d(statementBalance).minus(expected);
    // a matched group must sit wholly on one side of the date, otherwise the maths cannot work
    const straddle = await sql<{ n: string }>`
      SELECT count(DISTINCT g.id)::text AS n FROM bank_match_groups g
        JOIN reconciliation_matches s ON s.group_id = g.id AND s.statement_line_id IS NOT NULL
        JOIN bank_statement_lines sl ON sl.id = s.statement_line_id AND sl.txn_date <= ${date}::date
        JOIN reconciliation_matches b ON b.group_id = g.id AND b.journal_line_id IS NOT NULL
        JOIN journal_lines jl ON jl.id = b.journal_line_id AND jl.entry_date > ${date}::date
       WHERE g.account_id = ${accountId} AND g.reconciliation_id IS NULL`.execute(trx);
    return {
      statementDate: date, statementBalance: money(statementBalance), bookBalance: money(book), unmatchedBookNet: money(ubook), unmatchedStatementNet: money(ustmt),
      expectedStatementBalance: money(expected), difference: money(difference), openStatementLines: open.length, straddling: Number(straddle.rows[0].n),
      unmatchedBook, ignored: ignored.map((l) => ({ id: l.id, date: l.txn_date, description: l.description, amount: this.stmtSigned(l), reason: l.ignore_reason })),
    };
  }

  async preview(ctx: CompanyContext, accountId: string, q: z.infer<typeof previewQuery>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      const r = await this.compute_(trx, accountId, q.date, q.balance);
      return { ...r, canFinish: d(r.difference).isZero() && r.openStatementLines === 0 && r.straddling === 0 };
    });
  }

  async finish(ctx: CompanyContext, accountId: string, b: z.infer<typeof finishSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const acct = await this.bankAccount(trx, accountId);
      await sql`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`.execute(trx);
      const r = await this.compute_(trx, accountId, b.statementDate, b.statementBalance);
      if (r.openStatementLines > 0) throw new AppError('BANK_RECON_DIFFERENCE', `${r.openStatementLines} statement line(s) up to ${b.statementDate} are still unmatched — match, add a transaction for, or ignore them first`);
      if (r.straddling > 0) throw new AppError('BANK_RECON_DIFFERENCE', 'A match links a statement line on or before this date with a book entry after it — choose a later statement date');
      if (!d(r.difference).isZero()) throw new AppError('BANK_RECON_DIFFERENCE', `The statement balance differs from the books by ${r.difference} — check the closing balance and that the whole statement is imported`, { difference: r.difference });
      const row = await trx
        .insertInto('reconciliations')
        .values({
          company_id: ctx.companyId, account_id: accountId, statement_date: b.statementDate, statement_balance: money(b.statementBalance), book_balance: r.bookBalance,
          unmatched_book_net: r.unmatchedBookNet, unmatched_statement_net: r.unmatchedStatementNet, difference: '0.00', note: b.note ?? null, created_by: ctx.userId,
          details: JSON.stringify({ account: { code: acct.code, name: acct.name }, outstandingBook: r.unmatchedBook, ignored: r.ignored }),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const lock = await sql`
        UPDATE bank_match_groups g SET reconciliation_id = ${row.id}
         WHERE g.account_id = ${accountId} AND g.reconciliation_id IS NULL
           AND EXISTS (SELECT 1 FROM reconciliation_matches m JOIN bank_statement_lines sl ON sl.id = m.statement_line_id WHERE m.group_id = g.id AND sl.txn_date <= ${b.statementDate}::date)`.execute(trx);
      await this.audit.log(trx, ctx, 'CREATE', 'bank_reconciliation', row.id, null, { accountId, ...b, groupsLocked: Number(lock.numAffectedRows ?? 0) });
      return { id: row.id, groupsLocked: Number(lock.numAffectedRows ?? 0) };
    });
  }

  async history(ctx: CompanyContext, accountId: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      await this.bankAccount(trx, accountId);
      return trx.selectFrom('reconciliations as r').innerJoin('users as u', 'u.id', 'r.created_by').select(['r.id', 'r.statement_date', 'r.statement_balance', 'r.book_balance', 'r.note', 'r.created_at', 'u.full_name as created_by_name']).where('r.account_id', '=', accountId).orderBy('r.statement_date', 'desc').orderBy('r.created_at', 'desc').limit(100).execute();
    });
  }

  async statement(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const r = await trx.selectFrom('reconciliations as r').innerJoin('users as u', 'u.id', 'r.created_by').selectAll('r').select('u.full_name as created_by_name').where('r.id', '=', id).executeTakeFirst();
      if (!r) throw new AppError('NOT_FOUND');
      const co = await trx.selectFrom('companies').select(['name', 'base_currency']).where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
      return { ...r, company: co };
    });
  }
}

@Controller('bank')
export class BankController {
  constructor(private readonly svc: BankService) {}

  @Perm('bank.view') @Get('accounts') accounts(@Ctx() ctx: CompanyContext) {
    return this.svc.accountsOverview(ctx);
  }
  @Perm('bank.import') @Post('accounts/:accountId/import') import(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string, @Body(new Zod(importSchema)) b: z.infer<typeof importSchema>) {
    return this.svc.importStatement(ctx, id, b);
  }
  @Perm('bank.view') @Get('accounts/:accountId/statement-lines') lines(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.statementLines(ctx, id, q);
  }
  @Perm('bank.view') @Get('accounts/:accountId/book-lines') book(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string, @Query(new Zod(bookQuery)) q: z.infer<typeof bookQuery>) {
    return this.svc.bookLinesFor(ctx, id, q);
  }
  @Perm('bank.view') @Get('accounts/:accountId/suggestions') suggestions(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string) {
    return this.svc.suggestions(ctx, id);
  }
  @Perm('bank.view') @Get('accounts/:accountId/matches') matches(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string) {
    return this.svc.groupOf(ctx, id);
  }
  @Perm('bank.reconcile') @Post('accounts/:accountId/match') match(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string, @Body(new Zod(matchSchema)) b: z.infer<typeof matchSchema>) {
    return this.svc.match(ctx, id, b);
  }
  @Perm('bank.reconcile') @Post('accounts/:accountId/auto-match') auto(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string) {
    return this.svc.autoMatch(ctx, id);
  }
  @Perm('bank.reconcile') @Post('matches/:groupId/unmatch') unmatch(@Ctx() ctx: CompanyContext, @Param('groupId', new Zod(uuid)) id: string) {
    return this.svc.unmatch(ctx, id);
  }
  @Perm('bank.reconcile') @Post('lines/:lineId/ignore') ignore(@Ctx() ctx: CompanyContext, @Param('lineId', new Zod(uuid)) id: string, @Body(new Zod(ignoreSchema)) b: z.infer<typeof ignoreSchema>) {
    return this.svc.ignore(ctx, id, b.reason);
  }
  @Perm('bank.reconcile') @Post('lines/:lineId/unignore') unignore(@Ctx() ctx: CompanyContext, @Param('lineId', new Zod(uuid)) id: string) {
    return this.svc.ignore(ctx, id, null);
  }
  @Perm('bank.reconcile') @Post('lines/:lineId/link-doc') link(@Ctx() ctx: CompanyContext, @Param('lineId', new Zod(uuid)) id: string, @Body(new Zod(linkSchema)) b: z.infer<typeof linkSchema>) {
    const need = { RECEIPT: 'receipt.create', PAYMENT: 'payment.create', EXPENSE: 'expense.create', MANUAL_JOURNAL: 'journal.create' }[b.docType];
    if (!ctx.permissions.has(need)) throw new AppError('PERM_DENIED', `You need permission "${need}"`);
    return this.svc.linkDoc(ctx, id, b);
  }
  @Perm('bank.reconcile') @Post('lines/:lineId/journal') journal(@Ctx() ctx: CompanyContext, @Param('lineId', new Zod(uuid)) id: string, @Body(new Zod(journalSchema)) b: z.infer<typeof journalSchema>) {
    return this.svc.createJournal(ctx, id, b);
  }
  @Perm('bank.view') @Get('accounts/:accountId/reconcile-preview') preview(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string, @Query(new Zod(previewQuery)) q: z.infer<typeof previewQuery>) {
    return this.svc.preview(ctx, id, q);
  }
  @Perm('bank.reconcile') @Post('accounts/:accountId/finish') finish(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string, @Body(new Zod(finishSchema)) b: z.infer<typeof finishSchema>) {
    return this.svc.finish(ctx, id, b);
  }
  @Perm('bank.view') @Get('accounts/:accountId/reconciliations') history(@Ctx() ctx: CompanyContext, @Param('accountId', new Zod(uuid)) id: string) {
    return this.svc.history(ctx, id);
  }
  @Perm('bank.view') @Get('reconciliations/:id') statement(@Ctx() ctx: CompanyContext, @Param('id', new Zod(uuid)) id: string) {
    return this.svc.statement(ctx, id);
  }
}
