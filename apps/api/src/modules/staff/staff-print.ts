/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { amountInWords, formatMoney } from '@ledgerpro/shared';
import { dual, esc } from '../print/print.service';

interface Company {
  name: string;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  base_currency: string;
  pan: string | null;
  vat_no: string | null;
  abn: string | null;
  tax_id: string | null;
  country: string;
}
interface Employee {
  code: string;
  full_name: string;
  designation: string | null;
  department: string | null;
  pan: string | null;
  ssf_no: string | null;
  bank_name: string | null;
  bank_account: string | null;
  join_date: string | null;
}

const CSS = `
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:12px;margin:0}
  .wrap{max-width:780px;margin:0 auto;padding:8px}
  h1{font-size:20px;margin:0;letter-spacing:.5px;text-transform:uppercase}
  .top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:8px}
  .muted{color:#666;font-size:11px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
  .box{border:1px solid #ccc;border-radius:4px;padding:8px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}
  th{background:#f3f4f6;font-size:11px;text-transform:uppercase}
  .r{text-align:right}
  .sum td{font-weight:700;border-top:2px solid #111}
  .copy{font-weight:600;font-size:11px;border:1px solid #111;padding:2px 6px;display:inline-block;margin-top:4px}
  .stamp{position:fixed;top:40%;left:15%;font-size:72px;color:rgba(200,0,0,.18);transform:rotate(-25deg);font-weight:800}
  .foot{margin-top:36px;display:flex;justify-content:space-between;font-size:11px}
  .net{font-size:16px;font-weight:800;border:2px solid #111;padding:8px;margin-top:12px;display:flex;justify-content:space-between}
`;

function head(co: Company, title: string, rightLines: string, copyLabel: string) {
  const taxId = co.country === 'AU' ? co.abn : co.country === 'NP' ? co.pan ?? co.vat_no : co.tax_id ?? co.vat_no ?? co.pan;
  return `<div class="top">
  <div><div style="font-size:16px;font-weight:700">${esc(co.legal_name ?? co.name)}</div>
  <div class="muted">${esc(co.address ?? '')}</div>
  <div class="muted">${taxId ? 'Tax ID: ' + esc(taxId) : ''}${co.phone ? ' · ' + esc(co.phone) : ''}${co.email ? ' · ' + esc(co.email) : ''}</div></div>
  <div style="text-align:right"><h1>${esc(title)}</h1>${rightLines}<div class="copy">${esc(copyLabel)}</div></div>
</div>`;
}

function who(e: Employee) {
  return `<div class="box"><div class="muted">Employee</div>
    <div style="font-weight:600">${esc(e.full_name)} <span class="muted">(${esc(e.code)})</span></div>
    <div>${esc([e.designation, e.department].filter(Boolean).join(' · '))}</div>
    <div class="muted">${e.pan ? 'PAN: ' + esc(e.pan) : ''}${e.ssf_no ? ' · SSF no.: ' + esc(e.ssf_no) : ''}</div>
    ${e.join_date ? `<div class="muted">Joined: ${dual(e.join_date)}</div>` : ''}</div>`;
}

const row = (label: string, v: string, cur: string, note = '') => `<tr><td>${esc(label)}${note ? `<div class="muted">${esc(note)}</div>` : ''}</td><td class="r">${formatMoney(v, cur)}</td></tr>`;

export function payslipHtml(co: Company, e: Employee, p: any, copyLabel: string, printedAt: string) {
  const cur = co.base_currency;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(p.payslip_no ?? 'DRAFT')}</title><style>${CSS}</style></head><body><div class="wrap">
${p.status === 'CANCELLED' ? '<div class="stamp">CANCELLED</div>' : ''}
${head(co, 'Payslip', `<div><b>No.</b> ${esc(p.payslip_no ?? 'DRAFT')}</div><div><b>Period:</b> ${esc(p.period_label)}</div><div class="muted">${dual(p.period_start)} – ${dual(p.period_end)}</div>`, copyLabel)}
<div class="grid">${who(e)}
  <div class="box"><div class="muted">Payment</div>
    <div>${e.bank_name ? esc(e.bank_name) : '—'}</div><div class="muted">${e.bank_account ? 'A/c: ' + esc(e.bank_account) : ''}</div>
    ${p.status === 'CANCELLED' ? `<div><b>Cancelled:</b> ${esc(p.cancel_reason)}</div>` : ''}</div></div>
