# Phase 0–2 report (build session of 6–7 Oct 2026)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. See [LICENSE](../../LICENSE).

Branch: `feature/phase-0-2`. Scope agreed with the owner: Phases 0, 1 and 2 in one session (instead of one phase per session).

## 1. What was built (plain English)
- **A working web app** (website + server + background worker + database) you can run on your PC with Docker.
- **Sign-in security:** strong password hashing, 6-digit authenticator codes (2FA) — mandatory for Admin, Checker and Finance Manager — one-time recovery codes, account lock after 5 wrong passwords (with email alert), password reset by email, automatic sign-out after 30 minutes idle, “sign out other devices”, admin force-logout, and re-confirm-password for sensitive actions (unlock period, change roles, tax rates, company controls).
- **Companies:** Nepal (NPR, Bikram Sambat dates, FY Shrawan–Ashadh, VAT 13%, PAN, TDS) and Australia (AUD, July–June, GST 10%, ABN). Creating a company loads its chart of accounts, tax codes, roles, approval workflows and first fiscal year automatically. One login can belong to several companies.
- **Every date in both calendars** (BS and AD), using a 2000–2100 BS table checked against 3 independent sources.
- **Accounting core:** double-entry ledger that the database itself protects — unbalanced entries, editing/deleting posted entries, posting into locked periods and self-approval are all refused by PostgreSQL even if the program has a bug.
- **Maker–checker** on every financial document, with configurable steps (e.g. above NPR 500,000 a Finance Manager must also approve), approval limits per role, reject-with-reason, and full history.
- **Documents:** journal vouchers, opening balances (with go-live check), quotations, sales orders, invoices (incl. cash sales), credit notes, receipts (with discount and TDS), customer advances and their adjustment, purchase orders, goods receipts, bills (duplicate supplier-invoice guard), debit notes, payments (with TDS), direct expenses and employee claims, allocations of payments to invoices, cancellation/reversal with reason.
- **Printing:** invoice PDFs with BS + AD dates, PAN/ABN, amount in words (lakh/crore for NPR), “Original / Copy of original (n)” print counter.
- **Reports:** Trial Balance, General Ledger (click through to the journal and the source document), Journal register / Day Book, Sales Book and Purchase Book (IRD columns), AR/AP aging, customer/supplier statements, VAT/GST summary, home-page figures, integrity checks. CSV export is permission-controlled, watermarked and logged.
- **Audit log** of every action, hash-chained so tampering is detectable, readable by Admin/Auditor, changeable by nobody.

## 2. Test results
| Suite | Tests | Result |
|---|---|---|
| Shared library (BS↔AD with 270 reference dates + every day 2000–2100, fiscal years, VAT/GST maths, amount in words) | 292 | ✅ all pass |
| Database rules (tested directly against PostgreSQL, bypassing the API) | 23 | ✅ all pass |
| API Phase 0 (auth, 2FA, lockout, CSRF, tenancy, permissions, audit) | 17 | ✅ all pass |
| API Phase 1 (ledger, maker–checker, numbering, reversals, locks, opening balances, reports) | 18 | ✅ all pass |
| API Phase 2 (sales, purchases, VAT/GST, TDS, cancellations, PDFs, books, AR/AP control) | 18 | ✅ all pass |
| Browser smoke test (sign in → invoice → approve → reports, 25 screens, no page errors) | 1 | ✅ pass |
| **Total** | **369** | ✅ |

## 3. Acceptance checklists

### Phase 0 — Foundation
| Check | Result | Evidence |
|---|---|---|
| Admin creates a company with Nepal FY; 12 BS-month periods with correct AD dates | ✅ | `phase0.test.ts` “Admin creates a Nepal company…”: FY 2083/84 = 17 Jul 2026 – 16 Jul 2027, Ashwin 2083 = 17 Sep – 17 Oct 2026 |
| BS↔AD conversion passes 200+ reference tests | ✅ | 270 reference dates + round-trip of all 36,800+ days 2000–2100 |
| User without permission gets 403 from the API | ✅ | `phase0.test.ts` “user without permission gets 403” |
| User of Company A cannot see Company B (RLS) | ✅ | API test (404) + DB tests: cross-company read/insert blocked; automated check that **every** table with company_id has RLS on |
| Every action in audit log; hash chain verification passes | ✅ | API + DB tests; tamper simulation is detected |
| CI runs lint + tests on push; deploys staging on merge | ⚠️ written, not yet run | `.github/workflows/ci.yml` and `deploy-staging.yml` — run once pushed to GitHub; staging needs 4 secrets (see §4) |

