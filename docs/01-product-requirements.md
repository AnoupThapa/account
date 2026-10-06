# 01 — Product Requirements

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. Vision
A multi-company, multi-user management accounting and operations web app that gives owners an accurate, real-time view of financial position and performance, with strong internal controls (maker–checker), document management, and project tracking — built to the same accounting standards as Zoho Books / QuickBooks / Tally, but tuned for Nepal (BS dates, Shrawan–Ashadh FY, 13% VAT) and usable internationally (AD dates, any FY, GST).

## 2. Scope boundaries

**In scope**
- Full double-entry accounting, all books of accounts, financial statements
- Income, expenses, purchases, sales, inventory, fixed assets, bank & cash
- VAT/GST tracking for management (registers, payable/receivable, summaries)
- Bank reconciliation
- Maker–checker on all financial documents
- Users, roles, permissions; report-level access control
- Document upload/sharing with Google Drive sync
- OCR invoice capture
- Projects & tasks with schedule
- Dashboard + downloadable summary sheet

**Out of scope for v1 (design must allow later)**
- Statutory tax return filing (VAT return, income tax return, BAS)
- IRD-certified billing software status (CBMS real-time sync is an adapter for later — see doc 10)
- Full payroll engine (v1: payroll posted via journal templates)
- Live bank feeds (v1: statement import)
- Mobile native apps (v1: responsive web; PWA)

## 3. Business types supported
Chosen at company setup; loads a chart-of-accounts template and enables modules. Can be changed to "Mixed" later.

| Type | Enabled modules |
|---|---|
| Service | Sales, Purchases/Expenses, Projects, Time-based billing (optional) |
| Trading | + Inventory (perpetual), COGS, Stock registers |
| Manufacturing | + Bill of Materials, Production orders, Raw Material / WIP / Finished Goods |
| Mixed | All of the above |

## 4. Modules and features

### 4.1 Company & settings
- Multi-company (one login, switch companies); multi-branch per company
- Company profile: legal name, PAN/VAT No. (Nepal), ABN (Australia), address, logo
- Base currency; country; calendar mode (BS primary / AD primary)
- Fiscal year rules (Nepal default Shrawan 1 – Ashadh end)
- Number series per document type per FY (e.g. `SI-2083/84-00001`)
- Tax settings (admin only): tax codes, rates, effective dates, accounts

### 4.2 Chart of accounts
- Hierarchical: Class → Group → Sub-group → Ledger account
- Industry templates (Service/Trading/Manufacturing/Mixed), Nepal (NFRS) and IFRS layouts
- System accounts protected (AR control, AP control, VAT, Retained Earnings, Suspense, Opening Balance Equity)
- Cost centres / departments and projects as analysis dimensions

### 4.3 Contacts
- Customers, suppliers, employees (for reimbursements), "both" type
- PAN/VAT/ABN, credit limit, payment terms, opening balance, default accounts

### 4.4 Items (products & services)
- Type: Inventory item, Non-inventory item, Service, Raw material, Finished good, Fixed asset
- **Tax applicability set at item creation:** Taxable (pick rate), Zero-rated, Exempt, Out-of-scope
- Sales & purchase accounts, unit of measure (with conversions), HS code (optional), barcode
- Valuation method (FIFO or Weighted Average) set per company

### 4.5 Sales (income side)
Quotation → Sales Order → Delivery Note → Sales Invoice → Receipt; Credit Note (sales return); Customer advance; Cash sale. Invoices cannot be deleted once posted — only cancelled (with reason) or reversed by credit note.

### 4.6 Purchases & expenses (expense side)
Purchase Order → Goods Receipt → Purchase Bill → Payment; Debit Note (purchase return); Direct expense (with/without supplier); Expense claims/reimbursements; Petty cash.

### 4.7 Banking & cash
Bank/cash/wallet accounts (eSewa, Khalti, etc.), transfers, cheques (issued/received, status), statement import, reconciliation.

### 4.8 Manual journal & unidentified transactions
- Manual journal voucher (multi-line, any accounts, with narration and attachments)
- Unidentified receipts/payments go to **Suspense — Unidentified** and appear on a "To be identified" queue until reclassified

### 4.9 Inventory (trading/manufacturing)
Warehouses, stock in/out, transfers, adjustments, stock counts, reorder levels, perpetual valuation.

### 4.10 Manufacturing
BOM (multi-level), production orders, material issue, labour/overhead absorption, finished goods receipt, scrap/by-products.

### 4.11 Fixed assets
Asset register, categories, acquisition, depreciation (straight-line / diminishing balance, monthly or yearly), disposal with gain/loss.

### 4.12 Period & year-end
Monthly period lock, year-end closing wizard, opening balance carry-forward, reopen (admin only, logged).

### 4.13 Approvals (maker–checker) — see doc 06
### 4.14 Documents, Google Drive, OCR — see doc 07
### 4.15 Projects & tasks — see doc 08
### 4.16 Reports & dashboard — see doc 09

## 5. Non-functional requirements
| Item | Target |
|---|---|
| Users | 1–200 per company; 50 concurrent |
| Volume | 500k journal lines/company/year without degradation |
| Report speed | Trial balance / P&L / BS < 3 s for a full FY |
| Availability | 99.5% (single VPS) → 99.9% (managed) |
| Backups | Daily full + continuous WAL (point-in-time recovery), 30-day retention, off-site |
| Security | HTTPS, 2FA, RBAC, row-level tenant isolation, encrypted secrets, audit log |
| Languages | English UI v1; Nepali (Devanagari) labels v2; amounts in words in English and Nepali |
| Browsers | Latest Chrome, Edge, Safari, Firefox; responsive down to phone width |
