/**
 * Permission catalogue — docs/06. Permission = `module.action`.
 * Deny by default: every API endpoint declares the permission(s) it needs.
 */

/** Document types that go through maker–checker (docs/06 §5) and post to the ledger. */
export const DOC_TYPES = {
  MANUAL_JOURNAL: { prefix: 'JV', label: 'Journal voucher', perm: 'journal' },
  OPENING_BALANCE: { prefix: 'OB', label: 'Opening balances', perm: 'opening' },
  SALES_INVOICE: { prefix: 'SI', label: 'Sales invoice', perm: 'sales_invoice' },
  CREDIT_NOTE: { prefix: 'CN', label: 'Credit note', perm: 'credit_note' },
  RECEIPT: { prefix: 'RV', label: 'Receipt', perm: 'receipt' },
  ADVANCE_ADJUSTMENT: { prefix: 'AA', label: 'Advance adjustment', perm: 'receipt' },
  PURCHASE_BILL: { prefix: 'PB', label: 'Purchase bill', perm: 'bill' },
  DEBIT_NOTE: { prefix: 'DN', label: 'Debit note', perm: 'debit_note' },
  PAYMENT: { prefix: 'PV', label: 'Payment', perm: 'payment' },
  EXPENSE: { prefix: 'EX', label: 'Expense / claim', perm: 'expense' },
  CORRECTION: { prefix: 'RC', label: 'Reversal / cancellation', perm: 'correction' },
} as const;
export type DocType = keyof typeof DOC_TYPES;

/** Non-posting documents (numbered, no ledger impact). */
export const NONPOSTING_DOC_TYPES = {
  SALES_QUOTE: { prefix: 'QT', label: 'Quotation', perm: 'sales_quote' },
  SALES_ORDER: { prefix: 'SO', label: 'Sales order', perm: 'sales_order' },
  PURCHASE_ORDER: { prefix: 'PO', label: 'Purchase order', perm: 'purchase_order' },
  GOODS_RECEIPT: { prefix: 'GRN', label: 'Goods receipt', perm: 'goods_receipt' },
} as const;
export type NonPostingDocType = keyof typeof NONPOSTING_DOC_TYPES;

export const REPORTS = [
  'trial_balance',
  'general_ledger',
  'journal',
  'day_book',
  'sales_book',
  'purchase_book',
  'ar_aging',
  'ap_aging',
  'contact_statement',
  'vat_summary',
] as const;
export type ReportName = (typeof REPORTS)[number];

const docPerms = (p: string, extra: string[] = []) => [`${p}.view`, `${p}.create`, `${p}.approve`, ...extra];

export const PERMISSIONS: Record<string, string> = Object.fromEntries(
  (
    [
      ['company.manage', 'Edit company profile and settings'],
      ['company.create', 'Create new companies (platform)'],
      ['branch.manage', 'Manage branches'],
      ['user.view', 'View users'],
      ['user.manage', 'Invite users, assign roles, force logout'],
      ['role.manage', 'Create and edit roles and permissions'],
      ['audit.view', 'View the audit log'],
      ['fiscal_year.manage', 'Create fiscal years and periods'],
      ['period.lock', 'Lock accounting periods'],
      ['period.unlock', 'Unlock accounting periods (step-up)'],
      ['coa.view', 'View chart of accounts'],
      ['coa.manage', 'Create and edit accounts'],
      ['cost_centre.manage', 'Manage cost centres'],
      ['tax.view', 'View tax codes'],
      ['tax.manage', 'Create tax codes and rates (Admin)'],
      ['tds.manage', 'Manage TDS codes'],
      ['number_series.manage', 'Manage number series'],
      ['workflow.manage', 'Configure approval workflows'],
      ['approval.view', 'See approval queue'],
      ...docPerms('journal', ['journal.post_control']).map((p) => [p, 'Manual journals']),
      ['journal.reverse', 'Request reversal of posted entries'],
      ...docPerms('opening').map((p) => [p, 'Opening balances']),
      ['opening.go_live', 'Mark company live after opening balances'],
      ['contact.view', 'View customers/suppliers'],
      ['contact.manage', 'Manage customers/suppliers'],
      ['item.view', 'View items'],
      ['item.manage', 'Manage items'],
      ['item.tax_override', 'Override item tax code on a line'],
      ...['sales_quote', 'sales_order', 'purchase_order', 'goods_receipt'].flatMap((p) => [
        [`${p}.view`, p],
        [`${p}.create`, p],
      ]),
      ...docPerms('sales_invoice', ['sales_invoice.cancel', 'sales_invoice.print']).map((p) => [p, 'Sales invoices']),
      ...docPerms('credit_note').map((p) => [p, 'Credit notes']),
      ...docPerms('receipt', ['receipt.allocate']).map((p) => [p, 'Receipts']),
      ...docPerms('bill', ['bill.cancel']).map((p) => [p, 'Purchase bills']),
      ...docPerms('debit_note').map((p) => [p, 'Debit notes']),
      ...docPerms('payment', ['payment.allocate']).map((p) => [p, 'Payments']),
      ...docPerms('expense').map((p) => [p, 'Expenses & claims']),
      ...docPerms('correction').map((p) => [p, 'Reversals & cancellations']),
      ...REPORTS.flatMap((r) => [
        [`report.${r}.view`, `View report ${r}`],
        [`report.${r}.export`, `Export report ${r}`],
      ]),
    ] as [string, string][]
  ).map(([k, v]) => [k, v]),
);

