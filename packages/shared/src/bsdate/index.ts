/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { BS_EPOCH_AD, BS_MAX_YEAR, BS_MIN_YEAR, BS_MONTH_DAYS, BS_PROVISIONAL_FROM } from './data';
import { AppError } from '../errors';

export { BS_MIN_YEAR, BS_MAX_YEAR, BS_PROVISIONAL_FROM, BS_MONTH_DAYS };

export interface BsDate {
  year: number;
  month: number; // 1 = Baishakh … 12 = Chaitra
  day: number;
}

export const BS_MONTHS_EN = [
  'Baishakh',
  'Jestha',
  'Ashadh',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const;

export const BS_MONTHS_NP = [
  'बैशाख',
  'जेठ',
  'असार',
  'साउन',
  'भदौ',
  'असोज',
  'कार्तिक',
  'मंसिर',
  'पुष',
  'माघ',
  'फागुन',
  'चैत',
] as const;

const AD_MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MS_PER_DAY = 86_400_000;

/** Optional override table (e.g. loaded from the bs_calendar DB table after admin verification). */
let monthDays: Record<number, readonly number[]> = BS_MONTH_DAYS;
let yearStartDayIndex: Map<number, number> = buildIndex(monthDays);

function buildIndex(table: Record<number, readonly number[]>): Map<number, number> {
  const idx = new Map<number, number>();
  let acc = 0;
  for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR; y++) {
    idx.set(y, acc);
    const row = table[y];
    if (!row || row.length !== 12) throw new Error(`BS calendar data missing for ${y}`);
    for (const d of row) {
      if (d < 29 || d > 32) throw new Error(`Invalid BS month length ${d} in ${y}`);
      acc += d;
    }
  }
  idx.set(BS_MAX_YEAR + 1, acc);
  return idx;
}

/** Replace the calendar table (used when the DB bs_calendar has admin-verified corrections). */
export function setBsCalendar(table: Record<number, readonly number[]>): void {
  const idx = buildIndex(table);
  monthDays = table;
  yearStartDayIndex = idx;
}

export function getBsCalendar(): Record<number, readonly number[]> {
  return monthDays;
}

const EPOCH_MS = Date.parse(BS_EPOCH_AD + 'T00:00:00Z');

function adToDayIndex(ad: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ad)) throw new AppError('VAL_FIELD', `Invalid AD date "${ad}" (use YYYY-MM-DD)`);
  const ms = Date.parse(ad + 'T00:00:00Z');
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== ad) {
    throw new AppError('VAL_FIELD', `Invalid AD date "${ad}"`);
  }
  return Math.round((ms - EPOCH_MS) / MS_PER_DAY);
}

function dayIndexToAd(idx: number): string {
  return new Date(EPOCH_MS + idx * MS_PER_DAY).toISOString().slice(0, 10);
}

export function daysInBsMonth(year: number, month: number): number {
  if (year < BS_MIN_YEAR || year > BS_MAX_YEAR) {
    throw new AppError('VAL_DATE_OUT_OF_RANGE', `BS year ${year} is outside the supported range ${BS_MIN_YEAR}–${BS_MAX_YEAR}`);
  }
  if (month < 1 || month > 12) throw new AppError('VAL_FIELD', `BS month must be 1–12 (got ${month})`);
  return monthDays[year][month - 1];
}

export function isProvisionalBsYear(year: number): boolean {
  return year >= BS_PROVISIONAL_FROM;
}

/** AD (YYYY-MM-DD) → BS. Throws VAL_DATE_OUT_OF_RANGE outside the table. */
export function toBS(ad: string): BsDate {
  let rem = adToDayIndex(ad);
  const total = yearStartDayIndex.get(BS_MAX_YEAR + 1)!;
  if (rem < 0 || rem >= total) {
    throw new AppError('VAL_DATE_OUT_OF_RANGE', `Date ${ad} is outside the supported BS calendar range`);
  }
  // binary search the year
  let lo = BS_MIN_YEAR;
  let hi = BS_MAX_YEAR;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (yearStartDayIndex.get(mid)! <= rem) lo = mid;
    else hi = mid - 1;
  }
  const year = lo;
  rem -= yearStartDayIndex.get(year)!;
  const row = monthDays[year];
  let month = 0;
  while (rem >= row[month]) {
    rem -= row[month];
    month++;
  }
  return { year, month: month + 1, day: rem + 1 };
}

/** BS → AD (YYYY-MM-DD). Throws VAL_BS_INVALID_DAY for e.g. day 32 in a 31-day month. */
export function toAD(year: number, month: number, day: number): string {
  const dim = daysInBsMonth(year, month);
  if (!Number.isInteger(day) || day < 1 || day > dim) {
    throw new AppError('VAL_BS_INVALID_DAY', `${BS_MONTHS_EN[month - 1]} ${year} has only ${dim} days`, {
      days: dim,
    });
  }
  let idx = yearStartDayIndex.get(year)!;
  const row = monthDays[year];
  for (let m = 0; m < month - 1; m++) idx += row[m];
  idx += day - 1;
  return dayIndexToAd(idx);
}

export function parseBs(text: string): BsDate {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text.trim());
  if (!m) throw new AppError('VAL_FIELD', `Invalid BS date "${text}" (use YYYY-MM-DD)`);
  const bs = { year: +m[1], month: +m[2], day: +m[3] };
  toAD(bs.year, bs.month, bs.day); // validates
  return bs;
}

export function bsToAdString(text: string): string {
  const bs = parseBs(text);
  return toAD(bs.year, bs.month, bs.day);
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function formatBs(bs: BsDate): string {
  return `${bs.year}-${pad(bs.month)}-${pad(bs.day)}`;
}

export function formatBsLong(bs: BsDate): string {
  return `${BS_MONTHS_EN[bs.month - 1]} ${bs.day}, ${bs.year}`;
}

export function formatAdLong(ad: string): string {
  const [y, m, d] = ad.split('-').map(Number);
  return `${pad(d)} ${AD_MONTHS_SHORT[m - 1]} ${y}`;
}

/**
 * Dual display used everywhere, e.g. "2083-06-16 BS (02 Oct 2026)".
 * primary = 'BS' → BS first; 'AD' → "02 Oct 2026 (2083-06-16 BS)".
 * Dates outside the BS table fall back to AD only.
 */
export function formatDual(ad: string, primary: 'BS' | 'AD' = 'BS'): string {
  let bsText: string | null = null;
  try {
    bsText = formatBs(toBS(ad)) + ' BS';
  } catch {
    bsText = null;
  }
  const adText = formatAdLong(ad);
  if (!bsText) return adText;
  return primary === 'BS' ? `${bsText} (${adText})` : `${adText} (${bsText})`;
}

/** AD date arithmetic helpers (aging, due dates use AD day counts). */
export function addDays(ad: string, days: number): string {
  return dayIndexToAd(adToDayIndex(ad) + days);
}

export function diffDays(fromAd: string, toAd: string): number {
  return adToDayIndex(toAd) - adToDayIndex(fromAd);
}

export function todayAd(timeZone = 'Asia/Kathmandu'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}
