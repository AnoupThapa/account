/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/**
 * Bank statement import + matching helpers (docs/16). Pure functions: no I/O, money via the decimal library.
 * Sign convention everywhere: money INTO the bank = positive, money OUT = negative.
 */
import { d, money } from './money';
import { toAD } from './bsdate';

// ---------------------------------------------------------------- CSV
/** Small RFC-4180 CSV reader (quoted fields, escaped quotes, CRLF/LF, auto-detects , ; or tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const count = (c: string) => firstLine.split(c).length - 1;
  const delim = count('\t') > 0 && count('\t') >= count(',') && count('\t') >= count(';') ? '\t' : count(';') > count(',') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
  return rows;
}

// ---------------------------------------------------------------- column mapping
export interface ColumnMapping {
  date: number;
  description?: number | null;
  reference?: number | null;
  chequeNo?: number | null;
  balance?: number | null;
  /** Separate columns for deposits / withdrawals … */
  moneyIn?: number | null;
  moneyOut?: number | null;
  /** … or one signed amount column (negative = out), optionally with a Dr/Cr column. */
  amount?: number | null;
  type?: number | null;
}
export interface ImportOptions {
  dateFormat: 'YMD' | 'DMY' | 'MDY';
  calendar: 'AD' | 'BS';
}
export interface StatementRow {
  txnDate: string;
  description: string;
  reference: string | null;
  chequeNo: string | null;
  moneyIn: string;
  moneyOut: string;
  balance: string | null;
}
export interface RowIssue {
  row: number;
  message: string;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const findCol = (headers: string[], re: RegExp, skip: number[] = []) => headers.findIndex((h, i) => !skip.includes(i) && re.test(norm(h)));

/** Guess which column is which from the header names. Returns null for anything it cannot find. */
export function guessMapping(headers: string[]): ColumnMapping | null {
  const date = findCol(headers, /^(txn |transaction |posting |value |trans )?date$|^date( of)? (txn|transaction)|^tran date|^date/);
  if (date < 0) return null;
  const used = [date];
  const description = findCol(headers, /desc|narration|particular|detail|remark|memo|payee/, used);
  if (description >= 0) used.push(description);
  const reference = findCol(headers, /^ref|reference|txn id|transaction id|utr|voucher/, used);
  if (reference >= 0) used.push(reference);
  const chequeNo = findCol(headers, /cheque|check no|chq/, used);
  if (chequeNo >= 0) used.push(chequeNo);
  const balance = findCol(headers, /balance/, used);
  if (balance >= 0) used.push(balance);
  const moneyOut = findCol(headers, /^(debit|dr|withdraw|paid out|money out|debits?)\b|withdrawal|paid out|money out/, used);
  const moneyIn = findCol(headers, /^(credit|cr|deposit|paid in|money in|credits?)\b|deposit|paid in|money in/, used);
  const out: ColumnMapping = { date, description: description >= 0 ? description : null, reference: reference >= 0 ? reference : null, chequeNo: chequeNo >= 0 ? chequeNo : null, balance: balance >= 0 ? balance : null };
  if (moneyOut >= 0 || moneyIn >= 0) {
    out.moneyOut = moneyOut >= 0 ? moneyOut : null;
    out.moneyIn = moneyIn >= 0 ? moneyIn : null;
    return out;
  }
  const amount = findCol(headers, /amount/, used);
  if (amount >= 0) {
    out.amount = amount;
    const type = findCol(headers, /^(type|dr cr|drcr|cr dr|debit credit)$/, [...used, amount]);
    out.type = type >= 0 ? type : null;
    return out;
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Parse a statement date to AD "YYYY-MM-DD", or null when it cannot be understood. */
export function parseStatementDate(raw: string, opt: ImportOptions): string | null {
  const t = raw.trim();
  if (!t) return null;
  let y: number, m: number, day: number;
  const named = t.match(/^(\d{1,2})[ \-/]([A-Za-z]{3})[a-z]*[ \-/,]*(\d{2,4})$/);
  const iso = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/);
  const other = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (named) {
    const mi = MONTHS.indexOf(named[2].toLowerCase());
    if (mi < 0) return null;
    day = +named[1];
    m = mi + 1;
    y = +named[3];
  } else if (iso) {
    y = +iso[1];
    m = +iso[2];
    day = +iso[3];
  } else if (other) {
    const a = +other[1];
    const b = +other[2];
    y = +other[3];
    if (opt.dateFormat === 'MDY') {
      m = a;
      day = b;
    } else {
      day = a;
      m = b;
    }
  } else return null;
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || day < 1 || day > 31) return null;
  try {
    if (opt.calendar === 'BS') return toAD(y, m, day);
  } catch {
    return null;
  }
  const dt = new Date(Date.UTC(y, m - 1, day));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}

/** "1,234.50", "(500.00)", "Rs. 1,000", "250 DR" → signed decimal string; null when not a number; '' → '0.00'. */
export function parseAmount(raw: string | undefined): string | null {
  if (raw === undefined) return '0.00';
  let t = raw.trim();
  if (!t) return '0.00';
  let neg = false;
  if (/^\(.*\)$/.test(t)) {
    neg = true;
    t = t.slice(1, -1);
  }
  if (/(\bdr\b|\bd\b)\.?$/i.test(t)) {
    neg = true;
    t = t.replace(/\s*(dr|d)\.?$/i, '');
  } else if (/(\bcr\b|\bc\b)\.?$/i.test(t)) t = t.replace(/\s*(cr|c)\.?$/i, '');
  t = t.replace(/[A-Za-z$₹€£]+\.?\s*/g, '').replace(/,/g, '').replace(/\s/g, '');
  if (t.startsWith('-')) {
    neg = !neg;
    t = t.slice(1);
  } else if (t.startsWith('+')) t = t.slice(1);
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = d(t);
  return money(neg ? v.neg() : v);
}

/** Turn raw CSV rows (after the header row) into normalised statement rows, collecting a readable issue per bad row. */
/** Banks print "-" for an empty cheque / reference cell. */
const blankDash = (v: string | undefined) => ((v ?? '').trim() === '-' ? '' : (v ?? '').trim());

export function normaliseRows(rows: string[][], map: ColumnMapping, opt: ImportOptions, firstRowNo = 2): { lines: StatementRow[]; issues: RowIssue[] } {
  const lines: StatementRow[] = [];
  const issues: RowIssue[] = [];
  const cell = (r: string[], i: number | null | undefined) => (i === null || i === undefined || i < 0 ? undefined : (r[i] ?? ''));
  rows.forEach((r, idx) => {
    const rowNo = idx + firstRowNo; // 1-based row number in the file
    const txnDate = parseStatementDate(cell(r, map.date) ?? '', opt);
    if (!txnDate) return void issues.push({ row: rowNo, message: `Could not read the date "${cell(r, map.date) ?? ''}"` });
    let inn = d(0);
    let out = d(0);
    if (map.moneyIn !== undefined && map.moneyIn !== null || map.moneyOut !== undefined && map.moneyOut !== null) {
      const a = parseAmount(cell(r, map.moneyIn));
      const b = parseAmount(cell(r, map.moneyOut));
      if (a === null || b === null) return void issues.push({ row: rowNo, message: 'Could not read the amount' });
      inn = d(a).abs();
      out = d(b).abs();
    } else if (map.amount !== undefined && map.amount !== null) {
      const a = parseAmount(cell(r, map.amount));
      if (a === null) return void issues.push({ row: rowNo, message: `Could not read the amount "${cell(r, map.amount)}"` });
      let v = d(a);
      const ty = (cell(r, map.type) ?? '').toLowerCase();
      if (ty) {
        const isOut = /^(dr|d|debit|withdraw|paid out|out)/.test(ty);
        const isIn = /^(cr|c|credit|deposit|paid in|in)/.test(ty);
        if (isOut) v = v.abs().neg();
        else if (isIn) v = v.abs();
      }
      if (v.isPositive() && !v.isZero()) inn = v;
      else out = v.abs();
    } else return void issues.push({ row: rowNo, message: 'No amount column is mapped' });
    if (inn.isZero() && out.isZero()) return; // empty / opening-balance rows are skipped silently
    if (!inn.isZero() && !out.isZero()) return void issues.push({ row: rowNo, message: 'Both money-in and money-out have a value' });
    const bal = cell(r, map.balance);
    const balance = bal === undefined || bal === '' ? null : parseAmount(bal);
    lines.push({
      txnDate,
      description: (cell(r, map.description) ?? '').slice(0, 500),
      reference: blankDash(cell(r, map.reference)).slice(0, 100) || null,
      chequeNo: blankDash(cell(r, map.chequeNo)).slice(0, 40) || null,
      moneyIn: money(inn),
      moneyOut: money(out),
      balance,
    });
  });
  return { lines, issues };
}

// ---------------------------------------------------------------- statement tables (spreadsheet exports)
export interface StatementTable {
  header: string[];
  body: string[][];
  /** 1-based row number of the first body row in the file (for readable error messages). */
  firstRowNo: number;
  openingBalance: string | null;
  closingBalance: string | null;
  periodFrom: string | null;
  periodTo: string | null;
}
const DATE_LIKE = /^\s*(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[ \-/][A-Za-z]{3}[a-z]*[ \-/,]*\d{2,4})/;

/**
 * Many Nepali and Australian banks export a spreadsheet with title lines above the table and Opening / Closing Balance and
 * "Total Records" lines around it. Find the real header row, keep only the transaction rows, and read the balances and period.
 * Returns null when no header row with a date and amount columns is found.
 */
export function extractTable(rows: string[][]): StatementTable | null {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    const g = guessMapping(rows[i]);
    if (g && (g.amount !== undefined || g.moneyIn !== undefined || g.moneyOut !== undefined)) {
      h = i;
      break;
    }
  }
  if (h < 0) return null;
  const header = rows[h];
  const g = guessMapping(header)!;
  const firstDataIdx = rows.findIndex((r, i) => i > h && DATE_LIKE.test(r[g.date] ?? ''));
  const body = rows.slice(h + 1).filter((r) => DATE_LIKE.test(r[g.date] ?? ''));
  const num = (v: string | undefined) => (v === undefined || v.trim() === '' || v.trim() === '-' ? null : parseAmount(v));
  const descCol = g.description ?? -1;
  const balCol = g.balance ?? -1;
  const label = (r: string[], re: RegExp) => r.some((c) => re.test(c.trim()));
  let openingBalance: string | null = null;
  let closingBalance: string | null = null;
  // 1) rows inside the table: "Opening Balance" / "Closing Balance" with the figure in the Balance column
  for (const r of rows.slice(h + 1)) {
    if (descCol >= 0 && balCol >= 0 && /^opening balance/i.test((r[descCol] ?? '').trim())) openingBalance = num(r[balCol]);
    if (descCol >= 0 && balCol >= 0 && /^closing balance/i.test((r[descCol] ?? '').trim())) closingBalance = num(r[balCol]);
  }
  // 2) header block above the table: "Opening Balance : 1,000.00"
  const firstNumberAfterLabel = (r: string[], re: RegExp) => {
    const at = r.findIndex((c) => re.test(c.trim()));
    if (at < 0) return null;
    for (const c of r.slice(at + 1)) if (c.trim() && c.trim() !== ':' && num(c) !== null) return num(c);
    return null;
  };
  for (const r of rows.slice(0, h)) {
    if (openingBalance === null && label(r, /^opening balance/i)) openingBalance = firstNumberAfterLabel(r, /^opening balance/i);
    if (closingBalance === null && label(r, /^closing balance/i)) closingBalance = firstNumberAfterLabel(r, /^closing balance/i);
  }
  // 3) "From 2026-09-29 To 2026-10-29"
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const after = (r: string[], re: RegExp) => {
    const at = r.findIndex((c) => re.test(c.trim()));
    return at < 0 ? null : (r.slice(at + 1).map((c) => c.trim()).find((c) => iso.test(c)) ?? null);
  };
  for (const r of rows.slice(0, h)) {
    periodFrom ??= after(r, /^from$/i);
    periodTo ??= after(r, /^to$/i);
  }
  return { header, body, firstRowNo: (firstDataIdx < 0 ? h + 1 : firstDataIdx) + 1, openingBalance, closingBalance, periodFrom, periodTo };
}

