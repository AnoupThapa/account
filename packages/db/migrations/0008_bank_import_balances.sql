/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
-- Bank statements usually print the period and the opening / closing balance; keep them so the
-- "Finish reconciliation" screen can pre-fill the closing balance and date (docs/16).
ALTER TABLE bank_statement_imports
  ADD COLUMN period_from      date,
  ADD COLUMN period_to        date,
  ADD COLUMN opening_balance  numeric(18,2),
  ADD COLUMN closing_balance  numeric(18,2);
