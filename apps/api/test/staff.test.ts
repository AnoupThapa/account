/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Staff portal & HR acceptance (docs/15 §12.4): staff self-service, HR Manager, attendance, payslips, manual TDS certificates. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { adminDb, addMember, closeApp, createUser, getApp, setupCompany, TestClient } from './helpers';

afterAll(closeApp);

interface Staff { id: string; code: string; client: TestClient }

let admin: TestClient;
let hr: TestClient;
let periodId: string;
let periodId2: string;
const staff: Record<string, Staff> = {};

async function newStaff(name: string, salary?: { basic: string; allowance: string; other: string }, withLogin = true): Promise<Staff> {
  const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${Math.random().toString(36).slice(2, 7)}@test.local`;
  const e = await hr.post('/staff', { fullName: name, email, designation: 'Officer', department: 'Operations', pan: '123456789', joinDate: '2026-07-20' });
  if (e.status !== 201) throw new Error('staff create failed: ' + JSON.stringify(e.body));
  if (salary) {
    const s = await hr.post(`/staff/${e.body.id}/salary`, { effectiveFrom: '2026-07-17', basicSalary: salary.basic, allowance: salary.allowance, otherAllowance: salary.other });
    if (s.status !== 201) throw new Error('salary failed: ' + JSON.stringify(s.body));
  }
  let client = null as unknown as TestClient;
  if (withLogin) {
    const u = await createUser({ email, name });
    const l = await hr.post(`/staff/${e.body.id}/login`, {});
    if (l.status !== 201) throw new Error('login failed: ' + JSON.stringify(l.body));
    client = await new TestClient(await getApp(), u.email).init();
    await client.login();
    client.companyId = admin.companyId;
  }
  return { id: e.body.id, code: e.body.code, client };
}

beforeAll(async () => {
  ({ admin } = await setupCompany('NP'));
  hr = await addMember(admin, ['HR_MANAGER'], 'Hari HR Manager');
  const fys = (await admin.get('/fiscal-years')).body;
  periodId = fys[0].periods[0].id;
  periodId2 = fys[0].periods[1].id;
  staff.asha = await newStaff('Asha Gurung', { basic: '50000', allowance: '5000', other: '2500' });
  staff.bimal = await newStaff('Bimal Thapa', { basic: '40000', allowance: '3000', other: '0' });
  staff.chitra = await newStaff('Chitra Rai', undefined, false); // no salary, no login
});

describe('roles', () => {
  it('HR Manager and Staff roles exist; Staff can only use self-service', async () => {
    const roles = (await admin.get('/roles')).body as { key: string }[];
    expect(roles.map((r) => r.key)).toEqual(expect.arrayContaining(['HR_MANAGER', 'STAFF']));
    const me = (await staff.asha.client.get('/me/access')).body;
    expect(me.permissions).toEqual(['self.view']);
  });
  it('HR Manager cannot touch accounting data or roles', async () => {
    expect((await hr.get('/journals')).status).toBe(403);
    expect((await hr.get('/reports/trial-balance?from=2026-10-01&to=2026-10-31')).status).toBe(403);
    expect((await hr.get('/roles')).status).toBe(403);
  });
});

describe('staff profiles (HR Manager sees all, Staff sees only themselves)', () => {
  it('HR Manager lists every staff member, with salary history', async () => {
    const list = (await hr.get('/staff')).body as { full_name: string; has_login: boolean }[];
    expect(list.map((s) => s.full_name)).toEqual(expect.arrayContaining(['Asha Gurung', 'Bimal Thapa', 'Chitra Rai']));
    expect(list.find((s) => s.full_name === 'Chitra Rai')!.has_login).toBe(false);
    const one = (await hr.get(`/staff/${staff.asha.id}`)).body;
    expect(one.salary[0]).toMatchObject({ basic_salary: '50000.00', allowance: '5000.00', other_allowance: '2500.00' });
    expect(staff.asha.code).toBe('EMP-0001');
  });
  it('a staff member sees only their own profile and cannot open the staff list or anyone else', async () => {
    const mine = (await staff.asha.client.get('/me/staff')).body;
    expect(mine).toMatchObject({ full_name: 'Asha Gurung', code: 'EMP-0001' });
    expect(mine.salary.basic_salary).toBe('50000.00');
    expect(mine.user_id).toBeUndefined();
    expect((await staff.asha.client.get('/staff')).status).toBe(403);
    expect((await staff.asha.client.get(`/staff/${staff.bimal.id}`)).status).toBe(403);
    expect((await staff.asha.client.get(`/staff/${staff.bimal.id}/salary`)).status).toBe(403);
    expect((await staff.asha.client.get('/payslips')).status).toBe(403);
    expect((await staff.asha.client.get('/tds-certificates')).status).toBe(403);
  });
  it('a login belongs to exactly one staff member; a user without a staff record gets a clear message', async () => {
    expect((await hr.post(`/staff/${staff.asha.id}/login`, {})).status).toBe(409);
    const r = await admin.get('/me/staff');
    expect(r.status).toBe(404); // the company admin has self.view but no staff record
    expect(r.body.code).toBe('HR_NOT_STAFF');
    const hrSelf = await hr.get('/me/staff'); // HR Manager has self.view but no staff record
    expect(hrSelf.status).toBe(404);
    expect(hrSelf.body.code).toBe('HR_NOT_STAFF');
  });
  it('creating a login for a brand-new email needs an initial password; the account must change it', async () => {
    const e = (await hr.post('/staff', { fullName: 'Dipak Karki', email: `dipak.${Date.now()}@test.local` })).body;
    const noPw = await hr.post(`/staff/${e.id}/login`, {});
    expect(noPw.status).toBe(422);
    const ok = await hr.post(`/staff/${e.id}/login`, { initialPassword: 'Correct-Horse-Battery-9' });
    expect(ok.status).toBe(201);
    const db = await adminDb();
    const u = await db.query('SELECT must_change_password FROM users WHERE id = $1', [ok.body.userId]);
    await db.end();
    expect(u.rows[0].must_change_password).toBe(true);
  });
});

describe('attendance', () => {
  it('staff clock in and out from their portal; double clock-in is refused; a very short day is a half day', async () => {
    const c = staff.asha.client;
    const inn = await c.post('/me/attendance/clock-in');
    expect(inn.status).toBe(201);
    expect(['PRESENT', 'LATE']).toContain(inn.body.status);
    expect((await c.post('/me/attendance/clock-in')).status).toBe(409);
    const out = await c.post('/me/attendance/clock-out');
    expect(out.status).toBe(201);
    expect(out.body.status).toBe('HALF_DAY'); // worked 0 minutes < half-day threshold
    expect((await c.post('/me/attendance/clock-out')).status).toBe(409);
    const today = (await c.get('/me/staff')).body.today.date;
    const mine = (await c.get(`/me/attendance?from=${today}&to=${today}`)).body;
    expect(mine.days[0]).toMatchObject({ status: 'HALF_DAY', source: 'WEB' });
  });
  it('clock-in is late after the start time plus grace (HR setting)', async () => {
    expect((await hr.patch('/hr/settings', { workStart: '00:00', graceMinutes: 0 })).status).toBe(200);
    const r = await staff.bimal.client.post('/me/attendance/clock-in');
    expect(r.body.status).toBe('LATE');
    await hr.patch('/hr/settings', { workStart: '10:00', graceMinutes: 15 });
  });
  it('HR sees everyone on the daily sheet and the register; corrections need a reason and are logged; staff cannot correct', async () => {
    const today = (await staff.asha.client.get('/me/staff')).body.today.date;
    const daily = (await hr.get(`/attendance/daily?date=${today}`)).body;
    expect(daily.rows.map((r: { full_name: string }) => r.full_name)).toEqual(expect.arrayContaining(['Asha Gurung', 'Bimal Thapa']));
    const reg = (await hr.get(`/attendance/register?from=${today}&to=${today}`)).body;
    expect(reg.rows.length).toBeGreaterThanOrEqual(3);
    const no = await hr.put(`/attendance/staff/${staff.chitra.id}/${today}`, { status: 'LEAVE' });
    expect(no.status).toBe(422);
    const ok = await hr.put(`/attendance/staff/${staff.chitra.id}/${today}`, { status: 'LEAVE', remarks: 'Approved sick leave by phone' });
    expect(ok.status).toBe(200);
    const fixed = await hr.put(`/attendance/staff/${staff.bimal.id}/${today}`, { status: 'PRESENT', checkIn: '09:55', checkOut: '18:05', remarks: 'Forgot to clock out' });
    expect(fixed.body).toMatchObject({ status: 'PRESENT', worked_minutes: 490, source: 'MANUAL' });
    expect((await staff.asha.client.put(`/attendance/staff/${staff.asha.id}/${today}`, { status: 'PRESENT', remarks: 'self edit' })).status).toBe(403);
    const audit = (await admin.get('/audit-logs?entity=attendance_day')).body;
    expect(JSON.stringify(audit)).toContain('attendance_day');
  });
});

describe('payslips: HR generates and sends; staff review them in their portal', () => {
  let slip: { id: string; version: number };
  it('a draft is built from the salary structure and company SSF rates; TDS is typed in; totals add up', async () => {
    const r = await hr.post('/payslips', { employeeId: staff.asha.id, periodId });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ basic_salary: '50000.00', gross_pay: '57500.00', ssf_employee: '5500.00', ssf_employer: '10000.00', tds_amount: '0.00', net_pay: '52000.00', status: 'DRAFT' });
    const e = await hr.patch(`/payslips/${r.body.id}`, { tdsAmount: '1200', otherDeductions: '300', version: r.body.version });
    expect(e.body).toMatchObject({ total_deductions: '7000.00', net_pay: '50500.00' });
    slip = e.body;
  });
  it('nobody gets two active payslips for one period; no salary → clear error; deductions over gross are refused', async () => {
    expect((await hr.post('/payslips', { employeeId: staff.asha.id, periodId })).status).toBe(409);
    const ns = await hr.post('/payslips', { employeeId: staff.chitra.id, periodId });
    expect(ns.body.code).toBe('HR_NO_SALARY');
    const over = await hr.post('/payslips', { employeeId: staff.bimal.id, periodId, tdsAmount: '999999' });
    expect(over.status).toBe(422);
  });
  it('a draft is invisible to staff; sending numbers it, locks it, queues an email and shows it in the portal', async () => {
    expect(((await staff.asha.client.get('/me/payslips')).body as unknown[]).length).toBe(0);
    const sent = await hr.post(`/payslips/${slip.id}/send`);
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: 'SENT', payslip_no: 'PS-2083/84-00001', hasLogin: true, emailQueued: true });
    const db = await adminDb();
    const ob = await db.query(`SELECT payload FROM integration_outbox WHERE event_type = 'PAYSLIP_SENT' AND payload->>'payslipNo' = 'PS-2083/84-00001'`);
    expect(ob.rowCount).toBe(1);
    expect(JSON.stringify(ob.rows[0].payload)).not.toContain('50500'); // the email carries no salary figures
    // the database itself refuses to change a sent payslip
    await expect(db.query(`UPDATE payslips SET net_pay = 1, total_deductions = 57499 WHERE id = $1`, [slip.id])).rejects.toThrow(/cannot be edited/);
    await db.end();
    expect((await hr.patch(`/payslips/${slip.id}`, { tdsAmount: '5', version: 99 })).status).toBe(409);
    const list = (await staff.asha.client.get('/me/payslips')).body as { id: string; payslip_no: string; net_pay: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ payslip_no: 'PS-2083/84-00001', net_pay: '50500.00' });
  });
  it('the staff member can open, print and acknowledge it; HR sees that it was viewed and acknowledged', async () => {
    const c = staff.asha.client;
    const v = (await c.get(`/me/payslips/${slip.id}`)).body;
    expect(v.viewed_at).toBeTruthy();
    const html = await c.get(`/me/payslips/${slip.id}/print?format=html`);
    expect(html.text).toContain('Net pay (total receivable)');
    expect(html.text).toContain('50,500.00');
    expect(html.text).toContain('Original');
    expect((await c.post(`/me/payslips/${slip.id}/acknowledge`)).status).toBe(201);
    const row = (await hr.get(`/payslips?employeeId=${staff.asha.id}`)).body[0];
    expect(row.viewed_at).toBeTruthy();
    expect(row.acknowledged_at).toBeTruthy();
  });
  it('another staff member can never read, print or acknowledge it', async () => {
    const c = staff.bimal.client;
    expect(((await c.get('/me/payslips')).body as unknown[]).length).toBe(0);
    expect((await c.get(`/me/payslips/${slip.id}`)).status).toBe(404);
    expect((await c.get(`/me/payslips/${slip.id}/print?format=html`)).status).toBe(404);
    expect((await c.post(`/me/payslips/${slip.id}/acknowledge`)).status).toBe(404);
  });
  it('a wrong payslip is cancelled with a reason (number kept) and can be re-issued', async () => {
    expect((await hr.post(`/payslips/${slip.id}/cancel`, {})).status).toBe(422);
    const c = await hr.post(`/payslips/${slip.id}/cancel`, { reason: 'TDS typed wrongly' });
    expect(c.body).toMatchObject({ status: 'CANCELLED', payslip_no: 'PS-2083/84-00001' });
    expect(((await staff.asha.client.get('/me/payslips')).body as unknown[]).length).toBe(0);
    const again = await hr.post('/payslips', { employeeId: staff.asha.id, periodId, tdsAmount: '1000' });
    expect(again.status).toBe(201);
    const sent = await hr.post(`/payslips/${again.body.id}/send`);
    expect(sent.body.payslip_no).toBe('PS-2083/84-00002'); // gapless: next number, no hole
  });
  it('"draft for everyone" skips staff without a salary and anyone who already has a payslip', async () => {
    const r = (await hr.post('/payslips/draft-all', { periodId })).body;
    expect(r.created).toBe(1); // Bimal; Asha already has one; Chitra and Dipak have no salary
    expect(r.skipped.map((s: { name: string }) => s.name)).toEqual(expect.arrayContaining(['Asha Gurung', 'Chitra Rai']));
    const sent = (await hr.post('/payslips/send-all', { periodId })).body;
    expect(sent.sent).toBe(1);
    expect(((await staff.bimal.client.get('/me/payslips')).body as unknown[]).length).toBe(1);
  });
  it('HR prints any payslip; staff-only users cannot generate or send', async () => {
    const list = (await hr.get(`/payslips?employeeId=${staff.bimal.id}`)).body;
    const html = await hr.get(`/payslips/${list[0].id}/print?format=html`);
    expect(html.text).toContain('Bimal Thapa');
    expect((await staff.bimal.client.post('/payslips', { employeeId: staff.bimal.id, periodId: periodId2 })).status).toBe(403);
  });
});

describe('TDS certificate (manual, by Admin or HR Manager)', () => {
  const full = { periodFrom: '2026-07-17', periodTo: '2027-07-16', basicSalary: '600000', allowance: '60000', otherAllowance: '30000', tdsDeducted: '12000', ssfEmployee: '66000', ssfEmployer: '120000', otherDeductions: '5000' };
  let cert: { id: string; cert_no: string };
  it('the Admin issues a certificate with every field; totals are computed; employer SSF is shown but not deducted', async () => {
    const r = await admin.post('/tds-certificates', { employeeId: staff.asha.id, ...full, tdsDepositRef: 'IRD-778899', tdsDepositDate: '2026-11-10' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      cert_no: 'TDSC-2083/84-00001', basic_salary: '600000.00', allowance: '60000.00', other_allowance: '30000.00', total_remuneration: '690000.00',
      tds_deducted: '12000.00', ssf_employee: '66000.00', ssf_employer: '120000.00', other_deductions: '5000.00', total_receivable: '607000.00', source: 'MANUAL', status: 'ISSUED',
    });
    cert = r.body;
  });
  it('the HR Manager can issue too; a pre-filled certificate equals the sum of the sent payslips', async () => {
    const s = (await hr.get(`/tds-certificates/suggest?employeeId=${staff.asha.id}&from=2026-07-17&to=2027-07-16`)).body;
    expect(s).toMatchObject({ payslips: 1, basicSalary: '50000.00', tdsDeducted: '1000.00', ssfEmployee: '5500.00', ssfEmployer: '10000.00' });
    const r = await hr.post('/tds-certificates', { employeeId: staff.asha.id, periodFrom: '2026-07-17', periodTo: '2027-07-16', source: 'PAYSLIPS' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ cert_no: 'TDSC-2083/84-00002', total_remuneration: '57500.00', total_receivable: '51000.00', source: 'PAYSLIPS' });
    const none = await hr.post('/tds-certificates', { employeeId: staff.chitra.id, periodFrom: '2026-07-17', periodTo: '2027-07-16', source: 'PAYSLIPS' });
    expect(none.status).toBe(422);
  });
  it('amounts that do not add up are refused (deductions above remuneration); staff cannot issue', async () => {
    const bad = await admin.post('/tds-certificates', { employeeId: staff.asha.id, ...full, tdsDeducted: '9999999' });
    expect(bad.status).toBe(422);
    expect((await staff.asha.client.post('/tds-certificates', { employeeId: staff.asha.id, ...full })).status).toBe(403);
  });
  it('an issued certificate cannot be edited (database rule); it prints with every figure; copies are counted', async () => {
    const db = await adminDb();
    await expect(db.query(`UPDATE tds_certificates SET tds_deducted = 1, total_receivable = 689999 WHERE id = $1`, [cert.id])).rejects.toThrow(/cannot be edited/);
    await db.end();
    const h1 = (await admin.get(`/tds-certificates/${cert.id}/print?format=html`)).text;
    const plain = h1.replace(/,/g, ''); // Nepali amounts are grouped in lakhs (6,00,000.00) — compare the digits
    for (const t of ['TDSC-2083/84-00001', 'Basic salary', '600000.00', 'Allowance', 'Other allowance', 'Total remuneration', '690000.00', 'TDS deducted', '12000.00', 'SSF — employee contribution', '66000.00', 'SSF — employer contribution', '120000.00', 'Other deductions', '5000.00', 'Total receivable', '607000.00', 'IRD-778899', 'Original']) expect(plain).toContain(t);
    expect((await admin.get(`/tds-certificates/${cert.id}/print?format=html`)).text).toContain('Copy of original (1)');
  });
  it('the staff member sees and prints only their own certificates', async () => {
    const mine = (await staff.asha.client.get('/me/tds-certificates')).body as { cert_no: string }[];
    expect(mine.map((c) => c.cert_no).sort()).toEqual(['TDSC-2083/84-00001', 'TDSC-2083/84-00002']);
    expect((await staff.asha.client.get(`/me/tds-certificates/${cert.id}/print?format=html`)).text.replace(/,/g, '')).toContain('607000.00');
    expect(((await staff.bimal.client.get('/me/tds-certificates')).body as unknown[]).length).toBe(0);
    expect((await staff.bimal.client.get(`/me/tds-certificates/${cert.id}/print?format=html`)).status).toBe(404);
  });
  it('cancelling needs a reason and keeps the number; the staff member no longer sees it', async () => {
    expect((await admin.post(`/tds-certificates/${cert.id}/cancel`, {})).status).toBe(422);
    const c = await admin.post(`/tds-certificates/${cert.id}/cancel`, { reason: 'Wrong SSF figure' });
    expect(c.body).toMatchObject({ status: 'CANCELLED', cert_no: 'TDSC-2083/84-00001' });
    expect(((await staff.asha.client.get('/me/tds-certificates')).body as unknown[]).length).toBe(1);
    const re = await admin.post('/tds-certificates', { employeeId: staff.asha.id, ...full, ssfEmployee: '60000' });
    expect(re.body.cert_no).toBe('TDSC-2083/84-00003');
  });
});

describe('company isolation', () => {
  it('another company’s HR Manager sees none of this staff, payslips or certificates', async () => {
    const { admin: other } = await setupCompany('NP');
    const hr2 = await addMember(other, ['HR_MANAGER'], 'Other HR Manager');
    expect(((await hr2.get('/staff')).body as unknown[]).length).toBe(0);
    expect((await hr2.get(`/staff/${staff.asha.id}`)).status).toBe(404);
    expect(((await hr2.get('/payslips')).body as unknown[]).length).toBe(0);
    expect(((await hr2.get('/tds-certificates')).body as unknown[]).length).toBe(0);
    hr2.companyId = admin.companyId; // even naming the other company in the header gives nothing
    expect((await hr2.get('/staff')).status).toBeGreaterThanOrEqual(403);
  });
});
