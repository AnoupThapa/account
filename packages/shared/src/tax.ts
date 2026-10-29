/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import Decimal from 'decimal.js';
import { d, round2, sum, money, DecInput } from './money';

/**
 * Tax (VAT/GST) line calculation — docs/02 §4.
 * - Prices may be tax-exclusive or tax-inclusive (per document).
 * - Tax computed per line and rounded per line (default) or per invoice.
 * - EXEMPT / ZERO_RATED / OUT_OF_SCOPE lines carry 0 tax but are reported separately
 *   (exempt_total vs taxable_total) for the IRD-style Sales/Purchase Books.
 */
export type TaxType = 'STANDARD' | 'ZERO_RATED' | 'EXEMPT' | 'OUT_OF_SCOPE' | 'REVERSE_CHARGE';
export type RoundingMode = 'LINE' | 'DOCUMENT';

export interface TaxLineInput {
  quantity: DecInput;
  unitPrice: DecInput;
  discountPercent?: DecInput; // 0–100
  discountAmount?: DecInput; // absolute, applied after percent
  taxType: TaxType;
  taxRate: DecInput; // percent, e.g. 13 for 13%
  /**
   * Group tax (CGST+SGST, GST+PST …): when present (and taxType is STANDARD) the line is taxed by each component.
   * Parallel components are charged on the net amount; a stacked component is charged on net + earlier components.
   * `taxRate` is ignored in that case.
   */
  components?: { rate: DecInput; stacked?: boolean }[];
}

export interface TaxLineResult {
  gross: string; // qty × price (as entered, may include tax)
  discount: string; // discount as entered (same basis as price)
  net: string; // amount EXCLUDING tax after discount
  tax: string;
  total: string; // net + tax
  componentTax: string[]; // tax per component, in order (one entry for a plain tax code); sums to `tax`
  taxable: string; // net if STANDARD (incl. 0% standard), else 0
  zeroRated: string;
  exempt: string; // EXEMPT + OUT_OF_SCOPE net amounts
}

export interface TaxDocResult {
  lines: TaxLineResult[];
  subtotal: string; // sum of net (excl tax)
  discountTotal: string;
  taxableTotal: string;
  zeroRatedTotal: string;
  exemptTotal: string;
  taxTotal: string;
  grandTotal: string;
  roundingAdjustment: string; // per-document rounding only
}

function lineRaw(l: TaxLineInput, inclusive: boolean) {
  const q = d(l.quantity);
  const p = d(l.unitPrice);
  if (q.isNeg() || p.isNeg()) throw new Error('Quantity and price must not be negative');
  const gross = q.times(p);
  const pct = d(l.discountPercent ?? 0);
  if (pct.isNeg() || pct.gt(100)) throw new Error('Discount percent must be 0–100');
  const disc = gross.times(pct).div(100).plus(d(l.discountAmount ?? 0));
  if (disc.gt(gross)) throw new Error('Discount exceeds line amount');
  const afterDisc = gross.minus(disc);
  const comps = l.taxType === 'STANDARD' && l.components?.length ? l.components.map((c) => ({ rate: d(c.rate), stacked: !!c.stacked })) : null;
  if (comps && comps.some((c) => c.rate.isNeg() || c.rate.gt(100))) throw new Error('Tax rate must be 0–100');
  const parts = comps ?? [{ rate: l.taxType === 'STANDARD' ? d(l.taxRate) : d(0), stacked: false }];
  // effective rate of the whole group (tax on a base of 1)
  let running = d(0);
  for (const c of parts) running = running.plus(d(1).plus(c.stacked ? running : 0).times(c.rate).div(100));
  const rate = running.times(100);
  // net (exclusive of tax), unrounded
  const netRaw = inclusive && rate.gt(0) ? afterDisc.div(running.plus(1)) : afterDisc;
  return { gross, disc, afterDisc, rate, netRaw, parts };
}

/** Tax per component on a given net, each rounded to 2 dp (stacked components see the rounded earlier ones). */
function componentAmounts(net: Decimal, parts: { rate: Decimal; stacked: boolean }[]) {
  const out: Decimal[] = [];
  let running = d(0);
  for (const c of parts) {
    const t = round2(net.plus(c.stacked ? running : 0).times(c.rate).div(100));
    out.push(t);
    running = running.plus(t);
  }
  return out;
}

export function calculateTax(
  lines: TaxLineInput[],
  opts: { pricesIncludeTax: boolean; rounding?: RoundingMode },
): TaxDocResult {
  const rounding = opts.rounding ?? 'LINE';
  const inclusive = opts.pricesIncludeTax;
  const results: TaxLineResult[] = [];
  const rawTaxes: Decimal[] = [];

  for (const l of lines) {
    const { gross, disc, afterDisc, rate, netRaw, parts } = lineRaw(l, inclusive);
    let net: Decimal;
    let tax: Decimal;
    let comp: Decimal[];
    if (inclusive) {
      // total is fixed by the price entered; tax is carved out of it
      const total = round2(afterDisc);
      tax = rate.gt(0) ? round2(total.minus(netRaw)) : d(0);
      rawTaxes.push(afterDisc.minus(netRaw));
      net = total.minus(tax);
      // split the carved-out tax across components; any rounding residue goes to the largest component
      comp = componentAmounts(netRaw, parts);
      const resid = tax.minus(sum(comp));
      if (!resid.isZero() && comp.length) {
        let k = 0;
        comp.forEach((c, i) => { if (c.gt(comp[k])) k = i; });
        comp[k] = comp[k].plus(resid);
      }
    } else {
      net = round2(netRaw);
      comp = componentAmounts(net, parts);
      const t = sum(comp.length ? comp : [d(0)]);
      rawTaxes.push(parts.length === 1 ? net.times(rate).div(100) : t);
      tax = t;
    }
    const isStd = l.taxType === 'STANDARD' || l.taxType === 'REVERSE_CHARGE';
    results.push({
      gross: money(gross),
      discount: money(disc),
      net: money(net),
      tax: money(tax),
      total: money(net.plus(tax)),
      componentTax: comp.map((c) => money(c)),
      taxable: money(isStd ? net : 0),
      zeroRated: money(l.taxType === 'ZERO_RATED' ? net : 0),
      exempt: money(l.taxType === 'EXEMPT' || l.taxType === 'OUT_OF_SCOPE' ? net : 0),
    });
  }

  let taxTotal = sum(results.map((r) => r.tax));
  let roundingAdjustment = d(0);
  if (rounding === 'DOCUMENT') {
    const docTax = round2(sum(rawTaxes));
    roundingAdjustment = docTax.minus(taxTotal);
    taxTotal = docTax;
  }
  const subtotal = sum(results.map((r) => r.net));
  const grand = inclusive
    ? sum(results.map((r) => r.total)) // inclusive: customer pays exactly what was entered
    : subtotal.plus(taxTotal);
  // for inclusive + DOCUMENT rounding, any tax shift moves net (subtotal) so the grand total holds
  const subtotalAdj = inclusive ? grand.minus(taxTotal) : subtotal;

  return {
    lines: results,
    subtotal: money(subtotalAdj),
    discountTotal: money(sum(results.map((r) => r.discount))),
    taxableTotal: money(sum(results.map((r) => r.taxable))),
    zeroRatedTotal: money(sum(results.map((r) => r.zeroRated))),
    exemptTotal: money(sum(results.map((r) => r.exempt))),
    taxTotal: money(taxTotal),
    grandTotal: money(grand),
    roundingAdjustment: money(roundingAdjustment),
  };
}