// ---------------------------------------------------------------- matching
export interface StmtItem {
  id: string;
  date: string;
  amount: string; // signed
  description: string;
  reference?: string | null;
  chequeNo?: string | null;
}
export interface BookItem {
  id: string;
  date: string;
  amount: string; // signed
  description?: string | null;
  sourceNo?: string | null;
  contactId?: string | null;
  contactName?: string | null;
}
export type MatchTier = 'REFERENCE' | 'DATE_AMOUNT' | 'AMOUNT' | 'COMBINATION';
export interface Suggestion {
  statementLineId: string;
  journalLineIds: string[];
  tier: MatchTier;
  /** Safe to apply without asking (docs/02 §11: only reference and date+amount are automatic). */
  auto: boolean;
}

const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const clean = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Banks often put the cheque / invoice / transfer reference inside the description: take words that contain a digit. */
const descTokens = (t: string) => (t.match(/[A-Za-z0-9][A-Za-z0-9/_-]{3,}/g) ?? []).filter((w) => /\d/.test(w) && !/^\d{4}-\d{2}-\d{2}$/.test(w)).map(clean).filter((k) => k.length >= 4 && k.length <= 30);

function refHit(s: StmtItem, b: BookItem) {
  const keys = [...[s.reference, s.chequeNo].map(clean).filter((k) => k.length >= 3), ...descTokens(s.description)];
  if (!keys.length) return false;
  const hay = [b.sourceNo, b.description].map(clean).filter(Boolean);
  const hay2 = clean(s.description);
  return keys.some((k) => hay.some((h) => h.includes(k) || (h.length >= 4 && k.includes(h))) || (b.sourceNo && clean(b.sourceNo).length >= 4 && hay2.includes(clean(b.sourceNo))));
}
const nameHit = (s: StmtItem, b: BookItem) => {
  const n = clean(b.contactName);
  return n.length >= 4 && clean(s.description).includes(n);
};

