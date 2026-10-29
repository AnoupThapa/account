/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Company-time-zone helpers for attendance (docs/13 §4: stored as UTC instants, judged in the company's zone). */
export interface LocalParts {
  date: string; // YYYY-MM-DD in the zone
  minutes: number; // minutes since local midnight
  dow: number; // 0 = Sunday … 6 = Saturday
}

function parts(at: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(at)) o[p.type] = p.value;
  return { y: Number(o.year), m: Number(o.month), d: Number(o.day), h: Number(o.hour), mi: Number(o.minute), s: Number(o.second) };
}

export function localParts(at: Date, tz: string): LocalParts {
  const p = parts(at, tz);
  const date = `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  return { date, minutes: p.h * 60 + p.mi, dow: new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() };
}

/** Offset (ms) of `tz` from UTC at the instant `at`. */
function offsetMs(at: Date, tz: string): number {
  const p = parts(at, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant at which the wall clock in `tz` reads `date` `HH:MM`. */
export function zonedToUtc(date: string, hhmm: string, tz: string): Date {
  const [y, m, dd] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, dd, h, mi);
  let t = guess - offsetMs(new Date(guess), tz);
  t = guess - offsetMs(new Date(t), tz); // second pass settles DST edges
  return new Date(t);
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export interface AttendanceRules {
  workStart: string; // HH:MM
  graceMinutes: number;
  halfDayMinutes: number;
}

/** Status at clock-in: late when later than start + grace. */
export function statusAtClockIn(localMinutes: number, r: AttendanceRules): 'PRESENT' | 'LATE' {
  return localMinutes > hhmmToMinutes(r.workStart) + r.graceMinutes ? 'LATE' : 'PRESENT';
}

/** Status after clock-out: worked less than the half-day threshold → HALF_DAY, otherwise keep the clock-in status. */
export function statusAtClockOut(current: string, workedMinutes: number, r: AttendanceRules): string {
  return workedMinutes < r.halfDayMinutes && ['PRESENT', 'LATE'].includes(current) ? 'HALF_DAY' : current;
}
