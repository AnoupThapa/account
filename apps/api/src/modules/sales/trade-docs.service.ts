/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { AppError, d, money, DocType } from '@ledgerpro/shared';
import { sql } from 'kysely';
import { DatabaseService, Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { DocRow, DocumentRegistry } from '../approvals/documents';
import { ApprovalService } from '../approvals/approval.service';
import { LedgerService } from '../ledger/ledger.service';
import { FiscalService } from '../settings/fiscal.service';
import { NumberingService } from '../settings/numbering.service';
import { TaxService } from '../tax/tax.controller';
import { AllocationService } from '../allocations/allocation.service';
import { computeLines, defaultDueDate, LINE_DOCS, LineDocConfig, lineDocComponents, LineDocInput, LineDocKind, StoredLine } from './line-docs';

type AnyTx = any; // dynamic table names below

/**
 * Sales & purchase line documents: quotations, sales orders, invoices, credit notes,
 * purchase orders, bills, debit notes, expenses & claims.
 * All totals are computed on the server (tax per docs/02 §4); posting via the ledger engine only.
 */
@Injectable()
export class TradeDocsService implements OnModuleInit {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly audit: AuditService,
    private readonly registry: DocumentRegistry,
    private readonly approvals: ApprovalService,
    private readonly ledger: LedgerService,
    private readonly fiscal: FiscalService,
    private readonly numbering: NumberingService,
    private readonly tax: TaxService,
    private readonly alloc: AllocationService,
  ) {}

  onModuleInit() {
    for (const kind of ['SALES_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'DEBIT_NOTE', 'EXPENSE'] as const) this.registerHandler(kind);
  }

  private registerHandler(kind: LineDocKind) {
    const cfg = LINE_DOCS[kind];
    const self = this;
    const lines = (trx: Tx, id: string) => (trx as AnyTx).selectFrom(cfg.linesTable).selectAll().where(cfg.fk, '=', id).orderBy('line_no').execute() as Promise<StoredLine[]>;
    const components = async (trx: Tx, doc: DocRow) => lineDocComponents(trx, kind, doc, await lines(trx, doc.id));
    this.registry.register({
      docType: kind as DocType,
      table: cfg.table,
      dateField: cfg.dateField,
      amountField: 'grand_total',
      describe: (doc) => `${kind.replace('_', ' ').toLowerCase()} ${money(doc.grand_total)}`,
      async validate(trx, ctx, doc) {
        await self.fiscal.periodFor(trx, ctx.companyId, doc[cfg.dateField]);
        if (d(doc.grand_total).lte(0)) throw new AppError('VAL_FIELD', 'Total must be greater than zero');
        if (kind === 'PURCHASE_BILL') await self.checkDuplicateBill(trx, doc.contact_id, doc.supplier_invoice_no, doc.id);
        if (kind === 'CREDIT_NOTE' && doc.original_invoice_id) {
          const inv = await trx.selectFrom('sales_invoices').select(['status', 'contact_id']).where('id', '=', doc.original_invoice_id).executeTakeFirst();
          if (!inv || inv.status !== 'POSTED' || inv.contact_id !== doc.contact_id) throw new AppError('VAL_FIELD', 'The original invoice must be a posted invoice of the same customer');
        }
        if (kind === 'DEBIT_NOTE' && doc.original_bill_id) {
          const b = await trx.selectFrom('purchase_bills').select(['status', 'contact_id']).where('id', '=', doc.original_bill_id).executeTakeFirst();
          if (!b || b.status !== 'POSTED' || b.contact_id !== doc.contact_id) throw new AppError('VAL_FIELD', 'The original bill must be a posted bill of the same supplier');
        }
      },
      preview: async (trx, ctx, doc) => self.ledger.buildLines(trx, ctx.companyId, kind, await components(trx, doc)),
      async post(trx, ctx, doc, approvedBy) {
        const e = await self.ledger.post(trx, ctx, {
          sourceType: kind,
          sourceId: doc.id,
          sourceNo: doc.doc_no,
          entryDate: doc[cfg.dateField],
          narration: self.narration(kind, doc),
          branchId: doc.branch_id,
          approvedBy,
          components: await components(trx, doc),
        });
        // sub-ledger state
        if (kind === 'SALES_INVOICE') {
          await self.registry.update(trx, kind, doc.id, { amount_due: doc.cash_account_id ? '0' : doc.grand_total });
          if (doc.sales_order_id) await trx.updateTable('sales_orders').set({ status: 'INVOICED' }).where('id', '=', doc.sales_order_id).execute();
        }
        if (kind === 'PURCHASE_BILL') {
          await self.registry.update(trx, kind, doc.id, { amount_due: doc.grand_total });
          if (doc.purchase_order_id) await trx.updateTable('purchase_orders').set({ status: 'BILLED' }).where('id', '=', doc.purchase_order_id).execute();
          if (doc.goods_receipt_id) await trx.updateTable('goods_receipts').set({ status: 'BILLED' }).where('id', '=', doc.goods_receipt_id).execute();
        }
        if (kind === 'EXPENSE') await self.registry.update(trx, kind, doc.id, { amount_due: doc.kind === 'CLAIM' ? doc.grand_total : '0' });
        if (kind === 'CREDIT_NOTE' || kind === 'DEBIT_NOTE') {
          const refund = !!doc.refund_account_id;
          await self.registry.update(trx, kind, doc.id, { unallocated_amount: refund ? '0' : doc.grand_total });
          const target = kind === 'CREDIT_NOTE' ? doc.original_invoice_id : doc.original_bill_id;
          if (!refund && target) {
            const t = await (trx as AnyTx).selectFrom(kind === 'CREDIT_NOTE' ? 'sales_invoices' : 'purchase_bills').select('amount_due').where('id', '=', target).executeTakeFirst();
            const amt = d(doc.grand_total).lt(t?.amount_due ?? 0) ? d(doc.grand_total) : d(t?.amount_due ?? 0);
            if (amt.gt(0)) {
              await self.alloc.allocateInTx(trx, ctx, { sourceType: kind, sourceId: doc.id, targetType: kind === 'CREDIT_NOTE' ? 'SALES_INVOICE' : 'PURCHASE_BILL', targetId: target, amount: money(amt), date: doc[cfg.dateField] }, true);
            }
          }
        }
        return { entryId: e.id };
      },
      correction: {
        kind: 'CANCEL',
        async check(trx, _ctx, doc) {
          const asTarget = ['SALES_INVOICE', 'PURCHASE_BILL', 'EXPENSE'].includes(kind);
          const active = await trx
            .selectFrom('allocations')
            .select('id')
            .where(asTarget ? 'target_id' : 'source_id', '=', doc.id)
            .where('reversed_at', 'is', null)
            .executeTakeFirst();
          if (active) throw new AppError('DOC_CANCEL_HAS_PAYMENTS', 'Payments/credits are applied to this document — remove the allocations first or issue a credit/debit note');
          if (kind === 'SALES_INVOICE') {
            const adv = await trx.selectFrom('advance_adjustments').select('id').where('target_id', '=', doc.id).where('status', 'in', ['DRAFT', 'SUBMITTED', 'POSTED']).executeTakeFirst();
            if (adv) throw new AppError('DOC_CANCEL_HAS_PAYMENTS', 'An advance is applied to this invoice');
          }
        },
        async after(trx, _ctx, doc) {
          if (['SALES_INVOICE', 'PURCHASE_BILL', 'EXPENSE'].includes(kind)) await self.registry.update(trx, kind, doc.id, { amount_due: '0' });
          else await self.registry.update(trx, kind, doc.id, { unallocated_amount: '0' });
        },
      },
    });
  }

  private narration(kind: LineDocKind, doc: DocRow) {
    switch (kind) {
      case 'SALES_INVOICE':
        return `Sales invoice ${doc.doc_no}${doc.cash_account_id ? ' (cash sale)' : ''}`;
      case 'CREDIT_NOTE':
        return `Credit note ${doc.doc_no}${doc.reason ? ' — ' + doc.reason : ''}`;
      case 'PURCHASE_BILL':
        return `Bill ${doc.doc_no} (supplier invoice ${doc.supplier_invoice_no})`;
      case 'DEBIT_NOTE':
        return `Debit note ${doc.doc_no}${doc.reason ? ' — ' + doc.reason : ''}`;
      case 'EXPENSE':
        return `${doc.kind === 'CLAIM' ? 'Expense claim' : 'Expense'} ${doc.doc_no}${doc.narration ? ' — ' + doc.narration : ''}`;
      default:
        return String(doc.doc_no);
    }
  }

  /** Duplicate supplier invoice guard (also a partial unique index in the DB). */
  async checkDuplicateBill(trx: Tx, contactId: string, supplierInvoiceNo: string, selfId?: string) {
    const dup = await trx
      .selectFrom('purchase_bills')
      .select(['id', 'doc_no', 'status'])
      .where('contact_id', '=', contactId)
      .where(sql`lower(supplier_invoice_no)`, '=', supplierInvoiceNo.trim().toLowerCase())
      .where('status', '<>', 'CANCELLED')
      .$if(!!selfId, (q) => q.where('id', '<>', selfId!))
      .executeTakeFirst();
    if (dup) throw new AppError('DOC_DUPLICATE_INVOICE', `This supplier invoice already exists${dup.doc_no ? ' as ' + dup.doc_no : ' (draft)'}`, { existingId: dup.id, docNo: dup.doc_no });
  }

  // ------------------------------------------------------------------ CRUD
  private async header(trx: Tx, ctx: CompanyContext, cfg: LineDocConfig, input: LineDocInput, calc: Awaited<ReturnType<typeof computeLines>>) {
    const company = await trx.selectFrom('companies').select(['base_currency']).where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
    let contact: { id: string; type: string; name: string; pan: string | null; address: string | null; payment_terms_days: number } | undefined;
    if (input.contactId) {
      contact = await trx.selectFrom('contacts').select(['id', 'type', 'name', 'pan', 'address', 'payment_terms_days', 'is_active']).where('id', '=', input.contactId).executeTakeFirst();
      if (!contact) throw new AppError('VAL_FIELD', 'Unknown contact', undefined, [{ field: 'contactId', message: 'Unknown contact' }]);
      if (!cfg.contactTypes.includes(contact.type)) throw new AppError('VAL_FIELD', `Choose a ${cfg.side === 'SALES' ? 'customer' : 'supplier'}`, undefined, [{ field: 'contactId', message: 'Wrong contact type' }]);
    } else if (!(cfg.kind === 'EXPENSE' && input.expenseKind !== 'CLAIM')) {
      throw new AppError('VAL_FIELD', 'Choose a contact', undefined, [{ field: 'contactId', message: 'Required' }]);
    }
    const money6 = {
      subtotal: calc.subtotal,
      tax_total: calc.taxTotal,
      grand_total: calc.grandTotal,
    };
    const full = {
      ...money6,
      discount_total: calc.discountTotal,
      taxable_total: calc.taxableTotal,
      zero_rated_total: calc.zeroRatedTotal,
      exempt_total: calc.exemptTotal,
      rounding_adjustment: calc.roundingAdjustment,
    };
    const common = { branch_id: input.branchId ?? null, contact_id: input.contactId ?? null, currency_code: company.base_currency, price_includes_tax: input.pricesIncludeTax, notes: input.notes ?? null };
    const terms = contact?.payment_terms_days ?? 0;
    switch (cfg.kind) {
      case 'SALES_QUOTE':
        return { ...common, ...money6, quote_date: input.date, valid_until: input.validUntil ?? null };
      case 'SALES_ORDER':
        return { ...common, ...money6, order_date: input.date, expected_date: input.dueDate ?? null, customer_ref: input.reference ?? null };
      case 'PURCHASE_ORDER':
        return { ...common, ...money6, order_date: input.date, expected_date: input.dueDate ?? null };
      case 'SALES_INVOICE': {
        if (input.cashAccountId) await this.assertCashAccount(trx, input.cashAccountId);
        return {
          ...common,
          ...full,
          fx_rate: '1',
          invoice_date: input.date,
          due_date: input.dueDate ?? defaultDueDate(input.date, terms),
          buyer_name: input.buyerName ?? contact!.name,
          buyer_pan: input.buyerPan ?? contact!.pan,
          buyer_address: input.buyerAddress ?? contact!.address,
          customer_ref: input.reference ?? null,
          sales_order_id: input.salesOrderId ?? null,
          cash_account_id: input.cashAccountId ?? null,
        };
      }
      case 'CREDIT_NOTE':
        if (input.refundAccountId) await this.assertCashAccount(trx, input.refundAccountId);
        return { ...common, ...full, fx_rate: '1', note_date: input.date, original_invoice_id: input.originalInvoiceId ?? null, reason: input.reason ?? null, refund_account_id: input.refundAccountId ?? null };
      case 'PURCHASE_BILL':
        if (!input.supplierInvoiceNo?.trim()) throw new AppError('VAL_FIELD', "Enter the supplier's invoice number", undefined, [{ field: 'supplierInvoiceNo', message: 'Required' }]);
        return {
          ...common,
          ...full,
          fx_rate: '1',
          non_claimable_tax: calc.nonClaimableTax,
          bill_date: input.date,
          due_date: input.dueDate ?? defaultDueDate(input.date, terms),
          supplier_invoice_no: input.supplierInvoiceNo.trim(),
          supplier_invoice_date: input.supplierInvoiceDate ?? null,
          supplier_pan: input.supplierPan ?? contact!.pan,
          purchase_order_id: input.purchaseOrderId ?? null,
          goods_receipt_id: input.goodsReceiptId ?? null,
        };
      case 'DEBIT_NOTE':
        if (input.refundAccountId) await this.assertCashAccount(trx, input.refundAccountId);
        return { ...common, ...full, fx_rate: '1', non_claimable_tax: calc.nonClaimableTax, note_date: input.date, original_bill_id: input.originalBillId ?? null, reason: input.reason ?? null, supplier_ref: input.reference ?? null, refund_account_id: input.refundAccountId ?? null };
      case 'EXPENSE': {
        const kind = input.expenseKind ?? 'PAID';
        if (kind === 'PAID') {
          if (!input.paidFromAccountId) throw new AppError('VAL_FIELD', 'Choose the bank/cash account it was paid from', undefined, [{ field: 'paidFromAccountId', message: 'Required' }]);
          await this.assertCashAccount(trx, input.paidFromAccountId);
        } else if (contact?.type !== 'EMPLOYEE') {
          throw new AppError('VAL_FIELD', 'An expense claim must be for an employee contact', undefined, [{ field: 'contactId', message: 'Choose an employee' }]);
        }
        const { notes, ...rest } = common;
        return {
          ...rest,
          ...full,
          fx_rate: '1',
          narration: notes,
          non_claimable_tax: calc.nonClaimableTax,
          expense_date: input.date,
          kind,
          paid_from_account_id: kind === 'PAID' ? input.paidFromAccountId : null,
          supplier_invoice_no: input.supplierInvoiceNo ?? null,
          supplier_pan: input.supplierPan ?? contact?.pan ?? null,
        };
      }
    }
  }

  async assertCashAccount(trx: Tx, accountId: string) {
    const a = await trx.selectFrom('accounts').select(['subtype', 'is_active', 'is_postable', 'code', 'name']).where('id', '=', accountId).executeTakeFirst();
    if (!a || !a.is_active || !a.is_postable || !['CASH', 'BANK', 'WALLET'].includes(a.subtype ?? '')) throw new AppError('VAL_FIELD', 'Choose an active cash, bank or wallet account');
  }

  private async writeLines(trx: Tx, ctx: CompanyContext, cfg: LineDocConfig, id: string, calc: Awaited<ReturnType<typeof computeLines>>) {
    await (trx as AnyTx).deleteFrom(cfg.linesTable).where(cfg.fk, '=', id).execute();
    await (trx as AnyTx)
      .insertInto(cfg.linesTable)
      .values(
        calc.lines.map((l) => ({
          company_id: ctx.companyId,
          [cfg.fk]: id,
          line_no: l.line_no,
          item_id: l.item_id,
          account_id: l.account_id,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount_percent: l.discount_percent,
          discount_amount: l.discount_amount,
          tax_code_id: l.tax_code_id,
          tax_type: l.tax_type,
          tax_rate: l.tax_rate,
          is_claimable: l.is_claimable,
          net_amount: l.net_amount,
          tax_amount: l.tax_amount,
          total_amount: l.total_amount,
          cost_centre_id: l.cost_centre_id,
        })),
      )
      .execute();
  }

  async create(ctx: CompanyContext, kind: LineDocKind, input: LineDocInput) {
    const cfg = LINE_DOCS[kind];
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const calc = await computeLines(trx, ctx, cfg, input, this.tax);
      const h = await this.header(trx, ctx, cfg, input, calc);
      if (kind === 'PURCHASE_BILL') await this.checkDuplicateBill(trx, input.contactId!, input.supplierInvoiceNo!);
      const extra: Record<string, unknown> = {};
      if (!cfg.posting) extra.doc_no = await this.numbering.next(trx, ctx.companyId, kind, input.date); // quotes/orders numbered on creation
      const row = await (trx as AnyTx)
        .insertInto(cfg.table)
        .values({ company_id: ctx.companyId, ...h, ...extra, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.writeLines(trx, ctx, cfg, row.id, calc);
      await this.audit.log(trx, ctx, 'CREATE', cfg.table, row.id, null, { ...h, lines: calc.lines.length });
      return { ...row, lines: calc.lines };
    });
  }

  async update(ctx: CompanyContext, kind: LineDocKind, id: string, input: LineDocInput) {
    const cfg = LINE_DOCS[kind];
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const before = (await sql<DocRow>`SELECT * FROM ${sql.table(cfg.table)} WHERE id = ${id} FOR UPDATE`.execute(trx)).rows[0];
      if (!before) throw new AppError('NOT_FOUND');
      if (input.version !== undefined && before.version !== input.version) throw new AppError('DOC_VERSION_CONFLICT');
      if (cfg.posting) {
        if (before.status === 'SUBMITTED') await this.approvals.withdrawInTx(trx, ctx, kind, id);
        else if (!['DRAFT', 'REJECTED'].includes(before.status)) throw new AppError('ACC_IMMUTABLE');
      } else if (!['DRAFT', 'SENT', 'CONFIRMED', 'ISSUED'].includes(before.status)) throw new AppError('APR_INVALID_STATE', `A ${before.status.toLowerCase()} document can't be edited`);
      const calc = await computeLines(trx, ctx, cfg, input, this.tax);
      const h = await this.header(trx, ctx, cfg, input, calc);
      if (kind === 'PURCHASE_BILL') await this.checkDuplicateBill(trx, input.contactId!, input.supplierInvoiceNo!, id);
      if (cfg.posting) await (trx as AnyTx).updateTable(cfg.table).set({ status: 'DRAFT' }).where('id', '=', id).execute();
      await this.writeLines(trx, ctx, cfg, id, calc);
      const after = await (trx as AnyTx).updateTable(cfg.table).set({ ...h, updated_by: ctx.userId }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', cfg.table, id, before, { ...h, lines: calc.lines.length });
      return after;
    });
  }

  async remove(ctx: CompanyContext, kind: LineDocKind, id: string) {
    const cfg = LINE_DOCS[kind];
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = (await sql<DocRow>`SELECT * FROM ${sql.table(cfg.table)} WHERE id = ${id} FOR UPDATE`.execute(trx)).rows[0];
      if (!doc) throw new AppError('NOT_FOUND');
      if (cfg.posting ? !['DRAFT', 'REJECTED'].includes(doc.status) : doc.status !== 'DRAFT') throw new AppError('ACC_IMMUTABLE', 'Only drafts can be deleted');
      if (!cfg.posting) {
        // numbered on creation → keep the number visible as cancelled instead of deleting (gapless)
        await (trx as AnyTx).updateTable(cfg.table).set({ status: 'CANCELLED', updated_by: ctx.userId }).where('id', '=', id).execute();
      } else {
        await (trx as AnyTx).deleteFrom(cfg.table).where('id', '=', id).execute();
      }
      await this.audit.log(trx, ctx, 'DELETE', cfg.table, id, doc, null);
      return { ok: true };
    });
  }

  async list(ctx: CompanyContext, kind: LineDocKind, q: { status?: string; contactId?: string; from?: string; to?: string; unpaid?: boolean }) {
    const cfg = LINE_DOCS[kind];
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) =>
      (trx as AnyTx)
        .selectFrom(cfg.table)
        .leftJoin('contacts', 'contacts.id', `${cfg.table}.contact_id`)
        .selectAll(cfg.table)
        .select('contacts.name as contact_name')
        .$if(!!q.status, (x: AnyTx) => x.where(`${cfg.table}.status`, '=', q.status))
        .$if(!!q.contactId, (x: AnyTx) => x.where(`${cfg.table}.contact_id`, '=', q.contactId))
        .$if(!!q.from, (x: AnyTx) => x.where(cfg.dateField, '>=', q.from))
        .$if(!!q.to, (x: AnyTx) => x.where(cfg.dateField, '<=', q.to))
        .$if(!!q.unpaid, (x: AnyTx) => x.where('amount_due', '>', '0'))
        .orderBy(cfg.dateField, 'desc')
        .orderBy(`${cfg.table}.created_at`, 'desc')
        .limit(500)
        .execute(),
    );
  }

  async get(ctx: CompanyContext, kind: LineDocKind, id: string) {
    const cfg = LINE_DOCS[kind];
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await (trx as AnyTx).selectFrom(cfg.table).leftJoin('contacts', 'contacts.id', `${cfg.table}.contact_id`).selectAll(cfg.table).select(['contacts.name as contact_name', 'contacts.pan as contact_pan', 'contacts.abn as contact_abn', 'contacts.address as contact_address']).where(`${cfg.table}.id`, '=', id).executeTakeFirst();
      if (!doc) throw new AppError('NOT_FOUND');
      const lines = await (trx as AnyTx)
        .selectFrom(cfg.linesTable)
        .leftJoin('items', 'items.id', `${cfg.linesTable}.item_id`)
        .leftJoin('accounts', 'accounts.id', `${cfg.linesTable}.account_id`)
        .leftJoin('tax_codes', 'tax_codes.id', `${cfg.linesTable}.tax_code_id`)
        .selectAll(cfg.linesTable)
        .select(['items.sku', 'items.name as item_name', 'items.uom_code', 'accounts.code as account_code', 'accounts.name as account_name', 'tax_codes.code as tax_code'])
        .where(cfg.fk, '=', id)
        .orderBy('line_no')
        .execute();
      const allocations = cfg.posting
        ? await trx.selectFrom('allocations').selectAll().where((eb) => eb.or([eb('source_id', '=', id), eb('target_id', '=', id)])).orderBy('created_at').execute()
        : [];
      return { ...doc, lines, allocations };
    });
  }

  /** Quote → Sales order → Invoice, PO → Bill: copies lines into a new draft. */
  async convert(ctx: CompanyContext, from: LineDocKind, id: string, to: LineDocKind, extra: Partial<LineDocInput> = {}) {
    const allowed: Record<string, LineDocKind[]> = { SALES_QUOTE: ['SALES_ORDER', 'SALES_INVOICE'], SALES_ORDER: ['SALES_INVOICE'], PURCHASE_ORDER: ['PURCHASE_BILL'] };
    if (!allowed[from]?.includes(to)) throw new AppError('VAL_FIELD', `Can't convert ${from} to ${to}`);
    extra = Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) as Partial<LineDocInput>;
    const src = await this.get(ctx, from, id);
    if (['CANCELLED', 'CONVERTED', 'DECLINED', 'INVOICED', 'BILLED', 'CLOSED'].includes(src.status)) throw new AppError('APR_INVALID_STATE', `This ${from.toLowerCase().replace('_', ' ')} is ${src.status.toLowerCase()}`);
    const input: LineDocInput = {
      date: extra.date ?? src[LINE_DOCS[from].dateField],
      contactId: src.contact_id,
      branchId: src.branch_id,
      pricesIncludeTax: src.price_includes_tax,
      notes: src.notes,
      salesOrderId: from === 'SALES_ORDER' ? id : undefined,
      purchaseOrderId: from === 'PURCHASE_ORDER' ? id : undefined,
      supplierInvoiceNo: extra.supplierInvoiceNo,
      reference: src.customer_ref ?? undefined,
      lines: src.lines.map((l: any) => ({ itemId: l.item_id, accountId: l.account_id, description: l.description, quantity: l.quantity, unitPrice: l.unit_price, discountPercent: l.discount_percent, taxCodeId: l.tax_code_id, costCentreId: l.cost_centre_id })),
      ...extra,
    } as LineDocInput;
    const created = await this.create(ctx, to, input);
    await this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      if (from === 'SALES_QUOTE') await trx.updateTable('sales_quotes').set({ status: 'CONVERTED', converted_to_id: created.id }).where('id', '=', id).execute();
      if (from === 'SALES_ORDER' && src.status === 'DRAFT') await trx.updateTable('sales_orders').set({ status: 'CONFIRMED' }).where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'UPDATE', LINE_DOCS[from].table, id, { status: src.status }, { convertedTo: to, newId: created.id });
    });
    return created;
  }

  /** Status changes for non-posting documents (send/accept/decline quotes, confirm/close orders, issue POs). */
  async setStatus(ctx: CompanyContext, kind: LineDocKind, id: string, status: string) {
    const flows: Record<string, Record<string, string[]>> = {
      SALES_QUOTE: { DRAFT: ['SENT', 'CANCELLED'], SENT: ['ACCEPTED', 'DECLINED', 'CANCELLED'], ACCEPTED: ['CANCELLED'] },
      SALES_ORDER: { DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['CLOSED', 'CANCELLED'], INVOICED: ['CLOSED'] },
      PURCHASE_ORDER: { DRAFT: ['ISSUED', 'CANCELLED'], ISSUED: ['CLOSED', 'CANCELLED'], PARTIAL: ['CLOSED'], RECEIVED: ['CLOSED'], BILLED: ['CLOSED'] },
    };
    const cfg = LINE_DOCS[kind];
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await (trx as AnyTx).selectFrom(cfg.table).select(['status']).where('id', '=', id).forUpdate().executeTakeFirst();
      if (!doc) throw new AppError('NOT_FOUND');
      if (!flows[kind]?.[doc.status]?.includes(status)) throw new AppError('APR_INVALID_STATE', `Can't change ${doc.status} → ${status}`);
      await (trx as AnyTx).updateTable(cfg.table).set({ status, updated_by: ctx.userId }).where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'UPDATE', cfg.table, id, { status: doc.status }, { status });
      return { status };
    });
  }
}
