# 10 — Integrations & API

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. API-first
- Every UI action is a REST endpoint under `/api/v1`, documented with OpenAPI (Swagger).
- Auth for integrations: API keys per company with scopes, or OAuth2 client credentials.
- Idempotency keys on all create/post endpoints (safe retries).
- Pagination (cursor), filtering, consistent error format.
- **Webhooks** (outgoing): `invoice.posted`, `payment.posted`, `bill.approved`, `period.locked`, etc., signed with HMAC.

## 2. Integration outbox pattern
Business transaction writes an event row to `integration_outbox` in the same DB transaction → worker delivers to the target adapter with retries/back-off → result logged in `integration_logs`. Guarantees nothing is lost if an external system is down.

## 3. Adapter interface
```ts
interface IntegrationAdapter {
  key: string;                       // 'ird-cbms', 'bank-nabil-csv', 'basiq', 'esewa'
  validateConfig(cfg): Result;
  handle(event: OutboxEvent): Promise<DeliveryResult>;
  pull?(since: Date): Promise<ExternalRecord[]>;   // e.g. bank feeds
}
```

## 4. Nepal IRD readiness
Built-in now (needed later for IRD billing software compliance and good practice anyway):
- Sequential, gapless invoice numbers per FY; no deletion — only cancellation with reason
- Invoice shows seller & buyer PAN/VAT, BS date, taxable/exempt/VAT split, amount in words
- Print/reprint counter ("Copy of original — 2") logged
- Sales/Purchase Book in IRD column layout; materialised sales register
- Tamper-evident audit log; user activity log
- Fiscal-year based data export

Future adapter `ird-cbms`: real-time / batch posting of sales invoices and returns to IRD's Central Billing Monitoring System, storing IRD acknowledgement on each invoice. **Note:** using software for VAT billing may require IRD registration/approval of the software — a separate certification step to plan before switching it on. Requirements must be re-checked against IRD's current published directives at that time.

Other future adapters: e-TDS working export, VAT return working export (management data → filing done externally).

## 5. Other planned integrations
| Integration | Purpose |
|---|---|
| Nepal Rastra Bank exchange rates | Daily FX rates import |
| Banks (CSV/MT940 templates; APIs where available) | Statement import / feeds |
| Basiq or similar (Australia) | Bank feeds for AU companies |
| eSewa / Khalti / Fonepay / Stripe | Payment receipts auto-recorded |
| Shopify / e-commerce | Orders → sales invoices, payouts → bank |
| Email (SMTP) | Sending invoices, statements, notifications |
| Google Drive | Doc 07 |
| Payroll systems | Import payroll journal |
| ATO (Australia) | Future, if statutory use is ever needed |

## 6. Import / export
- Import (with preview & validation): COA, contacts, items, opening balances, invoices, bills, bank statements — Excel/CSV templates provided.
- Full company export (JSON + CSV per table + documents) for portability and audit.
