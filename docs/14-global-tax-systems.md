# 14 — Global Tax Systems & Taxable / Non-taxable Choices (APPROVED 2026-10-28 — Phase 2B in progress)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

Extends docs/02 §4 and docs/01 §4.1/§4.4. Management tracking only (registers, payable/receivable, summaries) — not statutory filing (docs/01 §2).

## 1. What exists today (Phases 0–2)
- Tax codes + effective-dated rates are **data**, admin-only (`tax_codes`, `tax_rates`); types STANDARD / ZERO_RATED / EXEMPT / OUT_OF_SCOPE / REVERSE_CHARGE.
- Items carry TAXABLE / ZERO_RATED / EXEMPT / OUT_OF_SCOPE plus a default tax code; line-level override exists.
- Tax-inclusive and exclusive pricing; line or document rounding; non-claimable input tax goes to cost.
- Seeded for Nepal (VAT 13%, TDS) and Australia (GST 10%).

## 2. Limits that block "tax systems from all over the world"
| # | Limit | Examples it cannot handle |
|---|---|---|
| 1 | Company country is only `NP`, `AU`, `OTHER` (database CHECK) | Everyone else |
| 2 | One tax per line | India CGST+SGST (or IGST), Canada GST+PST/QST, Brazil, many US states with state+county+city |
| 3 | Labels fixed to VAT/GST/PAN/ABN | "Sales tax", "Consumption tax", GSTIN, EIN, TRN, TIN, "Tax Invoice" wording |
| 4 | No way to pick a tax system | Admin must hand-create codes |
| 5 | Purchase and sales tax treatment share one item setting | Item taxable when sold but exempt/non-claimable when bought |
| 6 | No rule for taxable / non-taxable choice on bills coming from upload/OCR (Phase 5) | Supplier invoice with a mix of taxed and untaxed lines |
| 7 | Withholding only as Nepal-style TDS | Other countries' withholding / TCS |

## 3. Design

### 3.1 Tax regime = the unit an admin picks
A **tax regime** describes a jurisdiction's system:
`country (ISO 3166), name, tax label (VAT / GST / Sales Tax / Consumption Tax…), tax-ID label (PAN / ABN / GSTIN / EIN…), model, default price basis (inclusive / exclusive), rounding (line / document), return period (monthly / quarterly / annual — for reminders only), invoice title ("Tax Invoice"…), required invoice fields, default tax codes.`

**Models** (cover almost every system):
| Model | Behaviour | Typical countries |
|---|---|---|
| `CREDIT_VAT` | Output tax − input tax = payable; input claimable | Nepal, EU/UK, AU/NZ GST, India GST, Singapore, South Africa, UAE… |
| `SALES_TAX` | Charged on sale, not recoverable on purchase (input tax = cost) | US states |
| `COMPOUND` | Several components on one line (parallel or stacked/compound) | India CGST+SGST/IGST, Canada GST+PST/QST |
| `NONE` | No indirect tax tracked | Tax-free jurisdictions, unregistered businesses |
Withholding taxes (TDS and equivalents) generalise into **withholding codes** (rate, payable/receivable account, applies to sales/purchases).

### 3.2 Two ways to get a tax system
1. **Library ("tax packs").** Shipped as versioned data files (not code), each: regime + starter tax codes + rates + account mappings + report layout. Order of delivery: NP, AU (exist) → UK, NZ, India, Singapore, UAE, Canada, South Africa, EU standard rates, US (state-level shell) → more on request. Each pack shows "starter data as of <date> — **Admin must confirm rates before first use**". Packs are never silently updated; a newer pack version is offered as a diff the admin approves.
2. **Custom builder (Settings → Tax system → "My country isn't listed").** Wizard: pick model → name/labels → add components (name, rate, effective date, payable account, claimable?, stacked?) → create tax codes from components → choose tax-ID label and invoice title → preview on a sample invoice. Saved as a regime, can be exported/imported as a pack file and reused across the owner's companies.

Admin screen **Settings → Tax system:** choose regime for the company (one primary; optional extra regimes for a company that registers in two places), see active codes, change rates by adding a new effective-dated rate (never edit history). Changing regime, tax codes or rates needs step-up + audit. **Routing these changes through maker–checker is NOT built in Phase 2B** (still the open Phase 0–2 gap; planned with the Phase 4 settings work).

### 3.3 Taxable / non-taxable choices (item, bill, upload)
**At item creation (admin or `item.manage`):**
- Sales side: Taxable (choose code) / Zero-rated / Exempt / Out of scope / "Use regime default".
- Purchase side (separate): same options + **Claimable? yes/no** (non-claimable tax is added to cost).
- Optional HS/commodity code for lookup of special rates.
- Items with no choice get the company default (admin setting), never a silent "taxable".

**At bill / invoice creation (manual):**
- Each line shows the tax code defaulted from item → supplier/customer default → company default.
- Dropdown lists all active codes **including "Non-taxable / No tax"** (which maps to Exempt or Out-of-scope code, admin chooses which).
- Document switches: prices include tax; supplier not tax-registered (defaults all lines to non-claimable/none); reverse charge.
- Changing a line away from the item's default needs permission `tax.override_line`; a reason is required if the company setting says so; the override is shown on the approval screen and logged.

**At upload / OCR (Phase 5):**
- OCR extracts tax amounts per line or per document and the supplier's tax ID. Review screen shows source image beside lines, each line with **Taxable / Non-taxable** toggle and tax-code dropdown, pre-filled from: item mapping → supplier's last coding → regime default. Low-confidence tax fields are highlighted.
- Recompute check: tax from taxable base × rate vs OCR tax; mismatch beyond tolerance blocks submit until the reviewer confirms or corrects.
- Supplier without a valid tax ID (format checked per regime) → warning and suggestion "non-claimable".
- OCR never posts; maker–checker unchanged.