### Phase 1 — Core ledger
| Check | Result | Evidence |
|---|---|---|
| Unbalanced journal rejected by the database even if the API is bypassed | ✅ | `db-rules.test.ts` “rejects an unbalanced entry at COMMIT…” |
| Posted lines cannot be updated/deleted; reversal works and links to original | ✅ | DB test (even the schema owner is blocked) + `phase1.test.ts` reversal test (`reversal_of` / `reversed_by_entry_id`) |
| Maker cannot approve own journal (API and DB) | ✅ | API: APR_SELF_APPROVAL; DB: trigger on documents and approval actions |
| Posting into a locked period fails | ✅ | API and DB tests; failed attempt consumes no document number |
| Opening balances: go-live blocked until Opening Balance Equity = 0 | ✅ | `phase1.test.ts` go-live test (blocked at 10,000 difference, allowed after approved transfer journal) |
| TB totals agree; drill-down TB → GL → journal works | ✅ | API test + browser smoke test |

### Phase 2 — Sales & purchases
| Check | Result | Evidence |
|---|---|---|
| VAT-exempt item on a mixed invoice: taxable/exempt split correct; VAT 13% correct with rounding | ✅ | `phase2.test.ts`: taxable 1,020.09 / exempt 500.00 / VAT 132.61 / total 1,652.70 |
| Tax-inclusive and exclusive pricing give identical ledger results | ✅ | identical journal lines for 1,000 + 13% vs 1,130 inclusive |
| Posted invoice cannot be deleted; cancel requires reason and keeps the number | ✅ | cancellation via maker–checker; Sales Book shows it as Cancelled |
| Duplicate supplier invoice number blocked | ✅ | API (case-insensitive, drafts too) + unique index in the DB |
| AR control = sum of customer balances; AP control = sum of supplier balances | ✅ | integrity checks after invoices, receipts with TDS, credit notes, advances, bills, payments with TDS, debit notes |

## 4. What you (the owner) need to do
1. **Look at it:** follow `docs/dev-environment.md` section A (Docker Desktop) and click around with the demo users.
2. **GitHub:** push this folder to your private repo `accx` on a branch (not main) and open a pull request. Then in GitHub → Settings → Secrets → Actions add, when you have a staging server: `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY`, `STAGING_PATH`.
3. **Before any real data:** in the server's `.env` set new random values for `JWT_ACCESS_SECRET` and `ENCRYPTION_KEY` (commands are in `.env.example`), real database passwords, `COOKIE_SECURE=true`, `ENFORCE_2FA=true`, and SMTP settings so password-reset emails are sent.
4. **Decide** (docs/11 open questions still open): default approval thresholds (I used NPR 500,000 / AUD 50,000 for a second approval on payments, bills, journals, expenses and corrections — editable in Settings → Approval workflows), multi-currency in v1, final product name.

## 5. Deviations, risks and TODOs (honest list)
- **Database toolkit:** Kysely instead of Prisma (approved by you on 6 Oct; docs updated).
- **BS calendar 2084–2100** is provisional (published calendars disagree from 2084). Admin can correct month lengths (Settings API `PATCH /bs-calendar/:year/:month`, Super Admin + step-up); it is flagged in the database.
- **Docker images were not test-built here** (Docker Hub is blocked in my build environment). Everything inside them was built and tested directly. The first `docker compose up --build` on your PC is the real test — if it fails, paste the error into a session.
- **CI workflow has not run yet** (no GitHub access from this session).
- **Inventory:** stock items post to the Inventory account on bills, but stock quantities/valuation (FIFO/WAC), COGS on sale and GRN→GRNI journals are **Phase 7**. Goods receipts record quantities only.
- **Single currency per company** in v1 (fields for foreign currency exist; open question 7).
- **Tax-code changes** are Admin-only + step-up + audited, but not yet routed through maker–checker (docs/06 §5 lists them) — planned with the Phase 4 settings work.
- **Roles not yet created:** Project Manager and Team Member (they belong to Phase 6).
- **Email/notifications:** approval-request notifications are queued in the outbox; the in-app notification centre and email digests come later. Without SMTP settings, emails are printed in the worker log.
- **Breached-password check** uses a built-in list of common passwords; online check (HaveIBeenPwned) is a Phase 9 item.
- **2FA code replay** within the same 30-second window is not blocked yet (Phase 9 hardening).
- **Next.js image optimisation** pulls `sharp/libvips` (LGPL, dynamically linked — allowed; GPL/AGPL are blocked by `scripts/check-licences.mjs`).
- `packages/ui` from architecture §4 is not a separate package yet; shared web components live in `apps/web/components`.
