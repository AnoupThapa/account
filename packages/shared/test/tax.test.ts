import { describe, it, expect } from 'vitest';
import { calculateTax, amountInWords, formatMoney, money, round2 } from '../src';

describe('VAT/GST calculation', () => {
  it('mixed taxable + exempt invoice at Nepal VAT 13%', () => {
    const r = calculateTax(
      [
        { quantity: 3, unitPrice: '333.33', taxType: 'STANDARD', taxRate: 13 },
        { quantity: 1, unitPrice: '500', taxType: 'EXEMPT', taxRate: 0 },
        { quantity: 2, unitPrice: '10.05', taxType: 'STANDARD', taxRate: 13 },
      ],
      { pricesIncludeTax: false },
    );
    expect(r.lines[0].net).toBe('999.99');
    expect(r.lines[0].tax).toBe('130.00'); // 129.9987 → 130.00
    expect(r.lines[2].tax).toBe('2.61'); // 20.10 × 13% = 2.613
    expect(r.taxableTotal).toBe('1020.09');
    expect(r.exemptTotal).toBe('500.00');
    expect(r.taxTotal).toBe('132.61');
    expect(r.grandTotal).toBe('1652.70');
  });

  it('same mix with Australian GST 10% and GST-free item', () => {
    const r = calculateTax(
      [
        { quantity: 3, unitPrice: '333.33', taxType: 'STANDARD', taxRate: 10 },
        { quantity: 1, unitPrice: '500', taxType: 'ZERO_RATED', taxRate: 0 },
      ],
      { pricesIncludeTax: false },
    );
    expect(r.taxTotal).toBe('100.00');
    expect(r.zeroRatedTotal).toBe('500.00');
    expect(r.grandTotal).toBe('1599.99');
  });

  it('tax-inclusive and exclusive give identical results for the same total', () => {
    const ex = calculateTax([{ quantity: 1, unitPrice: '100', taxType: 'STANDARD', taxRate: 13 }], { pricesIncludeTax: false });
    const inc = calculateTax([{ quantity: 1, unitPrice: '113', taxType: 'STANDARD', taxRate: 13 }], { pricesIncludeTax: true });
    expect(inc.subtotal).toBe(ex.subtotal);
    expect(inc.taxTotal).toBe(ex.taxTotal);
    expect(inc.grandTotal).toBe(ex.grandTotal);
    const ex2 = calculateTax([{ quantity: 1, unitPrice: '100', taxType: 'STANDARD', taxRate: 10 }], { pricesIncludeTax: false });
    const inc2 = calculateTax([{ quantity: 1, unitPrice: '110', taxType: 'STANDARD', taxRate: 10 }], { pricesIncludeTax: true });
    expect([inc2.subtotal, inc2.taxTotal, inc2.grandTotal]).toEqual([ex2.subtotal, ex2.taxTotal, ex2.grandTotal]);
  });

  it('inclusive price: net + tax always equals the entered total', () => {
    for (const price of ['99.99', '1', '0.07', '12345.67', '113.01']) {
      const r = calculateTax([{ quantity: 1, unitPrice: price, taxType: 'STANDARD', taxRate: 13 }], { pricesIncludeTax: true });
      expect(round2(r.lines[0].net).plus(r.lines[0].tax).toFixed(2)).toBe(money(price));
    }
  });

  it('document-level rounding option', () => {
    const lines = Array.from({ length: 3 }, () => ({ quantity: 1, unitPrice: '0.05', taxType: 'STANDARD' as const, taxRate: 13 }));
    expect(calculateTax(lines, { pricesIncludeTax: false, rounding: 'LINE' }).taxTotal).toBe('0.03'); // 3 × 0.01
    const doc = calculateTax(lines, { pricesIncludeTax: false, rounding: 'DOCUMENT' });
    expect(doc.taxTotal).toBe('0.02'); // 0.0195 → 0.02
    expect(doc.roundingAdjustment).toBe('-0.01');
  });

  it('discounts', () => {
    const r = calculateTax([{ quantity: 10, unitPrice: '100', discountPercent: 10, taxType: 'STANDARD', taxRate: 13 }], { pricesIncludeTax: false });
    expect(r.lines[0].net).toBe('900.00');
    expect(r.taxTotal).toBe('117.00');
  });
});

describe('amount in words & formatting', () => {
  it('NPR lakh/crore', () => {
    expect(amountInWords('125000.50', 'NPR')).toBe('Rupees One Lakh Twenty-Five Thousand and Paisa Fifty Only');
    expect(amountInWords('12345678', 'NPR')).toBe('Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight Only');
  });
  it('AUD million', () => {
    expect(amountInWords('1250000.05', 'AUD')).toBe('Dollars One Million Two Hundred Fifty Thousand and Cents Five Only');
  });
  it('lakh grouping for NPR display', () => {
    expect(formatMoney('1234567.5', 'NPR')).toBe('12,34,567.50');
    expect(formatMoney('1234567.5', 'AUD')).toBe('1,234,567.50');
  });
});
