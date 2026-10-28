/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import type { TaxType } from './tax';

/**
 * Tax packs (docs/14 §3.2): starter data for a country's indirect-tax system. DATA, NOT ADVICE.
 * Rates change; every pack shows its "as of" date and the admin must confirm rates with their accountant
 * before first use. Rates are stored as effective-dated data per company — never read from here at posting time.
 */
export type TaxModel = 'CREDIT_VAT' | 'SALES_TAX' | 'COMPOUND' | 'NONE';

export interface PackCode {
  code: string;
  name: string;
  type: TaxType;
  rate: string; // percent; ignored for groups
  claimable: boolean; // input tax can be claimed back (false → tax becomes part of cost)
  /** Group (compound) code: made of other codes in this pack, in order. */
  group?: { code: string; stacked?: boolean }[];
}

export interface TaxPack {
  key: string;
  name: string;
  country: string;
  model: TaxModel;
  taxLabel: string;
  taxIdLabel: string;
  invoiceTitle: string;
  pricesIncludeTax: boolean;
  returnPeriod: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'NONE';
  /** code used when a user picks "Non-taxable" on a line */
  nonTaxableCode: string;
  version: string;
  asOf: string;
  notes: string;
  codes: PackCode[];
}

const std = (code: string, name: string, rate: string, claimable = true): PackCode => ({ code, name, type: 'STANDARD', rate, claimable });
const zero = (code: string, name: string): PackCode => ({ code, name, type: 'ZERO_RATED', rate: '0', claimable: true });
const exempt = (code: string, name: string): PackCode => ({ code, name, type: 'EXEMPT', rate: '0', claimable: false });
const oos = (code: string, name: string): PackCode => ({ code, name, type: 'OUT_OF_SCOPE', rate: '0', claimable: false });
const grp = (code: string, name: string, parts: [string, boolean?][]): PackCode => ({ code, name, type: 'STANDARD', rate: '0', claimable: true, group: parts.map(([c, s]) => ({ code: c, stacked: !!s })) });

const base = { version: '2026.1', asOf: '2026-10-01', pricesIncludeTax: false };

