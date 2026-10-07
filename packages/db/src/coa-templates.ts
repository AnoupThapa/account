/**
 * Chart-of-accounts templates — docs/02 §3.1. The Mixed/Nepal template is the master list;
 * Service, Trading and Manufacturing are subsets (column `in`). IFRS variant renames a few
 * headings and drops Nepal-only lines (wallet names, TDS wording).
 */
export type BusinessType = 'SERVICE' | 'TRADING' | 'MANUFACTURING' | 'MIXED';
export type AccountClass = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface TemplateAccount {
  code: string;
  name: string;
  ifrsName?: string;
  class: AccountClass;
  parent?: string;
  postable?: boolean; // default true
  control?: boolean;
  requiresContact?: boolean;
  systemKey?: string;
  subtype?: string;
  cashFlow?: 'OPERATING' | 'INVESTING' | 'FINANCING' | 'CASH';
  /** which business types include it; default all */
  in?: BusinessType[];
  nepalOnly?: boolean;
}

const TM: BusinessType[] = ['TRADING', 'MANUFACTURING', 'MIXED'];
const M: BusinessType[] = ['MANUFACTURING', 'MIXED'];
const H = (code: string, name: string, cls: AccountClass, parent?: string, extra: Partial<TemplateAccount> = {}): TemplateAccount => ({
  code,
  name,
  class: cls,
  parent,
  postable: false,
  ...extra,
});

