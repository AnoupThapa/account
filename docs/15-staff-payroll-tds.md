# 15 — Staff, Salary (Payroll) & TDS Certificates (PROPOSED — extends docs/13)

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

Owner request, 29 Oct 2026: "what about staff management — attendance, salary, TDS certificate etc." This document adds **salary/payroll** and **TDS certificates** to the attendance/leave module already approved in docs/13, and turns them into one plan. It supersedes docs/13 §2.8 and §5 phase A3 (which stopped at a payroll *journal template*) and answers docs/11 open question 8 (payroll: full module).

## 1. What exists today (honest status)
| Need | Status |
|---|---|
| Employees | Only a contact of type EMPLOYEE (used for expense claims). No staff records. |
| Attendance, leave, overtime | Designed in docs/13, **not built**. |
| Salary / payroll | Only a journal template line in docs/02 §6. **Not built.** |
| TDS | Nepal TDS codes exist (service 1.5%, rent 10%, contract 1.5%, commission 15%). TDS can be deducted on **receipts** (customer deducted) and **payments** (we deducted), posted to TDS Receivable / TDS Payable. **No TDS register, no deposit tracking, no certificates.** |

## 2. Staff management (employee records)
- Employee master: code, name (English + Nepali), photo, PAN, citizen/ID no., SSF no., PF/CIT no., bank account, join/confirmation/exit dates, employment type (permanent, contract, part-time, casual, intern), branch, department/cost centre, designation, manager, marital status (Nepal tax treatment), documents (contract, ID, certificates; Drive link when Phase 5 exists).
- Linked 1:1 to the existing EMPLOYEE contact so claims, advances and loans keep working.
- Lifecycle: onboarding checklist, probation end reminder, contract expiry reminder, exit checklist (final settlement, certificate, clear advances).
- Staff documents and salary are **restricted data**: permission `employee.view_salary`, field-level audit, never in exports unless granted.

## 3. Attendance & leave
Exactly as docs/13 §2.2–2.7 (web/PWA & QR clock-in, shifts, rosters, holidays in BS/AD, daily status engine, leave types/balances/approval, overtime, reports). Delivered inside the staff phases below.

## 4. Salary (payroll)
### 4.1 Salary structure
Per employee, effective-dated (a raise = new row, history kept): basic, allowances (fixed or % of basic), deductions, employer contributions. Components are **data**: type (earning / deduction / employer cost), taxable?, counts towards SSF base?, ledger account, show on payslip.

### 4.2 Pay run (monthly, BS month for Nepal)
1. **Create run** for a period → system pulls payable days / unpaid leave / late deductions / approved overtime from attendance (docs/13).
2. **Calculate** each employee: gross → SSF/PF/CIT → taxable income → TDS on remuneration → advances/loan instalments → net pay.
3. **Review** (variance vs last month, new joiners/leavers, warnings), edit one-off items (bonus, arrears, fine) with reason.
4. **Maker–checker approval** (two-step above a threshold like other documents).
5. **Post** through the ledger module as one journal per run, split by cost centre: Dr Salary & wages (+ employer SSF/PF expense) / Cr Salary payable, TDS payable (remuneration), SSF/PF payable, advances recovered.
6. **Pay**: bank payment batch (CSV for the bank) → posting through the normal payment document; payslips issued.
Pay runs are immutable once posted; a correction is a supplementary run or reversal (same rules as all documents). Attendance for the period is locked on approval.

### 4.3 Nepal specifics (to be confirmed — see §8)
- **SSF**: employee 11% + employer 20% of basic (secondary sources; configurable per company, off for companies below the SSF threshold or using PF/CIT instead).
- **TDS on remuneration**: progressive slab tax on annual taxable remuneration, with the monthly deduction computed from the projected annual figure and trued-up each month. Slab tables are **effective-dated data** per company (like tax rates), separate for individual / couple. Secondary sources report that FY 2083/84 raised the tax-free threshold to Rs 10 lakh with five slabs (1% / 10% / 20% / 27% / 29%) and that the earlier FY 2082/83 slabs still apply until Shrawan 1, 2083 — **the Finance Act and IRD schedule must be checked before the slab table is loaded**, so no table is built in until the owner's accountant confirms.
- Allowable deductions (retirement contributions, insurance) handled as configurable deduction types with limits.
- Festival allowance / bonus, gratuity accrual (employer cost, accrual journal), leave encashment, final settlement on exit.

