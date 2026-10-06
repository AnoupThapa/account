# 02 — Accounting Rules

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

These rules are the "constitution" of the system. Code must enforce them; no screen may bypass them.

## 1. Framework
- **Nepal:** Nepal Financial Reporting Standards (NFRS, IFRS-based) / NFRS for SMEs as applicable; statement layouts compatible with Companies Act requirements.
- **International:** IFRS / IFRS for SMEs presentation.
- **Basis:** Accrual basis. A cash-basis *view* of reports is available for management, derived from the same ledger.
- **Base currency** per company (NPR, AUD, etc.). Foreign-currency transactions record original amount + exchange rate + base amount.

## 2. Ten non-negotiable rules
1. **Double entry:** every posted journal has total debits = total credits (enforced in the database, not just the UI).
2. **Single source of truth:** every document (invoice, bill, receipt, etc.) posts to the general ledger; all reports read from the ledger.
3. **Immutability:** posted entries are never edited or deleted. Corrections are made by **reversal** + new entry, or by credit/debit notes.
4. **Maker ≠ checker:** the user who creates a document cannot approve it (doc 06).
5. **Period locks:** no posting into a locked period. Back-dated entries require an open period.
6. **Sequential numbering:** document numbers are gapless per series per fiscal year; cancelled numbers remain visible as "Cancelled".
7. **Audit trail:** every create/update/approve/post/reverse/cancel action is logged with user, time, IP, before/after values.
8. **Control accounts:** AR, AP, Inventory, VAT/GST accounts can only be posted via their sub-ledgers (manual journals to them need a contact/item and special permission).
9. **Dates:** stored as AD (Gregorian) in the database; displayed and entered in BS and/or AD (doc 03).
10. **Money precision:** amounts stored as `NUMERIC(18,2)`; quantities and rates `NUMERIC(18,4)`; exchange rates `NUMERIC(18,6)`. Rounding differences post to a "Rounding Off" account.

## 3. Chart of accounts structure

Five classes with normal balances:

| Class | Code range | Normal balance | Statement |
|---|---|---|---|
| 1 Assets | 1000–1999 | Debit | Balance Sheet |
| 2 Liabilities | 2000–2999 | Credit | Balance Sheet |
| 3 Equity | 3000–3999 | Credit | Balance Sheet |
| 4 Income | 4000–4999 | Credit | Income Statement |
| 5 Expenses (incl. COGS) | 5000–5999 | Debit | Income Statement |

### 3.1 Default template (Mixed company, Nepal) — abridged
```
1000 ASSETS
 1100 Current Assets
  1110 Cash in Hand            1111 Petty Cash
  1120 Bank Accounts           (one ledger per bank account)
  1130 Digital Wallets         (eSewa, Khalti…)
  1140 Trade Receivables (AR control)
  1150 Inventory               1151 Raw Materials  1152 Work in Progress  1153 Finished Goods  1154 Trading Goods
  1160 Advances & Prepayments  1161 Supplier Advances  1162 Prepaid Expenses  1163 Staff Advances
  1170 Tax Assets              1171 Input VAT/GST Receivable  1172 TDS Receivable  1173 Advance Income Tax
  1180 Other Receivables
 1500 Non-Current Assets
  1510 Property, Plant & Equipment (by category)  1590 Accumulated Depreciation (contra, by category)
  1600 Intangible Assets       1690 Accumulated Amortisation
  1700 Investments  1800 Deposits
2000 LIABILITIES
 2100 Current Liabilities
  2110 Trade Payables (AP control)
  2120 Customer Advances
  2130 Tax Liabilities         2131 Output VAT/GST Payable  2132 VAT/GST Settlement  2133 TDS Payable  2134 Income Tax Payable
  2140 Accrued Expenses        2150 Salary & Staff Payables  2160 Short-term Loans / Overdraft
 2500 Non-Current Liabilities  2510 Long-term Loans  2520 Provisions (gratuity etc.)
3000 EQUITY
  3100 Share Capital / Owner's Capital   3200 Retained Earnings   3300 Reserves
  3400 Drawings (sole/partnership)       3900 Opening Balance Equity (system, must be zero after go-live)
4000 INCOME
  4100 Sales — Goods   4200 Sales — Services   4300 Sales Returns & Discounts (contra)
  4800 Other Income (interest, FX gain, gain on disposal)
5000 EXPENSES
  5100 Cost of Goods Sold   5150 Purchase Price Variance / Stock Adjustments
  5200 Direct Manufacturing Costs (direct labour, factory overhead)
  5300 Employee Costs   5400 Administrative Expenses   5500 Selling & Distribution
  5600 Finance Costs (interest, bank charges)   5700 Depreciation & Amortisation
  5800 Other Expenses (FX loss, loss on disposal)   5900 Income Tax Expense
9000 SYSTEM / CLEARING (shown under current assets/liabilities by balance)
  9100 Suspense — Unidentified Receipts   9200 Suspense — Unidentified Payments
  9300 Goods Received Not Invoiced (GRNI)   9400 Rounding Off   9500 Inter-branch Clearing
```
Templates for Service, Trading and Manufacturing are subsets of the above. Codes and names are editable except system accounts.

