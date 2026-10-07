import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError, d, zAdDate, zQty } from '@ledgerpro/shared';
import { DatabaseService } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import { AuditService } from '../../common/audit.service';
import { NumberingService } from '../settings/numbering.service';

export const grnSchema = z.object({
  date: zAdDate,
  contactId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullish(),
  supplierRef: z.string().max(60).nullish(),
  notes: z.string().max(2000).nullish(),
  branchId: z.string().uuid().nullish(),
  lines: z.array(z.object({ itemId: z.string().uuid(), poLineId: z.string().uuid().nullish(), quantity: zQty, description: z.string().max(500).nullish() })).min(1),
});

/**
 * Goods receipt notes. Phase 2: quantity record against the PO (no ledger posting).
 * Phase 7 adds stock moves, valuation layers and the GRNI journal (Dr Inventory / Cr GRNI).
 */
@Injectable()
export class GrnService {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService, private readonly numbering: NumberingService) {}

  create(ctx: CompanyContext, b: z.infer<typeof grnSchema>) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      if (b.purchaseOrderId) {
        const po = await trx.selectFrom('purchase_orders').select(['status', 'contact_id']).where('id', '=', b.purchaseOrderId).forUpdate().executeTakeFirst();
        if (!po || po.contact_id !== b.contactId) throw new AppError('VAL_FIELD', 'Purchase order not found for this supplier');
        if (!['ISSUED', 'PARTIAL'].includes(po.status)) throw new AppError('APR_INVALID_STATE', 'Issue the purchase order before receiving goods');
      }
      const doc_no = await this.numbering.next(trx, ctx.companyId, 'GOODS_RECEIPT', b.date);
      const g = await trx
        .insertInto('goods_receipts')
        .values({ company_id: ctx.companyId, branch_id: b.branchId ?? null, doc_no, receipt_date: b.date, contact_id: b.contactId, purchase_order_id: b.purchaseOrderId ?? null, supplier_ref: b.supplierRef ?? null, notes: b.notes ?? null, status: 'RECEIVED', created_by: ctx.userId })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx
        .insertInto('goods_receipt_lines')
        .values(b.lines.map((l, i) => ({ company_id: ctx.companyId, receipt_id: g.id, line_no: i + 1, po_line_id: l.poLineId ?? null, item_id: l.itemId, quantity: l.quantity, description: l.description ?? null })))
        .execute();
      if (b.purchaseOrderId) {
        const ordered = await trx.selectFrom('purchase_order_lines').select(['id', 'quantity']).where('order_id', '=', b.purchaseOrderId).execute();
        const received = await trx
          .selectFrom('goods_receipt_lines')
          .innerJoin('goods_receipts', 'goods_receipts.id', 'goods_receipt_lines.receipt_id')
          .select(['po_line_id', (eb) => eb.fn.sum<string>('quantity').as('q')])
          .where('goods_receipts.purchase_order_id', '=', b.purchaseOrderId)
          .where('goods_receipts.status', '<>', 'CANCELLED')
          .groupBy('po_line_id')
          .execute();
        for (const l of b.lines) {
          const o = ordered.find((x) => x.id === l.poLineId);
          const r = received.find((x) => x.po_line_id === l.poLineId);
          if (o && d(r?.q ?? 0).gt(o.quantity)) throw new AppError('VAL_FIELD', 'Received quantity exceeds the ordered quantity');
        }
        const full = ordered.every((o) => d(received.find((x) => x.po_line_id === o.id)?.q ?? 0).gte(o.quantity));
        await trx.updateTable('purchase_orders').set({ status: full ? 'RECEIVED' : 'PARTIAL' }).where('id', '=', b.purchaseOrderId).execute();
      }
      await this.audit.log(trx, ctx, 'CREATE', 'goods_receipt', g.id, null, b);
      return g;
    });
  }

  list(ctx: CompanyContext) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, (trx) =>
      trx.selectFrom('goods_receipts').innerJoin('contacts', 'contacts.id', 'goods_receipts.contact_id').selectAll('goods_receipts').select('contacts.name as contact_name').orderBy('receipt_date', 'desc').limit(500).execute(),
    );
  }

  get(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const g = await trx.selectFrom('goods_receipts').selectAll().where('id', '=', id).executeTakeFirst();
      if (!g) throw new AppError('NOT_FOUND');
      const lines = await trx.selectFrom('goods_receipt_lines').innerJoin('items', 'items.id', 'goods_receipt_lines.item_id').selectAll('goods_receipt_lines').select(['items.sku', 'items.name as item_name']).where('receipt_id', '=', id).orderBy('line_no').execute();
      return { ...g, lines };
    });
  }

  cancel(ctx: CompanyContext, id: string) {
    return this.dbs.tenant(ctx.companyId, ctx.userId, async (trx) => {
      const g = await trx.selectFrom('goods_receipts').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!g) throw new AppError('NOT_FOUND');
      if (g.status === 'BILLED') throw new AppError('APR_INVALID_STATE', 'Already billed');
      await trx.updateTable('goods_receipts').set({ status: 'CANCELLED', updated_by: ctx.userId }).where('id', '=', id).execute();
      await this.audit.log(trx, ctx, 'CANCEL', 'goods_receipt', id, { status: g.status }, { status: 'CANCELLED' });
      return { ok: true };
    });
  }
}