/**
 * Suggest matches. Priority (docs/02 §11): (1) same reference/cheque number + amount, (2) same amount within ±3 days when only one
 * candidate fits, (3) amount only (suggestion), then (4) two or three book items of one contact adding up to the amount (suggestion).
 * Each book item is used once.
 */
export function suggestMatches(stmt: StmtItem[], book: BookItem[]): Suggestion[] {
  const out: Suggestion[] = [];
  const usedBook = new Set<string>();
  const usedStmt = new Set<string>();
  const free = (b: BookItem) => !usedBook.has(b.id);
  const take = (s: StmtItem, ids: string[], tier: MatchTier, auto: boolean) => {
    out.push({ statementLineId: s.id, journalLineIds: ids, tier, auto });
    ids.forEach((i) => usedBook.add(i));
    usedStmt.add(s.id);
  };
  const same = (s: StmtItem) => book.filter((b) => free(b) && d(b.amount).eq(s.amount));

  for (const s of stmt) {
    const c = same(s).filter((b) => refHit(s, b));
    if (c.length === 1) take(s, [c[0].id], 'REFERENCE', true);
    else if (c.length > 1) {
      const near = c.filter((b) => dayDiff(b.date, s.date) <= 3);
      if (near.length === 1) take(s, [near[0].id], 'REFERENCE', true);
    }
  }
  for (const s of stmt.filter((x) => !usedStmt.has(x.id))) {
    const c = same(s).filter((b) => dayDiff(b.date, s.date) <= 3);
    const pick = c.length === 1 ? c[0] : c.filter((b) => nameHit(s, b)).length === 1 ? c.find((b) => nameHit(s, b))! : null;
    if (!pick) continue;
    // the book item must also be the only fit for this statement line among the remaining statement lines
    const rivals = stmt.filter((o) => !usedStmt.has(o.id) && o.id !== s.id && d(o.amount).eq(pick.amount) && dayDiff(o.date, pick.date) <= 3);
    if (rivals.length === 0 || nameHit(s, pick)) take(s, [pick.id], 'DATE_AMOUNT', true);
  }
  for (const s of stmt.filter((x) => !usedStmt.has(x.id))) {
    const c = same(s);
    if (c.length >= 1) {
      const best = [...c].sort((a, b) => dayDiff(a.date, s.date) - dayDiff(b.date, s.date))[0];
      take(s, [best.id], 'AMOUNT', false);
    }
  }
  for (const s of stmt.filter((x) => !usedStmt.has(x.id))) {
    const pool = book.filter((b) => free(b) && b.contactId && Math.sign(+b.amount) === Math.sign(+s.amount) && dayDiff(b.date, s.date) <= 31);
    const byContact = new Map<string, BookItem[]>();
    for (const b of pool) byContact.set(b.contactId!, [...(byContact.get(b.contactId!) ?? []), b]);
    let found: string[] | null = null;
    for (const items of byContact.values()) {
      const L = items.slice(0, 12);
      for (let i = 0; i < L.length && !found; i++)
        for (let j = i + 1; j < L.length && !found; j++) {
          if (d(L[i].amount).plus(L[j].amount).eq(s.amount)) found = [L[i].id, L[j].id];
          else for (let k = j + 1; k < L.length && !found; k++) if (d(L[i].amount).plus(L[j].amount).plus(L[k].amount).eq(s.amount)) found = [L[i].id, L[j].id, L[k].id];
        }
      if (found) break;
    }
    if (found) take(s, found, 'COMBINATION', false);
  }
  return out;
}

/** True when the selected statement and book amounts are equal (the rule enforced by the DB at commit). */
export function groupBalances(stmtAmounts: string[], bookAmounts: string[]): boolean {
  if (!stmtAmounts.length || !bookAmounts.length) return false;
  return stmtAmounts.reduce((a, v) => a.plus(v), d(0)).eq(bookAmounts.reduce((a, v) => a.plus(v), d(0)));
}
