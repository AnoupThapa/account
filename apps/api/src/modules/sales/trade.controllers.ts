import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Type } from '@nestjs/common';
import { z } from 'zod';
import { AppError, zAdDate } from '@ledgerpro/shared';
import { Ctx, Perm, Zod } from '../../common/decorators';
import type { CompanyContext } from '../../common/context';
import { TradeDocsService } from './trade-docs.service';
import { LINE_DOCS, lineDocSchema, LineDocInput, LineDocKind } from './line-docs';
import { MoneyDocsService, receiptSchema, paymentSchema, advanceAdjSchema } from './money-docs.service';
import { AllocationService } from '../allocations/allocation.service';
import { GrnService, grnSchema } from '../purchases/grn.service';

const listQuery = z.object({
  status: z.string().max(20).optional(),
  contactId: z.string().uuid().optional(),
  from: zAdDate.optional(),
  to: zAdDate.optional(),
  unpaid: z.enum(['true', 'false']).optional(),
  kind: z.string().max(20).optional(),
});

/** One REST controller per line-document kind (same shape for invoices, bills, notes, quotes, orders, expenses). */
function lineDocController(path: string, kind: LineDocKind): Type<unknown> {
  const p = LINE_DOCS[kind].perm;
  @Controller(path)
  class LineDocController {
    constructor(readonly svc: TradeDocsService) {}

    @Perm(`${p}.view`)
    @Get()
    list(@Ctx() ctx: CompanyContext, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
      return this.svc.list(ctx, kind, { ...q, unpaid: q.unpaid === 'true' });
    }

    @Perm(`${p}.view`)
    @Get(':id')
    get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
      return this.svc.get(ctx, kind, id);
    }

    @Perm(`${p}.create`)
    @Post()
    create(@Ctx() ctx: CompanyContext, @Body(new Zod(lineDocSchema)) b: LineDocInput) {
      return this.svc.create(ctx, kind, b);
    }

    @Perm(`${p}.create`)
    @Patch(':id')
    update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(lineDocSchema)) b: LineDocInput) {
      return this.svc.update(ctx, kind, id, b);
    }

    @Perm(`${p}.create`)
    @Delete(':id')
    remove(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
      return this.svc.remove(ctx, kind, id);
    }

    @Perm(`${p}.create`)
    @Post(':id/status')
    status(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(z.object({ status: z.string().max(20) }))) b: { status: string }) {
      return this.svc.setStatus(ctx, kind, id, b.status);
    }

    @Perm(`${p}.view`)
    @Post(':id/convert')
    convert(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(z.object({ to: z.enum(['SALES_ORDER', 'SALES_INVOICE', 'PURCHASE_BILL']), date: zAdDate.optional(), supplierInvoiceNo: z.string().max(60).optional() }))) b: { to: LineDocKind; date?: string; supplierInvoiceNo?: string }) {
      const createPerm = `${LINE_DOCS[b.to].perm}.create`;
      if (!ctx.permissions.has(createPerm)) throw new AppError('PERM_DENIED', `You need permission "${createPerm}"`);
      return this.svc.convert(ctx, kind, id, b.to, { date: b.date, supplierInvoiceNo: b.supplierInvoiceNo });
    }
  }
  Object.defineProperty(LineDocController, 'name', { value: `${kind}Controller` });
  return LineDocController;
}

export const SalesQuotesController = lineDocController('sales-quotes', 'SALES_QUOTE');
export const SalesOrdersController = lineDocController('sales-orders', 'SALES_ORDER');
export const SalesInvoicesController = lineDocController('sales-invoices', 'SALES_INVOICE');
export const CreditNotesController = lineDocController('credit-notes', 'CREDIT_NOTE');
export const PurchaseOrdersController = lineDocController('purchase-orders', 'PURCHASE_ORDER');
export const BillsController = lineDocController('bills', 'PURCHASE_BILL');
export const DebitNotesController = lineDocController('debit-notes', 'DEBIT_NOTE');
export const ExpensesController = lineDocController('expenses', 'EXPENSE');

