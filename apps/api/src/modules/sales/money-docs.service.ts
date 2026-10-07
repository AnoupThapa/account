/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';
import { AppError, d, money, sum, zAdDate, zMoneyNonNeg, DocType } from '@ledgerpro/shared';
import { DatabaseService, Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { DocRow, DocumentRegistry } from '../approvals/documents';
import { ApprovalService } from '../approvals/approval.service';
import { LedgerService, PostingComponent } from '../ledger/ledger.service';
import { FiscalService } from '../settings/fiscal.service';
import { AllocationService } from '../allocations/allocation.service';
import { TradeDocsService } from './trade-docs.service';

const plannedSchema = z.array(z.object({ targetType: z.enum(['SALES_INVOICE', 'PURCHASE_BILL', 'EXPENSE']), targetId: z.string().uuid(), amount: zMoneyNonNeg })).default([]);

export const receiptSchema = z.object({
  date: zAdDate,
  contactId: z.string().uuid(),
  kind: z.enum(['RECEIPT', 'ADVANCE']).default('RECEIPT'),
  accountId: z.string().uuid(), // deposit (receipts) / paid-from (payments) bank, cash or wallet
  amount: zMoneyNonNeg,
  discountAmount: zMoneyNonNeg.default('0'),
  tdsCodeId: z.string().uuid().nullish(),
  tdsAmount: zMoneyNonNeg.default('0'),
  reference: z.string().max(60).nullish(),
  chequeNo: z.string().max(30).nullish(),
  narration: z.string().max(1000).nullish(),
  branchId: z.string().uuid().nullish(),
  allocations: plannedSchema,
  version: z.number().int().optional(),
});
export const paymentSchema = receiptSchema.extend({ kind: z.enum(['PAYMENT', 'ADVANCE', 'CLAIM']).default('PAYMENT') });
export const advanceAdjSchema = z.object({ date: zAdDate, advanceId: z.string().uuid(), targetId: z.string().uuid(), amount: zMoneyNonNeg, narration: z.string().max(1000).nullish() });

type ReceiptInput = z.infer<typeof receiptSchema>;
type PaymentInput = z.infer<typeof paymentSchema>;

/** Receipts (incl. customer advances), payments (incl. supplier advances & claim settlements), advance adjustments. */
@Injectable()
export class MoneyDocsService implements OnModuleInit {
  constructor(
    private readonly dbs: DatabaseService,
    private readonly audit: AuditService,
    private readonly registry: DocumentRegistry,
    private readonly approvals: ApprovalService,
    private readonly ledger: LedgerService,
    private readonly fiscal: FiscalService,
    private readonly alloc: AllocationService,
    private readonly trade: TradeDocsService,
  ) {}

  onModuleInit() {
    const self = this;
    // ------------------------------------------------------------ RECEIPT
    this.registry.register({
      docType: 'RECEIPT',
      table: 'receipts',
      dateField: 'receipt_date',
      amountField: 'total',
      describe: (doc) => `Receipt ${money(doc.amount)}`,
      async validate(trx, ctx, doc) {
        await self.fiscal.periodFor(trx, ctx.companyId, doc.receipt_date);
        await self.checkPlanned(trx, doc, 'SALES_INVOICE');
      },
      preview: async (trx, ctx, doc) => self.ledger.buildLines(trx, ctx.companyId, 'RECEIPT', await self.receiptComponents(trx, doc)),
      async post(trx, ctx, doc, approvedBy) {
        const e = await self.ledger.post(trx, ctx, { sourceType: 'RECEIPT', sourceId: doc.id, sourceNo: doc.doc_no, entryDate: doc.receipt_date, narration: doc.narration ?? `${doc.kind === 'ADVANCE' ? 'Advance received' : 'Receipt'} ${doc.doc_no}`, branchId: doc.branch_id, approvedBy, components: await self.receiptComponents(trx, doc) });
        await self.registry.update(trx, 'RECEIPT', doc.id, { unallocated_amount: doc.total });
        for (const p of (doc.planned_allocations as { targetType: 'SALES_INVOICE'; targetId: string; amount: string }[]) ?? []) {
          await self.alloc.allocateInTx(trx, ctx, { sourceType: 'RECEIPT', sourceId: doc.id, targetType: p.targetType, targetId: p.targetId, amount: p.amount, date: doc.receipt_date }, true);
        }
        return { entryId: e.id };
      },
      correction: {
        kind: 'CANCEL',
        check: (trx, _ctx, doc) => self.checkNoAllocations(trx, doc, 'source'),
        after: async (trx, _ctx, doc) => self.registry.update(trx, 'RECEIPT', doc.id, { unallocated_amount: '0' }),
      },
    });
    // ------------------------------------------------------------ PAYMENT
    this.registry.register({
      docType: 'PAYMENT',
      table: 'payments',
      dateField: 'payment_date',
      amountField: 'total',
      describe: (doc) => `Payment ${money(doc.amount)}`,
      async validate(trx, ctx, doc) {
        await self.fiscal.periodFor(trx, ctx.companyId, doc.payment_date);
        await self.checkPlanned(trx, doc, doc.kind === 'CLAIM' ? 'EXPENSE' : 'PURCHASE_BILL');
      },
      preview: async (trx, ctx, doc) => self.ledger.buildLines(trx, ctx.companyId, 'PAYMENT', await self.paymentComponents(trx, doc)),
      async post(trx, ctx, doc, approvedBy) {
        const e = await self.ledger.post(trx, ctx, { sourceType: 'PAYMENT', sourceId: doc.id, sourceNo: doc.doc_no, entryDate: doc.payment_date, narration: doc.narration ?? `${doc.kind === 'ADVANCE' ? 'Advance paid' : doc.kind === 'CLAIM' ? 'Claim settlement' : 'Payment'} ${doc.doc_no}`, branchId: doc.branch_id, approvedBy, components: await self.paymentComponents(trx, doc) });
        await self.registry.update(trx, 'PAYMENT', doc.id, { unallocated_amount: doc.total });
        for (const p of (doc.planned_allocations as { targetType: 'PURCHASE_BILL' | 'EXPENSE'; targetId: string; amount: string }[]) ?? []) {
          await self.alloc.allocateInTx(trx, ctx, { sourceType: 'PAYMENT', sourceId: doc.id, targetType: p.targetType, targetId: p.targetId, amount: p.amount, date: doc.payment_date }, true);
        }
        return { entryId: e.id };
      },
      correction: {
        kind: 'CANCEL',
        check: (trx, _ctx, doc) => self.checkNoAllocations(trx, doc, 'source'),
        after: async (trx, _ctx, doc) => self.registry.update(trx, 'PAYMENT', doc.id, { unallocated_amount: '0' }),
      },
    });
    // ------------------------------------------------------- ADVANCE ADJUSTMENT
    this.registry.register({
      docType: 'ADVANCE_ADJUSTMENT',
      table: 'advance_adjustments',
      dateField: 'adjustment_date',
      amountField: 'amount',
      describe: (doc) => `Advance adjustment ${money(doc.amount)}`,
      async validate(trx, ctx, doc) {
        await self.fiscal.periodFor(trx, ctx.companyId, doc.adjustment_date);
        await self.checkAdvance(trx, doc.side, doc.advance_id, doc.target_id, doc.contact_id, doc.amount, doc.id);
      },
      preview: (trx, ctx, doc) => self.ledger.buildLines(trx, ctx.companyId, 'ADVANCE_ADJUSTMENT', self.advComponents(doc)),
      async post(trx, ctx, doc, approvedBy) {
        const e = await self.ledger.post(trx, ctx, { sourceType: 'ADVANCE_ADJUSTMENT', sourceId: doc.id, sourceNo: doc.doc_no, entryDate: doc.adjustment_date, narration: doc.narration ?? `Advance applied ${doc.doc_no}`, approvedBy, components: self.advComponents(doc) });
        const advTable = doc.side === 'CUSTOMER' ? 'receipts' : 'payments';
        const adv = await (trx as any).selectFrom(advTable).select('unallocated_amount').where('id', '=', doc.advance_id).forUpdate().executeTakeFirstOrThrow();
        await (trx as any).updateTable(advTable).set({ unallocated_amount: money(d(adv.unallocated_amount).minus(doc.amount)) }).where('id', '=', doc.advance_id).execute();
        await self.alloc.allocateInTx(trx, ctx, { sourceType: 'ADVANCE_ADJUSTMENT', sourceId: doc.id, targetType: doc.side === 'CUSTOMER' ? 'SALES_INVOICE' : 'PURCHASE_BILL', targetId: doc.target_id, amount: doc.amount, date: doc.adjustment_date }, true);
        return { entryId: e.id };
      },
      correction: {
        kind: 'REVERSE',
        async check() {
          /* always reversible */
        },
        async after(trx, ctx, doc) {
          const a = await trx.selectFrom('allocations').select('id').where('source_id', '=', doc.id).where('reversed_at', 'is', null).execute();
          for (const x of a) await self.alloc.unallocateInTx(trx, ctx, x.id);
          const advTable = doc.side === 'CUSTOMER' ? 'receipts' : 'payments';
          const adv = await (trx as any).selectFrom(advTable).select('unallocated_amount').where('id', '=', doc.advance_id).forUpdate().executeTakeFirstOrThrow();
          await (trx as any).updateTable(advTable).set({ unallocated_amount: money(d(adv.unallocated_amount).plus(doc.amount)) }).where('id', '=', doc.advance_id).execute();
        },
      },
    });
  }

  // ------------------------------------------------------------ components
  private async tdsAccount(trx: Tx, tdsCodeId: string | null, which: 'payable' | 'receivable') {
    if (tdsCodeId) {
      const t = await trx.selectFrom('tds_codes').select(['payable_account_id', 'receivable_account_id']).where('id', '=', tdsCodeId).executeTakeFirstOrThrow();
      const id = which === 'payable' ? t.payable_account_id : t.receivable_account_id;
      if (id) return id;
    }
    const sys = await trx.selectFrom('accounts').select('id').where('system_key', '=', which === 'payable' ? 'TDS_PAYABLE' : 'TDS_RECEIVABLE').executeTakeFirst();
    if (!sys) throw new AppError('VAL_FIELD', 'TDS account is missing');
    return sys.id;
  }

  async receiptComponents(trx: Tx, doc: DocRow): Promise<PostingComponent[]> {
    const c: PostingComponent[] = [{ role: 'BANK', amount: doc.amount, accountId: doc.deposit_account_id, contactId: doc.contact_id, description: doc.cheque_no ? `Cheque ${doc.cheque_no}` : doc.reference }];
    if (d(doc.discount_amount).gt(0)) c.push({ role: 'DISCOUNT_ALLOWED', amount: doc.discount_amount, contactId: doc.contact_id });
    if (d(doc.tds_amount).gt(0)) c.push({ role: 'TDS_RECEIVABLE', amount: doc.tds_amount, accountId: await this.tdsAccount(trx, doc.tds_code_id, 'receivable'), contactId: doc.contact_id, description: 'TDS deducted by customer' });
    c.push({ role: doc.kind === 'ADVANCE' ? 'CUSTOMER_ADVANCE' : 'RECEIVABLE', amount: doc.total, contactId: doc.contact_id });
    return c;
  }

  async paymentComponents(trx: Tx, doc: DocRow): Promise<PostingComponent[]> {
    const role = doc.kind === 'ADVANCE' ? 'SUPPLIER_ADVANCE' : doc.kind === 'CLAIM' ? 'STAFF_PAYABLE' : 'PAYABLE';
    const c: PostingComponent[] = [{ role, amount: doc.total, contactId: doc.contact_id }, { role: 'BANK', amount: doc.amount, accountId: doc.paid_from_account_id, contactId: doc.contact_id, description: doc.cheque_no ? `Cheque ${doc.cheque_no}` : doc.reference }];
    if (d(doc.tds_amount).gt(0)) c.push({ role: 'TDS_PAYABLE', amount: doc.tds_amount, accountId: await this.tdsAccount(trx, doc.tds_code_id, 'payable'), contactId: doc.contact_id, description: 'TDS withheld' });
    if (d(doc.discount_amount).gt(0)) c.push({ role: 'DISCOUNT_RECEIVED', amount: doc.discount_amount, contactId: doc.contact_id });
    return c;
  }

  advComponents(doc: DocRow): PostingComponent[] {
    return doc.side === 'CUSTOMER'
      ? [
          { role: 'CUSTOMER_ADVANCE', amount: doc.amount, contactId: doc.contact_id },
          { role: 'RECEIVABLE', amount: doc.amount, contactId: doc.contact_id },
        ]
      : [
          { role: 'PAYABLE', amount: doc.amount, contactId: doc.contact_id },
          { role: 'SUPPLIER_ADVANCE', amount: doc.amount, contactId: doc.contact_id },
        ];
  }

  // ------------------------------------------------------------ checks
  private async checkNoAllocations(trx: Tx, doc: DocRow, as: 'source' | 'target') {
    const a = await trx.selectFrom('allocations').select('id').where(as === 'source' ? 'source_id' : 'target_id', '=', doc.id).where('reversed_at', 'is', null).executeTakeFirst();
    if (a) throw new AppError('DOC_CANCEL_HAS_PAYMENTS', 'This is applied to invoices/bills — remove the allocations first');
    if (doc.kind === 'ADVANCE') {
      const adj = await trx.selectFrom('advance_adjustments').select('id').where('advance_id', '=', doc.id).where('status', 'in', ['DRAFT', 'SUBMITTED', 'POSTED']).executeTakeFirst();
      if (adj) throw new AppError('DOC_CANCEL_HAS_PAYMENTS', 'This advance has been applied — reverse the advance adjustment first');
    }
  }

  private async checkPlanned(trx: Tx, doc: DocRow, targetType: 'SALES_INVOICE' | 'PURCHASE_BILL' | 'EXPENSE') {
    const planned = (doc.planned_allocations as { targetType: string; targetId: string; amount: string }[]) ?? [];
    if (!planned.length) return;
    if (doc.kind === 'ADVANCE') throw new AppError('VAL_FIELD', 'Advances are applied later with an advance adjustment');
    const total = sum(planned.map((p) => p.amount));
    if (total.gt(doc.total)) throw new AppError('ACC_OVER_ALLOCATION', 'Allocations exceed the amount received/paid');
    const table = targetType === 'SALES_INVOICE' ? 'sales_invoices' : targetType === 'PURCHASE_BILL' ? 'purchase_bills' : 'expenses';
    for (const p of planned) {
      if (p.targetType !== targetType) throw new AppError('VAL_FIELD', 'Allocation target type does not match');
      const t = await (trx as any).selectFrom(table).select(['contact_id', 'status', 'amount_due']).where('id', '=', p.targetId).executeTakeFirst();
      if (!t || t.status !== 'POSTED' || t.contact_id !== doc.contact_id) throw new AppError('VAL_FIELD', 'Allocation target must be a posted document of the same contact');
      if (d(p.amount).gt(t.amount_due)) throw new AppError('ACC_OVER_ALLOCATION', `Allocation exceeds amount due (${t.amount_due})`);
    }
  }

  private async checkAdvance(trx: Tx, side: string, advanceId: string, targetId: string, contactId: string, amount: string, selfId?: string) {
    const advTable = side === 'CUSTOMER' ? 'receipts' : 'payments';
    const tgtTable = side === 'CUSTOMER' ? 'sales_invoices' : 'purchase_bills';
    const adv = await (trx as any).selectFrom(advTable).selectAll().where('id', '=', advanceId).executeTakeFirst();
    if (!adv || adv.kind !== 'ADVANCE' || adv.status !== 'POSTED') throw new AppError('VAL_FIELD', 'Choose a posted advance');
    const tgt = await (trx as any).selectFrom(tgtTable).selectAll().where('id', '=', targetId).executeTakeFirst();
    if (!tgt || tgt.status !== 'POSTED') throw new AppError('VAL_FIELD', `Choose a posted ${side === 'CUSTOMER' ? 'invoice' : 'bill'}`);
    if (adv.contact_id !== contactId || tgt.contact_id !== contactId) throw new AppError('VAL_FIELD', 'Advance and invoice/bill must be for the same contact');
    const pending = await trx
      .selectFrom('advance_adjustments')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<string>('amount'), eb.val('0')).as('n'))
      .where('advance_id', '=', advanceId)
      .where('status', 'in', ['SUBMITTED', 'APPROVED'])
      .$if(!!selfId, (q) => q.where('id', '<>', selfId!))
      .executeTakeFirstOrThrow();
    if (d(amount).plus(pending.n ?? 0).gt(adv.unallocated_amount)) throw new AppError('ACC_OVER_ALLOCATION', `Only ${adv.unallocated_amount} of this advance is still available`);
    if (d(amount).gt(tgt.amount_due)) throw new AppError('ACC_OVER_ALLOCATION', `Allocation exceeds amount due (${tgt.amount_due})`);
  }

  // ------------------------------------------------------------ CRUD
  private async moneyHeader(trx: Tx, ctx: CompanyContext, side: 'RECEIPT' | 'PAYMENT', b: ReceiptInput | PaymentInput) {
    const contact = await trx.selectFrom('contacts').select(['type', 'is_active']).where('id', '=', b.contactId).executeTakeFirst();
    if (!contact) throw new AppError('VAL_FIELD', 'Unknown contact');
    const okTypes = side === 'RECEIPT' ? ['CUSTOMER', 'BOTH'] : b.kind === 'CLAIM' ? ['EMPLOYEE'] : ['SUPPLIER', 'BOTH'];
    if (!okTypes.includes(contact.type)) throw new AppError('VAL_FIELD', `Choose ${side === 'RECEIPT' ? 'a customer' : b.kind === 'CLAIM' ? 'an employee' : 'a supplier'}`, undefined, [{ field: 'contactId', message: 'Wrong contact type' }]);
    await this.trade.assertCashAccount(trx, b.accountId);
    if (d(b.amount).lte(0)) throw new AppError('VAL_FIELD', 'Amount must be greater than zero', undefined, [{ field: 'amount', message: 'Must be > 0' }]);
    if ((b.kind === 'ADVANCE' || (side === 'PAYMENT' && b.kind === 'CLAIM')) && (d(b.discountAmount).gt(0) || d(b.tdsAmount).gt(0))) throw new AppError('VAL_FIELD', 'Discount/TDS apply to regular receipts/payments only');
    if (d(b.tdsAmount).gt(0) && !b.tdsCodeId && side === 'PAYMENT') throw new AppError('VAL_FIELD', 'Choose the TDS code', undefined, [{ field: 'tdsCodeId', message: 'Required when TDS is withheld' }]);
    const total = money(d(b.amount).plus(b.discountAmount).plus(b.tdsAmount));
    if (sum(b.allocations.map((a) => a.amount)).gt(total)) throw new AppError('ACC_OVER_ALLOCATION', 'Allocations exceed the total');
    const common = {
      branch_id: b.branchId ?? null,
      contact_id: b.contactId,
      kind: b.kind,
      amount: money(b.amount),
      discount_amount: money(b.discountAmount),
      tds_code_id: b.tdsCodeId ?? null,
      tds_amount: money(b.tdsAmount),
      total,
      reference: b.reference ?? null,
      cheque_no: b.chequeNo ?? null,
      narration: b.narration ?? null,
      planned_allocations: JSON.stringify(b.allocations.map((a) => ({ ...a, amount: money(a.amount) }))),
    };
    return side === 'RECEIPT' ? { ...common, receipt_date: b.date, deposit_account_id: b.accountId } : { ...common, payment_date: b.date, paid_from_account_id: b.accountId };
  }

  async createMoney(ctx: CompanyContext, side: 'RECEIPT' | 'PAYMENT', b: ReceiptInput | PaymentInput) {
    const table = side === 'RECEIPT' ? 'receipts' : 'payments';
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const h = await this.moneyHeader(trx, ctx, side, b);
      const row = await (trx as any).insertInto(table).values({ company_id: ctx.companyId, ...h, created_by: ctx.userId }).returningAll().executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', table, row.id, null, h);
      return row;
    });
  }

  async updateMoney(ctx: CompanyContext, side: 'RECEIPT' | 'PAYMENT', id: string, b: ReceiptInput | PaymentInput) {
    const table = side === 'RECEIPT' ? 'receipts' : 'payments';
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await this.registry.lock(trx, side, id);
      if (b.version !== undefined && doc.version !== b.version) throw new AppError('DOC_VERSION_CONFLICT');
      if (doc.status === 'SUBMITTED') await this.approvals.withdrawInTx(trx, ctx, side, id);
      else if (!['DRAFT', 'REJECTED'].includes(doc.status)) throw new AppError('ACC_IMMUTABLE');
      const h = await this.moneyHeader(trx, ctx, side, b);
      const after = await (trx as any).updateTable(table).set({ ...h, status: 'DRAFT', updated_by: ctx.userId }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'UPDATE', table, id, doc, h);
      return after;
    });
  }

  async createAdvanceAdjustment(ctx: CompanyContext, side: 'CUSTOMER' | 'SUPPLIER', b: z.infer<typeof advanceAdjSchema>) {
    if (!ctx.permissions.has(side === 'CUSTOMER' ? 'receipt.create' : 'payment.create')) throw new AppError('PERM_DENIED');
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const advTable = side === 'CUSTOMER' ? 'receipts' : 'payments';
      const adv = await (trx as any).selectFrom(advTable).select(['contact_id']).where('id', '=', b.advanceId).executeTakeFirst();
      if (!adv) throw new AppError('VAL_FIELD', 'Unknown advance');
      await this.checkAdvance(trx, side, b.advanceId, b.targetId, adv.contact_id, b.amount);
      const row = await trx
        .insertInto('advance_adjustments')
        .values({ company_id: ctx.companyId, adjustment_date: b.date, side, contact_id: adv.contact_id, advance_id: b.advanceId, target_id: b.targetId, amount: money(b.amount), total: money(b.amount), narration: b.narration ?? null, created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.audit.log(trx, ctx, 'CREATE', 'advance_adjustment', row.id, null, row);
      return row;
    });
  }

  async list(ctx: CompanyContext, table: 'receipts' | 'payments' | 'advance_adjustments', q: { status?: string; contactId?: string; kind?: string }) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) =>
      (trx as any)
        .selectFrom(table)
        .innerJoin('contacts', 'contacts.id', `${table}.contact_id`)
        .selectAll(table)
        .select('contacts.name as contact_name')
        .$if(!!q.status, (x: any) => x.where(`${table}.status`, '=', q.status))
        .$if(!!q.contactId, (x: any) => x.where(`${table}.contact_id`, '=', q.contactId))
        .$if(!!q.kind && table !== 'advance_adjustments', (x: any) => x.where(`${table}.kind`, '=', q.kind))
        .orderBy(`${table}.created_at`, 'desc')
        .limit(500)
        .execute(),
    );
  }

  async get(ctx: CompanyContext, table: 'receipts' | 'payments' | 'advance_adjustments', id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await (trx as any).selectFrom(table).innerJoin('contacts', 'contacts.id', `${table}.contact_id`).selectAll(table).select(['contacts.name as contact_name', 'contacts.pan as contact_pan']).where(`${table}.id`, '=', id).executeTakeFirst();
      if (!doc) throw new AppError('NOT_FOUND');
      const allocations = await trx.selectFrom('allocations').selectAll().where('source_id', '=', id).orderBy('created_at').execute();
      return { ...doc, allocations };
    });
  }

  async remove(ctx: CompanyContext, docType: 'RECEIPT' | 'PAYMENT' | 'ADVANCE_ADJUSTMENT', id: string) {
    const table = { RECEIPT: 'receipts', PAYMENT: 'payments', ADVANCE_ADJUSTMENT: 'advance_adjustments' }[docType];
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const doc = await this.registry.lock(trx, docType as DocType, id);
      if (!['DRAFT', 'REJECTED'].includes(doc.status)) throw new AppError('ACC_IMMUTABLE', 'Only drafts can be deleted');
      await (trx as any).deleteFrom(table).where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'DELETE', table, id, doc, null);
      return { ok: true };
    });
  }
}