export const COA_MASTER: TemplateAccount[] = [
  H('1000', 'ASSETS', 'ASSET'),
  H('1100', 'Current Assets', 'ASSET', '1000'),
  { code: '1110', name: 'Cash in Hand', class: 'ASSET', parent: '1100', systemKey: 'CASH', subtype: 'CASH', cashFlow: 'CASH' },
  { code: '1111', name: 'Petty Cash', class: 'ASSET', parent: '1100', systemKey: 'PETTY_CASH', subtype: 'CASH', cashFlow: 'CASH' },
  H('1120', 'Bank Accounts', 'ASSET', '1100'),
  { code: '1121', name: 'Main Bank Account', class: 'ASSET', parent: '1120', systemKey: 'BANK_DEFAULT', subtype: 'BANK', cashFlow: 'CASH' },
  H('1130', 'Digital Wallets', 'ASSET', '1100'),
  { code: '1131', name: 'eSewa Wallet', class: 'ASSET', parent: '1130', subtype: 'WALLET', cashFlow: 'CASH', nepalOnly: true },
  { code: '1132', name: 'Khalti Wallet', class: 'ASSET', parent: '1130', subtype: 'WALLET', cashFlow: 'CASH', nepalOnly: true },
  { code: '1140', name: 'Trade Receivables', class: 'ASSET', parent: '1100', control: true, requiresContact: true, systemKey: 'AR_CONTROL', subtype: 'RECEIVABLE', cashFlow: 'OPERATING' },
  H('1150', 'Inventory', 'ASSET', '1100', { in: TM }),
  { code: '1151', name: 'Raw Materials', class: 'ASSET', parent: '1150', control: true, systemKey: 'RAW_MATERIALS', subtype: 'INVENTORY', cashFlow: 'OPERATING', in: M },
  { code: '1152', name: 'Work in Progress', class: 'ASSET', parent: '1150', control: true, systemKey: 'WIP', subtype: 'INVENTORY', cashFlow: 'OPERATING', in: M },
  { code: '1153', name: 'Finished Goods', class: 'ASSET', parent: '1150', control: true, systemKey: 'FINISHED_GOODS', subtype: 'INVENTORY', cashFlow: 'OPERATING', in: M },
  { code: '1154', name: 'Trading Goods', class: 'ASSET', parent: '1150', control: true, systemKey: 'INVENTORY', subtype: 'INVENTORY', cashFlow: 'OPERATING', in: TM },
  H('1160', 'Advances & Prepayments', 'ASSET', '1100'),
  { code: '1161', name: 'Supplier Advances', class: 'ASSET', parent: '1160', requiresContact: true, systemKey: 'SUPPLIER_ADVANCES', subtype: 'CURRENT_ASSET', cashFlow: 'OPERATING' },
  { code: '1162', name: 'Prepaid Expenses', class: 'ASSET', parent: '1160', subtype: 'CURRENT_ASSET', cashFlow: 'OPERATING' },
  { code: '1163', name: 'Staff Advances', class: 'ASSET', parent: '1160', requiresContact: true, subtype: 'CURRENT_ASSET', cashFlow: 'OPERATING' },
  H('1170', 'Tax Assets', 'ASSET', '1100'),
  { code: '1171', name: 'Input VAT/GST Receivable', class: 'ASSET', parent: '1170', control: true, systemKey: 'INPUT_TAX', subtype: 'CURRENT_ASSET', cashFlow: 'OPERATING' },
  { code: '1172', name: 'TDS Receivable', ifrsName: 'Withholding Tax Receivable', class: 'ASSET', parent: '1170', systemKey: 'TDS_RECEIVABLE', subtype: 'CURRENT_ASSET', cashFlow: 'OPERATING' },
  { code: '1173', name: 'Advance Income Tax', class: 'ASSET', parent: '1170', subtype: 'CURRENT_ASSET', cashFlow: 'OPERATING' },
  { code: '1180', name: 'Other Receivables', class: 'ASSET', parent: '1100', subtype: 'CURRENT_ASSET', cashFlow: 'OPERATING' },
  H('1500', 'Non-Current Assets', 'ASSET', '1000'),
  H('1510', 'Property, Plant & Equipment', 'ASSET', '1500'),
  { code: '1511', name: 'Furniture & Fixtures', class: 'ASSET', parent: '1510', subtype: 'PPE', cashFlow: 'INVESTING' },
  { code: '1512', name: 'Office Equipment & Computers', class: 'ASSET', parent: '1510', subtype: 'PPE', cashFlow: 'INVESTING' },
  { code: '1513', name: 'Vehicles', class: 'ASSET', parent: '1510', subtype: 'PPE', cashFlow: 'INVESTING' },
  { code: '1514', name: 'Plant & Machinery', class: 'ASSET', parent: '1510', subtype: 'PPE', cashFlow: 'INVESTING', in: M },
  H('1590', 'Accumulated Depreciation', 'ASSET', '1500'),
  { code: '1591', name: 'Accumulated Depreciation — PPE', class: 'ASSET', parent: '1590', subtype: 'ACCUM_DEPRECIATION', cashFlow: 'INVESTING' },
  { code: '1600', name: 'Intangible Assets', class: 'ASSET', parent: '1500', subtype: 'INTANGIBLE', cashFlow: 'INVESTING' },
  { code: '1690', name: 'Accumulated Amortisation', class: 'ASSET', parent: '1500', subtype: 'ACCUM_DEPRECIATION', cashFlow: 'INVESTING' },
  { code: '1700', name: 'Investments', class: 'ASSET', parent: '1500', subtype: 'NON_CURRENT_ASSET', cashFlow: 'INVESTING' },
  { code: '1800', name: 'Deposits', class: 'ASSET', parent: '1500', subtype: 'NON_CURRENT_ASSET', cashFlow: 'INVESTING' },

  H('2000', 'LIABILITIES', 'LIABILITY'),
  H('2100', 'Current Liabilities', 'LIABILITY', '2000'),
  { code: '2110', name: 'Trade Payables', class: 'LIABILITY', parent: '2100', control: true, requiresContact: true, systemKey: 'AP_CONTROL', subtype: 'PAYABLE', cashFlow: 'OPERATING' },
  { code: '2120', name: 'Customer Advances', class: 'LIABILITY', parent: '2100', requiresContact: true, systemKey: 'CUSTOMER_ADVANCES', subtype: 'CURRENT_LIABILITY', cashFlow: 'OPERATING' },
  H('2130', 'Tax Liabilities', 'LIABILITY', '2100'),
  { code: '2131', name: 'Output VAT/GST Payable', class: 'LIABILITY', parent: '2130', control: true, systemKey: 'OUTPUT_TAX', subtype: 'CURRENT_LIABILITY', cashFlow: 'OPERATING' },
  { code: '2132', name: 'VAT/GST Settlement', class: 'LIABILITY', parent: '2130', systemKey: 'TAX_SETTLEMENT', subtype: 'CURRENT_LIABILITY', cashFlow: 'OPERATING' },
  { code: '2133', name: 'TDS Payable', ifrsName: 'Withholding Tax Payable', class: 'LIABILITY', parent: '2130', systemKey: 'TDS_PAYABLE', subtype: 'CURRENT_LIABILITY', cashFlow: 'OPERATING' },
  { code: '2134', name: 'Income Tax Payable', class: 'LIABILITY', parent: '2130', systemKey: 'INCOME_TAX_PAYABLE', subtype: 'CURRENT_LIABILITY', cashFlow: 'OPERATING' },
  { code: '2140', name: 'Accrued Expenses', class: 'LIABILITY', parent: '2100', subtype: 'CURRENT_LIABILITY', cashFlow: 'OPERATING' },
  { code: '2150', name: 'Salary & Staff Payables', class: 'LIABILITY', parent: '2100', requiresContact: true, systemKey: 'STAFF_PAYABLES', subtype: 'CURRENT_LIABILITY', cashFlow: 'OPERATING' },
  { code: '2160', name: 'Short-term Loans / Overdraft', class: 'LIABILITY', parent: '2100', subtype: 'CURRENT_LIABILITY', cashFlow: 'FINANCING' },
  H('2500', 'Non-Current Liabilities', 'LIABILITY', '2000'),
  { code: '2510', name: 'Long-term Loans', class: 'LIABILITY', parent: '2500', subtype: 'NON_CURRENT_LIABILITY', cashFlow: 'FINANCING' },
  { code: '2520', name: 'Provisions (Gratuity etc.)', class: 'LIABILITY', parent: '2500', subtype: 'NON_CURRENT_LIABILITY', cashFlow: 'OPERATING' },

  H('3000', 'EQUITY', 'EQUITY'),
  { code: '3100', name: "Share Capital / Owner's Capital", ifrsName: 'Share Capital', class: 'EQUITY', parent: '3000', systemKey: 'CAPITAL', subtype: 'EQUITY', cashFlow: 'FINANCING' },
  { code: '3200', name: 'Retained Earnings', class: 'EQUITY', parent: '3000', systemKey: 'RETAINED_EARNINGS', subtype: 'EQUITY' },
  { code: '3300', name: 'Reserves', class: 'EQUITY', parent: '3000', subtype: 'EQUITY' },
  { code: '3400', name: 'Drawings', class: 'EQUITY', parent: '3000', systemKey: 'DRAWINGS', subtype: 'EQUITY', cashFlow: 'FINANCING' },
  { code: '3900', name: 'Opening Balance Equity', class: 'EQUITY', parent: '3000', systemKey: 'OPENING_BALANCE_EQUITY', subtype: 'EQUITY' },

  H('4000', 'INCOME', 'INCOME'),
  { code: '4100', name: 'Sales — Goods', class: 'INCOME', parent: '4000', systemKey: 'SALES_GOODS', subtype: 'REVENUE', in: TM },
  { code: '4200', name: 'Sales — Services', class: 'INCOME', parent: '4000', systemKey: 'SALES_SERVICES', subtype: 'REVENUE' },
  { code: '4300', name: 'Sales Returns & Discounts', class: 'INCOME', parent: '4000', systemKey: 'SALES_RETURNS', subtype: 'REVENUE_CONTRA' },
  H('4800', 'Other Income', 'INCOME', '4000'),
  { code: '4810', name: 'Interest Income', class: 'INCOME', parent: '4800', systemKey: 'INTEREST_INCOME', subtype: 'OTHER_INCOME' },
  { code: '4820', name: 'Discount Received', class: 'INCOME', parent: '4800', systemKey: 'DISCOUNT_RECEIVED', subtype: 'OTHER_INCOME' },
  { code: '4830', name: 'Foreign Exchange Gain', class: 'INCOME', parent: '4800', systemKey: 'FX_GAIN', subtype: 'OTHER_INCOME' },
  { code: '4840', name: 'Gain on Disposal of Assets', class: 'INCOME', parent: '4800', systemKey: 'GAIN_ON_DISPOSAL', subtype: 'OTHER_INCOME' },
  { code: '4890', name: 'Miscellaneous Income', class: 'INCOME', parent: '4800', subtype: 'OTHER_INCOME' },

  H('5000', 'EXPENSES', 'EXPENSE'),
  { code: '5100', name: 'Cost of Goods Sold', class: 'EXPENSE', parent: '5000', systemKey: 'COGS', subtype: 'COGS', in: TM },
  { code: '5150', name: 'Purchase Price Variance / Stock Adjustments', class: 'EXPENSE', parent: '5000', systemKey: 'STOCK_ADJUSTMENT', subtype: 'COGS', in: TM },
  H('5200', 'Direct Manufacturing Costs', 'EXPENSE', '5000', { in: M }),
  { code: '5210', name: 'Direct Labour', class: 'EXPENSE', parent: '5200', subtype: 'COGS', in: M },
  { code: '5220', name: 'Factory Overhead', class: 'EXPENSE', parent: '5200', subtype: 'COGS', in: M },
  H('5300', 'Employee Costs', 'EXPENSE', '5000'),
  { code: '5310', name: 'Salaries & Wages', class: 'EXPENSE', parent: '5300', systemKey: 'SALARIES', subtype: 'EMPLOYEE' },
  { code: '5320', name: 'Staff Welfare', class: 'EXPENSE', parent: '5300', subtype: 'EMPLOYEE' },
  H('5400', 'Administrative Expenses', 'EXPENSE', '5000'),
  { code: '5410', name: 'Rent', class: 'EXPENSE', parent: '5400', subtype: 'ADMIN' },
  { code: '5420', name: 'Utilities (Electricity, Water, Internet)', class: 'EXPENSE', parent: '5400', subtype: 'ADMIN' },
  { code: '5430', name: 'Office Supplies & Stationery', class: 'EXPENSE', parent: '5400', subtype: 'ADMIN' },
  { code: '5440', name: 'Professional & Audit Fees', class: 'EXPENSE', parent: '5400', subtype: 'ADMIN' },
  { code: '5450', name: 'Repairs & Maintenance', class: 'EXPENSE', parent: '5400', subtype: 'ADMIN' },
  { code: '5460', name: 'Travel & Conveyance', class: 'EXPENSE', parent: '5400', subtype: 'ADMIN' },
  { code: '5490', name: 'General Expenses', class: 'EXPENSE', parent: '5400', systemKey: 'GENERAL_EXPENSE', subtype: 'ADMIN' },
  H('5500', 'Selling & Distribution', 'EXPENSE', '5000'),
  { code: '5510', name: 'Discount Allowed', class: 'EXPENSE', parent: '5500', systemKey: 'DISCOUNT_ALLOWED', subtype: 'SELLING' },
  { code: '5520', name: 'Advertising & Marketing', class: 'EXPENSE', parent: '5500', subtype: 'SELLING' },
  { code: '5530', name: 'Freight & Delivery', class: 'EXPENSE', parent: '5500', subtype: 'SELLING' },
  H('5600', 'Finance Costs', 'EXPENSE', '5000'),
  { code: '5610', name: 'Interest Expense', class: 'EXPENSE', parent: '5600', subtype: 'FINANCE' },
  { code: '5620', name: 'Bank Charges', class: 'EXPENSE', parent: '5600', systemKey: 'BANK_CHARGES', subtype: 'FINANCE' },
  { code: '5700', name: 'Depreciation & Amortisation', class: 'EXPENSE', parent: '5000', systemKey: 'DEPRECIATION', subtype: 'DEPRECIATION' },
  H('5800', 'Other Expenses', 'EXPENSE', '5000'),
  { code: '5810', name: 'Foreign Exchange Loss', class: 'EXPENSE', parent: '5800', systemKey: 'FX_LOSS', subtype: 'OTHER_EXPENSE' },
  { code: '5820', name: 'Loss on Disposal of Assets', class: 'EXPENSE', parent: '5800', systemKey: 'LOSS_ON_DISPOSAL', subtype: 'OTHER_EXPENSE' },
  { code: '5900', name: 'Income Tax Expense', class: 'EXPENSE', parent: '5000', systemKey: 'INCOME_TAX_EXPENSE', subtype: 'INCOME_TAX' },

  H('9000', 'SYSTEM / CLEARING', 'ASSET'),
  { code: '9100', name: 'Suspense — Unidentified Receipts', class: 'LIABILITY', parent: '9000', systemKey: 'SUSPENSE_RECEIPTS', subtype: 'SUSPENSE' },
  { code: '9200', name: 'Suspense — Unidentified Payments', class: 'ASSET', parent: '9000', systemKey: 'SUSPENSE_PAYMENTS', subtype: 'SUSPENSE' },
  { code: '9300', name: 'Goods Received Not Invoiced (GRNI)', class: 'LIABILITY', parent: '9000', systemKey: 'GRNI', subtype: 'CLEARING', in: TM },
  { code: '9400', name: 'Rounding Off', class: 'EXPENSE', parent: '9000', systemKey: 'ROUNDING', subtype: 'CLEARING' },
  { code: '9500', name: 'Inter-branch Clearing', class: 'ASSET', parent: '9000', systemKey: 'INTER_BRANCH', subtype: 'CLEARING' },
];

