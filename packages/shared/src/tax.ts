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
}

export interface TaxLineResult {
  gross: string; // qty × price (as entered, may include tax)
  discount: string; // discount as entered (same basis as price)
  net: string; // amount EXCLUDING tax after discount
  tax: string;
  total: string; // net + tax
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
  const rate = l.taxType === 'STANDARD' ? d(l.taxRate) : d(0);
  // net (exclusive of tax), unrounded
  const netRaw = inclusive && rate.gt(0) ? afterDisc.div(rate.div(100).plus(1)) : afterDisc;
  return { gross, disc, afterDisc, rate, netRaw };
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
    const { gross, disc, afterDisc, rate, netRaw } = lineRaw(l, inclusive);
    let net: Decimal;
    let tax: Decimal;
    if (inclusive) {
      // total is fixed by the price entered; tax is carved out of it
      const total = round2(afterDisc);
      tax = rate.gt(0) ? round2(total.minus(netRaw)) : d(0);
      rawTaxes.push(afterDisc.minus(netRaw));
      net = total.minus(tax);
    } else {
      net = round2(netRaw);
      const t = net.times(rate).div(100);
      rawTaxes.push(t);
      tax = round2(t);
    }
    const isStd = l.taxType === 'STANDARD' || l.taxType === 'REVERSE_CHARGE';
    results.push({
      gross: money(gross),
      discount: money(disc),
      net: money(net),
      tax: money(tax),
      total: money(net.plus(tax)),
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
