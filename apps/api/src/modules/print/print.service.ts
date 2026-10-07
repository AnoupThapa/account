/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Controller, Get, Injectable, OnModuleDestroy, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, amountInWords, formatBsLong, formatAdLong, formatMoney, toBS, d } from '@ledgerpro/shared';
import { chromium, Browser } from 'playwright-core';
import { Ctx, Perm } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { DatabaseService } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { config } from '../../config';
import { LINE_DOCS, LineDocKind } from '../sales/line-docs';

const TITLES: Record<string, string> = {
  SALES_INVOICE: 'Invoice',
  CREDIT_NOTE: 'Credit Note',
  PURCHASE_BILL: 'Purchase Bill',
  DEBIT_NOTE: 'Debit Note',
  EXPENSE: 'Expense Voucher',
  SALES_QUOTE: 'Quotation',
  SALES_ORDER: 'Sales Order',
  PURCHASE_ORDER: 'Purchase Order',
};

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function dual(ad: string | null) {
  if (!ad) return '';
  try {
    return `${esc(formatBsLong(toBS(ad)))} BS <span class="muted">(${esc(formatAdLong(ad))})</span>`;
  } catch {
    return esc(formatAdLong(ad));
  }
}

@Injectable()
export class PrintService implements OnModuleDestroy {
  private browser: Promise<Browser> | null = null;
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  async onModuleDestroy() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }

  private async getBrowser() {
    if (!this.browser) this.browser = chromium.launch({ executablePath: config().CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    return this.browser;
  }

  async pdf(html: string): Promise<Buffer> {
    const b = await this.getBrowser().catch((e) => {
      this.browser = null;
      throw new AppError('SYS_UNEXPECTED', 'PDF engine unavailable — use the HTML print view (' + (e as Error).message.slice(0, 80) + ')');
    });
    const page = await b.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '14mm', left: '12mm', right: '12mm' } });
    } finally {
      await page.close();
    }
  }

  /** Render a document; increments the print counter for posted documents (reprints say "Copy of original"). */
  async render(ctx: CompanyContext, kind: LineDocKind, id: string, countPrint: boolean) {
    const cfg = LINE_DOCS[kind];
    if (!cfg) throw new AppError('NOT_FOUND');
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const co = await trx.selectFrom('companies').selectAll().where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
      const doc: any = await (trx as any).selectFrom(cfg.table).selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!doc) throw new AppError('NOT_FOUND');
      const contact = doc.contact_id ? await trx.selectFrom('contacts').selectAll().where('id', '=', doc.contact_id).executeTakeFirst() : null;
      const lines: any[] = await (trx as any)
        .selectFrom(cfg.linesTable)
        .leftJoin('items', 'items.id', `${cfg.linesTable}.item_id`)
        .leftJoin('tax_codes', 'tax_codes.id', `${cfg.linesTable}.tax_code_id`)
        .selectAll(cfg.linesTable)
        .select(['items.sku', 'items.uom_code', 'items.hs_code', 'tax_codes.code as tax_code'])
        .where(cfg.fk, '=', id)
        .orderBy('line_no')
        .execute();
      let printNo = doc.print_count ?? 0;
      const printable = ['POSTED', 'CANCELLED'].includes(doc.status);
      if (countPrint && printable && 'print_count' in doc) {
        printNo += 1;
        await (trx as any).updateTable(cfg.table).set({ print_count: printNo, last_printed_at: new Date() }).where('id', '=', id).execute();
        await this.audit.log(trx, ctx, 'PRINT', cfg.table, id, null, { printNo });
      }
      const date = doc[cfg.dateField];
      const cur = doc.currency_code ?? co.base_currency;
      const taxName = co.country === 'AU' ? 'GST' : 'VAT';
      const hasTax = d(doc.tax_total ?? 0).gt(0);
      let title = TITLES[kind];
      if (kind === 'SALES_INVOICE' && hasTax) title = co.country === 'AU' ? 'Tax Invoice' : 'Tax Invoice';
      if (kind === 'SALES_INVOICE' && doc.cash_account_id) title += ' (Cash)';
      const copyLabel = !printable ? 'DRAFT — NOT A VALID DOCUMENT' : printNo <= 1 ? 'Original' : `Copy of original (${printNo - 1})`;
      const idLabel = (c: { pan?: string | null; abn?: string | null; vat_no?: string | null } | null | undefined) =>
        !c ? '' : co.country === 'AU' ? (c.abn ? `ABN ${esc(c.abn)}` : '') : c.pan ? `PAN/VAT No. ${esc(c.pan)}` : '';
      const partyName = doc.buyer_name ?? contact?.name ?? 'Cash / Direct';
      const rows = lines
        .map(
          (l) => `<tr>
          <td>${l.line_no}</td>
          <td>${esc(l.description)}${l.sku ? `<div class="muted">${esc(l.sku)}${l.hs_code ? ' · HS ' + esc(l.hs_code) : ''}</div>` : ''}</td>
          <td class="r">${esc(Number(l.quantity).toString())} ${esc(l.uom_code ?? '')}</td>
          <td class="r">${formatMoney(l.unit_price, cur)}</td>
          <td class="r">${Number(l.discount_percent) ? esc(Number(l.discount_percent)) + '%' : ''}</td>
          <td>${esc(l.tax_code ?? '')}</td>
          <td class="r">${formatMoney(l.net_amount, cur)}</td></tr>`,
        )
        .join('');
      const total = doc.grand_total;
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} ${esc(doc.doc_no ?? '')}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:12px;margin:0}
  .wrap{max-width:780px;margin:0 auto;padding:8px}
  h1{font-size:20px;margin:0;letter-spacing:.5px;text-transform:uppercase}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px}
  .muted{color:#666;font-size:11px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
  .box{border:1px solid #ccc;border-radius:4px;padding:8px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}
  th{background:#f3f4f6;font-size:11px;text-transform:uppercase}
  .r{text-align:right}
  .totals{margin-left:auto;width:320px;margin-top:8px}
  .totals td{border:none;padding:3px 4px}
  .grand td{font-weight:700;font-size:14px;border-top:2px solid #111}
  .copy{font-weight:600;font-size:11px;border:1px solid #111;padding:2px 6px;display:inline-block;margin-top:4px}
  .stamp{position:fixed;top:40%;left:15%;font-size:72px;color:rgba(200,0,0,.18);transform:rotate(-25deg);font-weight:800}
  .foot{margin-top:28px;display:flex;justify-content:space-between;font-size:11px}
</style></head><body><div class="wrap">
${doc.status === 'CANCELLED' ? '<div class="stamp">CANCELLED</div>' : ''}
<div class="top">
  <div><div style="font-size:16px;font-weight:700">${esc(co.legal_name ?? co.name)}</div>
  <div class="muted">${esc(co.address ?? '')}</div>
  <div class="muted">${idLabel({ pan: co.pan ?? co.vat_no, abn: co.abn })}${co.phone ? ' · ' + esc(co.phone) : ''}${co.email ? ' · ' + esc(co.email) : ''}</div></div>
  <div style="text-align:right"><h1>${esc(title)}</h1>
  <div><b>No.</b> ${esc(doc.doc_no ?? 'DRAFT')}</div>
  <div><b>Date:</b> ${dual(date)}</div>
  ${doc.due_date ? `<div><b>Due:</b> ${dual(doc.due_date)}</div>` : ''}
  <div class="copy">${esc(copyLabel)}</div></div>
</div>
<div class="grid">
  <div class="box"><div class="muted">${cfg.side === 'SALES' ? 'Bill to' : 'Supplier'}</div>
    <div style="font-weight:600">${esc(partyName)}</div>
    <div class="muted">${esc(doc.buyer_address ?? contact?.address ?? '')}</div>
    <div>${idLabel(doc.buyer_pan ? { pan: doc.buyer_pan, abn: contact?.abn } : contact)}</div></div>
  <div class="box">
    ${doc.supplier_invoice_no ? `<div><b>Supplier invoice:</b> ${esc(doc.supplier_invoice_no)}</div>` : ''}
    ${doc.customer_ref ? `<div><b>Your ref:</b> ${esc(doc.customer_ref)}</div>` : ''}
    ${doc.reason ? `<div><b>Reason:</b> ${esc(doc.reason)}</div>` : ''}
    ${doc.status === 'CANCELLED' ? `<div><b>Cancelled:</b> ${esc(doc.cancel_reason)}</div>` : ''}
    <div><b>Currency:</b> ${esc(cur)}${doc.price_includes_tax ? ' · prices include ' + taxName : ''}</div></div>
</div>
<table><thead><tr><th>#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc.</th><th>Tax</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals">
  <tr><td>Sub-total</td><td class="r">${formatMoney(doc.subtotal, cur)}</td></tr>
  ${doc.exempt_total && d(doc.exempt_total).gt(0) ? `<tr><td>Non-taxable / exempt</td><td class="r">${formatMoney(doc.exempt_total, cur)}</td></tr>` : ''}
  ${doc.zero_rated_total && d(doc.zero_rated_total).gt(0) ? `<tr><td>Zero-rated</td><td class="r">${formatMoney(doc.zero_rated_total, cur)}</td></tr>` : ''}
  ${doc.taxable_total !== undefined ? `<tr><td>Taxable amount</td><td class="r">${formatMoney(doc.taxable_total, cur)}</td></tr>` : ''}
  <tr><td>${taxName}</td><td class="r">${formatMoney(doc.tax_total, cur)}</td></tr>
  <tr class="grand"><td>Total</td><td class="r">${formatMoney(total, cur, true)}</td></tr>
</table>
<p><b>In words:</b> ${esc(amountInWords(total, cur))}</p>
${doc.notes ? `<p class="muted">${esc(doc.notes)}</p>` : ''}
<div class="foot"><div>Prepared by system · Printed ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC${printable ? ` · Print #${printNo}` : ''}</div><div>Authorised signature ____________________</div></div>
</div></body></html>`;
      return { html, docNo: doc.doc_no as string | null };
    });
  }
}

@Controller('print')
export class PrintController {
  constructor(private readonly svc: PrintService) {}

  @Perm('member')
  @Get(':type/:id')
  async print(@Ctx() ctx: CompanyContext, @Param('type') type: string, @Param('id') id: string, @Query('format') format: string, @Res() res: Response) {
    const kind = type.toUpperCase() as LineDocKind;
    const cfg = LINE_DOCS[kind];
    if (!cfg) throw new AppError('NOT_FOUND');
    const perm = kind === 'SALES_INVOICE' ? 'sales_invoice.print' : `${cfg.perm}.view`;
    if (!ctx.permissions.has(perm)) throw new AppError('PERM_DENIED', `You need permission "${perm}"`);
    const { html, docNo } = await this.svc.render(ctx, kind, id, format !== 'preview');
    if (format === 'pdf') {
      const pdf = await this.svc.pdf(html);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${(docNo ?? 'draft').replace(/[^A-Za-z0-9_-]/g, '_')}.pdf"`);
      res.send(pdf);
      return;
    }
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    res.type('text/html').send(html);
  }
}
