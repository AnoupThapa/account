# CLAUDE.md — Standing instructions for Claude Code

> CONFIDENTIAL & PROPRIETARY — © 2026 Anoup Kumar Thapa. All rights reserved. See LICENSE.

You are building **LedgerPro**, a proprietary management-accounting web app. The owner is not a programmer: explain results in plain, non-technical English and never assume he can debug code.

## Decisions already made
- **Countries at launch:** Nepal AND Australia.
  - Nepal: NPR, BS calendar primary (AD shown alongside), FY Shrawan 1 – Ashadh end, VAT 13% / zero-rated / exempt, PAN, TDS codes, IRD-style Sales/Purchase Books.
  - Australia: AUD, AD calendar, FY 1 July – 30 June, GST 10% / GST-free / input-taxed, ABN.
  - Country is a per-company setting; one user can belong to companies in both countries.
- **Usage:** owner's own companies first, then sold to other companies as SaaS. Design multi-tenant from day one (company_id + RLS everywhere), but subscription billing/self-signup is NOT built until a later phase.
- **Stack:** as in docs/architecture.md (Next.js, NestJS, PostgreSQL 16, Kysely (type-safe SQL; replaced Prisma — approved 2026-10-06), Redis/BullMQ, pnpm + Turborepo).
- **Licence:** proprietary. Add the copyright header from docs/ip-protection.md to every new source file. Never add AGPL/GPL dependencies; check licences of new dependencies.

## Read before working
README.md, docs/01-product-requirements.md, docs/02-accounting-rules.md,
docs/03-nepali-calendar-fiscal-year.md, docs/architecture.md, docs/database.md,
docs/06-roles-permissions-maker-checker.md, docs/security.md, docs/error-handling.md,
docs/phases.md, plus any doc relevant to the current task. Build prompts are in docs/prompts.md.

## Non-negotiable rules
1. Follow the specs exactly. If something is unclear or conflicts, STOP and ask; do not guess.
2. Accounting rules (docs/02) are enforced in the database (constraints/triggers) AND the API:
   balanced entries, immutable posted entries, period locks, maker ≠ checker, gapless numbering.
3. Only the ledger module writes journal_entries/journal_lines, inside one transaction.
4. Money uses NUMERIC(18,2) in SQL and a decimal library in code — never floating point.
5. Dates stored in AD; BS shown alongside via packages/shared date utilities.
6. Every endpoint: auth guard, company guard, permission guard, validation, audit log,
   RFC 7807 errors with codes from docs/error-handling.md.
7. Security per docs/security.md. No secrets in code; use .env and .env.example.
8. Write tests for every business rule; all tests must pass before reporting done.
9. Work on a feature branch with small, clear commits; never push to main directly.
10. Do one phase at a time (docs/phases.md). Don't start the next phase until asked.
11. If a spec change is needed, update the doc first and ask for approval before coding it.

## Cloud session environment
Sessions run in a fresh cloud VM. If tests need PostgreSQL or Redis, create and maintain a setup script (documented in docs/dev-environment.md) that installs/starts them, and tell the owner exactly what to paste into the environment's setup-script box.

## End of every task, report
1. What was built (plain English). 2. Test results summary. 3. Acceptance checklist for the phase: pass/fail with evidence. 4. Anything the owner must do (e.g. add a secret), step by step. 5. Risks or TODOs.