<table><thead><tr><th>Earnings</th><th class="r">Amount</th></tr></thead><tbody>
  ${row('Basic salary', p.basic_salary, cur)}${row('Allowance', p.allowance, cur)}${row('Other allowance', p.other_allowance, cur)}
  <tr class="sum"><td>Gross pay</td><td class="r">${formatMoney(p.gross_pay, cur)}</td></tr></tbody></table>
<table><thead><tr><th>Deductions</th><th class="r">Amount</th></tr></thead><tbody>
  ${row('TDS (tax deducted at source)', p.tds_amount, cur)}${row('SSF — employee contribution', p.ssf_employee, cur)}${row('Other deductions', p.other_deductions, cur)}
  <tr class="sum"><td>Total deductions</td><td class="r">${formatMoney(p.total_deductions, cur)}</td></tr></tbody></table>
<div class="net"><span>Net pay (total receivable)</span><span>${formatMoney(p.net_pay, cur, true)}</span></div>
<p><b>In words:</b> ${esc(amountInWords(p.net_pay, cur))}</p>
<p class="muted">Employer's SSF contribution for this period: ${formatMoney(p.ssf_employer, cur)} (paid by the employer — not deducted from your pay).</p>
${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ''}
<div class="foot"><div>Computer-generated payslip · Printed ${esc(printedAt)} UTC</div><div>Authorised signature ____________________</div></div>
</div></body></html>`;
}

export function certificateHtml(co: Company, e: Employee, c: any, fyLabel: string | null, copyLabel: string, printedAt: string) {
  const cur = co.base_currency;
  return `<!doctype html><html><head><meta charset="utf-8"><title>TDS Certificate ${esc(c.cert_no)}</title><style>${CSS}</style></head><body><div class="wrap">
${c.status === 'CANCELLED' ? '<div class="stamp">CANCELLED</div>' : ''}
${head(co, 'TDS Certificate', `<div class="muted">Tax deducted at source — remuneration</div><div><b>No.</b> ${esc(c.cert_no)}</div><div><b>Issued:</b> ${dual(String(c.issued_at).slice(0, 10))}</div>`, copyLabel)}
<div class="grid">${who(e)}
  <div class="box"><div class="muted">Period covered</div>
    <div style="font-weight:600">${fyLabel ? 'Fiscal year ' + esc(fyLabel) : ''}</div>
    <div>${dual(c.period_from)} – ${dual(c.period_to)}</div>
    ${c.tds_deposit_ref ? `<div class="muted">TDS deposit ref: ${esc(c.tds_deposit_ref)}${c.tds_deposit_date ? ' · ' + dual(c.tds_deposit_date) : ''}</div>` : ''}
    ${c.status === 'CANCELLED' ? `<div><b>Cancelled:</b> ${esc(c.cancel_reason)}</div>` : ''}</div></div>
<table><thead><tr><th>Particulars</th><th class="r">Amount</th></tr></thead><tbody>
  ${row('Basic salary', c.basic_salary, cur)}${row('Allowance', c.allowance, cur)}${row('Other allowance', c.other_allowance, cur)}
  <tr class="sum"><td>Total remuneration</td><td class="r">${formatMoney(c.total_remuneration, cur)}</td></tr>
  ${row('TDS deducted', c.tds_deducted, cur)}
  ${row('SSF — employee contribution', c.ssf_employee, cur)}
  ${row('Other deductions', c.other_deductions, cur)}
  <tr class="sum"><td>Total receivable by the employee</td><td class="r">${formatMoney(c.total_receivable, cur, true)}</td></tr>
  ${row('SSF — employer contribution', c.ssf_employer, cur, 'Paid by the employer; not deducted from the employee')}
</tbody></table>
<p><b>TDS deducted, in words:</b> ${esc(amountInWords(c.tds_deducted, cur))}</p>
<p><b>Total receivable, in words:</b> ${esc(amountInWords(c.total_receivable, cur))}</p>
${c.notes ? `<p class="muted">${esc(c.notes)}</p>` : ''}
<p class="muted">Management-format certificate issued by the employer. Where the tax office prescribes a specific form, that form prevails.</p>
<div class="foot"><div>Printed ${esc(printedAt)} UTC</div><div>Authorised signature ____________________<br/>Name &amp; stamp</div></div>
</div></body></html>`;
}