export const TAX_PACKS: TaxPack[] = [
  {
    ...base, key: 'NP_VAT', name: 'Nepal VAT', country: 'NP', model: 'CREDIT_VAT', taxLabel: 'VAT', taxIdLabel: 'PAN', invoiceTitle: 'Tax Invoice', returnPeriod: 'MONTHLY', nonTaxableCode: 'EXEMPT',
    notes: 'VAT 13%. TDS codes are loaded separately for Nepal companies.',
    codes: [
      std('VAT13', 'VAT 13%', '13'),
      zero('VAT0', 'VAT 0% (zero-rated / export)'),
      exempt('EXEMPT', 'VAT Exempt'),
      std('VAT13-NC', 'VAT 13% — not claimable', '13', false),
      oos('NOVAT', 'No VAT (non-VAT supplier / out of scope)'),
    ],
  },
  {
    ...base, key: 'AU_GST', name: 'Australia GST', country: 'AU', model: 'CREDIT_VAT', taxLabel: 'GST', taxIdLabel: 'ABN', invoiceTitle: 'Tax Invoice', returnPeriod: 'QUARTERLY', nonTaxableCode: 'N-T',
    notes: 'GST 10%. Management tracking only — BAS lodgement is outside LedgerPro.',
    codes: [std('GST', 'GST 10%', '10'), zero('FRE', 'GST-free'), exempt('INP', 'Input-taxed'), oos('N-T', 'Not reportable (out of scope)')],
  },
  {
    ...base, key: 'GB_VAT', name: 'United Kingdom VAT', country: 'GB', model: 'CREDIT_VAT', taxLabel: 'VAT', taxIdLabel: 'VAT Reg No', invoiceTitle: 'VAT Invoice', returnPeriod: 'QUARTERLY', nonTaxableCode: 'OUTSCOPE',
    notes: 'Standard 20%, reduced 5%, zero 0%.',
    codes: [std('VAT20', 'VAT 20% (standard)', '20'), std('VAT5', 'VAT 5% (reduced)', '5'), zero('VAT0', 'VAT 0% (zero-rated)'), exempt('EXEMPT', 'VAT Exempt'), oos('OUTSCOPE', 'Outside the scope of VAT')],
  },
  {
    ...base, key: 'NZ_GST', name: 'New Zealand GST', country: 'NZ', model: 'CREDIT_VAT', taxLabel: 'GST', taxIdLabel: 'GST number', invoiceTitle: 'Tax Invoice', returnPeriod: 'MONTHLY', nonTaxableCode: 'OUTSCOPE',
    notes: 'GST 15%.',
    codes: [std('GST15', 'GST 15%', '15'), zero('GST0', 'GST 0% (zero-rated)'), exempt('EXEMPT', 'Exempt supply'), oos('OUTSCOPE', 'Outside the scope of GST')],
  },
  {
    ...base, key: 'IN_GST', name: 'India GST', country: 'IN', model: 'COMPOUND', taxLabel: 'GST', taxIdLabel: 'GSTIN', invoiceTitle: 'Tax Invoice', returnPeriod: 'MONTHLY', nonTaxableCode: 'NOGST',
    notes: 'Slabs 5% / 18% / 40% (from 22 Sep 2025). Intra-state supplies use CGST+SGST (two components); inter-state use IGST. Cess and special rates: add codes in Settings → Tax system.',
    codes: [
      std('CGST2.5', 'CGST 2.5%', '2.5'), std('SGST2.5', 'SGST 2.5%', '2.5'),
      std('CGST9', 'CGST 9%', '9'), std('SGST9', 'SGST 9%', '9'),
      std('CGST20', 'CGST 20%', '20'), std('SGST20', 'SGST 20%', '20'),
      std('IGST5', 'IGST 5%', '5'), std('IGST18', 'IGST 18%', '18'), std('IGST40', 'IGST 40%', '40'),
      grp('GST5', 'GST 5% (CGST+SGST)', [['CGST2.5'], ['SGST2.5']]),
      grp('GST18', 'GST 18% (CGST+SGST)', [['CGST9'], ['SGST9']]),
      grp('GST40', 'GST 40% (CGST+SGST)', [['CGST20'], ['SGST20']]),
      zero('GST0', 'GST 0% (zero-rated / export)'), exempt('EXEMPT', 'Exempt / nil-rated'), oos('NOGST', 'Non-GST supply'),
    ],
  },
  {
    ...base, key: 'SG_GST', name: 'Singapore GST', country: 'SG', model: 'CREDIT_VAT', taxLabel: 'GST', taxIdLabel: 'GST Reg No', invoiceTitle: 'Tax Invoice', returnPeriod: 'QUARTERLY', nonTaxableCode: 'OOS',
    notes: 'GST 9%.',
    codes: [std('SR', 'GST 9% (standard-rated)', '9'), zero('ZR', 'GST 0% (zero-rated)'), exempt('ES', 'Exempt supply'), oos('OOS', 'Out of scope')],
  },
  {
    ...base, key: 'AE_VAT', name: 'UAE VAT', country: 'AE', model: 'CREDIT_VAT', taxLabel: 'VAT', taxIdLabel: 'TRN', invoiceTitle: 'Tax Invoice', returnPeriod: 'QUARTERLY', nonTaxableCode: 'OOS',
    notes: 'VAT 5%.',
    codes: [std('VAT5', 'VAT 5%', '5'), zero('VAT0', 'VAT 0% (zero-rated)'), exempt('EXEMPT', 'Exempt'), oos('OOS', 'Out of scope')],
  },
  {
    ...base, key: 'ZA_VAT', name: 'South Africa VAT', country: 'ZA', model: 'CREDIT_VAT', taxLabel: 'VAT', taxIdLabel: 'VAT number', invoiceTitle: 'Tax Invoice', returnPeriod: 'MONTHLY', nonTaxableCode: 'OOS',
    notes: 'VAT 15%.',
    codes: [std('VAT15', 'VAT 15%', '15'), zero('VAT0', 'VAT 0% (zero-rated)'), exempt('EXEMPT', 'Exempt'), oos('OOS', 'Out of scope')],
  },
  {
    ...base, key: 'CA_GST', name: 'Canada GST / HST / PST / QST', country: 'CA', model: 'COMPOUND', taxLabel: 'GST/HST', taxIdLabel: 'BN / GST-HST no.', invoiceTitle: 'Invoice', returnPeriod: 'QUARTERLY', nonTaxableCode: 'OOS',
    notes: 'Federal GST 5%; HST by province (ON 13%, Atlantic provinces 15%); GST+PST in BC / SK / MB; GST+QST in Québec. PST/RST is not recoverable. Provincial rates change — confirm before use.',
    codes: [
      std('GST5', 'GST 5% (federal)', '5'), std('HST13', 'HST 13% (Ontario)', '13'), std('HST15', 'HST 15% (Atlantic provinces)', '15'),
      std('PST-BC', 'PST 7% (British Columbia)', '7', false), std('PST-SK', 'PST 6% (Saskatchewan)', '6', false), std('RST-MB', 'RST 7% (Manitoba)', '7', false),
      std('QST', 'QST 9.975% (Québec)', '9.975'),
      grp('GST-PST-BC', 'GST 5% + PST 7% (BC)', [['GST5'], ['PST-BC']]),
      grp('GST-PST-SK', 'GST 5% + PST 6% (SK)', [['GST5'], ['PST-SK']]),
      grp('GST-RST-MB', 'GST 5% + RST 7% (MB)', [['GST5'], ['RST-MB']]),
      grp('GST-QST', 'GST 5% + QST 9.975% (QC)', [['GST5'], ['QST']]),
      zero('ZERO', 'Zero-rated'), exempt('EXEMPT', 'Exempt'), oos('OOS', 'Out of scope'),
    ],
  },
  {
    ...base, key: 'US_SALES_TAX', name: 'United States sales tax (rate table)', country: 'US', model: 'SALES_TAX', taxLabel: 'Sales Tax', taxIdLabel: 'EIN', invoiceTitle: 'Invoice', returnPeriod: 'MONTHLY', nonTaxableCode: 'EXEMPT',
    notes: 'US sales tax varies by state, county and city. Create one code per jurisdiction you collect in (Settings → Tax system → Add code) or a group of state+local codes. Rates start at 0% until you set them. Tax paid on purchases is not recoverable and is added to cost.',
    codes: [std('SALESTAX', 'Sales tax (set your rate)', '0', false), exempt('EXEMPT', 'Exempt / resale'), oos('NONTAX', 'Non-taxable')],
  },
  {
    ...base, key: 'GENERIC_VAT', name: 'Generic VAT / GST (set your own rate)', country: 'OTHER', model: 'CREDIT_VAT', taxLabel: 'VAT', taxIdLabel: 'Tax ID', invoiceTitle: 'Tax Invoice', returnPeriod: 'MONTHLY', nonTaxableCode: 'NONE',
    notes: 'Starter codes for any country with a VAT/GST. Set the standard rate after applying.',
    codes: [std('STD', 'Standard rate (set your rate)', '0'), zero('ZERO', 'Zero-rated'), exempt('EXEMPT', 'Exempt'), oos('NONE', 'Out of scope')],
  },
  {
    ...base, key: 'NO_TAX', name: 'No indirect tax', country: 'OTHER', model: 'NONE', taxLabel: 'Tax', taxIdLabel: 'Tax ID', invoiceTitle: 'Invoice', returnPeriod: 'NONE', nonTaxableCode: 'NONE',
    notes: 'For businesses or jurisdictions without VAT/sales tax.',
    codes: [oos('NONE', 'No tax')],
  },
];

