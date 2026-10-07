# Build Prompts (for Claude Code)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

How to use: open the repository in **Claude Code** at claude.ai/code (connected to your GitHub). The standing rules in `CLAUDE.md` load automatically every session, so normally you only paste the prompt for the phase you're on. Use the Master Context below only if Claude seems to ignore the rules. When it finishes, paste the **Phase Review** prompt. You don't need to write code — just copy, paste, and check the acceptance list in [phases.md](phases.md).

Tip: one phase per session (or per few sessions). Never skip a phase's review.

---

## 0. Master Context (backup — CLAUDE.md normally covers this)
```
You are building LedgerPro, a proprietary management-accounting web app.
The complete specification is in /docs. Before writing code, read:
README.md, docs/01-product-requirements.md, docs/02-accounting-rules.md,
docs/03-nepali-calendar-fiscal-year.md, docs/architecture.md, docs/database.md,
docs/06-roles-permissions-maker-checker.md, docs/security.md,
docs/error-handling.md, docs/phases.md, and any doc relevant to the current phase.

Non-negotiable rules:
1. Follow the specs exactly. If something is unclear or conflicts, STOP and ask me; do not guess.
2. Accounting rules in 02-accounting-rules.md must be enforced in the database
   (constraints/triggers) AND the API: balanced entries, immutable posted entries,
   period locks, maker ≠ checker, gapless numbering.
3. Only the ledger module writes journal_entries/journal_lines, inside one transaction.
4. Money = NUMERIC(18,2) / decimal library, never floating point.
5. Dates stored in AD; BS shown alongside everywhere via packages/shared date utilities.
6. Every endpoint: auth guard, company guard, permission guard, validation, audit log,
   RFC 7807 errors with codes from error-handling.md.
7. Security per security.md. No secrets in code. Add the proprietary copyright header
   from docs/ip-protection.md to every new source file.
8. Write tests for every business rule. All tests must pass before you say you're done.
9. Work in small commits with clear messages on a feature branch; open a pull request
   at the end of the phase. Never push directly to main.
10. Explain what you did in plain, non-technical English at the end — I am not a programmer.
```

---

## Phase 0 — Foundation
```
Implement Phase 0 from docs/phases.md.
Set up the pnpm + Turborepo monorepo exactly as in architecture.md §4 (apps/web Next.js,
apps/api NestJS, apps/worker BullMQ, packages/db (Kysely + SQL migrations), packages/shared, packages/ui),
Docker Compose for local dev (Postgres 16, Redis), GitHub Actions CI (lint, typecheck, test,
build) and staging deploy workflow (leave secrets as placeholders and tell me what to add).
Build: auth (Argon2id, TOTP 2FA, refresh-token rotation, lockout), companies, branches,
users, roles, permissions engine, audit log with hash chain, RLS on tenant tables,
BS/AD date library with bs_calendar seed (2000–2100 BS) and 200+ conversion tests,
fiscal years and periods (Nepal Shrawan–Ashadh and AD-based).
Finish with: the acceptance checklist for Phase 0, each item marked pass/fail with evidence,
and step-by-step instructions for me to run it locally.
```

## Phase 1 — Core ledger
```
Implement Phase 1 from docs/phases.md using docs/02-accounting-rules.md and docs/database.md.
Include: COA templates (Service/Trading/Manufacturing/Mixed; Nepal & IFRS), accounts,
cost centres, tax codes & effective-dated rates (Admin only), posting_rules table and
ledger engine, manual journal vouchers, maker–checker workflow engine (configurable steps
and amount limits), opening balance wizard with Opening Balance Equity check,
Trial Balance, General Ledger, Journal and Day Book with BS/AD dates and drill-down.
Write database-level tests proving: unbalanced entries fail, posted lines can't be
updated/deleted, locked periods reject posting, self-approval fails.
Finish with the Phase 1 acceptance checklist and evidence.
```

## Phase 2 — Sales & purchases
```
Implement Phase 2 from docs/phases.md. Follow posting rules in 02-accounting-rules.md §5
exactly. Items carry tax applicability (TAXABLE/ZERO_RATED/EXEMPT/OUT_OF_SCOPE).
Support tax-inclusive and exclusive pricing, line-level rounding, TDS codes, customer
advances, allocations, duplicate supplier invoice guard, gapless numbering per FY,
cancel-with-reason (no delete), print counter, invoice/bill PDFs with BS+AD dates,
PAN/VAT, amount in words (lakh/crore for NPR). Add Sales/Purchase Books in IRD column
layout, customer/supplier statements, AR/AP aging.
Include test scenarios: mixed taxable+exempt invoice at 13% VAT; same with GST 10%;
inclusive vs exclusive equivalence; AR/AP control = sub-ledger totals.
Finish with the Phase 2 acceptance checklist and evidence.
```