### 4.4 Australia specifics (simplified, management only)
PAYG withholding amount per employee per run (entered or from the admin's loaded ATO table data), super guarantee 12% of ordinary-time earnings (reported rate; confirm), payslip fields required by law. **Single Touch Payroll lodgement is out of scope** (a CSV working export only).

### 4.5 Payslips
Per employee PDF (BS + AD dates, earnings, deductions, YTD, leave balance), emailed from the system or downloaded, access limited to the employee and HR. Print/reprint counter like invoices.

### 4.6 Payroll reports
Payroll register, bank payment sheet, SSF contribution statement, TDS-on-remuneration statement, salary by cost centre, headcount & cost trend, leave liability, gratuity liability.

## 5. TDS: register, deposits and certificates
### 5.1 TDS register & deposit tracking (Nepal)
- One register of every TDS amount **deducted by us** (supplier payments, remuneration, other) and **deducted from us** (customer receipts), with party PAN, bill/payment reference, base amount, rate, TDS, BS period.
- **Deposit tracking:** TDS payable by month → deposit to IRD recorded as a payment document (voucher no., date, bank) → register shows *deducted / deposited / outstanding*, with a due-date reminder (statutory due dates are admin-configured; secondary sources say 25 days after month-end — confirm).
- **e-TDS working export:** CSV/Excel in the column layout the owner's accountant needs for the IRD e-TDS filing (management working paper; LedgerPro does not file).

### 5.2 TDS certificates (three kinds)
1. **Supplier / payee certificate** — issued by us when we deduct TDS on a payment: gapless number per fiscal year (`TDSC-2083/84-00001`), payer & payee names and PAN, payment/bill reference, base amount, TDS code, rate and amount, deposit voucher/date, signatory block, BS + AD dates, amount in words, **Original / Copy (n)** counter, cancel-with-reason (number kept). Generated only for **posted** payments; flagged "deposit pending" until the TDS deposit is recorded.
2. **Employee remuneration certificate** — annual (after year end) and on leaving: total remuneration, SSF/retirement deductions, taxable income, TDS deducted and deposited, month-wise table. Produced from posted pay runs; blocked until that period's TDS is marked deposited (secondary sources say the employer must deposit before issuing and must issue within 30 days of year end or exit — confirm).
3. **Received-from-customer certificates** — when a customer deducted TDS from our receipt: record certificate no., date, amount, attach the scan; reconcile to TDS Receivable (open vs certificate received), so tax credits are not lost.
The layout is a **management-format certificate**; if the IRD prescribes a specific form, the template is replaced by the official layout (owner/accountant to supply the current form).

### 5.3 Controls
Certificate creation is a document under maker–checker (checker approves issuing); reissue after correction cancels the old one; every print/export audit-logged; numbers gapless; RLS on all tables.

## 6. Permissions (additions)
`employee.view` / `employee.manage` / `employee.view_salary`; `salary_structure.manage`; `payroll.view` / `payroll.run` / `payroll.approve`; `payslip.view_own` / `payslip.view_all`; `tds.register.view`; `tds.deposit.record`; `tds_certificate.view` / `.issue` / `.approve`; plus the attendance/leave permissions of docs/13 §3. New default roles: **HR Officer**, **Payroll Officer** (maker), with Finance Manager as approver. Employees see only their own payslips, attendance and certificates.

## 7. Data model (sketch; DDL to docs/database.md after approval)
`employees`, `employee_documents`, `salary_components`, `salary_structures` (+ lines, effective-dated), `pay_runs`, `pay_run_lines` (+ component amounts), `payslips`, `employee_advances`/`loan_schedules`, `tax_slab_tables` (+ bands, effective-dated), `ssf_settings`, `tds_register_entries` (view over receipts/payments/pay runs), `tds_deposits`, `tds_certificates` (+ number series, print counter, status), plus docs/13 tables (`shifts`, `attendance_punches`, `attendance_days`, `leave_*`, `overtime_*`). All with `company_id` + RLS, audit-logged, NUMERIC(18,2) money, no floating point; the ledger module remains the only writer of journal tables.

## 8. Legal / accuracy cautions (owner must confirm)
All Nepal and Australia payroll and TDS figures and deadlines above come from **secondary sources** (law-firm/HR blogs, a budget news report, an ICNL copy of the Income Tax Act 2058). I could not access IRD or Finance Act texts. Therefore: slab tables, SSF rates, due dates and certificate wording are **admin-editable data that ship empty or marked "unverified"** until the owner's accountant loads and confirms them; LedgerPro shows the "as of" date and an unverified warning on every run, certificate and report using them. LedgerPro is a management tool; it does not file returns or replace a registered accountant.

## 9. Phasing (proposal, in this order)
| Phase | Scope | Est. |
|---|---|---|
| **T1 — TDS register & supplier/customer certificates** | register, deposit tracking, supplier certificates (numbered, PDF, copy counter), received-certificate tracking, e-TDS working export. Builds on existing TDS data; no HR needed. | 2 wks |
| **S1 — Staff + attendance** | employee master, shifts/holidays, web/QR clock-in, daily status, corrections, registers (docs/13 A1) | 3 wks |
| **S2 — Leave, overtime, timesheets** | docs/13 A2 | 3 wks |
| **S3 — Salary & payslips** | structures, pay runs, SSF/PF, TDS-on-remuneration with slab tables, advances, payslips, journal posting, bank batch | 4 wks |
| **S4 — Employee TDS certificates & year-end** | annual/exit remuneration certificates, SSF statement, gratuity accrual, final settlement | 2 wks |
Each phase ends with tests, an acceptance checklist, and a phase report; one phase at a time.

## 10. Acceptance checks (headline)
- [ ] Payment with TDS → certificate numbers are gapless, cancel keeps the number, copy counter increments, "deposit pending" until deposit recorded.
- [ ] TDS register totals equal TDS Payable / Receivable ledger balances for the same period.
- [ ] Pay run journal balances, posts only after checker approval, locks the attendance period, and net pay + deductions = gross.
- [ ] Changing a salary mid-month pro-rates correctly; a back-dated raise creates an arrears line, not an edit of a posted run.
- [ ] Employee sees only own payslips; salary hidden from users without `employee.view_salary`; cross-company isolation on every new table.
- [ ] Annual remuneration certificate equals the sum of that employee's posted pay runs.

## 11. Open questions for the owner
1. Which of your companies will run payroll first, how many staff, and is SSF mandatory for them?
2. Do you want T1 (TDS register + supplier certificates) first because it needs no HR data? (recommended)
3. Please send, or ask your accountant for, the **current IRD TDS certificate format** and the current **remuneration TDS slab table** so they can be loaded as data.
4. Bank payment file format needed (which Nepali bank)?
5. Pay month in Nepal: BS calendar month (default) or fixed 30 days?
6. Should employees have their own login (payslip + attendance), priced per employee later?
