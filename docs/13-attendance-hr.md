# 13 — Attendance, Leave & Payroll-ready Module (APPROVED 2026-10-28 — build after Phase 2B)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. Purpose
Record who worked when, handle leave and overtime, and turn approved attendance into a payroll-ready summary and a payroll **journal** that goes through the normal maker–checker ledger path. This also fits the existing "Team Member / Staff" role and timesheet idea in doc 08.

Scope boundary: this is a management tool, not a statutory filing system. A full payroll engine (tax slabs, SSF filing, STP/BAS) stays a later phase (doc 01 §2, open question 8).

## 2. Features
### 2.1 Employees
- New `employees` table linked 1:1 to a `contacts` row of type EMPLOYEE (so expense claims keep working). Fields: employee code, branch, department (cost centre), designation, join/exit date, employment type (permanent / contract / part-time / casual), manager, basic salary & allowances (restricted permission), PAN / SSF no. (Nepal), TFN is **not stored** (AU super/tax details live in the payroll phase, encrypted).
- Linked to a login user (optional — staff without logins can be clocked in by a kiosk or manager).

### 2.2 Capturing attendance (pluggable "sources")
| Source | Phase | Notes |
|---|---|---|
| Web / PWA clock in-out (self-service) | A1 | Optional geofence around branch location; optional IP allow-list |
| Shared kiosk / QR code at the branch (rotating QR) | A1 | Prevents clocking in from home |
| Manual entry / correction request by employee | A1 | Needs manager approval (maker–checker); original punch kept |
| Import from biometric/ZKTeco-type device export (CSV) | A2 | Mapping templates, like bank statement import |
| Device push API (ADMS) / webhooks | A3 | Later |
| Timesheet (project/task hours) | A2 | Reuses doc 08 time logs; billable flag for invoicing |

All raw punches are append-only (`attendance_punches`); daily results (`attendance_days`) are computed from punches + shift + rules, so a rule change can recompute without losing evidence.

### 2.3 Shifts, rosters, holidays
- Shift templates (start/end, break, grace minutes, night shift crossing midnight, flexible hours / minimum hours).
- Weekly pattern and rosters per employee/team. Nepal default: Sunday–Friday with Saturday weekly off (admin-configurable; many offices differ).
- Holiday calendar per company/country: admin-maintained (Nepal public holidays are decided by government each year — never hard-coded), BS/AD shown, optional-holiday support.

### 2.4 Daily status engine
Present, Absent, Late, Early-out, Half-day, On leave, Holiday, Weekly off, Missed punch, Overtime. Rules are per company: grace period, late-count → half-day deduction, minimum hours for full day, rounding, auto-absent after N hours without punch.

### 2.5 Leave
- Leave types (annual/home, sick, casual, maternity/paternity, unpaid, substitute, compensatory-off) with entitlement per year, accrual method (monthly/yearly/on joining), carry-forward and encashment caps, paid/unpaid, half-day and hourly options, attachments (medical certificate).
- Request → manager approves → (optional HR second step). Balance checked at request and approval. Calendar view of who is away (BS/AD). Cancellation of approved leave is also approved.
- **Defaults are templates, not legal advice:** Nepal Labour Act and Australia's NES/awards set minimums that differ by sector and agreement; the admin confirms every value (see §6).

### 2.6 Overtime & compensatory time
Overtime rules: daily/weekly thresholds, multiplier (e.g. 1.5×, 2× on holidays), caps, requires pre-approval or post-approval. Output: approved OT hours per employee per period; or convert to compensatory leave.

### 2.7 Reports
Daily attendance sheet, monthly attendance register (matrix, BS or AD), late/absent/missed-punch exceptions, overtime report, leave balances & liability (accrued leave as accounting accrual), leave calendar, department/cost-centre hours, timesheet-to-project hours, headcount, punctuality trends. Export PDF/Excel (watermarked & logged like other reports).

### 2.8 Payroll-ready output (A3)
- Period close of attendance → locks the month (unlock = same controlled process as accounting periods).
- **Payroll summary sheet** per employee: payable days, unpaid leave days, OT hours, late deductions, approved allowances/deductions.
- **Payroll journal template**: Dr Salary & wages (by cost centre) / Cr Salary payable, TDS payable, SSF/PF payable (Nepal) or PAYG/super payable (AU) → submitted as a normal manual journal through maker–checker. The ledger module remains the only writer of journal tables.
- Later phase: full Nepal payroll (SSF, income-tax slabs, gratuity/PF) and AU (super, STP) — requires owner decision (open Q8).

