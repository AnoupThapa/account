# 08 — Projects & Task Monitoring

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. Do not copy or share without written permission. See [LICENSE](../LICENSE).

## 1. Objects
- **Project:** code, name, client (optional contact), manager, members, start/end (BS/AD), budget (amount and/or hours), status (`PLANNED`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `CANCELLED`), linked cost centre.
- **Milestone:** name, due date, % weight, linked billing (optional invoice on completion).
- **Task:** title, description, project/milestone, assignees, priority, status (`TODO`, `IN_PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`), start/due dates, estimate hours, checklist, dependencies (finish-to-start), recurring rule, attachments, comments with @mentions.
- **Time log:** user, task, date, hours, billable flag, rate.

## 2. Views
Kanban board, list/table, **Gantt schedule** (drag to reschedule, dependencies, critical path highlight), calendar (BS/AD), "My tasks", workload by person.

## 3. Finance link
- Every income/expense line can carry a project → **Project P&L** (revenue, direct costs, time cost, margin vs budget).
- Budget vs actual alerts at 80% / 100%.

## 4. Accounting compliance calendar (built-in template)
Recurring tasks auto-generated each period and assigned to roles, e.g.: bank reconciliation per account, VAT/GST working, TDS working, payroll journal, depreciation run, month-end close checklist, year-end close. Due-date rules are admin-configurable (statutory deadlines change; admin confirms current dates).

## 5. Progress & Drive
- Weekly (configurable) progress report per project: % complete (by milestone weight or tasks done), overdue tasks, hours vs estimate, budget vs actual → generated as PDF/Google Sheet and saved to `Projects/<Project>/` in Drive.
- Notifications: assigned, due tomorrow, overdue, mentioned, status changed.
