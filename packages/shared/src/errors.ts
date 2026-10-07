/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/**
 * Error code catalogue — docs/error-handling.md §3.
 * Messages live here (English now; Nepali later) and are reused by API and web.
 */
export const ERROR_CATALOGUE = {
  AUTH_INVALID_CREDENTIALS: { status: 401, title: 'Email or password is incorrect' },
  AUTH_ACCOUNT_LOCKED: { status: 423, title: 'Account locked for 15 minutes' },
  AUTH_2FA_REQUIRED: { status: 401, title: 'Enter your 6-digit code' },
  AUTH_2FA_INVALID: { status: 401, title: 'Code is incorrect' },
  AUTH_2FA_SETUP_REQUIRED: { status: 403, title: 'Two-factor authentication must be set up for your role' },
  AUTH_STEP_UP_REQUIRED: { status: 403, title: 'Please confirm your password/code' },
  AUTH_UNAUTHENTICATED: { status: 401, title: 'Please sign in' },
  AUTH_TOKEN_INVALID: { status: 401, title: 'Your session has expired — please sign in again' },
  AUTH_WEAK_PASSWORD: { status: 422, title: 'Password is too weak' },
  AUTH_RESET_INVALID: { status: 400, title: 'This reset link is invalid or has expired' },
  AUTH_CSRF: { status: 403, title: 'Security token missing or invalid — reload the page' },
  PERM_DENIED: { status: 403, title: "You don't have access to this action" },
  NOT_FOUND: { status: 404, title: 'Not found' },
  VAL_FIELD: { status: 422, title: 'Please correct the highlighted fields' },
  VAL_DATE_OUT_OF_RANGE: { status: 422, title: 'Date is outside the supported range' },
  VAL_BS_INVALID_DAY: { status: 422, title: 'Invalid day for this BS month' },
  ACC_UNBALANCED: { status: 422, title: 'Debits and credits must be equal' },
  ACC_PERIOD_LOCKED: { status: 409, title: 'Accounting period is locked' },
  ACC_NO_FISCAL_YEAR: { status: 409, title: 'Create the fiscal year first' },
  ACC_IMMUTABLE: { status: 409, title: "Posted entries can't be changed — reverse instead" },
  ACC_CONTROL_ACCOUNT: { status: 422, title: 'Select a customer/supplier for this account' },
  ACC_ACCOUNT_INACTIVE: { status: 422, title: 'Choose an active ledger account' },
  ACC_NOT_POSTABLE: { status: 422, title: 'Choose a ledger (postable) account, not a heading' },
  ACC_OPENING_UNBALANCED: { status: 409, title: 'Opening balances do not agree' },
  ACC_YEAR_CLOSED: { status: 409, title: 'Fiscal year is closed' },
  ACC_NEGATIVE_STOCK: { status: 409, title: 'Not enough stock' },
  ACC_OVER_ALLOCATION: { status: 422, title: 'Allocation exceeds amount due' },
  ACC_ALREADY_LIVE: { status: 409, title: 'Company is already live; opening balances are closed' },
  APR_SELF_APPROVAL: { status: 403, title: "You can't approve your own entry" },
  APR_LIMIT_EXCEEDED: { status: 403, title: 'Needs approval from a higher level' },
  APR_INVALID_STATE: { status: 409, title: 'This document is not in a state that allows this action' },
  APR_NOT_APPROVER: { status: 403, title: 'You are not an approver for this step' },
  DOC_DUPLICATE_INVOICE: { status: 409, title: 'This supplier invoice already exists' },
  DOC_CANCEL_HAS_PAYMENTS: { status: 409, title: 'Remove allocations first or issue a credit note' },
  DOC_VERSION_CONFLICT: { status: 409, title: 'Someone else changed this; reload to see changes' },
  DOC_DUPLICATE: { status: 409, title: 'A record with this code already exists' },
  TAX_NO_RATE: { status: 422, title: 'No tax rate set for this date — ask Admin' },
  TAX_MISMATCH: { status: 422, title: 'Tax differs from calculation' },
  RATE_LIMITED: { status: 429, title: 'Please wait and try again' },
  SYS_UNEXPECTED: { status: 500, title: 'Something went wrong' },
} as const;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

export interface FieldError {
  field: string;
  message: string;
}

/** Business error thrown anywhere (shared, api, worker); the API turns it into RFC 7807. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fields?: FieldError[];
  readonly meta?: Record<string, unknown>;

  constructor(code: ErrorCode, detail?: string, meta?: Record<string, unknown>, fields?: FieldError[]) {
    super(detail ?? ERROR_CATALOGUE[code].title);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CATALOGUE[code].status;
    this.meta = meta;
    this.fields = fields;
  }
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  requestId?: string;
  fields?: FieldError[];
  meta?: Record<string, unknown>;
}

export function isProblem(x: unknown): x is ProblemDetails {
  return typeof x === 'object' && x !== null && 'code' in x && 'status' in x && 'title' in x;
}
