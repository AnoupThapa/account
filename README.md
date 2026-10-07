# LedgerPro — Management Accounting & Operations Platform

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. This repository is private. No part may be copied, used or shared without written permission. See [LICENSE](LICENSE).

> **Status:** Phases 0–2 built and tested (foundation, core ledger, sales & purchases) — see [phase report](docs/phase-reports/phase-0-2.md).
> **Run it:** double-click `Start LedgerPro.cmd` on Windows after installing Node.js 22 and PostgreSQL 16 — step by step in [docs/dev-environment.md](docs/dev-environment.md) (Docker Desktop also works).
> **Purpose:** Management accounting (not a statutory tax-filing tool) for trading, service, manufacturing and mixed businesses, following Nepal (NFRS / Nepal practice) and international (IFRS) accounting practice, with optional Australian GST support.

## What this platform does

| Area | Summary |
|---|---|
| Core accounting | Double-entry general ledger, chart of accounts, income & expense, opening/closing balances, period & year-end closing |
| Books of accounts | Journal, Day Book, Cash Book, Bank Book, Petty Cash, Sales/Purchase Books & Returns, General Ledger, Debtors/Creditors Ledgers, Stock Register, Fixed Asset Register, VAT/GST Registers |
| Reports | Trial Balance, Income Statement (P&L), Balance Sheet, Cash Flow, Changes in Equity, Aging, Project P&L, VAT/GST summary |
| Bank reconciliation | Statement import, auto/manual matching, unidentified-transaction handling, Bank Reconciliation Statement |
| Controls | Maker–checker approval, role-based access, period locks, immutable audit trail |
| Tax | Admin-defined VAT/GST rates; items flagged taxable / zero-rated / exempt |
| Documents | Upload, share, link to transactions, Google Drive sync |
| OCR | Upload invoice → extract → draft bill → review → approve → post |
| Projects | Projects, tasks, schedule (Kanban + Gantt), progress synced to Google Drive |
| Dates | Every date shown in both BS (Nepali) and AD; Nepal FY Shrawan 1 – Ashadh end |
| Dashboard | Financial highlights + downloadable/shareable summary sheet (PDF/Excel) |
| Integration-ready | API-first, outbox pattern, adapters for IRD (CBMS), banks, payment gateways |

## What's in this repository
```
apps/api      NestJS REST API (auth, tenancy, ledger, approvals, sales, purchases, reports, PDFs)
apps/web      Next.js web app (all screens)
apps/worker   background jobs (emails, nightly integrity checks)
packages/db   SQL migrations (with the database-level accounting rules), seeds, COA templates
packages/shared  money, BS/AD calendar, fiscal years, VAT/GST maths, permissions, validation
infra/        docker-compose, Postgres init
docs/         specification + phase reports
```

## Specification documents

| Document | What it covers |
|---|---|
| [01 Product Requirements](docs/01-product-requirements.md) | Modules, features, scope, non-goals |
| [02 Accounting Rules](docs/02-accounting-rules.md) | Principles, chart of accounts, posting rules, books, opening/closing |
| [03 Nepali Calendar & Fiscal Year](docs/03-nepali-calendar-fiscal-year.md) | BS/AD dates, fiscal years, periods |
| [architecture.md](docs/architecture.md) | Tech stack, modules, request & posting flow, environments, observability, deployment |
| [database.md](docs/database.md) | SQL schema, DDL, ERD, RLS, DB roles, migrations, indexes |
| [security.md](docs/security.md) | Authentication, data protection, infrastructure, backups, incident response, go-live checklist |
| [error-handling.md](docs/error-handling.md) | Error format, error code catalogue, validation layers, retries, alerts |
| [phases.md](docs/phases.md) | Build phases with deliverables and acceptance checks |
| [prompts.md](docs/prompts.md) | Copy-paste build prompts for Claude Code, phase by phase |
| [06 Roles, Permissions & Maker–Checker](docs/06-roles-permissions-maker-checker.md) | RBAC, approval workflows, audit |
| [07 Documents, Google Drive & OCR](docs/07-documents-drive-ocr.md) | File handling, Drive sync, invoice OCR |
| [08 Projects & Tasks](docs/08-projects-tasks.md) | Project/task monitoring and scheduling |
| [09 Reports & Dashboard](docs/09-reports-dashboard.md) | Every report's definition, dashboard, summary sheet |
| [10 Integrations & API](docs/10-integrations-api.md) | IRD/CBMS readiness, bank feeds, API conventions |
| [11 Open Questions](docs/11-roadmap-open-questions.md) | Decisions needed before build |
| [ip-protection.md](docs/ip-protection.md) | Copyright, trademark, confidentiality, contracts, customer licensing |

## Recommended stack (summary)

- **Frontend:** Next.js (React, TypeScript), Tailwind, shadcn/ui
- **Backend:** NestJS (TypeScript) REST API with OpenAPI
- **Database:** PostgreSQL 16 (SQL), Kysely (type-safe SQL query builder) + hand-written SQL migrations
- **Jobs/Queue:** Redis + BullMQ (OCR, Drive sync, report generation, imports)
- **Storage:** Google Drive (shared) + S3-compatible object store (working copies)
- **OCR:** Google Document AI (primary) with an AI-vision fallback; Tesseract offline option
- **Deployment:** Docker Compose on one VPS to start; managed Postgres optional

See [architecture.md](docs/architecture.md) for rationale.

## Building
Built with Claude Code following [phases.md](docs/phases.md); standing instructions in [CLAUDE.md](CLAUDE.md); prompts in [prompts.md](docs/prompts.md).

## Licence
Proprietary — all rights reserved. See [LICENSE](LICENSE) and [ip-protection.md](docs/ip-protection.md).
