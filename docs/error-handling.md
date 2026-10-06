# Error Handling

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. Principles
1. **Never lose or half-save financial data.** Every financial operation is one database transaction; any error rolls back everything.
2. **The database is the last line of defence.** Critical accounting rules (balanced entries, immutability, period locks, maker ≠ checker) are enforced by constraints/triggers, so bugs in code cannot corrupt the books.
3. **Clear messages for users, full detail for admins/developers.** Users see what went wrong and what to do; logs hold the technical detail, linked by a Request ID.
4. **Fail safe, not open.** If a permission check, tax rate lookup or period check cannot be completed, the action is refused.
5. **Background jobs retry, then alert.** No silent failures.

## 2. API error format (RFC 7807 Problem Details)
```json
{
  "type": "https://docs.ledgerpro.app/errors/ACC_PERIOD_LOCKED",
  "title": "Accounting period is locked",
  "status": 409,
  "code": "ACC_PERIOD_LOCKED",
  "detail": "Ashwin 2083 (17 Sep – 17 Oct 2026) is locked. Choose a date in an open period or ask an Admin to unlock it.",
  "requestId": "req_01J9X…",
  "fields": [ { "field": "invoiceDate", "message": "Date falls in a locked period" } ]
}
```

| HTTP | Meaning |
|---|---|
| 400 | Malformed request |
| 401 | Not logged in / token expired |
| 403 | No permission |
| 404 | Not found (also used when record belongs to another company — never reveal it exists) |
| 409 | Conflict with business state (locked period, already posted, version changed) |
| 422 | Validation failed (field errors) |
| 429 | Rate limited |
| 500 | Unexpected error (generic message to user; full detail logged) |
| 502/503 | External service (Drive, OCR) unavailable |

## 3. Error code catalogue
| Code | When | User message (short) |
|---|---|---|
| `AUTH_INVALID_CREDENTIALS` | Wrong email/password | Email or password is incorrect |
| `AUTH_ACCOUNT_LOCKED` | Too many attempts | Account locked for 15 minutes |
| `AUTH_2FA_REQUIRED` / `AUTH_2FA_INVALID` | 2FA step | Enter your 6-digit code / Code is incorrect |
| `AUTH_STEP_UP_REQUIRED` | Sensitive action | Please confirm your password/code |
| `PERM_DENIED` | Missing permission | You don't have access to this action |
| `VAL_FIELD` | Field validation | Field-specific message |
| `VAL_DATE_OUT_OF_RANGE` | BS date outside calendar table | Date is outside the supported range |
| `VAL_BS_INVALID_DAY` | e.g. Shrawan 32 in a 31-day year | This month has only N days |
| `ACC_UNBALANCED` | Debits ≠ credits | Debits and credits must be equal (difference: X) |
| `ACC_PERIOD_LOCKED` | Posting to locked period | Period is locked |
| `ACC_NO_FISCAL_YEAR` | Date has no FY | Create the fiscal year first |
| `ACC_IMMUTABLE` | Edit of posted entry | Posted entries can't be changed — reverse instead |
| `ACC_CONTROL_ACCOUNT` | Direct journal to AR/AP/VAT without contact | Select a customer/supplier for this account |
| `ACC_ACCOUNT_INACTIVE` / `ACC_NOT_POSTABLE` | Inactive/group account | Choose an active ledger account |
| `ACC_OPENING_UNBALANCED` | Go-live with OBE ≠ 0 | Opening balances differ by X |
| `ACC_YEAR_CLOSED` | Posting into closed FY | Fiscal year is closed |
| `ACC_NEGATIVE_STOCK` | Issue more than available | Only N units available in <warehouse> |
| `ACC_OVER_ALLOCATION` | Receipt allocated beyond invoice due | Allocation exceeds amount due |
| `APR_SELF_APPROVAL` | Maker approves own doc | You can't approve your own entry |
| `APR_LIMIT_EXCEEDED` | Amount above approver's limit | Needs approval from a higher level |
| `APR_INVALID_STATE` | Approve already-posted etc. | This document is already <status> |
| `DOC_DUPLICATE_INVOICE` | Same supplier + invoice no. | This supplier invoice already exists (link) |
| `DOC_CANCEL_HAS_PAYMENTS` | Cancel paid invoice | Remove allocations first or issue a credit note |
| `DOC_VERSION_CONFLICT` | Two users edited at once | Someone else changed this; reload to see changes |
| `TAX_NO_RATE` | No rate effective on date | No tax rate set for this date — ask Admin |
| `TAX_MISMATCH` | OCR/entered VAT ≠ computed | VAT differs from calculation by X — confirm |
| `BANK_IMPORT_FORMAT` | Unrecognised file/columns | Couldn't read the file — map columns |
| `BANK_IMPORT_DUPLICATE` | Lines already imported | N lines skipped as duplicates |
| `BANK_ALREADY_RECONCILED` | Edit reconciled item | Un-reconcile first (permission required) |
| `FILE_TOO_LARGE` / `FILE_TYPE` / `FILE_INFECTED` | Upload checks | Clear reason; infected files quarantined |
| `OCR_FAILED` / `OCR_LOW_CONFIDENCE` | OCR | Couldn't read invoice — enter manually / please check highlighted fields |
| `DRIVE_AUTH_EXPIRED` | Google token revoked | Google Drive disconnected — Admin must reconnect |
| `DRIVE_QUOTA` / `DRIVE_UNAVAILABLE` | Drive issues | Sync paused; will retry |
| `INT_DELIVERY_FAILED` | External integration | Queued for retry |
| `RATE_LIMITED` | Too many requests | Please wait and try again |
| `SYS_UNEXPECTED` | Anything else | Something went wrong (Ref: requestId) |

