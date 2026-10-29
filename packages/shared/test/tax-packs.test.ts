/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { describe, expect, it } from 'vitest';
import { calculateTax, TAX_PACKS, TAX_PACK_BY_KEY, validatePack, packForCountry, COUNTRIES, countryDefaults } from '../src';

const comp = (rates: [string, boolean?][]) => rates.map(([rate, stacked]) => ({ rate, stacked: !!stacked }));

describe('compound (group) tax calculation', () => {
  it('single component behaves exactly like the old single-rate calculation', () => {
    const a = calculateTax([{ quantity: 3, unitPrice: '333.33', taxType: 'STANDARD', taxRate: '13' }], { pricesIncludeTax: false });
    const b = calculateTax([{ quantity: 3, unitPrice: '333.33', taxType: 'STANDARD', taxRate: '0', components: comp([['13']]) }], { pricesIncludeTax: false });
    expect(b.taxTotal).toBe(a.taxTotal);
    expect(b.grandTotal).toBe(a.grandTotal);
    expect(b.lines[0].componentTax).toEqual([a.taxTotal]);
  });

  it('India style CGST 9 + SGST 9 (parallel) on 1000', () => {
    const r = calculateTax([{ quantity: 1, unitPrice: 1000, taxType: 'STANDARD', taxRate: 0, components: comp([['9'], ['9']]) }], { pricesIncludeTax: false });
    expect(r.lines[0].componentTax).toEqual(['90.00', '90.00']);
    expect(r.taxTotal).toBe('180.00');
    expect(r.grandTotal).toBe('1180.00');
  });

  it('stacked component is charged on net + earlier components', () => {
    const r = calculateTax([{ quantity: 1, unitPrice: 1000, taxType: 'STANDARD', taxRate: 0, components: comp([['5'], ['10', true]]) }], { pricesIncludeTax: false });
    expect(r.lines[0].componentTax).toEqual(['50.00', '105.00']); // 10% of 1050
    expect(r.grandTotal).toBe('1155.00');
  });

  it('inclusive pricing: total stays exactly as entered and components add up to the tax', () => {
    const r = calculateTax([{ quantity: 1, unitPrice: 1180, taxType: 'STANDARD', taxRate: 0, components: comp([['9'], ['9']]) }], { pricesIncludeTax: true });
    expect(r.grandTotal).toBe('1180.00');
    expect(r.subtotal).toBe('1000.00');
    expect(r.lines[0].componentTax).toEqual(['90.00', '90.00']);
  });

  it('inclusive pricing with awkward amounts: components always sum to the line tax', () => {
    for (const price of ['99.99', '1234.57', '0.07', '5000.01', '17.77']) {
      const r = calculateTax([{ quantity: 3, unitPrice: price, taxType: 'STANDARD', taxRate: 0, components: comp([['5'], ['9.975']]) }], { pricesIncludeTax: true });
      const l = r.lines[0];
      const sumC = l.componentTax.reduce((a, c) => a + Math.round(Number(c) * 100), 0);
      expect(sumC).toBe(Math.round(Number(l.tax) * 100));
      expect(Math.round(Number(l.total) * 100)).toBe(Math.round(Number(price) * 3 * 100));
    }
  });

  it('zero-rated / exempt lines ignore components', () => {
    const r = calculateTax([{ quantity: 1, unitPrice: 100, taxType: 'EXEMPT', taxRate: 0, components: comp([['9'], ['9']]) }], { pricesIncludeTax: false });
    expect(r.taxTotal).toBe('0.00');
    expect(r.exemptTotal).toBe('100.00');
  });
});

describe('tax packs', () => {
  it('every pack is structurally valid', () => {
    for (const p of TAX_PACKS) expect(validatePack(p), p.key).toEqual([]);
  });
  it('pack keys are unique and every country default points to a real pack', () => {
    expect(new Set(TAX_PACKS.map((p) => p.key)).size).toBe(TAX_PACKS.length);
    for (const c of COUNTRIES) if (c.taxPack) expect(TAX_PACK_BY_KEY[c.taxPack], c.code).toBeDefined();
  });
  it('Nepal and Australia packs keep the seeded codes', () => {
    expect(TAX_PACK_BY_KEY.NP_VAT.codes.map((c) => c.code)).toEqual(['VAT13', 'VAT0', 'EXEMPT', 'VAT13-NC', 'NOVAT']);
    expect(TAX_PACK_BY_KEY.AU_GST.codes.map((c) => c.code)).toEqual(['GST', 'FRE', 'INP', 'N-T']);
  });
  it('India GST 18 group = CGST 9 + SGST 9; Canada BC = GST 5 + PST 7 (PST not claimable)', () => {
    expect(TAX_PACK_BY_KEY.IN_GST.codes.find((c) => c.code === 'GST18')!.group!.map((g) => g.code)).toEqual(['CGST9', 'SGST9']);
    const bc = TAX_PACK_BY_KEY.CA_GST.codes;
    expect(bc.find((c) => c.code === 'PST-BC')!.claimable).toBe(false);
    expect(bc.find((c) => c.code === 'GST-PST-BC')!.group!.map((g) => g.code)).toEqual(['GST5', 'PST-BC']);
  });
  it('unknown country falls back to the generic VAT starter and sane defaults', () => {
    expect(packForCountry('XX').key).toBe('GENERIC_VAT');
    expect(countryDefaults('XX').currency).toBe('USD');
    expect(countryDefaults('NP').calendar).toBe('BS');
  });
});