## 4. Tax (VAT / GST) rules — management purpose
- **Admin only** creates tax codes. Each code: name, rate %, type, effective-from/to, output account, input account, claimable flag.
- Types: `STANDARD`, `ZERO_RATED`, `EXEMPT`, `OUT_OF_SCOPE`, `REVERSE_CHARGE` (future).
- Defaults seeded: Nepal VAT 13% / 0% / Exempt; Australia GST 10% / GST-free / Input-taxed. Rates are data, not code — when a rate changes, admin adds a new rate with an effective date.
- **Item-level:** each item carries a default tax code (taxable or free). Line-level override allowed with permission.
- Prices may be **tax-exclusive or tax-inclusive** (per document). Tax computed per line, rounded per line (configurable to per-invoice).
- **Non-claimable input tax** (e.g. purchases from non-VAT suppliers, blocked items) is added to the cost of the expense/asset.
- **TDS (Nepal withholding)** codes are configurable (rate, payable account), applied on bills/payments; management tracking only.
- VAT/GST settlement entry at period end: Output − Input → payable (or carried forward credit).

## 5. Posting rules (automatic journals)

| Transaction | Debit | Credit |
|---|---|---|
| Credit sales invoice | AR (total) | Sales (net); Output VAT (tax) |
| Cash sale | Cash/Bank | Sales; Output VAT |
| COGS on sale (perpetual) | COGS | Inventory (at FIFO/WAC cost) |
| Sales return / credit note | Sales Returns; Output VAT | AR or Cash/Bank |
| Stock back on return | Inventory | COGS |
| Customer receipt | Bank/Cash; Discount Allowed (if any); TDS Receivable (if deducted by customer) | AR |
| Customer advance | Bank | Customer Advances (liability); later Dr Advances, Cr AR on adjustment |
| Purchase bill — stock | Inventory; Input VAT | AP |
| Purchase bill — expense | Expense; Input VAT | AP |
| Purchase bill — fixed asset | PPE (category); Input VAT | AP |
| Goods received before bill | Inventory | GRNI; bill then clears GRNI |
| Supplier payment | AP | Bank; TDS Payable (if withheld); Discount Received |
| Purchase return / debit note | AP | Inventory/Expense; Input VAT |
| Direct expense (paid) | Expense; Input VAT | Bank/Cash |
| Petty cash top-up | Petty Cash | Bank |
| Bank transfer | Destination bank | Source bank |
| Bank charges (from reconciliation) | Bank Charges | Bank |
| Interest received | Bank | Interest Income |
| Unidentified receipt | Bank | Suspense — Unidentified Receipts |
| Reclassify unidentified | Suspense | AR / Income / correct account |
| Unidentified payment | Suspense — Unidentified Payments | Bank |
| Payroll (journal template) | Salary Expense | Salary Payable; TDS Payable; SSF/PF Payable |
| Depreciation | Depreciation Expense | Accumulated Depreciation |
| Asset disposal | Bank; Accumulated Dep.; Loss on disposal | PPE cost; Gain on disposal |
| Material issue to production | WIP | Raw Materials |
| Labour / overhead absorption | WIP | Wages Applied / Overhead Applied |
| Production completion | Finished Goods | WIP |
| Stock adjustment (loss) | Stock Adjustment expense | Inventory |
| VAT settlement | Output VAT | Input VAT; VAT Payable (difference) |
| FX revaluation (unrealised) | AR/AP/Bank or FX Loss | FX Gain or AR/AP/Bank |
| Accrual | Expense | Accrued Expenses (auto-reversal next period optional) |
| Prepayment amortisation | Expense | Prepaid Expenses |

