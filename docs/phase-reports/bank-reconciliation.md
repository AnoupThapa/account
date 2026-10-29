# Bank reconciliation report (29 Oct 2026)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. See [LICENSE](../../LICENSE).

Branch: `claude/wizardly-hopper-fmsd6z`. Spec: [docs/16](../16-bank-reconciliation.md) (owner request of 29 Oct 2026; it is the core of Phase 3).

## 1. What was built (plain English)
- **Banking** in the sidebar (under Accounting). It lists every bank, cash and wallet account with the balance in your books, how many statement lines still need matching, and when it was last reconciled.
- **Upload bank statement.** Choose the CSV file from your bank. The screen guesses which column is the date, description, money in, money out and so on, shows a preview and lets you correct the guess. It understands Nepali (BS) dates, `31/01/2026`-style dates, separate debit/credit columns or one signed amount column. Uploading the same file twice adds nothing the second time.
- **Reconcile screen (like Zoho Books).** Left: the bank statement lines. Right: **your books** — every posted receipt, payment, expense and journal on that account, with date, number, customer/supplier and description. Tick lines on both sides and press **Match**. One statement line can match several book items and the other way round, but the totals must be equal (the program and the database both refuse anything else).
- **Auto-match.** Matches the safe ones by itself (same reference or cheque number and amount, or the only same-amount item within 3 days). Weaker guesses (amount only, or several items adding up) are shown as **Suggested** with an Accept button — never applied silently.
- **Missing in the books? Press Add.** You can create the transaction without leaving the screen: a customer receipt (choose which sales invoices it pays), a supplier payment (which bills), an expense (account and tax), a bank charge, interest/other, or park it as **Unidentified** in the Suspense account. Each follows your normal approval rules (maker–checker); the statement line matches itself as soon as the document is posted.
- **Ignore** a line with a reason, or bring it back. **Un-match** any time before the reconciliation is finished.
- **Finish reconciliation.** Enter the closing date and balance from the statement; the screen shows the maths (books balance, outstanding items, difference). It only finishes at a difference of 0.00 with nothing left unmatched. Finishing **locks** the matches; undoing one later needs the new "undo reconciliation" permission and is logged.
- **Bank Reconciliation Statement** you can print.
- **Permissions.** `bank.view` (look), `bank.import` (upload), `bank.reconcile` (match, add, ignore, finish), `bank.unreconcile` (undo a finished one). Given by default to Accountant, Checker, Finance Manager, Auditor (view only) and Company Admin; HR Manager and Staff have no access. Companies that already existed received the new permissions automatically (once).

## 2. How the maths works
Money in is positive, money out negative on both sides. A match is valid only when statement total = books total. To finish: *statement balance = books balance − (books items not yet on the statement) + (statement lines you ignored)*. Books items dated before the first imported statement line are treated as cleared before the statement began, and receipts or payments that were cancelled (with their reversal) are hidden because they net to zero.

## 3. Test results
| Suite | Tests | Result |
|---|---|---|
| Shared library (incl. 23 new: CSV reading, dates incl. BS, amounts, column guessing, matching rules) | 332 | ✅ |
| Database rules (row-level security on every company table, now incl. 5 new tables) | 23 | ✅ |
| API (incl. **20 new bank tests**) | 121 | ✅ |
| Browser: upload → auto-match → add bank charge → checker approves → finish → printable statement; HR manager blocked | 1 | ✅ |
| **Total** | **477** | ✅ |
Also: header and licence checks pass.

## 4. Acceptance checklist (docs/16 §6)
All nine items ticked in docs/16. Evidence: `packages/shared/src/bank.test.ts`, `apps/api/test/bank.test.ts`, `apps/web/e2e/bank-smoke.mjs`.

## 5. What you need to do
1. After the website (Vercel) **and** the server (Render) have redeployed, open **Banking** in the sidebar.
2. Try it with a real statement: Banking → *Upload statement* → choose the CSV → *Start matching*. Please send me one real Nepali and one real Australian bank CSV so I can check the column guesses against your banks.
3. Nothing to change in Render or Neon: the new tables are created automatically when the server starts.

## 6. Risks / TODO
- **CSV only.** Excel, OFX, MT940 and CAMT files, and saved per-bank column templates, are still to do (save an Excel file as CSV for now).
- **First reconciliation:** import the statement from the date your books' bank entries started, or books items older than the first statement line are treated as already cleared.
- Bank transfers between your own accounts, the cheque register, and "bank feeds" (automatic download) are not built yet.
- A reconciled month can still change if someone with the "undo" permission un-matches (logged). Locking the accounting period is a separate control.
- Statement lines are stored exactly as imported; wrong lines can be ignored but not edited.
