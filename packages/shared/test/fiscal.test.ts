/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { describe, it, expect } from 'vitest';
import { nepalFiscalYear, adFiscalYear, fiscalYearContaining, validateFiscalYear, defaultFySettings } from '../src';

describe('fiscal years', () => {
  it('Nepal FY 2083/84 = Shrawan 1 2083 to Ashadh end 2084 with 12 BS-month periods', () => {
    const fy = nepalFiscalYear(2083);
    expect(fy.label).toBe('2083/84');
    expect(fy.startDate).toBe('2026-07-17');
    expect(fy.periods).toHaveLength(12);
    expect(fy.periods[0].name).toBe('Shrawan 2083');
    expect(fy.periods[2].name).toBe('Ashwin 2083');
    expect(fy.periods[2].startDate).toBe('2026-09-17');
    expect(fy.periods[2].endDate).toBe('2026-10-17');
    expect(fy.periods[11].name).toBe('Ashadh 2084');
    validateFiscalYear(fy);
  });

  it('Nepal FY 2082/83 ends on Ashadh 32, 2083 (16 Jul 2026)', () => {
    const fy = nepalFiscalYear(2082);
    expect(fy.startDate).toBe('2025-07-17');
    expect(fy.endDate).toBe('2026-07-16');
  });

  it('consecutive Nepal FYs are contiguous for 2001–2098', () => {
    for (let y = 2001; y < 2099; y++) {
      const a = nepalFiscalYear(y);
      const b = nepalFiscalYear(y + 1);
      validateFiscalYear(a);
      const next = new Date(Date.parse(a.endDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
      expect(b.startDate).toBe(next);
    }
  });

  it('Australian FY2026-27 = 1 Jul 2026 – 30 Jun 2027', () => {
    const fy = adFiscalYear(2026, 7);
    expect(fy.label).toBe('FY2026-27');
    expect(fy.startDate).toBe('2026-07-01');
    expect(fy.endDate).toBe('2027-06-30');
    expect(fy.periods[7].endDate).toBe('2027-02-28');
    validateFiscalYear(fy);
  });

  it('adjustment period 13 is optional', () => {
    const fy = nepalFiscalYear(2083, true);
    expect(fy.periods).toHaveLength(13);
    expect(fy.periods[12].isAdjustment).toBe(true);
  });

  it('finds FY containing a date', () => {
    expect(fiscalYearContaining('2026-10-07', defaultFySettings('NP')).label).toBe('2083/84');
    expect(fiscalYearContaining('2026-07-10', defaultFySettings('NP')).label).toBe('2082/83');
    expect(fiscalYearContaining('2026-10-07', defaultFySettings('AU')).label).toBe('FY2026-27');
    expect(fiscalYearContaining('2026-03-07', defaultFySettings('AU')).label).toBe('FY2025-26');
    expect(fiscalYearContaining('2026-03-07', defaultFySettings('OTHER')).label).toBe('FY2026');
  });
});
