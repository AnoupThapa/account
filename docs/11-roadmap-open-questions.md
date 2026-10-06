# 11 — Open Questions

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. Build phases
See [phases.md](phases.md) for the detailed phase plan, deliverables and acceptance checks.

## 2. Decisions made
- **Countries at launch:** Nepal + Australia (Q4).
- **Usage:** own companies first, sell as SaaS later — multi-tenant from day one, billing later (Q3).
- **Build method:** Claude Code (cloud sessions) connected to the private GitHub repo.

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
