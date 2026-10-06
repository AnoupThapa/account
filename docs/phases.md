# Build Phases

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

Each phase ends with a working, deployable version on staging. A phase is **done** only when every acceptance check passes and you have signed off in a short UAT session. Effort estimates are indicative.

## Phase 0 — Foundation (2–3 weeks)
**Deliverables:** monorepo (web, api, worker, shared packages), Docker Compose, GitHub Actions CI/CD, PostgreSQL + Redis, login with 2FA, password reset, companies & branches, users, roles & permissions engine, audit log with hash chain, BS/AD date library + `bs_calendar` seed, fiscal years & periods (Nepal Shrawan–Ashadh and AD-based), LICENSE and copyright headers.
**Acceptance checks**
- [ ] Admin can create a company with Nepal FY; 12 BS-month periods generated with correct AD dates
- [ ] BS↔AD conversion passes 200+ reference date tests
- [ ] User without permission gets 403 on API (not just hidden button)
- [ ] User of Company A cannot see Company B data (RLS test)
- [ ] Every action appears in audit log; hash chain verification passes
- [ ] CI runs lint + tests on every push; deploys to staging on merge

## Phase 1 — Core ledger (3–4 weeks)
**Deliverables:** COA templates, account CRUD, cost centres, tax codes & rates (admin only), ledger engine + posting rules, manual journals, maker–checker engine with configurable workflows, opening balance wizard, Trial Balance, General Ledger, Journal & Day Book.
**Acceptance checks**
- [ ] Unbalanced journal is rejected by the database even if the API is bypassed
- [ ] Posted lines cannot be updated/deleted; reversal works and links to original
- [ ] Maker cannot approve own journal (API and DB)
- [ ] Posting into a locked period fails
- [ ] Opening balances: go-live blocked until Opening Balance Equity = 0
- [ ] TB totals agree; drill-down TB → GL → journal works

## Phase 2 — Sales & purchases (4–5 weeks)
**Deliverables:** contacts, items with tax applicability, quotations, sales orders, invoices, credit notes, receipts & allocation, customer advances, POs, GRN, bills, debit notes, payments, expenses & claims, TDS codes, gapless numbering, invoice/bill PDF (BS+AD dates, PAN, amount in words), customer/supplier statements, AR/AP aging, Sales/Purchase Books.
**Acceptance checks**
- [ ] VAT-exempt item on a mixed invoice: taxable/exempt split correct; VAT 13% correct with rounding
- [ ] Tax-inclusive and exclusive pricing give identical ledger results for the same total
- [ ] Posted invoice cannot be deleted; cancel requires reason and keeps the number
- [ ] Duplicate supplier invoice number blocked
- [ ] AR control = sum of customer balances; AP control = sum of supplier balances

## Phase 3 — Banking & reconciliation (2–3 weeks)
**Deliverables:** bank/cash/wallet accounts, transfers, cheque register, statement import (CSV/Excel/OFX/MT940 + saved column templates), auto/manual matching, create-from-statement, unidentified → suspense → reclassify, Bank Reconciliation Statement.
**Acceptance checks**
- [ ] Import of a real Nepali bank CSV and an Australian bank CSV
- [ ] Auto-match ≥ 80% on test data; one-to-many match works
- [ ] BRS closing balance equals bank book balance
- [ ] Unidentified receipt posts to suspense and appears on the queue until reclassified

## Phase 4 — Statements, books & dashboard (3 weeks)
**Deliverables:** P&L, Balance Sheet, Cash Flow (indirect + direct), Changes in Equity, all remaining books, comparisons, PDF/Excel export, dashboard widgets, Financial Summary sheet, report-level permissions.
**Acceptance checks**
- [ ] Balance sheet balances for every test company and every date
- [ ] Net profit in P&L = movement in equity before close
- [ ] Cash flow closing cash = cash & bank balances
- [ ] User without report permission cannot open or export it; exports are logged and watermarked

## Phase 5 — Documents, Google Drive & OCR (3 weeks)
**Deliverables:** documents module, linking, sharing, Drive OAuth + Shared Drive folder structure, two-way sync, OCR jobs → draft bill, duplicate & tax checks, review screen.
**Acceptance checks**
- [ ] Upload in app appears in correct Drive folder within 1 minute
- [ ] OCR on 20 sample invoices (Nepali & Australian) extracts totals correctly ≥ 90%
- [ ] OCR never posts; draft requires maker review and checker approval
- [ ] Disconnecting Drive deletes nothing

## Phase 6 — Projects & tasks (3 weeks)
**Deliverables:** projects, milestones, tasks, dependencies, Kanban, Gantt, calendar (BS/AD), time logs, compliance-calendar templates, project P&L, progress reports to Drive, notifications.
**Acceptance checks**
- [ ] Moving a task in Gantt moves dependent tasks
- [ ] Project P&L matches ledger lines tagged to the project
- [ ] Weekly progress PDF saved to the project's Drive folder

## Phase 7 — Inventory & manufacturing (4 weeks)
**Deliverables:** warehouses, stock moves, FIFO & weighted average, landed costs, stock counts/adjustments, stock register & valuation reports, BOM, production orders, WIP accounting.
**Acceptance checks**
- [ ] FIFO and WAC test scenarios match hand-calculated results
- [ ] Inventory control account = stock valuation report
- [ ] Production: RM → WIP → FG journals correct

## Phase 8 — Fixed assets & closing (2 weeks)
**Deliverables:** asset register, depreciation runs (SLM/WDV), disposal, month-end checklist, period lock UI, year-end close, carry-forward, reopen (admin, logged).
**Acceptance checks**
- [ ] Year-end: income/expense accounts zero after close; Retained Earnings correct
- [ ] Next FY opening TB = prior FY closing balance sheet
- [ ] Reopen + re-close produces identical results

## Phase 9 — Hardening & go-live (2–3 weeks)
**Deliverables:** performance tuning (500k lines), security review (security.md checklist), penetration test, backup restore drill, user guides, data migration from current system, production deployment.
**Acceptance checks**
- [ ] TB/P&L/BS < 3 s on 500k lines
- [ ] All security.md checklist items ticked
- [ ] Restore from backup completed and verified
- [ ] Parallel run: one month of real data matches your current books

## Phase 10 — Integrations (ongoing)
Public API & webhooks, NRB exchange rates, payment gateways (eSewa/Khalti/Fonepay/Stripe), Shopify, bank feeds, IRD CBMS adapter (after certification decision), Nepali UI.