@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly svc: MoneyDocsService) {}
  @Perm('receipt.view') @Get() list(@Ctx() ctx: CompanyContext, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(ctx, 'receipts', q);
  }
  @Perm('receipt.view') @Get(':id') get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.get(ctx, 'receipts', id);
  }
  @Perm('receipt.create') @Post() create(@Ctx() ctx: CompanyContext, @Body(new Zod(receiptSchema)) b: z.infer<typeof receiptSchema>) {
    return this.svc.createMoney(ctx, 'RECEIPT', b);
  }
  @Perm('receipt.create') @Patch(':id') update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(receiptSchema)) b: z.infer<typeof receiptSchema>) {
    return this.svc.updateMoney(ctx, 'RECEIPT', id, b);
  }
  @Perm('receipt.create') @Delete(':id') remove(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.remove(ctx, 'RECEIPT', id);
  }
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: MoneyDocsService) {}
  @Perm('payment.view') @Get() list(@Ctx() ctx: CompanyContext, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(ctx, 'payments', q);
  }
  @Perm('payment.view') @Get(':id') get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.get(ctx, 'payments', id);
  }
  @Perm('payment.create') @Post() create(@Ctx() ctx: CompanyContext, @Body(new Zod(paymentSchema)) b: z.infer<typeof paymentSchema>) {
    return this.svc.createMoney(ctx, 'PAYMENT', b);
  }
  @Perm('payment.create') @Patch(':id') update(@Ctx() ctx: CompanyContext, @Param('id') id: string, @Body(new Zod(paymentSchema)) b: z.infer<typeof paymentSchema>) {
    return this.svc.updateMoney(ctx, 'PAYMENT', id, b);
  }
  @Perm('payment.create') @Delete(':id') remove(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.remove(ctx, 'PAYMENT', id);
  }
}

@Controller('advance-adjustments')
export class AdvanceAdjustmentsController {
  constructor(private readonly svc: MoneyDocsService) {}
  @Perm('member') @Get() list(@Ctx() ctx: CompanyContext, @Query(new Zod(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(ctx, 'advance_adjustments', q);
  }
  @Perm('member') @Post(':side') create(@Ctx() ctx: CompanyContext, @Param('side') side: string, @Body(new Zod(advanceAdjSchema)) b: z.infer<typeof advanceAdjSchema>) {
    return this.svc.createAdvanceAdjustment(ctx, side.toUpperCase() === 'SUPPLIER' ? 'SUPPLIER' : 'CUSTOMER', b);
  }
  @Perm('member') @Delete(':id') remove(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.remove(ctx, 'ADVANCE_ADJUSTMENT', id);
  }
}

const allocSchema = z.object({
  sourceType: z.enum(['RECEIPT', 'CREDIT_NOTE', 'PAYMENT', 'DEBIT_NOTE']),
  sourceId: z.string().uuid(),
  targetType: z.enum(['SALES_INVOICE', 'PURCHASE_BILL', 'EXPENSE']),
  targetId: z.string().uuid(),
  amount: z.string().regex(/^\d{1,16}(\.\d{1,2})?$/),
  date: zAdDate.optional(),
});

@Controller('allocations')
export class AllocationsController {
  constructor(private readonly svc: AllocationService) {}
  @Perm('member') @Post() allocate(@Ctx() ctx: CompanyContext, @Body(new Zod(allocSchema)) b: z.infer<typeof allocSchema>) {
    return this.svc.allocate(ctx, b);
  }
  @Perm('member') @Post(':id/reverse') reverse(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.unallocate(ctx, id);
  }
}

@Controller('goods-receipts')
export class GoodsReceiptsController {
  constructor(private readonly svc: GrnService) {}
  @Perm('goods_receipt.view') @Get() list(@Ctx() ctx: CompanyContext) {
    return this.svc.list(ctx);
  }
  @Perm('goods_receipt.view') @Get(':id') get(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }
  @Perm('goods_receipt.create') @Post() create(@Ctx() ctx: CompanyContext, @Body(new Zod(grnSchema)) b: z.infer<typeof grnSchema>) {
    return this.svc.create(ctx, b);
  }
  @Perm('goods_receipt.create') @Post(':id/cancel') cancel(@Ctx() ctx: CompanyContext, @Param('id') id: string) {
    return this.svc.cancel(ctx, id);
  }
}
