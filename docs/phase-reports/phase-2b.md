# Phase 2B report — Global tax systems (28 Oct 2026)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. See [LICENSE](../../LICENSE).

Branch: `claude/wizardly-hopper-fmsd6z` (draft PR). Scope: docs/14, approved by the owner's delegation of decisions on 28 Oct 2026 (docs/11 §2b).

## 1. What was built (plain English)
- **Any country.** A company can now be created in any country (a list of ~50 with ready defaults for currency, financial-year start and time zone, or any 2-letter code you type). Nepal and Australia work exactly as before.
- **Tax system picker (Settings → Tax system).** The admin picks a ready-made tax system — Nepal, Australia, UK, New Zealand, India, Singapore, UAE, South Africa, Canada, USA (rate table), a generic VAT/GST starter, or "no indirect tax" — and sees every code and rate before loading it. Loading only adds codes; nothing is deleted or changed. The pack's starter rates are labelled with their date and "confirm with your accountant".
- **"My country isn't listed" builder.** The admin describes how tax works (VAT/GST, sales tax, more than one tax per sale, or none), names the tax and the registration number (e.g. "GSTIN", "NUI"), the invoice title and how often returns are filed, then adds codes. Invoices use those names.
- **Combined taxes.** One tax code can be made of several taxes, charged side by side or one on top of another (India CGST+SGST, Canada GST+PST/QST). Each part is calculated, posted to its own tax account and shown separately in the tax summary. Parts that can't be claimed back (e.g. PST) go into the cost of the purchase automatically.
- **Taxable / non-taxable choices.**
  - **Items:** tax when sold and (optionally) a different tax when bought, each with its own default code.
  - **Bills and invoices:** each line has a tax dropdown and a one-click **Non-taxable** button. Changing a line away from the item's tax needs permission and a reason (company setting, on by default); the reason is stored and shown.
- **Labels follow the tax system** on invoices (title, tax name, "PAN/VAT No." / "ABN" / "GSTIN"…), company and contact screens.

## 2. Test results
| Suite | Tests | Result |
|---|---|---|
| Shared library (BS/AD, fiscal years, VAT maths **incl. 6 new combined-tax tests**, **5 new pack/country checks**) | 303 | ✅ |
| Database rules (incl. "every company table has row-level security" — now covers the 2 new tables) | 23 | ✅ |
| API Phase 0–2 (unchanged, all still pass) | 53 | ✅ |
| API Phase 2B (new) | 15 | ✅ |
| Browser smoke test (sign in → invoice → approve → reports, 25 screens) | 1 | ✅ |
| **Total** | **395** | ✅ |

## 3. Acceptance checklist (docs/14 §5)
| Check | Result | Evidence |
|---|---|---|
| All Phase 2 tests pass unchanged (VAT 13% mixed invoice, inclusive = exclusive) | ✅ | the 53 earlier API tests, no edits to them |
| Company in a country with no pack, via the builder; invoice posts with correct tax and labels | ✅ | `phase2b` "custom builder": 5% + 2% stacked = 71.00, posts per component, prints "Faturë / TVSH / NUI" |
| India CGST+SGST and Canada GST+PST: per-component tax, balanced ledger, per-component accounts, inclusive pricing | ✅ | `phase2b` India (incl. inclusive 1,180 = 1,000 + 180) and Canada BC tests; tax summary lists CGST9 / SGST9 separately |
| Item taxable on sale but non-claimable on purchase → tax to cost | ✅ | `phase2b` "non-claimable tax goes to cost" (1,130 expense, no input-tax line) |
| Non-taxable choice on a bill line posts zero tax and reports as exempt | ✅ | `phase2b` "Non-taxable on an account-only bill line" |
| Override without permission → 403; with permission → reason required & logged | ✅ | `phase2b` 403 test + reason test (reason stored on the line) |
| Rate change by a new effective date leaves old invoices unchanged | ✅ | `phase2b` India GST5 test |
| Regime/rate changes go through maker–checker | ⚠️ **not built** | they require step-up + audit log now; maker–checker routing is deferred (see §5) |
| Cross-company isolation on every new table; PDF uses the regime's labels | ✅ | DB RLS test + `phase2b` isolation test; print test above |

## 4. What you (the owner) need to do
1. **Have your accountant confirm each pack's rates before real use** — they are starter data dated 1 Oct 2026 (especially India's new 5/18/40% slabs, Canadian provincial rates and the UK/EU rates).
2. Re-run the database update on your PC/server (the start file does it): it adds migration `0005_tax_v2.sql`. Existing companies are converted automatically (Nepal → Nepal VAT, Australia → Australia GST); nothing in existing documents changes.
3. Answer the remaining questions in docs/14 §6 if you disagree with my choices (docs/11 §2b lists them).

## 5. Deviations, risks and TODOs (honest list)
- **Maker–checker for tax-system changes is not built.** Changing the tax system, codes or rates needs Admin + password re-entry and is audit-logged, as in Phase 2. Planned with the Phase 4 settings work.
- **One tax system per company** (the data model allows more; no screen for it).
- **Packs are not verified legal advice.** I could not check rates against official sources in this session; they come from my general knowledge as of the date shown. Rates are *data* in each company, so correcting one is a normal "new rate from a date" change.
- **Not included:** US/Canada rates by address, e-invoicing mandates, special schemes (margin / flat-rate / partial exemption), withholding taxes outside Nepal's TDS, override report (`report.tax_override.view`), tax-return working exports.
- The new Accountant default permission `item.tax_override` applies to **new** companies; existing companies keep their current role settings (Admin can add it in Users & roles).
- **Multi-currency is still not supported**; tax is in the company's base currency.
- Foreign-country **Chart of accounts** uses the generic IFRS layout; Nepal-specific accounts exist only for Nepal companies.
- CI: the workflow's Ubuntu image was pinned to 24.04 because Playwright 1.56 does not run on Ubuntu 26.04 (`ubuntu-latest`).

## 6. Security update added to this branch (28 Oct 2026)
The CI dependency audit started failing on advisories published against libraries the app already used (it was **not** caused by Phase 2B). Fixed on the same branch (the only branch I may push to):
- **Next.js 15.5.27 → 15.5.28** (critical remote-code-execution flaw and a denial-of-service flaw).
- **Kysely 0.27 → 0.28.18** (SQL-injection advisories), **Nodemailer 6 → 10.2** (worker emails), **Zod 3 → 4.6.7** (input validation), NestJS 11.2.8, and forced patched versions of `postcss`, `multer`, `body-parser` and `qs` (`pnpm-workspace.yaml` overrides).
- `pnpm audit --prod --audit-level high`: **No known vulnerabilities found.**
- **A real bug the upgrade would have caused, caught by the tests:** Zod 4's "partial" schema still fills in default values, so editing one field of a role, item or contact would have silently reset other fields (a role's permissions, an item's prices and unit, a contact's payment terms). All edit forms now use `patchSchema()` (`packages/shared/src/schemas.ts`), and 3 new tests (`patch-safety.test.ts`) guard it.
- Tests after the update: shared 303, database 23, API 71, browser smoke test OK, production build OK.
- Not changed: NestJS stays on 11.x (12 is a separate major upgrade); Kysely stays on 0.28 (0.29 is newer).
