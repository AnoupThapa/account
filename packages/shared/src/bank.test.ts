/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { describe, expect, it } from 'vitest';
import { groupBalances, guessMapping, normaliseRows, parseAmount, parseCsv, parseStatementDate, suggestMatches } from './bank';
import { toBS } from './bsdate';

describe('parseCsv', () => {
  it('handles quotes, commas inside quotes, CRLF and BOM', () => {
    const r = parseCsv('﻿Date,Description,Amount\r\n01/02/2026,"Shop, Kathmandu ""Main""",-1500.00\r\n');
    expect(r).toEqual([['Date', 'Description', 'Amount'], ['01/02/2026', 'Shop, Kathmandu "Main"', '-1500.00']]);
  });
  it('detects semicolon and tab separators', () => {
    expect(parseCsv('a;b\n1;2')[1]).toEqual(['1', '2']);
    expect(parseCsv('a\tb\n1\t2')[1]).toEqual(['1', '2']);
  });
});

describe('parseAmount', () => {
  it.each([
    ['1,234.50', '1234.50'],
    ['(500.00)', '-500.00'],
    ['Rs. 1,000', '1000.00'],
    ['250 DR', '-250.00'],
    ['250 CR', '250.00'],
    ['-12.5', '-12.50'],
    ['', '0.00'],
  ])('%s → %s', (a, b) => expect(parseAmount(a)).toBe(b));
  it('rejects text', () => expect(parseAmount('abc')).toBeNull());
});

describe('parseStatementDate', () => {
  const ad = { dateFormat: 'DMY', calendar: 'AD' } as const;
  it('reads common AD formats', () => {
    expect(parseStatementDate('2026-01-31', ad)).toBe('2026-01-31');
    expect(parseStatementDate('31/01/2026', ad)).toBe('2026-01-31');
    expect(parseStatementDate('01/31/2026', { ...ad, dateFormat: 'MDY' })).toBe('2026-01-31');
    expect(parseStatementDate('5 Mar 2026', ad)).toBe('2026-03-05');
    expect(parseStatementDate('31/02/2026', ad)).toBeNull();
  });
  it('converts BS dates to AD', () => {
    const bs = toBS('2026-04-14');
    const txt = `${String(bs.day).padStart(2, '0')}/${String(bs.month).padStart(2, '0')}/${bs.year}`;
    expect(parseStatementDate(txt, { dateFormat: 'DMY', calendar: 'BS' })).toBe('2026-04-14');
  });
});

describe('guessMapping + normaliseRows', () => {
  it('Nepal style: separate Debit / Credit columns, BS dates', () => {
    const csv = parseCsv('Tran Date,Particulars,Cheque No,Debit,Credit,Balance\n2083/01/05,Cash deposit,,,"10,000.00","110,000.00"\n2083/01/06,Cheque 123 to Himal Traders,123,"4,000.00",,"106,000.00"');
    const map = guessMapping(csv[0])!;
    expect(map).toMatchObject({ date: 0, description: 1, chequeNo: 2, moneyOut: 3, moneyIn: 4, balance: 5 });
    const { lines, issues } = normaliseRows(csv.slice(1), map, { dateFormat: 'YMD', calendar: 'BS' });
    expect(issues).toEqual([]);
    expect(lines[0]).toMatchObject({ moneyIn: '10000.00', moneyOut: '0.00', balance: '110000.00' });
    expect(lines[1]).toMatchObject({ moneyIn: '0.00', moneyOut: '4000.00', chequeNo: '123' });
  });
  it('Australia style: one signed Amount column', () => {
    const csv = parseCsv('Date,Amount,Description\n31/01/2026,-45.10,Coffee\n01/02/2026,2000.00,Client payment INV-1');
    const map = guessMapping(csv[0])!;
    const { lines } = normaliseRows(csv.slice(1), map, { dateFormat: 'DMY', calendar: 'AD' });
    expect(lines.map((l) => [l.txnDate, l.moneyIn, l.moneyOut])).toEqual([['2026-01-31', '0.00', '45.10'], ['2026-02-01', '2000.00', '0.00']]);
  });
  it('Amount + Dr/Cr column', () => {
    const csv = parseCsv('Date,Amount,Type,Narration\n01/02/2026,100.00,DR,x\n02/02/2026,50.00,CR,y');
    const { lines } = normaliseRows(csv.slice(1), guessMapping(csv[0])!, { dateFormat: 'DMY', calendar: 'AD' });
    expect(lines.map((l) => [l.moneyIn, l.moneyOut])).toEqual([['0.00', '100.00'], ['50.00', '0.00']]);
  });
  it('reports unreadable rows with the row number and skips empty rows', () => {
    const csv = parseCsv('Date,Amount\nnot a date,5\n01/02/2026,0\n01/02/2026,x');
    const { lines, issues } = normaliseRows(csv.slice(1), guessMapping(csv[0])!, { dateFormat: 'DMY', calendar: 'AD' });
    expect(lines).toEqual([]);
    expect(issues.map((i) => i.row)).toEqual([2, 4]);
  });
});

