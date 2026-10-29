/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
'use client';
import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { extractTable, guessMapping, normaliseRows, parseCsv, parseStatementDate, type ColumnMapping, type ImportOptions, type StatementTable } from '@ledgerpro/shared';
import { post } from '@/lib/api';
import { ErrorBanner, Field, Notice, PageHeader } from '@/components/ui';

const MAX_BYTES = 2_000_000;

/** Read the first sheet of an Excel file as rows of text (numbers keep full precision, dates become YYYY-MM-DD). */
async function readSpreadsheet(f: File): Promise<string[][]> {
  const XLSX = await import('@e965/xlsx');
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const out: string[][] = [];
  for (let r = range.s.r; r <= range.e.r && out.length < 10000; r++) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell || cell.v === undefined || cell.v === null) row.push('');
      else if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(String(cell.z))) {
        const p = XLSX.SSF.parse_date_code(cell.v as number);
        row.push(p ? `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}` : String(cell.v));
      } else row.push(String(cell.t === 'n' ? cell.v : (cell.w ?? cell.v)).trim());
    }
    out.push(row);
  }
  return out;
}
type ColKey = 'description' | 'reference' | 'chequeNo' | 'balance' | 'moneyIn' | 'moneyOut' | 'amount' | 'type';
const COLS: { key: ColKey; label: string; hint?: string }[] = [
  { key: 'description', label: 'Description / narration' },
  { key: 'moneyIn', label: 'Money in (deposit / credit)' },
  { key: 'moneyOut', label: 'Money out (withdrawal / debit)' },
  { key: 'amount', label: 'Single amount column', hint: 'Use this instead of the two above when the file has one signed amount (negative = money out).' },
  { key: 'type', label: 'Dr / Cr column', hint: 'Only with a single amount column.' },
  { key: 'reference', label: 'Reference' },
  { key: 'chequeNo', label: 'Cheque number' },
  { key: 'balance', label: 'Running balance' },
];