Each posting rule is configured as a template in the database so new document types can be added without code changes.

## 6. Inventory valuation
- Perpetual system. Method per company: **FIFO** or **Weighted Average** (LIFO not permitted under IFRS/NFRS).
- Landed cost allocation (freight, customs, insurance) to receipts by value or quantity.
- Negative stock blocked by default (admin can allow; then cost adjusted on next receipt).
- Lower of cost and net realisable value: manual write-down journal supported.

## 7. Books of accounts generated
All are views on the ledger/sub-ledgers, filterable by date (BS/AD), branch, cost centre, project, user, status.

| Book | Source |
|---|---|
| Journal / Journal Register | All journal entries with narration |
| Day Book | All vouchers for a day/range |
| Cash Book (single/multi-column) | Cash accounts |
| Bank Book | Each bank account, with cleared/uncleared flag |
| Petty Cash Book | Petty cash accounts |
| Sales Book / Sales Return Book | Sales invoices & credit notes (IRD-style columns: date, invoice no., buyer name, PAN, taxable amount, exempt amount, VAT) |
| Purchase Book / Purchase Return Book | Bills & debit notes (same layout) |
| General Ledger | Any account, opening + transactions + running balance + closing |
| Debtors Ledger / Creditors Ledger | Per contact, with aging |
| Stock Register / Stock Ledger | Per item & warehouse, qty and value |
| Fixed Asset Register | Per asset: cost, additions, depreciation, NBV |
| VAT/GST Register | Output vs input by rate |
| TDS Register | Deducted / deposited |
| Cheque Register | Issued / received / cleared / bounced |

## 8. Opening balances
1. Admin sets **go-live date** (usually first day of a fiscal year or month).
2. Enter opening balances via the Opening Balance wizard: accounts (TB format), customer/supplier open invoices (detail, for aging), inventory quantity × cost by warehouse, fixed assets (cost & accumulated depreciation), bank balances with unreconciled items.
3. Sub-ledger openings post to control accounts automatically; difference posts to **Opening Balance Equity (3900)**.
4. Go-live is blocked until Opening Balance Equity = 0 (or admin explicitly accepts and transfers it to Capital/Retained Earnings).
5. Opening entries go through maker–checker like any other entry.

## 9. Closing
### 9.1 Month-end (period close) checklist (system-guided)
Bank accounts reconciled → suspense cleared or reviewed → depreciation run → accruals/prepayments → stock valuation reviewed → VAT/GST settlement → pending approvals = 0 → lock period.

### 9.2 Year-end close
1. All 12 periods locked (or admin override).
2. System generates **closing entries**: all Income and Expense accounts closed to **Retained Earnings (3200)** (or partners' capital per profit-sharing ratio for partnerships; Drawings closed to Capital for sole traders).
3. Balance Sheet account closing balances become next FY **opening balances** automatically (no re-entry).
4. New FY document number series created.
5. Year can be **reopened** by Admin only; reopening reverses closing entries and re-runs them on close; fully logged.

## 10. Corrections
- **Reverse:** creates a mirror entry dated on chosen date (in an open period), linked to original.
- **Cancel (invoice/bill):** allowed only if no receipts/payments applied; posts reversal; number retained as Cancelled with reason.
- **Amend:** reverse + new document, linked ("Replaces SI-…").

## 11. Reconciliation rules
See doc 09 §4 for report; matching logic:
- Statement import formats: CSV, Excel, OFX, QIF, MT940, CAMT.053 (bank-specific CSV mappings saved as templates).
- Auto-match priority: exact reference/cheque no. → amount + date ± 3 days + contact → amount only (suggested, needs confirm).
- One-to-many and many-to-one matching supported.
- Unmatched statement line → "Create transaction" (expense, receipt, transfer, bank charge) or "Unidentified" (posts to suspense).
- Reconciled items are locked; un-reconcile requires permission and is logged.