export const TAX_PACK_BY_KEY: Record<string, TaxPack> = Object.fromEntries(TAX_PACKS.map((p) => [p.key, p]));

/** Pack suggested for a country (falls back to the generic VAT starter). */
export function packForCountry(country: string): TaxPack {
  const hit = TAX_PACKS.find((p) => p.country === country);
  return hit ?? TAX_PACK_BY_KEY.GENERIC_VAT;
}

/** Structural checks used by tests and by "apply pack" (a broken pack must never reach a company). */
export function validatePack(p: TaxPack): string[] {
  const errs: string[] = [];
  const codes = new Set<string>();
  for (const c of p.codes) {
    if (codes.has(c.code)) errs.push(`duplicate code ${c.code}`);
    codes.add(c.code);
    const r = Number(c.rate);
    if (!(r >= 0 && r <= 100)) errs.push(`${c.code}: bad rate`);
    if (c.type !== 'STANDARD' && r !== 0) errs.push(`${c.code}: non-standard code must have 0% rate`);
  }
  for (const c of p.codes) {
    for (const g of c.group ?? []) {
      const t = p.codes.find((x) => x.code === g.code);
      if (!t) errs.push(`${c.code}: unknown component ${g.code}`);
      else if (t.group) errs.push(`${c.code}: component ${g.code} is itself a group`);
    }
    if (c.group && c.group.length < 2) errs.push(`${c.code}: a group needs at least 2 components`);
  }
  if (!codes.has(p.nonTaxableCode)) errs.push(`nonTaxableCode ${p.nonTaxableCode} missing`);
  return errs;
}
