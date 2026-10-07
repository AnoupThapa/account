/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { todayAd, zAdDate } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { ReportsService } from './reports.service';

const range = z.object({ from: zAdDate, to: zAdDate, format: z.enum(['json', 'csv']).default('json') });
const tbQuery = range.extend({ includeZero: z.enum(['true', 'false']).optional(), branchId: z.string().uuid().optional(), costCentreId: z.string().uuid().optional() });
const glQuery = range.extend({ accountId: z.string().uuid(), contactId: z.string().uuid().optional() });

/** CSV with formula-injection protection (security.md §4) and an export watermark line. */
function toCsv(rows: Record<string, unknown>[], watermark: string): string {
  if (!rows.length) return `# ${watermark}\n`;
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [`# ${watermark}`, cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService, private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  /** Exports need report.<name>.export, are watermarked and audit-logged (docs/06 §3). */
  private async maybeExport(ctx: CompanyContext, name: string, format: string, rows: Record<string, unknown>[], res: Response, data: unknown) {
    if (format !== 'csv') return data;
    if (!ctx.permissions.has(`report.${name}.export`)) {
      res.status(403).type('application/problem+json').json({ type: 'https://docs.ledgerpro.app/errors/PERM_DENIED', title: "You don't have access to this action", status: 403, code: 'PERM_DENIED', detail: `You need permission "report.${name}.export"` });
      return;
    }
    const user = await this.dbs.db.selectFrom('users').select(['full_name', 'email']).where('id', '=', ctx.userId).executeTakeFirstOrThrow();
    const watermark = `LedgerPro export — ${name} — by ${user.full_name} <${user.email}> at ${new Date().toISOString()} — CONFIDENTIAL management accounts (unaudited)`;
    await this.dbs.tenant(ctx.companyId, ctx.userId, (trx) => this.audit.log(trx, ctx, 'EXPORT', `report.${name}`, null, null, { format, rows: rows.length }));
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${todayAd()}.csv"`);
    res.type('text/csv').send(toCsv(rows, watermark));
  }

  @Perm('report.trial_balance.view')
  @Get('trial-balance')
  async tb(@Ctx() ctx: CompanyContext, @Query(new Zod(tbQuery)) q: z.infer<typeof tbQuery>, @Res({ passthrough: true }) res: Response) {
    const r = await this.reports.trialBalance(ctx, q.from, q.to, { includeZero: q.includeZero === 'true', branchId: q.branchId, costCentreId: q.costCentreId });
    return this.maybeExport(ctx, 'trial_balance', q.format, r.rows, res, r);
  }

  @Perm('report.general_ledger.view')
  @Get('general-ledger')
  async gl(@Ctx() ctx: CompanyContext, @Query(new Zod(glQuery)) q: z.infer<typeof glQuery>, @Res({ passthrough: true }) res: Response) {
    const r = await this.reports.generalLedger(ctx, q.accountId, q.from, q.to, q.contactId);
    return this.maybeExport(ctx, 'general_ledger', q.format, r.lines, res, r);
  }

  @Perm('report.journal.view')
  @Get('journal')
  async journal(@Ctx() ctx: CompanyContext, @Query(new Zod(range.extend({ sourceType: z.string().optional() }))) q: z.infer<typeof range> & { sourceType?: string }, @Res({ passthrough: true }) res: Response) {
    const r = await this.reports.journalRegister(ctx, q.from, q.to, q.sourceType);
    return this.maybeExport(ctx, 'journal', q.format, r.entries.flatMap((e) => e.lines.map((l) => ({ date: e.entry_date, dateBs: e.dateBs, entryNo: e.entry_no, source: e.source_no, narration: e.narration, ...l }))), res, r);
  }

  @Perm('report.day_book.view')
  @Get('day-book')
  async dayBook(@Ctx() ctx: CompanyContext, @Query(new Zod(range)) q: z.infer<typeof range>, @Res({ passthrough: true }) res: Response) {
    const r = await this.reports.dayBook(ctx, q.from, q.to);
    return this.maybeExport(ctx, 'day_book', q.format, r.entries.map((e) => ({ date: e.entry_date, dateBs: e.dateBs, entryNo: e.entry_no, source: e.source_type, ref: e.source_no, narration: e.narration, amount: e.total })), res, r);
  }

  @Perm('report.sales_book.view')
  @Get('sales-book')
  async salesBook(@Ctx() ctx: CompanyContext, @Query(new Zod(range)) q: z.infer<typeof range>, @Res({ passthrough: true }) res: Response) {
    const r = await this.reports.salesBook(ctx, q.from, q.to);
    return this.maybeExport(ctx, 'sales_book', q.format, r.rows as unknown as Record<string, unknown>[], res, r);
  }

  @Perm('report.purchase_book.view')
  @Get('purchase-book')
  async purchaseBook(@Ctx() ctx: CompanyContext, @Query(new Zod(range)) q: z.infer<typeof range>, @Res({ passthrough: true }) res: Response) {
    const r = await this.reports.purchaseBook(ctx, q.from, q.to);
    return this.maybeExport(ctx, 'purchase_book', q.format, r.rows as unknown as Record<string, unknown>[], res, r);
  }

  @Perm('report.vat_summary.view')
  @Get('tax-summary')
  taxSummary(@Ctx() ctx: CompanyContext, @Query(new Zod(range)) q: z.infer<typeof range>) {
    return this.reports.taxSummary(ctx, q.from, q.to);
  }

  @Perm('member')
  @Get('aging/:side')
  async aging(@Ctx() ctx: CompanyContext, @Param('side') side: string, @Query(new Zod(z.object({ asOf: zAdDate.optional(), format: z.enum(['json', 'csv']).default('json') }))) q: { asOf?: string; format: string }, @Res({ passthrough: true }) res: Response) {
    const s = side.toUpperCase() === 'AP' ? 'AP' : 'AR';
    const perm = s === 'AR' ? 'report.ar_aging.view' : 'report.ap_aging.view';
    if (!ctx.permissions.has(perm)) {
      res.status(403).type('application/problem+json').json({ type: 'https://docs.ledgerpro.app/errors/PERM_DENIED', title: "You don't have access to this action", status: 403, code: 'PERM_DENIED', detail: `You need permission "${perm}"` });
      return;
    }
    const r = await this.reports.aging(ctx, s, q.asOf ?? todayAd());
    return this.maybeExport(ctx, s === 'AR' ? 'ar_aging' : 'ap_aging', q.format, r.contacts as unknown as Record<string, unknown>[], res, r);
  }

  @Perm('report.contact_statement.view')
  @Get('statement/:contactId')
  statement(@Ctx() ctx: CompanyContext, @Param('contactId') id: string, @Query(new Zod(range)) q: z.infer<typeof range>) {
    return this.reports.statement(ctx, id, q.from, q.to);
  }

  @Perm('audit.view')
  @Get('integrity')
  integrity(@Ctx() ctx: CompanyContext) {
    return this.reports.integrity(ctx);
  }

  @Perm('member')
  @Get('summary')
  summary(@Ctx() ctx: CompanyContext, @Query('asOf') asOf?: string) {
    return this.reports.summary(ctx, asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : todayAd());
  }

  /** Drill-down: journal entry → lines → source document reference. */
  @Perm('report.general_ledger.view')
  @Get('entries/:id')
  entry(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const e = await trx.selectFrom('journal_entries').selectAll().where('id', '=', id).executeTakeFirst();
      if (!e) return null;
      const lines = await trx
        .selectFrom('journal_lines')
        .innerJoin('accounts', 'accounts.id', 'journal_lines.account_id')
        .leftJoin('contacts', 'contacts.id', 'journal_lines.contact_id')
        .select(['line_no', 'account_id', 'accounts.code', 'accounts.name', 'debit', 'credit', 'contacts.name as contact_name', 'journal_lines.description'])
        .where('entry_id', '=', id)
        .orderBy('line_no')
        .execute();
      return { ...e, lines };
    });
  }
}