## 3. Roles & permissions (new, added to packages/shared permissions)
| Permission | Default roles |
|---|---|
| `attendance.clock` | Team Member, all staff |
| `attendance.view_own` / `attendance.view_team` / `attendance.view_all` | Staff / Manager / HR, Admin, Auditor (read) |
| `attendance.correct` (request) / `attendance.approve` | Staff / Manager (never self-approve — same DB rule as maker–checker) |
| `leave.request` / `leave.approve` / `leave.manage_types` | Staff / Manager / HR, Admin |
| `roster.manage`, `shift.manage`, `holiday.manage` | HR, Admin |
| `employee.view` / `employee.manage` / `employee.view_salary` | HR, Admin / Finance Manager (salary restricted) |
| `report.attendance.*`, `payroll.summary.export` | HR, Finance Manager, Auditor |

New default role: **HR Officer**. Data scopes by branch / department so a manager only sees their team.

## 4. Data model (sketch — final DDL goes in docs/database.md after approval)
All tables carry `company_id` + RLS (existing automated check must pass), audit-logged, soft-delete only.
`employees`, `departments` (reuse cost_centres), `shifts`, `roster_assignments`, `holidays`, `attendance_punches` (append-only; source, device, lat/long optional, ip, created_at), `attendance_days` (computed; status, worked_minutes, late_minutes, ot_minutes, locked), `attendance_corrections` (approval doc), `leave_types`, `leave_policies`, `leave_balances` (ledger-style: entries, not an overwritten number), `leave_requests` (approval doc), `overtime_rules`, `overtime_entries`, `attendance_periods` (lock), `payroll_summaries`.
Rules enforced in DB, as with accounting: punches immutable; locked period rejects changes; leave balance cannot go negative unless the leave type allows; approver ≠ requester.
Times stored as UTC timestamptz **plus** company time zone (Nepal UTC+5:45, Australia has several zones and daylight saving → per-branch time zone). Dates stored AD, BS shown alongside.

## 5. Phases
- **A1 (3 weeks):** employees, shifts, holidays, web/PWA + QR clock-in, daily engine, manual corrections with approval, attendance register & exceptions, permissions.
- **A2 (3 weeks):** leave types/policies/requests/balances, overtime, timesheets, biometric CSV import, leave & OT reports, notifications.
- **A3 (2 weeks):** attendance period lock, payroll summary, payroll journal template, accrued-leave liability journal, Drive export of monthly register.
Acceptance checks (each phase): night shift across midnight computes correctly; DST day in AU; BS month boundaries; late/half-day rules; leave balance never wrong after cancel; self-approval blocked by API and DB; cross-company RLS; locked period immutable; employee sees only own data; payroll journal balances and posts only after checker approval.

## 6. Legal & privacy cautions (owner must confirm)
- Rates and limits found in secondary sources (law-firm and HR blogs, not the official texts) — **verify with a Nepali labour lawyer / the Labour Act 2074 and SSF before enabling defaults**: standard 8 h/day & 48 h/week, 30-min break after 5 h, overtime 1.5× (capped ≈ 4 h/day, 24 h/week — one source said 20 h), SSF 11% employee + 20% employer on basic. Australian super guarantee reported as 12% and Payday Super from 1 July 2026; award overtime/penalty rules vary by award and are **not** implemented in A1–A3 (flat multipliers only).
- Location, device and biometric data is personal/sensitive: collect only if the company turns it on, show a consent notice, store minimum data, restrict access, retention setting (default 24 months), include in company export/delete. Face/fingerprint templates are **never stored** by the app (only device-side or CSV results).
- Monitoring staff must follow local privacy and employment law; the admin screen shows a notice.

## 7. Open questions for the owner
1. Which companies will use it first, and how many staff (affects rosters vs simple clock-in)?
2. Do you use biometric/fingerprint machines today? Which brand/model?
3. Geofence/QR clock-in acceptable, or only manager-entered attendance?
4. Weekly off day(s) and standard hours for your Nepal and Australia companies?
5. Leave policies to load as defaults (list the types and days)?
6. Should A3 stop at the payroll **journal template**, or do you want the full Nepal payroll (SSF, tax slabs) next?
7. Staff self-service login for every employee (adds users → SaaS pricing impact)?