## Phase 3 — Banking & reconciliation
```
Implement Phase 3 from docs/phases.md and 02-accounting-rules.md §11, report in
09-reports-dashboard.md §4. Statement import (CSV/Excel/OFX/MT940) with a column-mapping
screen and saved templates per bank, duplicate-line detection, auto-match rules
(reference → amount+date±3 days+contact → amount only as suggestion), manual and
one-to-many matching, create transaction from a statement line, unidentified → suspense
→ reclassify queue, cheque register, Bank Reconciliation Statement.
Ask me for sample bank statement files before building the mapping templates.
Finish with the Phase 3 acceptance checklist and evidence.
```

## Phase 4 — Statements, books & dashboard
```
Implement Phase 4 from docs/phases.md and docs/09-reports-dashboard.md.
P&L (NFRS by function/nature, IFRS, simple), Balance Sheet, Cash Flow (indirect + direct),
Changes in Equity, all remaining books, period comparisons, drill-down, PDF (Playwright)
and Excel (ExcelJS) exports with watermark and audit logging, report-level permissions,
dashboard widgets (permission-aware) and the one-click Financial Summary sheet (PDF + Excel)
with save-to-Drive placeholder until Phase 5.
Add automated tests: balance sheet always balances; cash flow ties to cash balances.
Finish with the Phase 4 acceptance checklist and evidence.
```

## Phase 5 — Documents, Google Drive & OCR
```
Implement Phase 5 from docs/phases.md and docs/07-documents-drive-ocr.md.
Documents module (upload, preview, versions, tags, links, sharing, ClamAV scan),
Google Drive OAuth with Shared Drive support, auto folder structure, background two-way
sync, scheduled report exports to Drive. OCR via pluggable OcrProvider (Google Document
AI first, Tesseract eng+nep fallback): extract, match supplier by PAN/ABN, suggest
accounts, recompute VAT, duplicate check, create DRAFT bill only, side-by-side review screen.
Tell me exactly which Google Cloud settings and keys I need to create, step by step.
Finish with the Phase 5 acceptance checklist and evidence.
```

## Phase 6 — Projects & tasks
```
Implement Phase 6 from docs/phases.md and docs/08-projects-tasks.md: projects, members,
milestones, tasks with dependencies, Kanban, Gantt (drag to reschedule, dependent tasks
shift), calendar with BS/AD, time logs, recurring tasks, accounting compliance calendar
template, project P&L from ledger tags, weekly progress PDF to Drive, notifications.
Finish with the Phase 6 acceptance checklist and evidence.
```

## Phase 7 — Inventory & manufacturing
```
Implement Phase 7 from docs/phases.md: warehouses, stock moves, valuation layers with
FIFO and weighted average (company setting), landed cost allocation, negative stock rule,
stock counts and adjustments, stock register and valuation reports, BOM (multi-level),
production orders with RM → WIP → FG journals and overhead absorption.
Include hand-calculated FIFO/WAC test cases in the test suite.
Finish with the Phase 7 acceptance checklist and evidence.
```

## Phase 8 — Fixed assets & closing
```
Implement Phase 8 from docs/phases.md and 02-accounting-rules.md §8–9: asset register,
SLM/WDV depreciation runs through maker–checker, disposals with gain/loss, month-end
checklist, period lock/unlock (step-up auth), year-end close wizard (closing entries to
Retained Earnings or partners' capital), automatic carry-forward, new number series,
reopen year (Admin only, fully logged, reversible).
Finish with the Phase 8 acceptance checklist and evidence.
```

## Phase 9 — Hardening & go-live
```
Run Phase 9 from docs/phases.md. Generate 500k journal lines of realistic test data and
tune performance to targets. Go through every item in docs/security.md §12 and report
pass/fail with evidence, fixing failures. Set up backups and run a restore test.
Write a plain-English user guide per module (in docs/user-guide/) and a production
deployment runbook I can follow without coding. Prepare a data import plan from my
current accounting system (ask me which system it is).
```

---

## Phase Review (paste after each phase)
```
Review the work for this phase as a strict senior accountant and security engineer.
1. Re-read the relevant spec docs and list anything missing or different.
2. Run all tests and show the summary.
3. Check every acceptance item in docs/phases.md for this phase: pass/fail + evidence.
4. List any shortcuts, TODOs, or risks.
5. Fix what you can, then give me a plain-English summary and what I should click/test
   myself on staging (5–10 steps).
```

## Bug-fix prompt
```
Bug: <describe what you did, what you expected, what happened, Request ID if shown>.
Find the root cause, write a test that reproduces it, fix it, confirm all tests pass,
and explain the cause and fix in plain English. Do not change accounting rules without asking me.
```

## Change-request prompt
```
Change request: <describe>. First update the relevant docs in /docs to reflect the change
and show me the doc changes for approval. Only after I approve, implement it with tests.
```
