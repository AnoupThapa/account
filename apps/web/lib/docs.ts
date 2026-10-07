export type DocKey =
  | 'sales-invoices'
  | 'credit-notes'
  | 'sales-quotes'
  | 'sales-orders'
  | 'bills'
  | 'debit-notes'
  | 'purchase-orders'
  | 'expenses'
  | 'receipts'
  | 'payments';

export interface DocDef {
  key: DocKey;
  title: string;
  singular: string;
  docType?: string; // maker–checker document type (posting docs)
  printType?: string;
  perm: string;
  side: 'SALES' | 'PURCHASE';
  contactType?: 'CUSTOMER' | 'SUPPLIER' | 'EMPLOYEE';
  money?: boolean; // receipts / payments
  posting: boolean;
  dateLabel: string;
  statusFlow?: Record<string, string[]>;
  convert?: { to: string; label: string; path: DocKey }[];
}

export const DOCS: Record<DocKey, DocDef> = {
  'sales-invoices': { key: 'sales-invoices', title: 'Sales invoices', singular: 'Invoice', docType: 'SALES_INVOICE', printType: 'sales_invoice', perm: 'sales_invoice', side: 'SALES', contactType: 'CUSTOMER', posting: true, dateLabel: 'Invoice date' },
  'credit-notes': { key: 'credit-notes', title: 'Credit notes', singular: 'Credit note', docType: 'CREDIT_NOTE', printType: 'credit_note', perm: 'credit_note', side: 'SALES', contactType: 'CUSTOMER', posting: true, dateLabel: 'Date' },
  'sales-quotes': {
    key: 'sales-quotes', title: 'Quotations', singular: 'Quotation', printType: 'sales_quote', perm: 'sales_quote', side: 'SALES', contactType: 'CUSTOMER', posting: false, dateLabel: 'Quote date',
    statusFlow: { DRAFT: ['SENT', 'CANCELLED'], SENT: ['ACCEPTED', 'DECLINED', 'CANCELLED'], ACCEPTED: ['CANCELLED'] },
    convert: [{ to: 'SALES_ORDER', label: 'Convert to sales order', path: 'sales-orders' }, { to: 'SALES_INVOICE', label: 'Convert to invoice', path: 'sales-invoices' }],
  },
  'sales-orders': {
    key: 'sales-orders', title: 'Sales orders', singular: 'Sales order', printType: 'sales_order', perm: 'sales_order', side: 'SALES', contactType: 'CUSTOMER', posting: false, dateLabel: 'Order date',
    statusFlow: { DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['CLOSED', 'CANCELLED'], INVOICED: ['CLOSED'] },
    convert: [{ to: 'SALES_INVOICE', label: 'Create invoice', path: 'sales-invoices' }],
  },
  bills: { key: 'bills', title: 'Purchase bills', singular: 'Bill', docType: 'PURCHASE_BILL', printType: 'purchase_bill', perm: 'bill', side: 'PURCHASE', contactType: 'SUPPLIER', posting: true, dateLabel: 'Bill date' },
  'debit-notes': { key: 'debit-notes', title: 'Debit notes', singular: 'Debit note', docType: 'DEBIT_NOTE', printType: 'debit_note', perm: 'debit_note', side: 'PURCHASE', contactType: 'SUPPLIER', posting: true, dateLabel: 'Date' },
  'purchase-orders': {
    key: 'purchase-orders', title: 'Purchase orders', singular: 'Purchase order', printType: 'purchase_order', perm: 'purchase_order', side: 'PURCHASE', contactType: 'SUPPLIER', posting: false, dateLabel: 'Order date',
    statusFlow: { DRAFT: ['ISSUED', 'CANCELLED'], ISSUED: ['CLOSED', 'CANCELLED'], PARTIAL: ['CLOSED'], RECEIVED: ['CLOSED'], BILLED: ['CLOSED'] },
    convert: [{ to: 'PURCHASE_BILL', label: 'Create bill', path: 'bills' }],
  },
  expenses: { key: 'expenses', title: 'Expenses & claims', singular: 'Expense', docType: 'EXPENSE', printType: 'expense', perm: 'expense', side: 'PURCHASE', posting: true, dateLabel: 'Date' },
  receipts: { key: 'receipts', title: 'Receipts & customer advances', singular: 'Receipt', docType: 'RECEIPT', perm: 'receipt', side: 'SALES', contactType: 'CUSTOMER', money: true, posting: true, dateLabel: 'Receipt date' },
  payments: { key: 'payments', title: 'Payments & supplier advances', singular: 'Payment', docType: 'PAYMENT', perm: 'payment', side: 'PURCHASE', contactType: 'SUPPLIER', money: true, posting: true, dateLabel: 'Payment date' },
};

export const dateFieldOf = (d: any) => d.invoice_date ?? d.note_date ?? d.quote_date ?? d.order_date ?? d.bill_date ?? d.expense_date ?? d.receipt_date ?? d.payment_date ?? d.journal_date;

/** Where a ledger source document lives in the UI (drill-down from reports). */
export function sourceHref(sourceType: string, sourceId: string | null) {
  if (!sourceId) return null;
  const m: Record<string, string> = {
    SALES_INVOICE: '/docs/sales-invoices/',
    CREDIT_NOTE: '/docs/credit-notes/',
    PURCHASE_BILL: '/docs/bills/',
    DEBIT_NOTE: '/docs/debit-notes/',
    EXPENSE: '/docs/expenses/',
    RECEIPT: '/docs/receipts/',
    PAYMENT: '/docs/payments/',
    MANUAL_JOURNAL: '/journals/',
    OPENING_BALANCE: '/opening/',
  };
  return m[sourceType] ? m[sourceType] + sourceId : null;
}