describe('suggestMatches', () => {
  const stmt = [
    { id: 's1', date: '2026-02-01', amount: '5000.00', description: 'CHQ 778 deposit', chequeNo: '778' },
    { id: 's2', date: '2026-02-02', amount: '-1200.00', description: 'Payment to Himal Traders' },
    { id: 's3', date: '2026-02-10', amount: '300.00', description: 'Misc credit' },
    { id: 's4', date: '2026-02-12', amount: '900.00', description: 'Sunrise Co' },
  ];
  const book = [
    { id: 'b1', date: '2026-02-01', amount: '5000.00', description: 'Cheque 778', sourceNo: 'RCT-1', contactId: 'c1', contactName: 'Alpha' },
    { id: 'b2', date: '2026-02-01', amount: '-1200.00', description: '', sourceNo: 'PAY-9', contactId: 'c2', contactName: 'Himal Traders' },
    { id: 'b3', date: '2026-02-20', amount: '300.00', description: 'unrelated', sourceNo: 'RCT-2', contactId: 'c3', contactName: 'Zed' },
    { id: 'b4', date: '2026-02-11', amount: '400.00', description: '', sourceNo: 'RCT-3', contactId: 'c4', contactName: 'Sunrise Co' },
    { id: 'b5', date: '2026-02-11', amount: '500.00', description: '', sourceNo: 'RCT-4', contactId: 'c4', contactName: 'Sunrise Co' },
  ];
  const r = suggestMatches(stmt, book);
  const of = (id: string) => r.find((x) => x.statementLineId === id)!;
  it('reference + amount is automatic', () => expect(of('s1')).toMatchObject({ tier: 'REFERENCE', auto: true, journalLineIds: ['b1'] }));
  it('amount within 3 days is automatic', () => expect(of('s2')).toMatchObject({ tier: 'DATE_AMOUNT', auto: true, journalLineIds: ['b2'] }));
  it('amount only is a suggestion, never automatic', () => expect(of('s3')).toMatchObject({ tier: 'AMOUNT', auto: false, journalLineIds: ['b3'] }));
  it('two book items of one contact adding up are suggested', () => {
    const c = of('s4');
    expect(c.tier).toBe('COMBINATION');
    expect(c.auto).toBe(false);
    expect([...c.journalLineIds].sort()).toEqual(['b4', 'b5']);
  });
  it('never uses a book item twice', () => {
    const ids = r.flatMap((x) => x.journalLineIds);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('two equal statement lines do not both grab the same book item', () => {
    const rr = suggestMatches(
      [{ id: 'x1', date: '2026-03-01', amount: '10.00', description: '' }, { id: 'x2', date: '2026-03-01', amount: '10.00', description: '' }],
      [{ id: 'y1', date: '2026-03-01', amount: '10.00' }],
    );
    expect(rr.length).toBe(1);
    expect(rr[0].auto).toBe(false); // ambiguous → needs confirmation
  });
});

describe('groupBalances', () => {
  it('requires both sides and equal sums', () => {
    expect(groupBalances(['100.00', '50.00'], ['150.00'])).toBe(true);
    expect(groupBalances(['100.00'], ['99.99'])).toBe(false);
    expect(groupBalances([], ['0.00'])).toBe(false);
  });
});