**Admin policy settings (per company):** default treatment for unmapped items; allow line override (yes/no, by role); reason required on override; allow tax-inclusive entry; rounding mode; block posting when tax code inactive or has no rate for the date (already enforced).

### 3.4 Data model changes (additive migration; existing NP/AU data migrated automatically)
- `countries` (ISO code, name, currency, default tax regime hint) replaces the NP/AU/OTHER CHECK; `companies.country` references it.
- `tax_regimes` (company-scoped; copied from pack or builder; stores labels, model, rounding, price basis, return period, `source_pack` + `pack_version`).
- `tax_codes.regime_id`; new `tax_code_components` (code → ordered components: name, share, stacked flag, payable/input account); `tax_rates` move to the component level (rate effective-dated, overlap exclusion kept).
- Document line tax stored as **tax lines** (one row per component per line: base, rate, amount, account) so reports and posting are exact for compound taxes; existing single-tax lines migrate as one component.
- `items`: `purchase_tax_applicability`, `purchase_default_tax_code_id`, `purchase_tax_claimable`.
- `withholding_codes` generalises `tds_codes` (TDS stays as the Nepal pack's codes).
- `tax_overrides` (line, from code, to code, reason, user) for audit; company tax policy columns.
All new tables: `company_id` + RLS + audit; NUMERIC rates; no floating point.

### 3.5 Calculation and posting
- `packages/shared/tax.ts` extended: per-line list of components, parallel vs stacked, inclusive pricing solved across components, rounding per component (line) or per document; results identical to today for single-component codes (regression suite must stay green).
- Posting rules post each component to its own payable / receivable account; non-claimable parts go to cost; reverse charge posts both sides.
- Foreign-currency tax amounts converted to base currency at the document rate (depends on multi-currency decision).

### 3.6 Reports
Tax summary by regime and component (output, input, net payable); Tax register with columns driven by the regime; taxable / zero-rated / exempt / out-of-scope totals; non-claimable report; override report (who changed taxability and why). Nepal Sales/Purchase Books keep the IRD layout (a regime-specific report layout in the Nepal pack); other regimes get the generic register. Per-regime return-working export (CSV/Excel) is a later add-on, never a filing.

### 3.7 Permissions
Built: `tax.manage` (Admin, step-up) covers regimes, packs, codes, groups and rates; `item.tax_override` (existing permission) lets a user change a line's tax away from the item's default — now granted to the Accountant role by default, with a reason required (company setting, on by default). Not built yet: `report.tax_override.view` (override report).

## 4. Honest limits
- **"All tax systems in the world" cannot be verified or kept current by this project alone** (≈200 jurisdictions; rates, thresholds and rules change; US sales tax varies by address). The plan is: accurate packs for the most-used regimes, a flexible builder for the rest, and clear "confirm with your accountant" prompts. Pack data is starter data, not tax advice.
- Address-based automatic US/Canada rates, e-invoicing mandates (e.g. EU, India e-invoice, Nepal CBMS) and statutory returns are out of scope here; they would be integrations (doc 10) after a separate decision, possibly via a paid tax-rate service.
- Special schemes (margin scheme, flat-rate schemes, partial exemption apportionment) are not included in the first release.

## 5. Phasing (proposal)
Do this **before more modules depend on tax**, as a short inserted phase:
- **Phase 2B — Tax engine v2 (≈3 weeks):** migration + compound calculation + regime/pack loader + Settings → Tax system (pick + builder) + item purchase/sales tax options + bill/invoice override rules + tax-lines reports + packs for NP, AU, UK, NZ, IN, SG, CA.
- **Phase 5 (OCR) addition:** the upload review behaviour in §3.3.
- Later: more packs, rate-service integration, return-working exports.

**Acceptance checks (Phase 2B):**
- [x] All Phase 2 tests still pass unchanged (VAT 13% mixed invoice → 1,020.09 / 500.00 / 132.61 / 1,652.70; inclusive = exclusive).
- [x] Admin creates a company in a country with no pack via the builder; invoice posts with correct tax and labels.
- [x] India-style CGST+SGST line and Canada-style GST+PST line: tax per component, ledger balanced, per-component accounts correct, inclusive pricing correct.
- [x] Item taxable on sale but non-claimable on purchase: bill posts tax to cost, not to input tax.
- [x] Non-taxable choice on a bill line posts zero tax and is reported as exempt/out-of-scope as configured.
- [x] Line override without permission → 403; with permission → reason required (if configured) and logged; shown to approver.
- [x] Rate change by adding a new effective date leaves old invoices unchanged. (Regime/rate changes go through step-up + audit; maker–checker routing deferred, see §3.2.)
- [x] Cross-company isolation (RLS) on every new table; invoice PDF uses the regime's labels and tax-ID label.

## 6. Open questions for the owner
1. Which countries do you need first after Nepal and Australia (your own companies / first customers)?
2. For the US/Canada: is a simple per-company rate table enough, or do you need automatic rates by address (paid service)?
3. Should one company be able to hold two regimes (e.g. registered in two countries)?
4. Who may override a line's taxability — only Accountant/Checker roles, or Admin only? Is a reason mandatory?
5. Should "Non-taxable" on a bill default to Exempt or Out-of-scope for each regime (affects reports)?
6. Are you comfortable that rates in packs are starter data your accountant confirms (no legal guarantee)?
