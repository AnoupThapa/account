# Protecting & Licensing LedgerPro (Intellectual Property Guide)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

> This is general information to help you plan, not legal advice. Have a lawyer in Nepal and in Australia review the final documents before you rely on them — especially before selling the software or signing with developers.

## 1. What can and cannot be protected — an honest picture
- **The general idea** ("an accounting app with BS dates, maker–checker and OCR") **cannot be owned** by anyone. Copyright protects *expression*, not ideas, and accounting software is a crowded market (Tally, Zoho, QuickBooks, Swastik and others). Someone can legally build *their own* similar product.
- **What you can protect strongly:**

| Asset | How it's protected |
|---|---|
| Source code, database design, these specs, UI designs, prompts | **Copyright** (automatic) + **confidentiality / trade secret** |
| Product name and logo | **Trademark** registration |
| Know-how, workflows, customer lists, pricing | **Trade secret** — protected only if you keep it confidential |
| Your rights against developers/staff/partners | **Contracts**: NDA, IP assignment, terms of service |
| Unique technical inventions | Patent — generally not practical for this kind of software (see §5) |

So the real protection is: **keep it secret, own it on paper, brand it, and deliver it as SaaS so nobody gets the code.**

## 2. Copyright
- **Nepal:** copyright arises automatically on creation under the Copyright Act 2059 (2002). Optional **registration** with the Copyright Registrar's Office is available and gives useful evidence of ownership and date in a dispute — worth doing for the specification and the software once Phase 1 is complete.
- **Australia:** copyright is automatic under the Copyright Act 1968; there is **no registration system**. Evidence of authorship and date comes from your records — your private GitHub history (timestamped commits) is good evidence; also keep dated copies of the specs.
- Put a copyright notice in the README, LICENSE and every source file (header below).
- **AI-assisted code:** in several countries, protection for material generated purely by AI without human creative input is uncertain. Strengthen your position by keeping records of your own creative contribution — the specifications, design decisions, reviews, change requests and approvals you make (this repo's docs and pull-request history do that). Trade-secret and contract protection apply regardless of this question.

### Source file header (add to every file)
```
/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
```
If you decide a company (e.g. a Nepal Pvt. Ltd. or an Australian Pty Ltd) should own the software, replace the name in LICENSE and headers and sign a short assignment from yourself to the company — this matters if you later raise investment or sell the business.

## 3. Trademark (protect the name)
1. Choose the final name (LedgerPro is a placeholder and may already be used by others — search before committing).
2. Check availability: Nepal Department of Industry trademark records; Australia — IP Australia's trade mark search; also domain names and social handles.
3. Register in the countries you'll sell in:
   - **Nepal:** Department of Industry (Industrial Property section).
   - **Australia:** IP Australia (online).
   - Classes typically: **9** (downloadable software) and **42** (software-as-a-service).
   - More countries later via the Madrid Protocol where available, or national filings.
4. Use ™ until registered, ® only after registration (in the country where it's registered).

## 4. Trade secrets & confidentiality (most important day to day)
- **GitHub repo private.** A licence file does *not* stop people reading a public repo. Never make it public.
- GitHub: 2FA for everyone, least-privilege access, branch protection, remove access the day someone leaves, quarterly access review.
- Mark specs "Confidential" (done in every doc in /docs).
- **NDA before sharing** the specs or demo with anyone: developers, designers, potential partners, investors, pilot customers.
- Share only what's needed (e.g. a front-end designer doesn't need database.md).
- Keep secrets out of the code (API keys etc.) — see security.md.
- Watermarked exports and audit logs inside the app also help prove misuse.

## 5. Patents
Software and business methods are generally difficult or impossible to patent in Nepal, and narrowly patentable in Australia (only where there is a genuine technical invention, not an accounting workflow done on a computer). Patents are expensive and public (they disclose your method). For this product, copyright + trade secret + trademark + contracts is the usual and more cost-effective protection. Consider a patent attorney only if you invent a genuinely novel technical method.

## 6. Contracts you need
### 6.1 Developer / contractor agreement (anyone who writes code or designs)
Must include:
- **IP assignment:** all work product, code, designs and documents created for the project are owned by you (or your company) from creation; contractor assigns all rights and waives moral rights to the extent law allows.
- Confidentiality (survives termination), no reuse of your code in other projects.
- No inclusion of third-party code without approval; disclose open-source licences used.
- Return/delete all materials on termination; handover of credentials.
- Non-solicitation of your customers (keep reasonable in scope).
- Governing law and dispute venue (Nepal or Australia — choose deliberately).
Without a written assignment, a freelancer may legally own the code they wrote.

### 6.2 NDA (for partners, investors, pilot customers)
Definition of confidential information, permitted purpose only, no copying/reverse engineering, duration (e.g. 3–5 years; trade secrets indefinitely), return/destruction, remedies including injunction.

### 6.3 Employee agreements
Confidentiality and IP-assignment clauses in employment contracts for anyone who works on the product.

## 7. How to license it to customers
**Recommended model: SaaS subscription.** Customers use the app through the browser; they never receive the code.

| Document | Purpose |
|---|---|
| **Terms of Service / Subscription Agreement** | Licence to *use* the hosted service (non-exclusive, non-transferable), subscription fees, no copying/reverse engineering/competing use, acceptable use, suspension for non-payment, limitation of liability, governing law |
| **Privacy Policy** | How you handle customers' data (Nepal's Individual Privacy Act 2075; Australian Privacy Act 1988 where applicable) |
| **Data Processing terms** | Customer owns their accounting data; you process it on their behalf; data export on exit; backup and security commitments |
| **Service Level Agreement (optional)** | Uptime, support hours, response times |
| **Order form / pricing** | Plan, users, companies, price, term |

Make it clear in the Terms that **customers own their data, you own the software**.

If a customer ever insists on installing it on their own server (common with banks): use an **on-premise licence agreement** with licence keys, bundled/minified builds only (no source), audit rights, no reverse engineering, and source-code escrow only if they demand it.

## 8. Open-source components (don't accidentally lose rights)
The app will use open-source libraries (React, NestJS, PostgreSQL, etc.). These are fine for proprietary SaaS if licences are permissive (MIT, BSD, Apache-2.0, PostgreSQL licence).
- **Avoid AGPL** components in the app — they can require you to publish your source when offered as a network service.
- Be cautious with GPL/LGPL; get advice first.
- CI runs an automatic licence check and generates `THIRD_PARTY_NOTICES` (required attribution).

## 9. Action checklist
- [ ] Keep the GitHub repo **private**; enable 2FA and branch protection
- [ ] Upload LICENSE and confidential markings (included in this pack)
- [ ] Decide owner: you personally or a company — and update LICENSE/headers
- [ ] Choose final product name; search; file trademarks (Nepal, Australia)
- [ ] Register the domain name(s)
- [ ] Sign contractor IP-assignment + NDA before anyone else touches the code or specs
- [ ] Use an NDA before demos to partners/investors/banks
- [ ] Consider Nepal copyright registration after Phase 1
- [ ] Prepare Terms of Service, Privacy Policy, Data Processing terms before the first paying customer
- [ ] Licence check for dependencies in CI
- [ ] Lawyer review in Nepal and Australia
