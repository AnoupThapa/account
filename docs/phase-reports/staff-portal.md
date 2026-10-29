# Staff portal & HR report (29 Oct 2026)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. See [LICENSE](../../LICENSE).

Branch: `claude/wizardly-hopper-fmsd6z` (draft PR #1). Scope: docs/15 §12 (owner request of 29 Oct 2026).

## 1. What was built (plain English)
- **Staff profile section.** HR sees every staff member's profile with tabs: Profile, Salary (history kept), Attendance, Payslips, TDS certificates, Login.
- **Separate staff portal ("My profile").** A staff member signs in and sees only their own profile, current salary, attendance (with a Clock in / Clock out card), payslips and TDS certificates. Nothing else — no accounting screens, no other staff.
- **HR Manager profile.** A new role with access to all staff profiles, attendance, payslips, TDS certificates and HR settings, and no access to accounting data or user/role management. Needs 2FA like other sensitive roles. The Company Admin has everything.
- **Attendance.** Staff clock in/out from their portal (the company's time zone; Late and Half-day rules from HR settings). HR sees the daily sheet and the monthly register and can correct or mark any day — a reason is required and every change is logged.
- **Payslips.** HR creates a draft per staff member (from the salary and the company SSF rates; TDS is typed in), can create drafts for everyone at once, edits drafts, then **sends** them. Sending gives the payslip a gapless number (`PS-2083/84-00001`), locks it, emails the staff member (the email carries no salary figures) and shows it in their portal, where they can open it, print/PDF it and confirm receipt. HR sees "not opened / opened / acknowledged". A wrong payslip is cancelled (reason, number kept) and re-issued.
- **TDS certificate, issued manually by the Admin or HR Manager.** All the fields you asked for: basic salary, allowance, other allowance, TDS deductible, SSF employee contribution, SSF employer contribution, other deductible, and total receivable (plus total remuneration and optional TDS deposit reference/date). Amounts are typed in, or pre-filled from the staff member's sent payslips. Numbered `TDSC-2083/84-00001`, cannot be edited after issue, can be cancelled with a reason (number kept), printed/PDF'd with an Original/Copy counter. The staff member can view and print their own.
- **Closing a security gap found on the way.** Three older endpoints were open to *any* company member (the home-page money figures, the advance-adjustments list and its delete). That didn't matter while only finance people had logins; with staff logins it did. They now need accounting permissions, and a new test proves a staff or HR login gets "403 Forbidden" on 17 finance screens.

## 2. How the figures work (please confirm with your accountant)
Gross pay = basic + allowance + other allowance. Total deductions = TDS + SSF (employee) + other deductions. **Net pay = total receivable = gross − total deductions.** The SSF employer contribution is shown on the payslip and certificate but is **not** deducted from the staff member. These rules are enforced by the database as well as the program.

## 3. Test results
| Suite | Tests | Result |
|---|---|---|
| Shared library (incl. 6 new payslip arithmetic and time-zone/late-rule tests) | 309 | ✅ |
| Database rules (every company table has row-level security — now incl. 6 new tables) | 23 | ✅ |
| API (incl. **26 new staff & HR tests**; earlier 71 unchanged) | 97 | ✅ |
| Browser: main flow, staff & HR flow (run twice), tax screens | 3 | ✅ |
| **Total** | **432** | ✅ |
Also: copyright and licence checks pass; dependency audit clean; production build OK.

## 4. Acceptance checklist (docs/15 §12.4)
| Check | Result | Evidence |
|---|---|---|
| Staff login sees only own profile, attendance, payslips, certificates | ✅ | `staff.test.ts`: another staff member's payslip/certificate → 404 on view, print and acknowledge; HR/staff-list endpoints → 403 |
| HR Manager sees all staff, generates/sends payslips, issues certificates; cannot touch accounting, roles | ✅ | tests "HR Manager cannot touch accounting data or roles", finance endpoints → 403 |
| Payslip totals add up; sent is immutable (also in the database); duplicate refused; gapless numbers; email queued; staff sees and acknowledges | ✅ | PS-…-00001 then 00002 after a cancel; direct SQL edit of a sent payslip is rejected; outbox row has no salary figures |
| TDS certificate: all owner-listed fields; total receivable correct; pre-fill = sum of payslips; immutable; cancel keeps number | ✅ | 6,90,000 remuneration / 12,000 TDS / 66,000 + 1,20,000 SSF / 5,000 other → 6,07,000 receivable; certificate numbers 00001→00003 gapless |
| Clock in/out: late and half-day rules; double clock-in refused; HR correction needs a reason and is logged | ✅ | tests incl. a correction to 490 worked minutes and audit-log entry; time-zone unit tests (Nepal, Sydney daylight saving) |
| Company isolation on every new table; deny by default | ✅ | other company's HR Manager sees nothing; DB row-level-security test |

## 5. What you (the owner) need to do
1. **Update the database** (the Windows start file does it). It adds `0006_staff_hr.sql` and gives every existing company the new HR Manager and Staff roles.
2. **Try it** (demo data): `hr.np@ledgerpro.local` (HR Manager) and `staff.np@ledgerpro.local` (Sita Shrestha, staff), same for `.au`; password `Demo-Ledger-2026!`. HR → Staff & HR → Payslips → *Create drafts for everyone* → *Send all drafts*; then sign in as the staff member.
3. **Real use:** in Staff → open a person → **Login** tab to create their login (email + a first password they must change). Set work hours and SSF rates under **HR settings** and confirm them with your accountant.
4. Tell me if the pay formula in §2 is not how your accountant wants *total receivable* defined.

## 6. Deviations, risks and TODOs (honest list)
- **No ledger posting yet.** Payslips are staff records; the pay-run journal (salary expense, TDS/SSF payable) and bank payment file are the next payroll step (docs/15 S3).
- **TDS on salary is typed in**, not calculated from slabs — the slab table must first be confirmed by your accountant (docs/15 §8). The SSF 11%/20% defaults come from secondary sources and are marked unverified.
- **No maker–checker on payslips/certificates:** the HR Manager (or Admin) issues them directly; every action is audit-logged and cancel-with-reason keeps numbers. If you want a second person to approve payslips before sending, say so.
- **Not yet built:** leave requests and balances, overtime, rosters/shifts, public-holiday calendar, supplier/customer TDS register & certificates (docs/15 T1), employee photos/documents, staff self-edit of profile, payslip email attachment.
- The certificate layout is a management format; if the tax office prescribes a form, send it and I'll replace it.
- Clock-in is by browser only (no location/QR/fingerprint yet). A staff member can clock in from anywhere with a login.
- Staff can clock in only for *today*; HR can correct earlier days.
