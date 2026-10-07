import { Injectable } from '@nestjs/common';
import { AppError, d, money, formatMoney } from '@ledgerpro/shared';
import { DatabaseService, Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';

export type AllocSource = 'RECEIPT' | 'CREDIT_NOTE' | 'PAYMENT' | 'DEBIT_NOTE' | 'ADVANCE_ADJUSTMENT';
export type AllocTarget = 'SALES_INVOICE' | 'PURCHASE_BILL' | 'EXPENSE';

const SOURCE: Record<AllocSource, { table: string; field: string; date: string }> = {
  RECEIPT: { table: 'receipts', field: 'unallocated_amount', date: 'receipt_date' },
  CREDIT_NOTE: { table: 'credit_notes', field: 'unallocated_amount', date: 'note_date' },
  PAYMENT: { table: 'payments', field: 'unallocated_amount', date: 'payment_date' },
  DEBIT_NOTE: { table: 'debit_notes', field: 'unallocated_amount', date: 'note_date' },
  ADVANCE_ADJUSTMENT: { table: 'advance_adjustments', field: 'amount', date: 'adjustment_date' },
};
const TARGET: Record<AllocTarget, { table: string; date: string }> = {
  SALES_INVOICE: { table: 'sales_invoices', date: 'invoice_date' },
  PURCHASE_BILL: { table: 'purchase_bills', date: 'bill_date' },
  EXPENSE: { table: 'expenses', date: 'expense_date' },
};
const COMPATIBLE: Record<AllocSource, AllocTarget[]> = {
  RECEIPT: ['SALES_INVOICE'],
  CREDIT_NOTE: ['SALES_INVOICE'],
  PAYMENT: ['PURCHASE_BILL', 'EXPENSE'],
  DEBIT_NOTE: ['PURCHASE_BILL'],
  ADVANCE_ADJUSTMENT: ['SALES_INVOICE', 'PURCHASE_BILL'],
};

export interface AllocRequest {
  sourceType: AllocSource;
  sourceId: string;
  targetType: AllocTarget;
  targetId: string;
  amount: string;
  date?: string;
}

/**
 * Sub-ledger matching of receipts/credits to invoices and payments/debits to bills.
 * Never touches the ledger (both sides already sit on AR/AP control); keeps amount_due / unallocated exact.
 * Over-allocation is refused here AND by CHECK (amount_due >= 0, unallocated_amount >= 0) in the DB.
 */
@Injectable()
export class AllocationService {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  async allocateInTx(trx: Tx, ctx: CompanyContext, r: AllocRequest, system = false) {
    const amt = d(r.amount);
    if (amt.lte(0)) throw new AppError('VAL_FIELD', 'Allocation amount must be positive');
    if (!COMPATIBLE[r.sourceType]?.includes(r.targetType)) throw new AppError('VAL_FIELD', `A ${r.sourceType.toLowerCase()} can't be applied to a ${r.targetType.toLowerCase()}`);
    const s = SOURCE[r.sourceType];
    const t = TARGET[r.targetType];
    const src = await (trx as any).selectFrom(s.table).selectAll().where('id', '=', r.sourceId).forUpdate().executeTakeFirst();
    const tgt = await (trx as any).selectFrom(t.table).selectAll().where('id', '=', r.targetId).forUpdate().executeTakeFirst();
    if (!src || !tgt) throw new AppError('NOT_FOUND');
    if (src.status !== 'POSTED' && !system) throw new AppError('APR_INVALID_STATE', 'Only posted receipts/payments/notes can be allocated');
    if (tgt.status !== 'POSTED') throw new AppError('APR_INVALID_STATE', 'Only posted invoices/bills can receive allocations');
    if (src.contact_id !== tgt.contact_id) throw new AppError('VAL_FIELD', 'Source and target must belong to the same customer/supplier');
    if (r.sourceType === 'RECEIPT' && src.kind !== 'RECEIPT') throw new AppError('VAL_FIELD', 'Apply customer advances with an advance adjustment');
    if (r.sourceType === 'PAYMENT') {
      if (src.kind === 'ADVANCE') throw new AppError('VAL_FIELD', 'Apply supplier advances with an advance adjustment');
      if ((src.kind === 'CLAIM') !== (r.targetType === 'EXPENSE')) throw new AppError('VAL_FIELD', 'Claim payments settle expense claims; supplier payments settle bills');
    }
    if (r.targetType === 'EXPENSE' && tgt.kind !== 'CLAIM') throw new AppError('VAL_FIELD', 'Only expense claims can be settled by payments');
    if (amt.gt(tgt.amount_due)) throw new AppError('ACC_OVER_ALLOCATION', `Allocation exceeds amount due (${formatMoney(tgt.amount_due)})`, { amountDue: tgt.amount_due });
    if (r.sourceType !== 'ADVANCE_ADJUSTMENT' && amt.gt(src[s.field])) throw new AppError('ACC_OVER_ALLOCATION', `Only ${formatMoney(src[s.field])} is unallocated`, { unallocated: src[s.field] });
    await (trx as any).updateTable(t.table).set({ amount_due: money(d(tgt.amount_due).minus(amt)) }).where('id', '=', r.targetId).execute();
    if (r.sourceType !== 'ADVANCE_ADJUSTMENT') await (trx as any).updateTable(s.table).set({ [s.field]: money(d(src[s.field]).minus(amt)) }).where('id', '=', r.sourceId).execute();
    const date = r.date ?? (src[s.date] > tgt[t.date] ? src[s.date] : tgt[t.date]);
    const row = await trx
      .insertInto('allocations')
      .values({ company_id: ctx.companyId, contact_id: src.contact_id, source_type: r.sourceType, source_id: r.sourceId, target_type: r.targetType, target_id: r.targetId, amount: money(amt), allocated_on: date, created_by: ctx.userId })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.log(trx, ctx, 'ALLOCATE', 'allocation', row.id, null, row);
    return row;
  }

  allocate(ctx: CompanyContext, r: AllocRequest) {
    this.requirePerm(ctx, r.sourceType);
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) => this.allocateInTx(trx, ctx, r));
  }

  private requirePerm(ctx: CompanyContext, src: AllocSource) {
    const perm = ['RECEIPT', 'CREDIT_NOTE'].includes(src) ? 'receipt.allocate' : 'payment.allocate';
    if (!ctx.permissions.has(perm)) throw new AppError('PERM_DENIED', `You need permission "${perm}"`);
  }

  async unallocateInTx(trx: Tx, ctx: CompanyContext, id: string) {
    const a = await trx.selectFrom('allocations').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!a) throw new AppError('NOT_FOUND');
    if (a.reversed_at) throw new AppError('APR_INVALID_STATE', 'Already un-allocated');
    const s = SOURCE[a.source_type as AllocSource];
    const t = TARGET[a.target_type as AllocTarget];
    const tgt = await (trx as any).selectFrom(t.table).select(['amount_due', 'status']).where('id', '=', a.target_id).forUpdate().executeTakeFirstOrThrow();
    await (trx as any).updateTable(t.table).set({ amount_due: money(d(tgt.amount_due).plus(a.amount)) }).where('id', '=', a.target_id).execute();
    if (a.source_type !== 'ADVANCE_ADJUSTMENT') {
      const src = await (trx as any).selectFrom(s.table).select([s.field]).where('id', '=', a.source_id).forUpdate().executeTakeFirstOrThrow();
      await (trx as any).updateTable(s.table).set({ [s.field]: money(d(src[s.field]).plus(a.amount)) }).where('id', '=', a.source_id).execute();
    }
    await trx.updateTable('allocations').set({ reversed_at: new Date(), reversed_by: ctx.userId }).where('id', '=', id).execute();
    await this.audit.log(trx, ctx, 'UNALLOCATE', 'allocation', id, a, { reversed: true });
  }

  async unallocate(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const a = await trx.selectFrom('allocations').select('source_type').where('id', '=', id).executeTakeFirst();
      if (!a) throw new AppError('NOT_FOUND');
      if (a.source_type === 'ADVANCE_ADJUSTMENT') throw new AppError('APR_INVALID_STATE', 'Reverse the advance adjustment instead');
      this.requirePerm(ctx, a.source_type as AllocSource);
      await this.unallocateInTx(trx, ctx, id);
      return { ok: true };
    });
  }
}
