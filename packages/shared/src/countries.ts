/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/**
 * Company-setup defaults per country (docs/14). Only defaults — every value is editable when the company is created.
 * A country not listed here can still be used: the admin types the ISO code and picks currency / year start by hand.
 */
export interface CountryInfo {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string; // ISO 4217
  calendar: 'AD' | 'BS';
  fyStartMonth: number; // AD month (BS month when calendar = BS)
  timezone: string;
  taxPack?: string; // suggested tax pack key (docs/14 §3.2)
}

const c = (code: string, name: string, currency: string, fyStartMonth: number, timezone: string, taxPack?: string): CountryInfo => ({ code, name, currency, calendar: 'AD', fyStartMonth, timezone, taxPack });

export const COUNTRIES: CountryInfo[] = [
  { code: 'NP', name: 'Nepal', currency: 'NPR', calendar: 'BS', fyStartMonth: 4, timezone: 'Asia/Kathmandu', taxPack: 'NP_VAT' },
  c('AU', 'Australia', 'AUD', 7, 'Australia/Sydney', 'AU_GST'),
  c('GB', 'United Kingdom', 'GBP', 4, 'Europe/London', 'GB_VAT'),
  c('NZ', 'New Zealand', 'NZD', 4, 'Pacific/Auckland', 'NZ_GST'),
  c('IN', 'India', 'INR', 4, 'Asia/Kolkata', 'IN_GST'),
  c('SG', 'Singapore', 'SGD', 1, 'Asia/Singapore', 'SG_GST'),
  c('CA', 'Canada', 'CAD', 1, 'America/Toronto', 'CA_GST'),
  c('AE', 'United Arab Emirates', 'AED', 1, 'Asia/Dubai', 'AE_VAT'),
  c('ZA', 'South Africa', 'ZAR', 3, 'Africa/Johannesburg', 'ZA_VAT'),
  c('US', 'United States', 'USD', 1, 'America/New_York', 'US_SALES_TAX'),
  c('IE', 'Ireland', 'EUR', 1, 'Europe/Dublin'),
  c('DE', 'Germany', 'EUR', 1, 'Europe/Berlin'),
  c('FR', 'France', 'EUR', 1, 'Europe/Paris'),
  c('IT', 'Italy', 'EUR', 1, 'Europe/Rome'),
  c('ES', 'Spain', 'EUR', 1, 'Europe/Madrid'),
  c('NL', 'Netherlands', 'EUR', 1, 'Europe/Amsterdam'),
  c('BE', 'Belgium', 'EUR', 1, 'Europe/Brussels'),
  c('AT', 'Austria', 'EUR', 1, 'Europe/Vienna'),
  c('PT', 'Portugal', 'EUR', 1, 'Europe/Lisbon'),
  c('SE', 'Sweden', 'SEK', 1, 'Europe/Stockholm'),
  c('DK', 'Denmark', 'DKK', 1, 'Europe/Copenhagen'),
  c('NO', 'Norway', 'NOK', 1, 'Europe/Oslo'),
  c('FI', 'Finland', 'EUR', 1, 'Europe/Helsinki'),
  c('PL', 'Poland', 'PLN', 1, 'Europe/Warsaw'),
  c('CH', 'Switzerland', 'CHF', 1, 'Europe/Zurich'),
  c('TR', 'Türkiye', 'TRY', 1, 'Europe/Istanbul'),
  c('MY', 'Malaysia', 'MYR', 1, 'Asia/Kuala_Lumpur'),
  c('ID', 'Indonesia', 'IDR', 1, 'Asia/Jakarta'),
  c('TH', 'Thailand', 'THB', 1, 'Asia/Bangkok'),
  c('PH', 'Philippines', 'PHP', 1, 'Asia/Manila'),
  c('VN', 'Vietnam', 'VND', 1, 'Asia/Ho_Chi_Minh'),
  c('LK', 'Sri Lanka', 'LKR', 4, 'Asia/Colombo'),
  c('BD', 'Bangladesh', 'BDT', 7, 'Asia/Dhaka'),
  c('PK', 'Pakistan', 'PKR', 7, 'Asia/Karachi'),
  c('BT', 'Bhutan', 'BTN', 7, 'Asia/Thimphu'),
  c('CN', 'China', 'CNY', 1, 'Asia/Shanghai'),
  c('JP', 'Japan', 'JPY', 4, 'Asia/Tokyo'),
  c('KR', 'South Korea', 'KRW', 1, 'Asia/Seoul'),
  c('HK', 'Hong Kong', 'HKD', 4, 'Asia/Hong_Kong'),
  c('SA', 'Saudi Arabia', 'SAR', 1, 'Asia/Riyadh'),
  c('QA', 'Qatar', 'QAR', 1, 'Asia/Qatar'),
  c('KW', 'Kuwait', 'KWD', 1, 'Asia/Kuwait'),
  c('OM', 'Oman', 'OMR', 1, 'Asia/Muscat'),
  c('BH', 'Bahrain', 'BHD', 1, 'Asia/Bahrain'),
  c('EG', 'Egypt', 'EGP', 7, 'Africa/Cairo'),
  c('NG', 'Nigeria', 'NGN', 1, 'Africa/Lagos'),
  c('KE', 'Kenya', 'KES', 7, 'Africa/Nairobi'),
  c('GH', 'Ghana', 'GHS', 1, 'Africa/Accra'),
  c('TZ', 'Tanzania', 'TZS', 7, 'Africa/Dar_es_Salaam'),
  c('MX', 'Mexico', 'MXN', 1, 'America/Mexico_City'),
  c('BR', 'Brazil', 'BRL', 1, 'America/Sao_Paulo'),
  c('AR', 'Argentina', 'ARS', 1, 'America/Argentina/Buenos_Aires'),
  c('CL', 'Chile', 'CLP', 1, 'America/Santiago'),
  c('CO', 'Colombia', 'COP', 1, 'America/Bogota'),
];

export const COUNTRY_BY_CODE: Record<string, CountryInfo> = Object.fromEntries(COUNTRIES.map((x) => [x.code, x]));

/** Defaults for any country code (listed or not). Unlisted countries fall back to USD / calendar year / UTC. */
export function countryDefaults(code: string): CountryInfo {
  return COUNTRY_BY_CODE[code] ?? { code, name: code, currency: 'USD', calendar: 'AD', fyStartMonth: 1, timezone: 'UTC' };
}
