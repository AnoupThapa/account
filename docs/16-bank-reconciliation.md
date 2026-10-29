# 16 — Bank reconciliation (Phase 3 core)

Owner request (2026-10-29): *"add a bank reconciliation section where a bank statement is uploaded and all payments and receipts with descriptions are loaded, and the user can match the transactions with sales or purchase invoices, expenses, custom payments — like Zoho Books."*
This is the core of Phase 3 in docs/phases.md. Rules come from docs/02 §11.

## 1. What the user sees
**Banking** (sidebar) → pick a bank / cash / wallet account (any ledger account whose subtype is BANK, CASH or WALLET).
1. **Import statement** – upload a CSV exported from the bank. The screen shows a preview, guesses which column is the date / description / money-in / money-out, lets the user fix the mapping, then imports. Lines already imported before are skipped (duplicate protection).
2. **Reconcile screen** – two columns, like Zoho Books:
   - Left: **bank statement lines** not yet matched (date, description, reference, money in/out).
   - Right: **books** – every posted receipt, payment, expense, journal etc. that touched that bank account and is not yet matched (date, number, contact, description, amount).
   - The user ticks one or more on each side and presses **Match**. Totals must be equal (one-to-one, one-to-many and many-to-one all work).
   - **Auto-match** button: applies safe matches (same reference/cheque number + amount, or the only same-amount item within ±3 days) and shows "needs your confirmation" suggestions for weaker guesses (amount only).
3. **Nothing in the books for a statement line?** Press **Add transaction** on the line:
   - *Customer receipt* (opens the receipt form pre-filled; user picks the sales invoices it pays),
   - *Supplier payment* (pre-filled; picks the bills it pays),
   - *Expense* (pre-filled),
   - *Bank charge / interest / other* (a journal drafted for the user – account chosen, e.g. Bank Charges),
   - *Unidentified* (journal to the Suspense account until someone reclassifies it).
   Because every one of these is a normal document, **maker–checker still applies**: once it is posted, the line is matched automatically.
4. **Ignore** a line (with reason) or **Un-match** (needs permission, logged).
5. **Finish reconciliation** – the user enters the statement closing balance and date. The system shows *book balance − unmatched book items + unmatched statement items = statement balance*; when the difference is 0.00 the reconciliation is saved and all matched items are locked. The **Bank Reconciliation Statement** can be printed.

## 2. Rules (enforced in the database AND the API)
- A match group is valid only when the **sum of statement amounts = sum of book amounts** (money in is positive, money out negative).
- A statement line and a book line can each be in **one** match group only.
- Reversed or cancelled entries (and their mirror entries) are not offered for matching.
- Matched items in a **finished** reconciliation are locked; un-matching them needs `bank.unreconcile` and is audit-logged.
- Statement lines are never edited after import (only matched / ignored); duplicates are detected by a content hash.
- Only the ledger module writes journals. Reconciliation itself writes **no** journal entries.
- Every endpoint: auth, company, permission guard, validation, audit log, RFC 7807 errors (BANK_* codes, docs/error-handling.md).
- Money is NUMERIC(18,2) / decimal library – never floats.

## 3. Permissions
| Permission | Meaning | Default roles |
|---|---|---|
| `bank.view` | See statements, books and reconciliations | Admin, Accountant, Checker, Finance Mgr, Auditor |
| `bank.import` | Upload statements | Admin, Accountant |
| `bank.reconcile` | Match, auto-match, ignore, add transaction, finish | Admin, Accountant, Checker |
| `bank.unreconcile` | Undo a match in a finished reconciliation | Admin, Finance Mgr |

## 4. Data model (migration 0007)
- `bank_statement_imports` – one row per uploaded file.
- `bank_statement_lines` – txn_date, description, reference, cheque_no, `money_in`, `money_out`, optional running balance, `line_hash` (unique per account), status `UNMATCHED | MATCHED | IGNORED`, pending document link.
- `bank_match_groups` – one match (method AUTO / MANUAL, who, when, reconciliation id once finished).
- `reconciliation_matches` – the items of a group: either a statement line or a journal line, with a signed amount.
- `reconciliations` – finished reconciliations (statement date, closing balance, book balance, difference = 0).
Note: docs/database.md names a `bank_accounts` table; the app already treats bank/cash/wallet as ledger accounts (subtype), so statements point straight at the account – no duplicate table.

## 5. Statement file formats
- **Excel (.xls / .xlsx) and CSV** (any bank). Spreadsheet exports with title lines, an Opening/Closing Balance row and a footer (e.g. the Nepali "Statement of Account" export: Date, Value Date, Chq. No., Transaction Detail, Debit, Credit, Balance) are read directly; the period and the closing balance printed on the statement are kept and pre-fill the Finish screen. Column mapping with a guess; date formats YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, "12 Jan 2026"; AD or BS dates; either separate money-in/money-out columns, one signed amount column, or amount + Dr/Cr column).
- OFX / QIF / MT940 / CAMT.053 and saved bank templates are **later** (listed in Phase 3 in docs/phases.md). Spreadsheets are read in the browser with `@e965/xlsx` (Apache-2.0, the patched SheetJS build — the old `xlsx` package on npm has known vulnerabilities and is not used).

## 6. Acceptance checklist
- [x] Import a Nepal-style CSV (BS dates, separate Dr/Cr) and an Australian CSV (DD/MM/YYYY, signed amount) — `packages/shared/src/bank.test.ts`
- [x] Re-importing the same file adds 0 lines
- [x] Books column lists posted receipts/payments/expenses/journals with descriptions; reversed entries are hidden
- [x] One-to-one, one-to-many and many-to-one matches work; unequal totals are refused
- [x] Auto-match applies safe matches and only suggests weaker ones
- [x] Receipt/payment/expense/journal created from a statement line matches itself once posted
- [x] Finish reconciliation only when difference is 0.00; matched items locked; un-match needs permission
- [x] BRS closing balance equals the statement balance
- [x] Staff/HR and users without `bank.*` get 403; other companies' data is invisible (RLS)
