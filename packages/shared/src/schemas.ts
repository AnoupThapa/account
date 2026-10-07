/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { z } from 'zod';

/** Shared validation schemas — used by API (authoritative) and web (instant feedback). */

export const zAdDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const zMoney = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^-?\d{1,16}(\.\d{1,2})?$/.test(v), 'Enter an amount with up to 2 decimals');
export const zMoneyNonNeg = zMoney.refine((v) => !v.startsWith('-'), 'Amount cannot be negative');
export const zQty = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,14}(\.\d{1,4})?$/.test(v), 'Enter a quantity with up to 4 decimals');
export const zRate = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,3}(\.\d{1,4})?$/.test(v) && Number(v) <= 100, 'Rate must be 0–100');
export const zUuid = z.string().uuid();
export const zOptUuid = z.string().uuid().nullish();

export const zPassword = z.string().min(10, 'Password must be at least 10 characters').max(200);

export const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });
export const totpSchema = z.object({ code: z.string().regex(/^(\d{6}|[A-Z0-9]{4}-[A-Z0-9]{4})$/, 'Enter the 6-digit code') });

export const companyCreateSchema = z.object({
  name: z.string().min(2).max(150),
  legalName: z.string().max(200).optional(),
  country: z.enum(['NP', 'AU', 'OTHER']),
  baseCurrency: z.string().length(3).optional(),
  calendarMode: z.enum(['BS', 'AD']).optional(),
  fyStartMonth: z.number().int().min(1).max(12).optional(),
  businessType: z.enum(['SERVICE', 'TRADING', 'MANUFACTURING', 'MIXED']),
  coaTemplate: z.enum(['NEPAL', 'IFRS']).optional(),
  pan: z.string().max(20).optional(),
  vatNo: z.string().max(20).optional(),
  abn: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().optional().or(z.literal('')),
  timezone: z.string().max(60).optional(),
  firstFiscalYearDate: zAdDate.optional(),
});

export const journalLineSchema = z.object({
  accountId: zUuid,
  debit: zMoneyNonNeg.default('0'),
  credit: zMoneyNonNeg.default('0'),
  contactId: zOptUuid,
  costCentreId: zOptUuid,
  description: z.string().max(500).optional(),
});

export const manualJournalSchema = z.object({
  journalDate: zAdDate,
  branchId: zOptUuid,
  narration: z.string().min(1, 'Narration is required').max(2000),
  reference: z.string().max(60).optional(),
  lines: z.array(journalLineSchema).min(2, 'At least two lines'),
});

export const docLineSchema = z.object({
  itemId: zOptUuid,
  accountId: zOptUuid,
  description: z.string().max(500).optional(),
  quantity: zQty.default('1'),
  unitPrice: zMoneyNonNeg,
  discountPercent: zRate.optional(),
  taxCodeId: zOptUuid,
  costCentreId: zOptUuid,
});

export type ManualJournalInput = z.infer<typeof manualJournalSchema>;
export type DocLineInput = z.infer<typeof docLineSchema>;
