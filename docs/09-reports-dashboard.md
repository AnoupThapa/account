# 09 — Reports & Dashboard

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

All reports: filter by date range (BS/AD), branch, cost centre, project; compare to previous period / previous year / budget; drill down from any number to the ledger and then to the source document; export to PDF, Excel, CSV; save to Drive; access controlled per doc 06.

## 1. Financial statements
| Report | Definition |
|---|---|
| **Trial Balance** | Per account: Opening Dr/Cr, Period Dr/Cr, Closing Dr/Cr. Totals must agree. Options: grouped, detailed, with zero balances. |
| **Income Statement (P&L)** | Revenue − Sales returns = Net revenue; − COGS = Gross profit; + Other income; − Operating expenses (employee, admin, selling); = EBITDA; − Depreciation = EBIT; − Finance costs = Profit before tax; − Income tax = Net profit. Formats: NFRS (by function or nature), IFRS, simple management. |
| **Balance Sheet (Statement of Financial Position)** | Non-current & current assets; equity; non-current & current liabilities. Current-year profit shown in equity until year-end close. Must balance (system check). |
| **Cash Flow Statement** | Indirect method (profit adjusted for non-cash items and working-capital changes) + investing + financing; direct method option from bank/cash ledgers. Accounts are tagged with a cash-flow category. |
| **Statement of Changes in Equity** | Capital, reserves, retained earnings movements. |
| **Notes / schedules** | PPE schedule, receivables & payables schedules, inventory schedule. |

## 2. Books (see doc 02 §7)
Journal, Day Book, Cash Book, Bank Book, Petty Cash Book, Sales/Purchase Books & Return Books, General Ledger, Debtors/Creditors Ledgers, Stock Register, Fixed Asset Register, VAT/GST, TDS and Cheque registers.

## 3. Management reports
AR aging & AP aging (0–30/31–60/61–90/90+), customer & supplier statements, sales by customer/item/period, purchases by supplier, expense analysis, gross margin by item, stock valuation & movement, slow-moving stock, production cost, project P&L, cost-centre P&L, budget vs actual, VAT/GST summary (output, input, net payable), cash position forecast (open AR/AP by due date), suspense/unidentified items report, approval turnaround, user activity.

## 4. Bank Reconciliation Statement
```
Balance as per bank statement (date)                 X
Add: Deposits recorded in books not yet credited     X
Less: Cheques issued not yet presented              (X)
Add/Less: Other reconciling items (listed)           X
= Balance as per bank book                           X   ✔ must equal ledger
```
Also: unmatched statement lines, reconciliation history, uncleared items aging.

## 5. Dashboard (home page)
Widgets (each permission-controlled, period selector BS/AD, compare toggle):
- Cash & bank balances (each account + total), wallets
- Revenue, expenses, gross profit, net profit — MTD / YTD vs last year
- Gross margin % and net margin %
- Receivables total + overdue; payables total + due in next 7/30 days
- VAT/GST payable (receivable) current period
- Income vs expense trend (12 months) chart; expense breakdown donut
- Top 5 customers, top 5 expense categories, top items
- Stock value and low-stock alerts (trading/manufacturing)
- **Pending approvals** count (click-through), unreconciled bank lines, unidentified transactions
- Project status summary (on track / at risk / overdue), my tasks due
- Key ratios: current ratio, quick ratio, debtor days, creditor days, inventory days

## 6. Downloadable summary sheet (for sharing)
One-click **"Financial Summary"** for a chosen period:
- Page 1: company header, period (BS & AD), KPIs, mini P&L, mini balance sheet, cash position, AR/AP aging summary, key ratios, short auto-generated commentary (variances > 10% flagged).
- Formats: **PDF** (print-ready, logo, "Management accounts — unaudited" footer) and **Excel** (summary tab + TB, P&L, BS tabs).
- Actions: download, email to selected users, save to Drive `Reports/` with share link, schedule monthly auto-generation.
- Only users with `report.summary.export` can generate.