export function buildCoaTemplate(businessType: BusinessType, layout: 'NEPAL' | 'IFRS'): TemplateAccount[] {
  return COA_MASTER.filter((a) => (!a.in || a.in.includes(businessType)) && !(layout === 'IFRS' && a.nepalOnly)).map((a) => ({
    ...a,
    name: layout === 'IFRS' && a.ifrsName ? a.ifrsName : a.name,
  }));
}

/** Default tax codes per country — docs/02 §4. Rates are data; admins add new effective-dated rates. */
export interface TaxCodeSeed {
  code: string;
  name: string;
  type: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE';
  rate: string;
  claimable: boolean;
}
export const DEFAULT_TAX_CODES: Record<'NP' | 'AU' | 'OTHER', TaxCodeSeed[]> = {
  NP: [
    { code: 'VAT13', name: 'VAT 13%', type: 'STANDARD', rate: '13', claimable: true },
    { code: 'VAT0', name: 'VAT 0% (zero-rated / export)', type: 'ZERO_RATED', rate: '0', claimable: true },
    { code: 'EXEMPT', name: 'VAT Exempt', type: 'EXEMPT', rate: '0', claimable: false },
    { code: 'VAT13-NC', name: 'VAT 13% — not claimable', type: 'STANDARD', rate: '13', claimable: false },
    { code: 'NOVAT', name: 'No VAT (non-VAT supplier / out of scope)', type: 'OUT_OF_SCOPE', rate: '0', claimable: false },
  ],
  AU: [
    { code: 'GST', name: 'GST 10%', type: 'STANDARD', rate: '10', claimable: true },
    { code: 'FRE', name: 'GST-free', type: 'ZERO_RATED', rate: '0', claimable: true },
    { code: 'INP', name: 'Input-taxed', type: 'EXEMPT', rate: '0', claimable: false },
    { code: 'N-T', name: 'Not reportable (out of scope)', type: 'OUT_OF_SCOPE', rate: '0', claimable: false },
  ],
  OTHER: [
    { code: 'STD', name: 'Standard rate', type: 'STANDARD', rate: '0', claimable: true },
    { code: 'EXEMPT', name: 'Exempt', type: 'EXEMPT', rate: '0', claimable: false },
    { code: 'NONE', name: 'Out of scope', type: 'OUT_OF_SCOPE', rate: '0', claimable: false },
  ],
};