export type Permission = string;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

const viewAllReports = REPORTS.map((r) => `report.${r}.view`);
const exportAllReports = REPORTS.map((r) => `report.${r}.export`);
const uniq = <T>(a: T[]) => [...new Set(a)];
const allDocs = uniq(Object.values(DOC_TYPES).map((d) => d.perm));
const allNonPosting = Object.values(NONPOSTING_DOC_TYPES).map((d) => d.perm);

export interface RoleTemplate {
  key: string;
  name: string;
  description: string;
  requires2fa: boolean;
  permissions: string[];
}

/** Default roles (docs/06 §2). Editable per company after creation. */
const RAW_ROLES: RoleTemplate[] = [
  {
    key: 'COMPANY_ADMIN',
    name: 'Company Admin',
    description: 'Everything in the company',
    requires2fa: true,
    permissions: ALL_PERMISSIONS.filter((p) => p !== 'company.create'),
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant (Maker)',
    description: 'Create drafts and submit for approval',
    requires2fa: false,
    permissions: [
      'coa.view',
      'tax.view',
      'contact.view',
      'contact.manage',
      'item.view',
      'item.manage',
      'approval.view',
      ...allDocs.flatMap((p) => [`${p}.view`, `${p}.create`]),
      ...allNonPosting.flatMap((p) => [`${p}.view`, `${p}.create`]),
      'journal.reverse',
      'receipt.allocate',
      'payment.allocate',
      'sales_invoice.print',
      'report.trial_balance.view',
      'report.general_ledger.view',
      'report.journal.view',
      'report.day_book.view',
      'report.sales_book.view',
      'report.purchase_book.view',
      'report.ar_aging.view',
      'report.ap_aging.view',
      'report.contact_statement.view',
    ],
  },
  {
    key: 'CHECKER',
    name: 'Senior Accountant (Checker)',
    description: "Approve/reject accountants' work",
    requires2fa: true,
    permissions: [
      'coa.view',
      'tax.view',
      'contact.view',
      'item.view',
      'approval.view',
      ...allDocs.flatMap((p) => [`${p}.view`, `${p}.approve`]),
      ...allNonPosting.map((p) => `${p}.view`),
      'sales_invoice.cancel',
      'bill.cancel',
      'sales_invoice.print',
      'journal.post_control',
      ...viewAllReports,
      ...exportAllReports,
    ],
  },
  {
    key: 'FINANCE_MANAGER',
    name: 'Finance Manager / Approver',
    description: 'Final approval above limits; lock periods',
    requires2fa: true,
    permissions: [
      'coa.view',
      'tax.view',
      'contact.view',
      'item.view',
      'approval.view',
      'period.lock',
      'audit.view',
      ...allDocs.flatMap((p) => [`${p}.view`, `${p}.approve`]),
      ...allNonPosting.map((p) => `${p}.view`),
      'opening.go_live',
      ...viewAllReports,
      ...exportAllReports,
    ],
  },
  {
    key: 'AUDITOR',
    name: 'Auditor',
    description: 'Read-only books, reports and audit log',
    requires2fa: false,
    permissions: [
      'coa.view',
      'tax.view',
      'contact.view',
      'item.view',
      'audit.view',
      'user.view',
      ...allDocs.map((p) => `${p}.view`),
      ...allNonPosting.map((p) => `${p}.view`),
      ...viewAllReports,
      ...exportAllReports,
    ],
  },
  {
    key: 'VIEWER',
    name: 'Viewer / Owner-view',
    description: 'Dashboard and selected reports only',
    requires2fa: false,
    permissions: ['report.trial_balance.view'],
  },
];

/** Default roles (docs/06 §2) with de-duplicated permission lists. */
export const DEFAULT_ROLES: RoleTemplate[] = RAW_ROLES.map((r) => ({ ...r, permissions: uniq(r.permissions).filter((p) => p in PERMISSIONS) }));
