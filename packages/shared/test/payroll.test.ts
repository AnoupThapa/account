/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { describe, expect, it } from 'vitest';
import { calcPay, ssfOf, localParts, zonedToUtc, statusAtClockIn, statusAtClockOut } from '../src';

const base = { basicSalary: '50000', allowance: '5000', otherAllowance: '2500', tdsAmount: '1200', ssfEmployee: '5500', ssfEmployer: '10000', otherDeductions: '300' };

describe('payslip arithmetic', () => {
  it('gross, deductions and net; employer SSF is not deducted', () => {
    expect(calcPay(base)).toEqual({ grossPay: '57500.00', totalDeductions: '7000.00', netPay: '50500.00' });
  });
  it('refuses deductions larger than gross pay and negative amounts', () => {
    expect(() => calcPay({ ...base, otherDeductions: '60000' })).toThrow(/more than the gross/);
    expect(() => calcPay({ ...base, tdsAmount: '-1' })).toThrow(/negative/);
  });
  it('SSF = basic × % rounded to 2 dp', () => {
    expect(ssfOf('50000', '11')).toBe('5500.00');
    expect(ssfOf('33333.33', '20')).toBe('6666.67');
  });
});

describe('attendance time zones and status rules', () => {
  it('Nepal (UTC+5:45): 04:15 UTC is 10:00 local; date rolls over correctly', () => {
    const p = localParts(new Date('2026-10-28T04:15:00Z'), 'Asia/Kathmandu');
    expect(p).toMatchObject({ date: '2026-10-28', minutes: 600, dow: 3 });
    expect(localParts(new Date('2026-10-28T19:00:00Z'), 'Asia/Kathmandu').date).toBe('2026-10-29');
  });
  it('local wall-clock to UTC, including Australian daylight saving', () => {
    expect(zonedToUtc('2026-10-28', '10:00', 'Asia/Kathmandu').toISOString()).toBe('2026-10-28T04:15:00.000Z');
    expect(zonedToUtc('2026-10-28', '09:00', 'Australia/Sydney').toISOString()).toBe('2026-10-27T22:00:00.000Z'); // AEDT +11
    expect(zonedToUtc('2026-06-15', '09:00', 'Australia/Sydney').toISOString()).toBe('2026-06-14T23:00:00.000Z'); // AEST +10
  });
  it('late after start + grace; half day under the threshold', () => {
    const r = { workStart: '10:00', graceMinutes: 15, halfDayMinutes: 240 };
    expect(statusAtClockIn(615, r)).toBe('PRESENT');
    expect(statusAtClockIn(616, r)).toBe('LATE');
    expect(statusAtClockOut('LATE', 200, r)).toBe('HALF_DAY');
    expect(statusAtClockOut('PRESENT', 480, r)).toBe('PRESENT');
    expect(statusAtClockOut('LEAVE', 10, r)).toBe('LEAVE');
  });
});
