# 11 — Open Questions

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. Build phases
See [phases.md](phases.md) for the detailed phase plan, deliverables and acceptance checks.

## 2. Decisions made
- **Countries at launch:** Nepal + Australia (Q4).
- **Usage:** own companies first, sell as SaaS later — multi-tenant from day one, billing later (Q3).
- **Build method:** Claude Code (cloud sessions) connected to the private GitHub repo.

## 2b. Decisions delegated to Claude (owner message, 2026-10-28: "based on your understanding you can pick your choice")
Recommended answers adopted. The owner may overrule any of them at any time.
- **Order of work:** CI fix → Phase 2B tax engine v2 → Phase 3 banking → Phase 4 statements → Phase 4A go-to-market basics → Phase 5A attendance (A1–A3) → Phase 5 OCR → 7 inventory → 6 projects → 8 assets → 9 hardening. One phase at a time (CLAUDE.md rule 10).
- **Tax (doc 14):** extra tax packs after NP/AU: UK, NZ, India, Singapore, Canada, UAE, South Africa. US/Canada: simple per-company rate table (no address-based rates). One tax system per company in 2B (schema allows more later). Line tax override needs `tax.override_line` (Admin, Checker, Finance Manager by default; Accountants can be granted) and a reason (company setting, default on). "Non-taxable" defaults to the regime's exempt/out-of-scope code chosen in the pack (Nepal: Exempt; Australia: Input-taxed→ N-T for out of scope). Pack rates are starter data the owner's accountant confirms.
- **Multi-currency (Q7):** not in v1; tax and reports stay in the company's base currency.
- **Attendance (doc 13):** web/PWA + QR clock-in accepted (location check optional per company); no biometric device in A1; weekly off Saturday (Nepal) and Sat–Sun (Australia) as editable defaults; leave types loaded as editable templates; A3 stops at the payroll journal template (full Nepal payroll is a later decision); self-service for all employees, priced per active employee later.
- **Still open for the owner:** app name, hosting, inventory default (WAC proposed), OCR provider, Drive model, approval thresholds, Nepali UI timing, legal owner.

## 3. Open questions — still to answer
1. **App name** — "LedgerPro" is a placeholder.
2. **Hosting** — do you want a VPS (cheapest, I give you one-command deploy), or a managed platform (simpler, higher monthly cost)? Any preference for hosting in Nepal vs Australia/Singapore (data location)?
3. **Companies** — is this for your own businesses only, or will you sell it to other companies (SaaS with subscriptions)? This changes billing, onboarding and tenant design.
4. **Countries at launch** — Nepal only, or Nepal + Australia (GST, July–June FY) from day one?
5. **Primary calendar default** — BS primary for Nepal companies (AD shown alongside)? Confirm.
6. **Inventory method default** — FIFO or Weighted Average?
7. **Multi-currency** — needed in v1 (e.g. imports in USD/INR), or later?
8. **Payroll** — journal-template only (v1 plan), or a full Nepal payroll (SSF, tax slabs) module?
9. **OCR provider** — OK with Google Document AI (pay per page) as default?
10. **Google Drive** — one company Shared Drive (recommended), or each user's own Drive?
11. **Approval limits** — default thresholds for 2-step approval?
12. **Nepali-language UI** — needed at launch or v2?
13. **GitHub** — please share the repository URL and confirm it is **private**. Files are uploaded via GitHub's web "Add file → Upload files"; the build itself is done with Claude Code connected to your GitHub (see prompts.md).
14. **Legal owner** — you personally, or a company (Nepal Pvt. Ltd. / Australian Pty Ltd)? See ip-protection.md.
