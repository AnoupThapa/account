/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { AppError } from './errors';
import { d, money, round2, DecInput } from './money';

/**
 * Payslip / staff TDS certificate arithmetic (docs/15 §12.2) — one place, used by API and web:
 *   gross pay        = basic + allowance + other allowance
 *   total deductions = TDS + SSF (employee) + other deductions
 *   net pay (total receivable) = gross − total deductions
 * SSF employer contribution is an employer cost: shown, never deducted from the staff member's pay.
 */
export interface PayInput {
  basicSalary: DecInput;
  allowance: DecInput;
  otherAllowance: DecInput;
  tdsAmount: DecInput;
  ssfEmployee: DecInput;
  ssfEmployer: DecInput;
  otherDeductions: DecInput;
}

export interface PayResult {
  grossPay: string;
  totalDeductions: string;
  netPay: string;
}

export function calcPay(i: PayInput): PayResult {
  for (const [k, v] of Object.entries(i)) if (d(v).isNeg()) throw new AppError('VAL_FIELD', `${k} cannot be negative`, undefined, [{ field: k, message: 'Cannot be negative' }]);
  const gross = d(i.basicSalary).plus(i.allowance).plus(i.otherAllowance);
  const ded = d(i.tdsAmount).plus(i.ssfEmployee).plus(i.otherDeductions);
  const net = gross.minus(ded);
  if (net.isNeg()) throw new AppError('VAL_FIELD', 'Deductions are more than the gross pay', undefined, [{ field: 'tdsAmount', message: 'Deductions exceed gross pay' }]);
  return { grossPay: money(gross), totalDeductions: money(ded), netPay: money(net) };
}

/** SSF contribution = basic × percent, rounded to 2 dp. */
export function ssfOf(basic: DecInput, pct: DecInput): string {
  return money(round2(d(basic).times(pct).div(100)));
}