/** Default Nepal TDS codes (management tracking only; rates editable by Admin). */
export const DEFAULT_TDS_CODES = [
  { code: 'TDS-SVC', name: 'TDS on service fee', rate: '1.5' },
  { code: 'TDS-RENT', name: 'TDS on house rent', rate: '10' },
  { code: 'TDS-CONT', name: 'TDS on contract payment', rate: '1.5' },
  { code: 'TDS-COMM', name: 'TDS on commission', rate: '15' },
];

/**
 * Posting rules (docs/02 §5) as data: (source_type, role) → side + account reference.
 * 'SYSTEM:<key>' resolves to the account with that system_key; 'LINE' means the document supplies the account.
 */
export const DEFAULT_POSTING_RULES: [string, string, 'DEBIT' | 'CREDIT', string, string][] = [
  ['SALES_INVOICE', 'RECEIVABLE', 'DEBIT', 'SYSTEM:AR_CONTROL', 'Customer owes the invoice total'],
  ['SALES_INVOICE', 'CASH', 'DEBIT', 'LINE', 'Cash sale — cash/bank account'],
  ['SALES_INVOICE', 'REVENUE', 'CREDIT', 'LINE', 'Sales (net of tax)'],
  ['SALES_INVOICE', 'OUTPUT_TAX', 'CREDIT', 'LINE', 'Output VAT/GST'],
  ['SALES_INVOICE', 'ROUNDING', 'CREDIT', 'SYSTEM:ROUNDING', 'Rounding difference'],
  ['CREDIT_NOTE', 'SALES_RETURN', 'DEBIT', 'SYSTEM:SALES_RETURNS', 'Sales returns (net)'],
  ['CREDIT_NOTE', 'OUTPUT_TAX', 'DEBIT', 'LINE', 'Output VAT/GST reversed'],
  ['CREDIT_NOTE', 'RECEIVABLE', 'CREDIT', 'SYSTEM:AR_CONTROL', 'Reduce customer balance'],
  ['CREDIT_NOTE', 'CASH', 'CREDIT', 'LINE', 'Cash refund'],
  ['CREDIT_NOTE', 'ROUNDING', 'DEBIT', 'SYSTEM:ROUNDING', 'Rounding difference'],
  ['RECEIPT', 'BANK', 'DEBIT', 'LINE', 'Money received into bank/cash'],
  ['RECEIPT', 'DISCOUNT_ALLOWED', 'DEBIT', 'SYSTEM:DISCOUNT_ALLOWED', 'Discount allowed'],
  ['RECEIPT', 'TDS_RECEIVABLE', 'DEBIT', 'LINE', 'TDS deducted by customer'],
  ['RECEIPT', 'RECEIVABLE', 'CREDIT', 'SYSTEM:AR_CONTROL', 'Customer balance reduced'],
  ['RECEIPT', 'CUSTOMER_ADVANCE', 'CREDIT', 'SYSTEM:CUSTOMER_ADVANCES', 'Advance received (liability)'],
  ['ADVANCE_ADJUSTMENT', 'CUSTOMER_ADVANCE', 'DEBIT', 'SYSTEM:CUSTOMER_ADVANCES', 'Advance applied'],
  ['ADVANCE_ADJUSTMENT', 'RECEIVABLE', 'CREDIT', 'SYSTEM:AR_CONTROL', 'Invoice settled by advance'],
  ['ADVANCE_ADJUSTMENT', 'PAYABLE', 'DEBIT', 'SYSTEM:AP_CONTROL', 'Bill settled by advance'],
  ['ADVANCE_ADJUSTMENT', 'SUPPLIER_ADVANCE', 'CREDIT', 'SYSTEM:SUPPLIER_ADVANCES', 'Supplier advance applied'],
  ['PURCHASE_BILL', 'EXPENSE', 'DEBIT', 'LINE', 'Expense / inventory / asset (incl. non-claimable tax)'],
  ['PURCHASE_BILL', 'INPUT_TAX', 'DEBIT', 'LINE', 'Input VAT/GST receivable'],
  ['PURCHASE_BILL', 'PAYABLE', 'CREDIT', 'SYSTEM:AP_CONTROL', 'Owed to supplier'],
  ['PURCHASE_BILL', 'ROUNDING', 'DEBIT', 'SYSTEM:ROUNDING', 'Rounding difference'],
  ['DEBIT_NOTE', 'PAYABLE', 'DEBIT', 'SYSTEM:AP_CONTROL', 'Reduce supplier balance'],
  ['DEBIT_NOTE', 'CASH', 'DEBIT', 'LINE', 'Cash refund from supplier'],
  ['DEBIT_NOTE', 'EXPENSE', 'CREDIT', 'LINE', 'Expense / inventory returned'],
  ['DEBIT_NOTE', 'INPUT_TAX', 'CREDIT', 'LINE', 'Input VAT/GST reversed'],
  ['DEBIT_NOTE', 'ROUNDING', 'CREDIT', 'SYSTEM:ROUNDING', 'Rounding difference'],
  ['PAYMENT', 'PAYABLE', 'DEBIT', 'SYSTEM:AP_CONTROL', 'Supplier balance reduced'],
  ['PAYMENT', 'SUPPLIER_ADVANCE', 'DEBIT', 'SYSTEM:SUPPLIER_ADVANCES', 'Advance paid to supplier'],
  ['PAYMENT', 'STAFF_PAYABLE', 'DEBIT', 'SYSTEM:STAFF_PAYABLES', 'Employee claim settled'],
  ['PAYMENT', 'BANK', 'CREDIT', 'LINE', 'Paid from bank/cash'],
  ['PAYMENT', 'TDS_PAYABLE', 'CREDIT', 'LINE', 'TDS withheld'],
  ['PAYMENT', 'DISCOUNT_RECEIVED', 'CREDIT', 'SYSTEM:DISCOUNT_RECEIVED', 'Discount received'],
  ['EXPENSE', 'EXPENSE', 'DEBIT', 'LINE', 'Expense (incl. non-claimable tax)'],
  ['EXPENSE', 'INPUT_TAX', 'DEBIT', 'LINE', 'Input VAT/GST'],
  ['EXPENSE', 'BANK', 'CREDIT', 'LINE', 'Paid from bank/cash'],
  ['EXPENSE', 'STAFF_PAYABLE', 'CREDIT', 'SYSTEM:STAFF_PAYABLES', 'Owed to employee (claim)'],
  ['EXPENSE', 'ROUNDING', 'DEBIT', 'SYSTEM:ROUNDING', 'Rounding difference'],
  ['MANUAL_JOURNAL', 'LINE_DEBIT', 'DEBIT', 'LINE', 'As entered'],
  ['MANUAL_JOURNAL', 'LINE_CREDIT', 'CREDIT', 'LINE', 'As entered'],
  ['OPENING_BALANCE', 'LINE_DEBIT', 'DEBIT', 'LINE', 'Opening debit balance'],
  ['OPENING_BALANCE', 'LINE_CREDIT', 'CREDIT', 'LINE', 'Opening credit balance'],
  ['OPENING_BALANCE', 'RECEIVABLE', 'DEBIT', 'SYSTEM:AR_CONTROL', 'Customer open items'],
  ['OPENING_BALANCE', 'PAYABLE', 'CREDIT', 'SYSTEM:AP_CONTROL', 'Supplier open items'],
  ['OPENING_BALANCE', 'OBE', 'CREDIT', 'SYSTEM:OPENING_BALANCE_EQUITY', 'Balancing difference'],
];
