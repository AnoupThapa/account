# Security

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

Security baseline: **OWASP ASVS Level 2** and **OWASP Top 10**. Financial data is treated as confidential by default.

## 1. Authentication
- Passwords hashed with **Argon2id**; minimum 10 characters; checked against known-breached password list.
- **TOTP 2FA** (Google Authenticator etc.), mandatory for Admin, Checker, Finance Manager; optional for others (admin can force for all). Recovery codes issued once.
- Optional "Sign in with Google" (Workspace accounts).
- Account lockout: 5 failed attempts → 15-minute lock + email alert.
- Access token 15 minutes; refresh token rotated on use, revoked on logout/password change; stored in httpOnly, Secure, SameSite=Strict cookies.
- Session list per user with "log out other devices"; admin can force-logout any user.
- Idle timeout 30 minutes (configurable).

## 2. Authorisation
- Deny by default; every endpoint declares required permission(s); enforced server-side by guards.
- Tenant isolation at two layers: API company guard + PostgreSQL Row-Level Security.
- Object-level checks (user may only open records in their permitted branches/projects).
- Maker ≠ checker enforced in API **and** database constraints.
- Sensitive actions (change bank details, tax rates, roles, unlock period, reopen year, export all data) require re-entering password/2FA ("step-up auth") and are flagged in audit.

## 3. Data protection
- **In transit:** TLS 1.2+ only, HSTS, no mixed content.
- **At rest:** disk encryption on server and backups; application-level encryption (AES-256-GCM) for secrets: OAuth tokens, API keys, OCR keys, bank account numbers.
- Keys held outside the database (environment/secret manager); key rotation procedure documented.
- PII minimisation: store only what accounting needs.
- Masking: bank/PAN numbers partly masked in lists and logs.

## 4. Application security
- Input validation on every request (Zod schemas shared by frontend and backend).
- Parameterised queries only (Prisma / tagged SQL) — no string-built SQL.
- Output encoding; strict **Content Security Policy**; X-Frame-Options DENY; X-Content-Type-Options nosniff; Referrer-Policy.
- CSRF protection (SameSite cookies + CSRF token for state-changing requests).
- Rate limiting per IP and per user (login, OCR, exports, API keys).
- File uploads: allow-list of types, size limits, ClamAV virus scan, stored outside web root, served via signed short-lived URLs, image re-encoding to strip embedded content.
- Excel/CSV exports protected against formula injection (prefix cells beginning with `= + - @`).
- Dependency scanning (Dependabot / `pnpm audit`), container image scanning, secret scanning in GitHub; CI fails on high-severity issues.
- Static analysis (ESLint security rules, CodeQL).

## 5. Infrastructure
- Firewall: only ports 80/443 public; SSH by key only, non-standard port, fail2ban, or via VPN/Tailscale.
- Database and Redis not exposed to the internet.
- Containers run as non-root, read-only filesystem where possible.
- Automatic OS security updates.
- Separate credentials for staging and production; production data never copied to staging un-anonymised.

## 6. Audit & monitoring
- Append-only, hash-chained audit log (see database.md); daily chain verification.
- Alerts for: repeated failed logins, logins from new country, bulk exports, permission changes, period unlock, integrity check failures.
- Logs retained 1 year (configurable); no passwords, tokens, or full account numbers in logs.

## 7. Backup & disaster recovery
- Nightly full backup + continuous WAL archiving, encrypted, stored off-site (different provider/region).
- **RPO** ≤ 15 minutes, **RTO** ≤ 4 hours.
- Monthly automated restore test with integrity checks; documented recovery runbook.

## 8. Google Drive & third parties
- Minimum OAuth scopes; tokens encrypted; refresh failures alert Admin.
- Recommended Shared Drive owned by the company, not a personal account.
- OCR providers: no data retention/training settings enabled where offered; Admin can choose offline Tesseract for sensitive documents.
- Outgoing webhooks signed (HMAC-SHA256); incoming webhooks verified.

## 9. Source code & intellectual property protection
- GitHub repository **private**; 2FA required for all GitHub members; branch protection on `main` (reviews, passing CI, no force push).
- Least-privilege repo access; remove access immediately when someone leaves; quarterly access review.
- Proprietary `LICENSE` and copyright header in every source file (see [ip-protection.md](ip-protection.md)).
- No secrets in Git; `.env` files ignored; GitHub secret scanning + push protection on.
- SaaS delivery (code stays on your server; customers never receive source).
- If ever installed on a customer's server: compiled/bundled builds, licence-key check, contractual no-reverse-engineering clause.

## 10. Incident response
1. Detect (alert) → 2. Contain (disable accounts/keys, block IP) → 3. Assess scope from audit logs → 4. Eradicate & restore → 5. Notify affected companies and, where required by law, regulators → 6. Post-incident review within 7 days.
Contact list and runbook stored outside the app (e.g. in Drive).

## 11. Periodic reviews
| Frequency | Activity |
|---|---|
| Weekly | Review security alerts, failed jobs |
| Monthly | Restore test, dependency updates |
| Quarterly | User & role access review per company; GitHub access review |
| Yearly | External penetration test; policy review |

## 12. Go-live security checklist
- [ ] HTTPS with A rating (SSL Labs) and security headers (securityheaders.com)
- [ ] 2FA enforced for privileged roles
- [ ] RLS enabled on all tenant tables (automated test)
- [ ] Ledger immutability triggers active
- [ ] Backups running and a restore tested
- [ ] Secrets encrypted; none in repo history
- [ ] Rate limiting and lockout verified
- [ ] Upload virus scanning active
- [ ] Penetration test findings fixed (critical/high)
- [ ] Repo private, branch protection on, LICENSE present