Messages are stored in a translation file (English now, Nepali later).

## 4. Validation layers
1. **Frontend:** instant field checks (same Zod schemas) — fast feedback, not trusted.
2. **API:** schema validation + business rules (permissions, period, tax, stock, allocation).
3. **Database:** constraints and triggers — final guarantee.

## 5. Concurrency
- Optimistic locking via `version` column on documents → `DOC_VERSION_CONFLICT`.
- Pessimistic row locks (`SELECT … FOR UPDATE`) for posting, number allocation, stock valuation, allocations.
- Idempotency keys on create/post endpoints so a double-click or network retry never creates duplicates.

## 6. Background jobs (OCR, Drive, imports, exports, integrations)
- Retry with exponential back-off: 1 min, 5 min, 30 min, 2 h, 12 h (max 5 attempts; configurable per job).
- After final failure → status `FAILED`, visible in Admin "Job problems" screen with Retry button; Admin notified.
- Jobs are idempotent (safe to run twice).
- Integration outbox keeps events until acknowledged; nothing is dropped.

## 7. Frontend behaviour
- Field errors shown under the field; form-level errors in a banner; unsaved drafts autosaved every 30 s.
- Network loss: banner "Offline — changes not saved", retry on reconnect; never shows a document as saved unless the server confirmed.
- Session expiry: silent refresh; if refresh fails, keep the form content and prompt re-login.
- 500 errors show the Request ID so users can report it.
- Global error boundary — a crash in one widget never blanks the whole app.

## 8. Logging & alerting
- Every error logged with `requestId`, user, company, endpoint, code; stack traces only in logs.
- 5xx errors and failed jobs go to error tracking (Sentry/GlitchTip) with alerts.
- Nightly integrity checks (database.md §6) raise a **critical** alert on any failure, and posting can be paused for that company until resolved.

## 9. Data correction (not "errors" but mistakes)
Users fix accounting mistakes through reversal, credit/debit notes, cancellation or reclassification — never by editing posted data. See 02-accounting-rules.md §10.