/** Upload a CSV bank statement: preview, check the column guess, import. */
export default function ImportStatement({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<string[][] | null>(null);
  const [firstRowNo, setFirstRowNo] = useState(2);
  const [map, setMap] = useState<Record<string, number | null>>({});
  const [opt, setOpt] = useState<ImportOptions>({ dateFormat: 'DMY', calendar: 'AD' });
  const [err, setErr] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);

  const [table, setTable] = useState<StatementTable | null>(null);
  const onFile = async (f: File | undefined) => {
    setErr(null);
    setRes(null);
    setMsg('');
    if (!f) return;
    if (f.size > MAX_BYTES) return setMsg('This file is larger than 2 MB. Please export a shorter period.');
    if (!/\.(csv|txt|xls|xlsx)$/i.test(f.name)) return setMsg('Please upload a .xls, .xlsx or .csv file.');
    let parsed: string[][];
    try {
      parsed = /\.(xls|xlsx)$/i.test(f.name) ? await readSpreadsheet(f) : parseCsv(await f.text());
    } catch {
      return setMsg("We couldn't open this file. Please download the statement again from your bank, or save it as CSV.");
    }
    if (parsed.length < 2) return setMsg('The file has no transactions.');
    // bank exports often have title lines, opening/closing balance rows and a footer around the table
    const t = extractTable(parsed);
    setTable(t);
    const header = t ? t.header : parsed[0];
    const body = t ? t.body : parsed.slice(1);
    if (!body.length) return setMsg('The file has no transactions.');
    setFileName(f.name);
    setRows([header, ...body]);
    setFirstRowNo(t ? t.firstRowNo : 2);
    const g = guessMapping(header);
    setMap(g ? { date: g.date, description: g.description ?? null, reference: g.reference ?? null, chequeNo: g.chequeNo ?? null, balance: g.balance ?? null, moneyIn: g.moneyIn ?? null, moneyOut: g.moneyOut ?? null, amount: g.amount ?? null, type: g.type ?? null } : { date: 0 });
    const sample = body[0]?.[g?.date ?? 0] ?? '';
    setOpt((o) => ({ ...o, calendar: /^20[6-9]\d[-/.]/.test(sample.trim()) || /[-/.]20[6-9]\d$/.test(sample.trim()) ? 'BS' : 'AD', dateFormat: /^\d{4}/.test(sample.trim()) ? 'YMD' : o.dateFormat }));
    if (!g) setMsg("We couldn't guess the columns — choose them below.");
  };

  const mapping: ColumnMapping | null = map.date === undefined || map.date === null ? null : (map as unknown as ColumnMapping);
  const result = useMemo(() => (rows && mapping ? normaliseRows(rows.slice(1), mapping, opt, firstRowNo) : null), [rows, map, opt, firstRowNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstDate = result?.lines[0] ? result.lines[0].txnDate : null;
  const lastDate = result?.lines.at(-1) ? result.lines.at(-1)!.txnDate : null;
  const sampleOk = rows && mapping ? parseStatementDate(rows[1]?.[mapping.date] ?? '', opt) : null;

  const submit = async () => {
    if (!result?.lines.length) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await post(`/bank/accounts/${accountId}/import`, { fileName, lines: result.lines, periodFrom: table?.periodFrom ?? undefined, periodTo: table?.periodTo ?? undefined, openingBalance: table?.openingBalance ?? undefined, closingBalance: table?.closingBalance ?? undefined });
      setRes(r);
      qc.invalidateQueries({ queryKey: ['bank-accounts'] });
      qc.invalidateQueries({ queryKey: ['bank', accountId] });
    } catch (x) {
      setErr(x);
    } finally {
      setBusy(false);
    }
  };
  const colSelect = (k: string, allowNone = true) => (
    <select className="input" value={map[k] ?? ''} onChange={(e) => setMap({ ...map, [k]: e.target.value === '' ? null : Number(e.target.value) })}>
      {allowNone && <option value="">— none —</option>}
      {rows![0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
    </select>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      <PageHeader title="Upload bank statement" subtitle="Download your statement from the bank (Excel .xls / .xlsx or CSV) and choose it here." actions={<Link className="btn" href={`/banking/${accountId}`}>Back to reconcile</Link>} />
      <ErrorBanner error={err} />
      {msg && <Notice tone="warn">{msg}</Notice>}
      {res && (
        <Notice tone="ok">
          <b>{res.imported}</b> lines imported{res.skipped > 0 && <>, <b>{res.skipped}</b> skipped because they were already imported</>}. <button className="btn btn-primary btn-sm ml-2" onClick={() => router.push(`/banking/${accountId}`)}>Start matching</button>
        </Notice>
      )}
      <div className="panel p-4"><input type="file" accept=".xls,.xlsx,.csv,.txt,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Statement file" data-testid="stmt-file" /></div>
      {rows && (
        <>
          <div className="panel p-4 space-y-3">
            <div className="font-semibold">1. Check the columns</div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Field label="Date *">{colSelect('date', false)}</Field>
              {COLS.map((c) => <Field key={c.key} label={c.label} hint={c.hint}>{colSelect(c.key)}</Field>)}
            </div>
            <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
              <Field label="Dates in the file are"><select className="input" value={opt.calendar} onChange={(e) => setOpt({ ...opt, calendar: e.target.value as 'AD' | 'BS' })}><option value="AD">AD (English calendar)</option><option value="BS">BS (Nepali calendar)</option></select></Field>
              <Field label="Date order"><select className="input" value={opt.dateFormat} onChange={(e) => setOpt({ ...opt, dateFormat: e.target.value as ImportOptions['dateFormat'] })}><option value="YMD">Year-Month-Day (2026-01-31)</option><option value="DMY">Day/Month/Year (31/01/2026)</option><option value="MDY">Month/Day/Year (01/31/2026)</option></select></Field>
            </div>
            {!sampleOk && <Notice tone="warn">The first date ("{rows[1]?.[mapping?.date ?? 0]}") can't be read with these settings — change the calendar or date order.</Notice>}
          </div>
          {result && (
            <div className="panel p-4 space-y-3">
              <div className="font-semibold">2. Preview</div>
              {table && (table.openingBalance || table.closingBalance) && <div className="text-sm muted">Statement says: opening balance <b>{table.openingBalance ?? '—'}</b>, closing balance <b>{table.closingBalance ?? '—'}</b>{table.periodFrom && <> · period {table.periodFrom} to {table.periodTo}</>}. The closing balance will be pre-filled when you finish the reconciliation.</div>}
              <div className="text-sm"><b>{result.lines.length}</b> transactions readable{firstDate && <> from {firstDate} to {lastDate}</>}{result.issues.length > 0 && <span style={{ color: 'var(--danger)' }}> · {result.issues.length} row(s) can't be read and will be skipped</span>}</div>
              {result.issues.length > 0 && <ul className="text-xs muted list-disc pl-5">{result.issues.slice(0, 5).map((i) => <li key={i.row}>Row {i.row}: {i.message}</li>)}{result.issues.length > 5 && <li>…and {result.issues.length - 5} more</li>}</ul>}
              <div className="overflow-x-auto"><table className="grid text-sm"><thead><tr><th>Date (AD)</th><th>Description</th><th>Reference</th><th className="num">Money in</th><th className="num">Money out</th><th className="num">Balance</th></tr></thead>
                <tbody>{result.lines.slice(0, 8).map((l, i) => <tr key={i}><td>{l.txnDate}</td><td>{l.description}</td><td>{l.reference ?? l.chequeNo}</td><td className="num">{Number(l.moneyIn) ? l.moneyIn : ''}</td><td className="num">{Number(l.moneyOut) ? l.moneyOut : ''}</td><td className="num">{l.balance}</td></tr>)}</tbody></table></div>
              <button className="btn btn-primary" disabled={busy || !result.lines.length || !!res} onClick={submit} data-testid="stmt-import">{busy ? 'Importing…' : `Import ${result.lines.length} transactions`}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
