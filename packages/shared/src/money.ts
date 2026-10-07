/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import Decimal from 'decimal.js';

/**
 * Money helpers. NEVER use JS floating point for amounts.
 * Amounts: 2 dp (NUMERIC(18,2)); quantities & rates: 4 dp; FX rates: 6 dp.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;
export type DecInput = Decimal.Value;

export const ZERO = new Dec(0);

export function d(v: DecInput | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new Dec(0);
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Invalid amount');
  return new Dec(v);
}

/** Round to 2 dp (half-up, i.e. commercial rounding). */
export function round2(v: DecInput): Decimal {
  return d(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function round4(v: DecInput): Decimal {
  return d(v).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function sum(values: DecInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), new Dec(0));
}

/** Canonical string for API/DB transport: always 2 dp, e.g. "1234.50". */
export function money(v: DecInput): string {
  return round2(v).toFixed(2);
}

export function qty(v: DecInput): string {
  return round4(v).toFixed(4);
}

export function eq(a: DecInput, b: DecInput): boolean {
  return d(a).eq(d(b));
}

export function isZero(v: DecInput): boolean {
  return d(v).isZero();
}

/** Display formatting. NPR uses lakh/crore grouping (12,34,567.00); others use thousands. */
export function formatMoney(v: DecInput, currency = 'NPR', withSymbol = false): string {
  const n = round2(v);
  const neg = n.isNeg();
  const [intPart, frac] = n.abs().toFixed(2).split('.');
  let grouped: string;
  if (currency === 'NPR' || currency === 'INR') {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
  } else {
    grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  const sym = withSymbol ? (currency === 'NPR' ? 'Rs. ' : currency === 'AUD' ? 'A$' : currency + ' ') : '';
  return `${neg ? '-' : ''}${sym}${grouped}.${frac}`;
}
