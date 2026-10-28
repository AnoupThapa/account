# 12 — Competitive Review & Improvement Plan (APPROVED 2026-10-28)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

Compared with: Zoho Books, Xero, QuickBooks Online (QBO). Review date: 2026-10-28. Repo state reviewed: Phases 0–2 built (≈15k lines TypeScript, 369 tests).

> Evidence note: web sources found were comparison/aggregator sites, not vendor pages. Competitor feature statements below are general market knowledge and MUST be re-checked against each vendor's current pricing/feature pages before they are used in marketing or pricing decisions.

## 1. Where LedgerPro is already stronger or different
| Strength | Why it matters against Zoho / Xero / QBO |
|---|---|
| Nepal-native: BS+AD dates, Shrawan–Ashadh FY, 13% VAT, PAN, TDS, IRD-layout Sales/Purchase Books, amount in words (lakh/crore) | None of the three serve Nepal properly. This is the moat. |
| Accounting rules enforced **in the database** (balanced, immutable, period locks, maker≠checker, gapless numbering) | Stronger controls than QBO/Xero small-plan defaults; sells well to auditors and owners with staff. |
| Maker–checker with amount thresholds | Zoho/Xero have basic approvals; this is deeper. |
| Hash-chained audit log, RLS tenant isolation from day one | Enterprise-grade trust story. |
| Nepal + Australia in one login | Useful for cross-border owners and accountants. |

## 2. Gaps vs competitors (what makes people choose them)
Priority: **P1** = needed to be taken seriously; **P2** = needed to win deals; **P3** = differentiator / later.

| # | Area | Competitors | LedgerPro today | Recommendation | Pri |
|---|---|---|---|---|---|
| 1 | Bank feeds & reconciliation | Live feeds, auto-match rules, "reconcile in 1 click" | Phase 3 planned (CSV import only) | Keep Phase 3; add **saved matching rules** (learn from past coding), duplicate detection, Nepal bank CSV templates, later AU feeds (Basiq/open banking) | P1 |
| 2 | Financial statements | P&L, BS, cash flow, budgets, comparisons | Phase 4 planned, not built | Build; add budget vs actual, multi-period columns, drill-down, scheduled email of reports | P1 |
| 3 | Inventory | Tracking, variants, reorder, serial/batch | Phase 7; stock items post only to Inventory account | Move **basic stock (WAC + quantities + COGS)** earlier; FIFO, batch/expiry later | P1 |
| 4 | Recurring & automation | Recurring invoices/bills, auto-reminders, rules | None | Recurring invoices/bills/journals, automatic overdue reminders by email/SMS, payment-term templates | P1 |
| 5 | Online payments | Stripe/PayPal "Pay now" on invoice | Phase 10 | Payment link + QR on invoice: Fonepay/eSewa/Khalti (NP), Stripe (AU); auto-record receipt | P2 |
| 6 | Multi-currency | Built in, auto FX, revaluation | Single currency (open Q7) | Decide now; schema already has fields. Needed for Nepal importers/exporters and AU | P2 |
| 7 | Mobile | Native apps, receipt photo capture | Responsive web only | Installable **PWA**: camera receipt capture, approvals, clock-in (ties to attendance) | P2 |
| 8 | Receipt/bill capture (OCR) | Hubdoc / Zoho AutoScan / QBO receipt capture | Phase 5 | Keep; email-in address pulled forward | P2 |
| 9 | Payroll | Gusto/QBO Payroll, Xero Payroll, Zoho Payroll | Journal template only | See doc 13: attendance + leave + payroll-**ready** summary, then Nepal payroll (SSF, tax slabs) | P1/P2 |
| 10 | Import / migration | Import from Tally, QBO, Xero, CSV | Spec only | **Import wizard** (Tally/Excel/CSV, Xero/QBO export files). Biggest sales unlock for SaaS | P1 |
| 11 | Customer portal | Client portal, quotes accept online | None | Read-only portal: view/pay invoices, statements, accept quotes; accountant/auditor invite | P2 |
| 12 | Accountant / multi-client dashboard | Xero HQ, QBO Accountant | Company switcher only | Practice view: many companies, tasks, month-end status, per-client permissions | P2 |
| 13 | Public API, webhooks, app marketplace | Large ecosystems | Spec in doc 10 | Ship API keys + webhooks early; Zapier/Make connector | P2 |
| 14 | Reporting UX | Custom reports, dashboards, scheduled sharing | Fixed reports; CSV export | Report builder (saved filters), Excel export with formulas, PDF with branding | P2 |
| 15 | Fixed assets, projects/time billing | Zoho Projects link, QBO projects | Phases 6, 8 | Keep; add time→invoice billing | P2 |
| 16 | AI assistance | QBO/Xero/Zoho AI categorisation, "ask your books" | None | Auto-coding suggestions from history; anomaly flags (duplicates, unusual amounts); natural-language report Q&A. Must never post — drafts only (fits maker–checker) | P3 |
| 17 | Tax filing | AU BAS/STP, VAT returns | Out of scope by design | Keep management-only; add **VAT/GST return working papers** export; revisit IRD CBMS (needs IRD certification) | P3 |
| 18 | UX polish & onboarding | Guided setup, templates, sample data, localisation | Functional; Nepali UI v2 | Setup wizard, invoice templates/branding, keyboard-first entry, Nepali UI earlier (strong local differentiator) | P2 |
| 19 | Subscription billing / self-signup | Core to SaaS | Deliberately deferred | Plan before SaaS launch: plans, trials, usage limits, dunning | P3 |
| 20 | Reliability & scale | Mature SLAs | Never run in CI/Docker yet (per phase report) | Run CI, container build, backup-restore drill, load test **before** selling | P1 |

## 3. Risks found in the current repo (from reading code/docs/phase report)
1. CI workflow, Docker images and the Windows launcher have never been run on real infrastructure (phase report §5). Treat as unverified.
2. BS calendar 2084–2100 is provisional (sources disagree); wrong month lengths silently shift dates. Needs an official-source check before go-live.
3. Stock accounting incomplete (no FIFO/WAC, no COGS) — trading businesses cannot rely on margins yet.
4. Tax-code changes are not yet maker–checker (doc 06 §5 says they should be).
5. 2FA code replay within 30 s is not blocked; breached-password check is a small local list.
6. No in-app notification centre; emails only logged without SMTP.
7. Employees exist only as "contacts"; no HR data model at all (see doc 13).

## 4. Recommended order (proposal)
1. Phase 3 Banking → Phase 4 Statements/dashboard (unchanged).
2. **New Phase 4A "Go-to-market basics":** recurring documents, auto-reminders, import wizard, invoice branding, notification centre, CI/Docker proven.
3. **New Phase 5A "Attendance, Leave & Payroll-ready" (doc 13).**
4. Then Phase 5 OCR, 7 Inventory (basic stock pulled earlier if trading customers come first), 6 Projects, 8 Assets, 9 Hardening.
5. Payments, portal, accountant view, API/webhooks, AI assist, Nepal payroll engine.

Nothing here changes code. Approval needed before any phase is started (CLAUDE.md rule 11).
