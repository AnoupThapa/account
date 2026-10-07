import { describe, it, expect } from 'vitest';
import refs from './bs-reference.json';
import { toBS, toAD, formatBs, formatDual, daysInBsMonth, BS_MONTH_DAYS, AppError, addDays } from '../src';

const KNOWN: [string, string][] = [
  ['1943-04-14', '2000-01-01'], // epoch
  ['2023-04-14', '2080-01-01'],
  ['2024-04-13', '2081-01-01'],
  ['2025-04-14', '2082-01-01'],
  ['2026-04-14', '2083-01-01'],
  ['2026-07-17', '2083-04-01'], // Shrawan 1, 2083 (spec docs/03)
  ['2026-10-02', '2083-06-16'], // spec example
  ['2026-10-17', '2083-06-31'], // Ashwin 31, 2083 (spec)
  ['2025-07-17', '2082-04-01'], // FY 2082/83 start
  ['2026-07-16', '2083-03-32'], // FY 2082/83 end (Ashadh 32)
];

describe('BS ↔ AD conversion', () => {
  it(`has ${refs.length + KNOWN.length} reference dates (spec requires 200+)`, () => {
    expect(refs.length + KNOWN.length).toBeGreaterThanOrEqual(200);
  });

  it.each([...KNOWN, ...(refs as [string, string][])])('AD %s ⇄ BS %s', (ad, bs) => {
    expect(formatBs(toBS(ad))).toBe(bs);
    const [y, m, d] = bs.split('-').map(Number);
    expect(toAD(y, m, d)).toBe(ad);
  });

  it('round-trips every day 2000–2100 BS', () => {
    let ad = '1943-04-14';
    for (let y = 2000; y <= 2100; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= daysInBsMonth(y, m); d++) {
          expect(toAD(y, m, d)).toBe(ad);
          ad = addDays(ad, 1);
        }
      }
    }
  });

  it('table has 12 months with 29–32 days for every year', () => {
    for (let y = 2000; y <= 2100; y++) {
      expect(BS_MONTH_DAYS[y]).toHaveLength(12);
      for (const d of BS_MONTH_DAYS[y]) expect(d >= 29 && d <= 32).toBe(true);
    }
  });

  it('rejects invalid BS day with VAL_BS_INVALID_DAY', () => {
    // Shrawan 2083 has 31 days
    expect(daysInBsMonth(2083, 4)).toBe(31);
    try {
      toAD(2083, 4, 32);
      throw new Error('should fail');
    } catch (e) {
      expect((e as AppError).code).toBe('VAL_BS_INVALID_DAY');
    }
  });

  it('rejects out-of-range dates with VAL_DATE_OUT_OF_RANGE', () => {
    expect(() => toBS('1900-01-01')).toThrowError(AppError);
    try {
      toAD(1999, 1, 1);
    } catch (e) {
      expect((e as AppError).code).toBe('VAL_DATE_OUT_OF_RANGE');
    }
  });

  it('rejects malformed AD date', () => {
    expect(() => toBS('2026-02-30')).toThrow();
  });

  it('formats dual dates', () => {
    expect(formatDual('2026-10-02')).toBe('2083-06-16 BS (02 Oct 2026)');
    expect(formatDual('2026-10-02', 'AD')).toBe('02 Oct 2026 (2083-06-16 BS)');
  });
});
