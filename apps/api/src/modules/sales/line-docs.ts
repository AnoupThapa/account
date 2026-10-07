import { z } from 'zod';
import { AppError, calculateTax, d, money, sum, addDays, zAdDate, zMoneyNonNeg, zQty, zRate, TaxType } from '@ledgerpro/shared';
import type { Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import type { TaxService } from '../tax/tax.controller';
import type { PostingComponent } from '../ledger/ledger.service';

/** Line-based document kinds (sales & purchase side). */
export type LineDocKind = 'SALES_INVOICE' | 'CREDIT_NOTE' | 'PURCHASE_BILL' | 'DEBIT_NOTE' | 'EXPENSE' | 'SALES_QUOTE' | 'SALES_ORDER' | 'PURCHASE_ORDER';

export interface LineDocConfig {
  kind: LineDocKind;
  table: string;
  linesTable: string;
  fk: string;
  dateField: string;
  side: 'SALES' | 'PURCHASE';
  perm: string;
  posting: boolean;
  /** contact must be customer / supplier / employee */
  contactTypes: string[];
}

export const LINE_DOCS: Record<LineDocKind, LineDocConfig> = {
  SALES_INVOICE: { kind: 'SALES_INVOICE', table: 'sales_invoices', linesTable: 'sales_invoice_lines', fk: 'invoice_id', dateField: 'invoice_date', side: 'SALES', perm: 'sales_invoice', posting: true, contactTypes: ['CUSTOMER', 'BOTH'] },
  CREDIT_NOTE: { kind: 'CREDIT_NOTE', table: 'credit_notes', linesTable: 'credit_note_lines', fk: 'note_id', dateField: 'note_date', side: 'SALES', perm: 'credit_note', posting: true, contactTypes: ['CUSTOMER', 'BOTH'] },
  PURCHASE_BILL: { kind: 'PURCHASE_BILL', table: 'purchase_bills', linesTable: 'purchase_bill_lines', fk: 'bill_id', dateField: 'bill_date', side: 'PURCHASE', perm: 'bill', posting: true, contactTypes: ['SUPPLIER', 'BOTH'] },
  DEBIT_NOTE: { kind: 'DEBIT_NOTE', table: 'debit_notes', linesTable: 'debit_note_lines', fk: 'note_id', dateField: 'note_date', side: 'PURCHASE', perm: 'debit_note', posting: true, contactTypes: ['SUPPLIER', 'BOTH'] },
  EXPENSE: { kind: 'EXPENSE', table: 'expenses', linesTable: 'expense_lines', fk: 'expense_id', dateField: 'expense_date', side: 'PURCHASE', perm: 'expense', posting: true, contactTypes: ['SUPPLIER', 'BOTH', 'EMPLOYEE'] },
  SALES_QUOTE: { kind: 'SALES_QUOTE', table: 'sales_quotes', linesTable: 'sales_quote_lines', fk: 'quote_id', dateField: 'quote_date', side: 'SALES', perm: 'sales_quote', posting: false, contactTypes: ['CUSTOMER', 'BOTH'] },
  SALES_ORDER: { kind: 'SALES_ORDER', table: 'sales_orders', linesTable: 'sales_order_lines', fk: 'order_id', dateField: 'order_date', side: 'SALES', perm: 'sales_order', posting: false, contactTypes: ['CUSTOMER', 'BOTH'] },
  PURCHASE_ORDER: { kind: 'PURCHASE_ORDER', table: 'purchase_orders', linesTable: 'purchase_order_lines', fk: 'order_id', dateField: 'order_date', side: 'PURCHASE', perm: 'purchase_order', posting: false, contactTypes: ['SUPPLIER', 'BOTH'] },
};

export const lineInputSchema = z.object({
  itemId: z.string().uuid().nullish(),
  accountId: z.string().uuid().nullish(),
  description: z.string().max(500).nullish(),
  quantity: zQty.default('1'),
  unitPrice: zQty,
  discountPercent: zRate.default('0'),
  taxCodeId: z.string().uuid().nullish(),
  costCentreId: z.string().uuid().nullish(),
});

export const lineDocSchema = z.object({
  date: zAdDate,
  dueDate: zAdDate.nullish(),
  validUntil: zAdDate.nullish(),
  contactId: z.string().uuid().nullish(),
  branchId: z.string().uuid().nullish(),
  pricesIncludeTax: z.boolean().default(false),
  notes: z.string().max(2000).nullish(),
  reference: z.string().max(60).nullish(), // customer ref / supplier ref
  // sales invoice
  cashAccountId: z.string().uuid().nullish(),
  buyerName: z.string().max(200).nullish(),
  buyerPan: z.string().max(20).nullish(),
  buyerAddress: z.string().max(500).nullish(),
  salesOrderId: z.string().uuid().nullish(),
  // credit / debit notes
  originalInvoiceId: z.string().uuid().nullish(),
  originalBillId: z.string().uuid().nullish(),
  reason: z.string().max(1000).nullish(),
  refundAccountId: z.string().uuid().nullish(),
  // bills & expenses
  supplierInvoiceNo: z.string().max(60).nullish(),
  supplierInvoiceDate: zAdDate.nullish(),
  supplierPan: z.string().max(20).nullish(),
  purchaseOrderId: z.string().uuid().nullish(),
  goodsReceiptId: z.string().uuid().nullish(),
  expenseKind: z.enum(['PAID', 'CLAIM']).nullish(),
  paidFromAccountId: z.string().uuid().nullish(),
  lines: z.array(lineInputSchema).min(1, 'Add at least one line').max(500),
  version: z.number().int().optional(),
});
export type LineDocInput = z.infer<typeof lineDocSchema>;

export interface ComputedLine {
  line_no: number;
  item_id: string | null;
  account_id: string | null;
  description: string | null;
  quantity: string;
  unit_price: string;
  discount_percent: string;
  discount_amount: string;
  tax_code_id: string | null;
  tax_type: TaxType;
  tax_rate: string;
  is_claimable: boolean;
  net_amount: string; // excl. tax (for purchases: excl. claimable tax, incl. nothing else)
  tax_amount: string;
  total_amount: string;
  cost_centre_id: string | null;
  output_account_id: string | null;
  input_account_id: string | null;
}

export interface ComputedDoc {
  lines: ComputedLine[];
  subtotal: string;
  discountTotal: string;
  taxableTotal: string;
  zeroRatedTotal: string;
  exemptTotal: string;
  taxTotal: string;
  nonClaimableTax: string;
  roundingAdjustment: string;
  grandTotal: string;
}

/** Resolve items/accounts/tax codes and compute every amount server-side (never trust client totals). */
export async function computeLines(trx: Tx, ctx: CompanyContext, cfg: LineDocConfig, input: LineDocInput, tax: TaxService): Promise<ComputedDoc> {
  const company = await trx.selectFrom('companies').select(['tax_rounding']).where('id', '=', ctx.companyId).executeTakeFirstOrThrow();
  const itemIds = input.lines.map((l) => l.itemId).filter(Boolean) as string[];
  const items = itemIds.length ? await trx.selectFrom('items').selectAll().where('id', 'in', itemIds).execute() : [];
  const resolved: { accountId: string | null; taxCodeId: string | null; itemId: string | null; description: string | null }[] = [];
  for (const [i, l] of input.lines.entries()) {
    const item = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
    if (l.itemId && (!item || !item.is_active)) throw new AppError('VAL_FIELD', `Line ${i + 1}: unknown or inactive item`, undefined, [{ field: `lines.${i}.itemId`, message: 'Unknown item' }]);
    const accountId = l.accountId ?? (item ? (cfg.side === 'SALES' ? item.sales_account_id : item.is_stock_tracked ? item.inventory_account_id ?? item.purchase_account_id : item.purchase_account_id) : null);
    if (!accountId) throw new AppError('VAL_FIELD', `Line ${i + 1}: choose an item or an account`, undefined, [{ field: `lines.${i}.accountId`, message: 'Required' }]);
    const taxCodeId = l.taxCodeId ?? item?.default_tax_code_id ?? null;
    if (item && l.taxCodeId && l.taxCodeId !== item.default_tax_code_id && !ctx.permissions.has('item.tax_override')) {
      throw new AppError('PERM_DENIED', `Line ${i + 1}: changing the item's tax code needs the "item.tax_override" permission`);
    }
    if (!taxCodeId && item && item.tax_applicability === 'TAXABLE') throw new AppError('VAL_FIELD', `Line ${i + 1}: taxable item has no tax code`);
    resolved.push({ accountId, taxCodeId, itemId: item?.id ?? null, description: l.description ?? item?.name ?? null });
  }
  // accounts must be active ledger accounts, not control accounts (those are posted by the system)
  const acctIds = [...new Set(resolved.map((r) => r.accountId).filter(Boolean) as string[])];
  const accts = acctIds.length ? await trx.selectFrom('accounts').select(['id', 'code', 'name', 'is_active', 'is_postable', 'is_control', 'requires_contact', 'subtype']).where('id', 'in', acctIds).execute() : [];
  for (const [i, r] of resolved.entries()) {
    if (!r.accountId) continue;
    const a = accts.find((x) => x.id === r.accountId);
    if (!a) throw new AppError('VAL_FIELD', `Line ${i + 1}: unknown account`);
    if (!a.is_active) throw new AppError('ACC_ACCOUNT_INACTIVE', `Line ${i + 1}: ${a.code} ${a.name} is inactive`);
    if (!a.is_postable) throw new AppError('ACC_NOT_POSTABLE', `Line ${i + 1}: ${a.code} ${a.name} is a heading`);
    // inventory control accounts are allowed on purchase lines (stock purchases); AR/AP/VAT never
    const stockPurchase = cfg.side === 'PURCHASE' && a.subtype === 'INVENTORY';
    if ((a.is_control || a.requires_contact) && !stockPurchase) {
      throw new AppError('ACC_CONTROL_ACCOUNT', `Line ${i + 1}: ${a.code} ${a.name} is a control account and can't be used on a document line`);
    }
  }
  const date = input.date;
  const taxInfos = new Map<string, Awaited<ReturnType<TaxService['taxOn']>>>();
  for (const r of resolved) if (r.taxCodeId && !taxInfos.has(r.taxCodeId)) taxInfos.set(r.taxCodeId, await tax.taxOn(trx, r.taxCodeId, date));

  const calc = calculateTax(
    input.lines.map((l, i) => {
      const t = resolved[i].taxCodeId ? taxInfos.get(resolved[i].taxCodeId!)! : null;
      return { quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxType: (t?.type ?? 'OUT_OF_SCOPE') as TaxType, taxRate: t?.rate ?? '0' };
    }),
    { pricesIncludeTax: input.pricesIncludeTax, rounding: company.tax_rounding as 'LINE' | 'DOCUMENT' },
  );

  let nonClaimable = d(0);
  const lines: ComputedLine[] = input.lines.map((l, i) => {
    const t = resolved[i].taxCodeId ? taxInfos.get(resolved[i].taxCodeId!)! : null;
    const c = calc.lines[i];
    const claimable = t ? t.isClaimable : true;
    if (cfg.side === 'PURCHASE' && !claimable) nonClaimable = nonClaimable.plus(c.tax);
    return {
      line_no: i + 1,
      item_id: resolved[i].itemId,
      account_id: resolved[i].accountId,
      description: resolved[i].description,
      quantity: l.quantity,
      unit_price: l.unitPrice,
      discount_percent: l.discountPercent ?? '0',
      discount_amount: c.discount,
      tax_code_id: resolved[i].taxCodeId,
      tax_type: (t?.type ?? 'OUT_OF_SCOPE') as TaxType,
      tax_rate: t?.rate ?? '0',
      is_claimable: claimable,
      net_amount: c.net,
      tax_amount: c.tax,
      total_amount: c.total,
      cost_centre_id: l.costCentreId ?? null,
      output_account_id: t?.outputAccountId ?? null,
      input_account_id: t?.inputAccountId ?? null,
    };
  });
  return {
    lines,
    subtotal: calc.subtotal,
    discountTotal: calc.discountTotal,
    taxableTotal: calc.taxableTotal,
    zeroRatedTotal: calc.zeroRatedTotal,
    exemptTotal: calc.exemptTotal,
    taxTotal: calc.taxTotal,
    nonClaimableTax: money(nonClaimable),
    roundingAdjustment: calc.roundingAdjustment,
    grandTotal: calc.grandTotal,
  };
}

export interface StoredLine {
  account_id: string | null;
  item_id: string | null;
  description: string | null;
  net_amount: string;
  tax_amount: string;
  tax_code_id: string | null;
  is_claimable: boolean;
  cost_centre_id: string | null;
  project_id: string | null;
}

/**
 * Build posting components for a line document (docs/02 §5).
 * Rounding: with per-document rounding the tax difference goes to the first tax line (VAT stays exact)
 * and, for tax-inclusive prices, the balancing difference goes to Rounding Off.
 */
export async function lineDocComponents(trx: Tx, kind: LineDocKind, doc: Record<string, any>, lines: StoredLine[]): Promise<PostingComponent[]> {
  const taxAcct = new Map<string, { output: string | null; input: string | null }>();
  for (const l of lines) {
    if (l.tax_code_id && !taxAcct.has(l.tax_code_id)) {
      const tc = await trx.selectFrom('tax_codes').select(['output_account_id', 'input_account_id']).where('id', '=', l.tax_code_id).executeTakeFirstOrThrow();
      taxAcct.set(l.tax_code_id, { output: tc.output_account_id, input: tc.input_account_id });
    }
  }
  const c: PostingComponent[] = [];
  const contact = doc.contact_id ?? null;
  const grand = doc.grand_total as string;
  const adj = d(doc.rounding_adjustment ?? 0);
  const taxLines = lines.filter((l) => d(l.tax_amount).gt(0));
  const base = (l: StoredLine) => ({ itemId: l.item_id, costCentreId: l.cost_centre_id, projectId: l.project_id, description: l.description, taxCodeId: l.tax_code_id });

  if (kind === 'SALES_INVOICE' || kind === 'CREDIT_NOTE') {
    const isInv = kind === 'SALES_INVOICE';
    const cashAcct = isInv ? doc.cash_account_id : doc.refund_account_id;
    c.push(cashAcct ? { role: 'CASH', amount: grand, accountId: cashAcct, contactId: contact, description: isInv ? 'Cash sale' : 'Cash refund' } : { role: 'RECEIVABLE', amount: grand, contactId: contact });
    for (const l of lines) c.push({ ...base(l), role: isInv ? 'REVENUE' : 'SALES_RETURN', amount: l.net_amount, accountId: isInv ? l.account_id : null });
    for (const l of taxLines) c.push({ ...base(l), role: 'OUTPUT_TAX', amount: l.tax_amount, accountId: taxAcct.get(l.tax_code_id!)!.output, description: 'Output VAT/GST' });
    if (!adj.isZero() && taxLines[0]) c.push({ ...base(taxLines[0]), role: 'OUTPUT_TAX', amount: money(adj), accountId: taxAcct.get(taxLines[0].tax_code_id!)!.output, description: 'VAT/GST rounding (per document)' });
  } else {
    // purchase side: bill, debit note, expense
    for (const l of lines) {
      const cost = l.is_claimable ? d(l.net_amount) : d(l.net_amount).plus(l.tax_amount); // non-claimable tax added to cost
      c.push({ ...base(l), role: 'EXPENSE', amount: money(cost), accountId: l.account_id, contactId: null });
    }
    const claimTax = taxLines.filter((l) => l.is_claimable);
    for (const l of claimTax) c.push({ ...base(l), role: 'INPUT_TAX', amount: l.tax_amount, accountId: taxAcct.get(l.tax_code_id!)!.input, description: 'Input VAT/GST' });
    if (!adj.isZero()) {
      if (claimTax[0]) c.push({ ...base(claimTax[0]), role: 'INPUT_TAX', amount: money(adj), accountId: taxAcct.get(claimTax[0].tax_code_id!)!.input, description: 'VAT/GST rounding (per document)' });
      else if (lines[0]) c.push({ ...base(lines[0]), role: 'EXPENSE', amount: money(adj), accountId: lines[0].account_id });
    }
    if (kind === 'PURCHASE_BILL') c.push({ role: 'PAYABLE', amount: grand, contactId: contact });
    else if (kind === 'DEBIT_NOTE') c.push(doc.refund_account_id ? { role: 'CASH', amount: grand, accountId: doc.refund_account_id, contactId: contact } : { role: 'PAYABLE', amount: grand, contactId: contact });
    else c.push(doc.kind === 'CLAIM' ? { role: 'STAFF_PAYABLE', amount: grand, contactId: contact } : { role: 'BANK', amount: grand, accountId: doc.paid_from_account_id, contactId: contact });
  }
  // Inclusive prices + per-document rounding: balance the entry through Rounding Off (docs/02 §2.10)
  const dr = sum(c.filter((x) => isDebit(kind, x.role)).map((x) => x.amount));
  const cr = sum(c.filter((x) => !isDebit(kind, x.role)).map((x) => x.amount));
  const diff = dr.minus(cr);
  // ROUNDING must add a CREDIT of `diff`: positive amount on CREDIT-side rules, negative on DEBIT-side rules
  if (!diff.isZero()) c.push({ role: 'ROUNDING', amount: money(roundingRuleIsCredit(kind) ? diff : diff.neg()), description: 'Rounding off' });
  return c;
}

const DEBIT_ROLES: Record<string, string[]> = {
  SALES_INVOICE: ['RECEIVABLE', 'CASH'],
  CREDIT_NOTE: ['SALES_RETURN', 'OUTPUT_TAX'],
  PURCHASE_BILL: ['EXPENSE', 'INPUT_TAX'],
  DEBIT_NOTE: ['PAYABLE', 'CASH'],
  EXPENSE: ['EXPENSE', 'INPUT_TAX'],
};
function isDebit(kind: LineDocKind, role: string) {
  return (DEBIT_ROLES[kind] ?? []).includes(role);
}
/** ROUNDING rule side: CREDIT for invoices & debit notes, DEBIT for credit notes, bills & expenses. */
function roundingRuleIsCredit(kind: LineDocKind) {
  return ['SALES_INVOICE', 'DEBIT_NOTE'].includes(kind);
}

export function defaultDueDate(date: string, termsDays: number) {
  return addDays(date, termsDays);
}
