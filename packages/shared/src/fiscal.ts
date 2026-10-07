/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { BS_MONTHS_EN, daysInBsMonth, toAD, toBS, addDays } from './bsdate';
import { AppError } from './errors';

export type Country = 'NP' | 'AU' | 'OTHER';
export type CalendarMode = 'BS' | 'AD';

export interface PeriodDef {
  periodNo: number; // 1–12, 13 = adjustment
  name: string;
  startDate: string; // AD
  endDate: string; // AD
  isAdjustment: boolean;
}

export interface FiscalYearDef {
  label: string;
  startDate: string;
  endDate: string;
  periods: PeriodDef[];
}

const AD_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function lastDayOfAdMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based → day 0 of next month
}
const p2 = (n: number) => String(n).padStart(2, '0');

/**
 * Nepal FY: Shrawan 1 of BS year `bsStartYear` to the last day of Ashadh of `bsStartYear + 1`.
 * Label "2083/84". Periods follow BS months Shrawan … Ashadh.
 */
export function nepalFiscalYear(bsStartYear: number, withAdjustment = false): FiscalYearDef {
  const periods: PeriodDef[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = ((3 + i) % 12) + 1; // Shrawan = 4
    const year = monthIdx >= 4 ? bsStartYear : bsStartYear + 1;
    const start = toAD(year, monthIdx, 1);
    const end = toAD(year, monthIdx, daysInBsMonth(year, monthIdx));
    periods.push({ periodNo: i + 1, name: `${BS_MONTHS_EN[monthIdx - 1]} ${year}`, startDate: start, endDate: end, isAdjustment: false });
  }
  const startDate = periods[0].startDate;
  const endDate = periods[11].endDate;
  if (withAdjustment) {
    periods.push({ periodNo: 13, name: `Adjustment ${bsStartYear}/${String(bsStartYear + 1).slice(-2)}`, startDate: endDate, endDate, isAdjustment: true });
  }
  return { label: `${bsStartYear}/${String(bsStartYear + 1).slice(-2)}`, startDate, endDate, periods };
}

/**
 * AD-based FY starting on the 1st of `startMonth` (1–12) of `startYear`.
 * Australia: startMonth 7 → "FY2026-27". Calendar-year FY (startMonth 1) → "FY2026".
 */
export function adFiscalYear(startYear: number, startMonth: number, withAdjustment = false): FiscalYearDef {
  if (startMonth < 1 || startMonth > 12) throw new AppError('VAL_FIELD', 'FY start month must be 1–12');
  const periods: PeriodDef[] = [];
  for (let i = 0; i < 12; i++) {
    const m0 = startMonth - 1 + i;
    const y = startYear + Math.floor(m0 / 12);
    const m = (m0 % 12) + 1;
    periods.push({
      periodNo: i + 1,
      name: `${AD_MONTHS[m - 1]} ${y}`,
      startDate: `${y}-${p2(m)}-01`,
      endDate: `${y}-${p2(m)}-${p2(lastDayOfAdMonth(y, m))}`,
      isAdjustment: false,
    });
  }
  const startDate = periods[0].startDate;
  const endDate = periods[11].endDate;
  if (withAdjustment) {
    periods.push({ periodNo: 13, name: `Adjustment FY${startYear}`, startDate: endDate, endDate, isAdjustment: true });
  }
  const label = startMonth === 1 ? `FY${startYear}` : `FY${startYear}-${String(startYear + 1).slice(-2)}`;
  return { label, startDate, endDate, periods };
}

/** BS-based FY for "Other" countries that choose a BS start month. */
export function bsFiscalYear(bsStartYear: number, bsStartMonth: number, withAdjustment = false): FiscalYearDef {
  if (bsStartMonth === 4) return nepalFiscalYear(bsStartYear, withAdjustment);
  const periods: PeriodDef[] = [];
  for (let i = 0; i < 12; i++) {
    const m0 = bsStartMonth - 1 + i;
    const year = bsStartYear + Math.floor(m0 / 12);
    const month = (m0 % 12) + 1;
    periods.push({
      periodNo: i + 1,
      name: `${BS_MONTHS_EN[month - 1]} ${year}`,
      startDate: toAD(year, month, 1),
      endDate: toAD(year, month, daysInBsMonth(year, month)),
      isAdjustment: false,
    });
  }
  const startDate = periods[0].startDate;
  const endDate = periods[11].endDate;
  if (withAdjustment) periods.push({ periodNo: 13, name: `Adjustment ${bsStartYear}`, startDate: endDate, endDate, isAdjustment: true });
  return { label: `${bsStartYear}/${String(bsStartYear + 1).slice(-2)}`, startDate, endDate, periods };
}

export interface FySettings {
  country: Country;
  calendarMode: CalendarMode;
  fyStartMonth: number; // BS month (1–12) when calendarMode=BS, AD month otherwise
}

export function defaultFySettings(country: Country): FySettings {
  if (country === 'NP') return { country, calendarMode: 'BS', fyStartMonth: 4 };
  if (country === 'AU') return { country, calendarMode: 'AD', fyStartMonth: 7 };
  return { country, calendarMode: 'AD', fyStartMonth: 1 };
}

/** Build the FY that contains `adDate` for the given settings. */
export function fiscalYearContaining(adDate: string, s: FySettings, withAdjustment = false): FiscalYearDef {
  if (s.calendarMode === 'BS') {
    const bs = toBS(adDate);
    const startYear = bs.month >= s.fyStartMonth ? bs.year : bs.year - 1;
    return bsFiscalYear(startYear, s.fyStartMonth, withAdjustment);
  }
  const [y, m] = adDate.split('-').map(Number);
  const startYear = m >= s.fyStartMonth ? y : y - 1;
  return adFiscalYear(startYear, s.fyStartMonth, withAdjustment);
}

/** Sanity check used in tests and at FY creation: periods contiguous and cover the year. */
export function validateFiscalYear(fy: FiscalYearDef): void {
  const regular = fy.periods.filter((p) => !p.isAdjustment);
  if (regular.length !== 12) throw new Error('FY must have 12 regular periods');
  if (regular[0].startDate !== fy.startDate || regular[11].endDate !== fy.endDate) throw new Error('FY bounds mismatch');
  for (let i = 1; i < 12; i++) {
    if (addDays(regular[i - 1].endDate, 1) !== regular[i].startDate) throw new Error(`Gap before period ${i + 1}`);
  }
}
