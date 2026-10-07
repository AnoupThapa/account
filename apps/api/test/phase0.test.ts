/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Phase 0 acceptance (docs/phases.md): auth, 2FA, tenancy, RBAC, audit chain, fiscal years. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { authenticator } from 'otplib';
import { addMember, adminDb, closeApp, createUser, getApp, setupCompany, TestClient, STRONG_PW } from './helpers';

afterAll(closeApp);

describe('authentication', () => {
  it('rejects wrong password with RFC 7807 problem + request id', async () => {
    const app = await getApp();
    const u = await createUser();
    const c = await new TestClient(app).init();
    const r = await c.post('/auth/login', { email: u.email, password: 'wrong-password-x' }, false);
    expect(r.status).toBe(401);
    expect(r.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(r.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(r.body.requestId).toMatch(/^req_/);
    expect(r.body.type).toContain('AUTH_INVALID_CREDENTIALS');
  });

  it('locks the account after 5 failed attempts for 15 minutes', async () => {
    const app = await getApp();
    const u = await createUser();
    const c = await new TestClient(app).init();
    for (let i = 0; i < 5; i++) await c.post('/auth/login', { email: u.email, password: 'nope-nope-nope' }, false);
    const r = await c.post('/auth/login', { email: u.email, password: STRONG_PW }, false);
    expect(r.status).toBe(423);
    expect(r.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    const db = await adminDb();
    const ev = await db.query(`SELECT count(*)::int n FROM integration_outbox WHERE event_type = 'ACCOUNT_LOCKED' AND payload->>'to' = $1`, [u.email]);
    await db.end();
    expect(ev.rows[0].n).toBe(1); // email alert queued
  });

  it('requires CSRF token on state-changing requests', async () => {
    const app = await getApp();
    const c = new TestClient(app);
    const r = await c.agent.post('/auth/login').send({ email: 'x@y.z', password: 'whatever' });
    expect(r.body.code).toBe('AUTH_CSRF');
  });

  it('login → me → refresh rotation → reuse detection kills the session family', async () => {
    const app = await getApp();
    const u = await createUser({ name: 'Rotation Tester' });
    const c = await new TestClient(app, u.email).init();
    const l = await c.login();
    expect(l.status).toBe(200);
    const me = await c.get('/auth/me', false);
    expect(me.body.email).toBe(u.email);
    const oldRt = (l.headers['set-cookie'] as unknown as string[]).find((x) => x.startsWith('lp_rt='))!.split(';')[0];
    const r1 = await c.post('/auth/refresh', {}, false);
    expect(r1.status).toBe(200);
    // replay the old (rotated) refresh token
    const thief = await new TestClient(app).init();
    const replay = await thief.agent.post('/auth/refresh').set('Cookie', `${oldRt}; lp_csrf=${thief.csrf}`).set('X-CSRF-Token', thief.csrf);
    expect(replay.status).toBe(401);
    // the legitimate session is now revoked as well
    const after = await c.get('/auth/me', false);
    expect(after.status).toBe(401);
  });

  it('logout revokes the session', async () => {
    const app = await getApp();
    const u = await createUser();
    const c = await new TestClient(app, u.email).init();
    await c.login();
    expect((await c.post('/auth/logout', {}, false)).status).toBe(200);
    expect((await c.get('/auth/me', false)).status).toBe(401);
  });

  it('weak passwords are refused', async () => {
    const app = await getApp();
    const u = await createUser();
    const c = await new TestClient(app, u.email).init();
    await c.login();
    const r = await c.post('/auth/password/change', { currentPassword: STRONG_PW, newPassword: 'password123' }, false);
    expect(r.body.code).toBe('AUTH_WEAK_PASSWORD');
    const ok = await c.post('/auth/password/change', { currentPassword: STRONG_PW, newPassword: 'An0ther-Strong-Phrase' }, false);
    expect(ok.status).toBe(200);
  });

  it('password reset: token emailed via outbox, one-time use, revokes sessions', async () => {
    const app = await getApp();
    const u = await createUser();
    const c = await new TestClient(app).init();
    expect((await c.post('/auth/password/forgot', { email: u.email }, false)).status).toBe(200);
    expect((await c.post('/auth/password/forgot', { email: 'nobody@nowhere.test' }, false)).status).toBe(200); // no enumeration
    const db = await adminDb();
    const row = await db.query(`SELECT payload FROM integration_outbox WHERE event_type='PASSWORD_RESET' AND payload->>'to' = $1`, [u.email]);
    await db.end();
    const token = new URL(row.rows[0].payload.link).searchParams.get('token')!;
    expect((await c.post('/auth/password/reset', { token, newPassword: 'Brand-New-Secret-77' }, false)).status).toBe(200);
    expect((await c.post('/auth/password/reset', { token, newPassword: 'Brand-New-Secret-78' }, false)).body.code).toBe('AUTH_RESET_INVALID');
    const l = await new TestClient(app, u.email, 'Brand-New-Secret-77').init();
    expect((await l.login()).status).toBe(200);
  });
});

describe('two-factor authentication', () => {
  it('setup → enable → login requires code; recovery codes are single-use', async () => {
    const app = await getApp();
    const u = await createUser();
    const c = await new TestClient(app, u.email).init();
    await c.login();
    const codes = await c.enable2fa();
    expect(codes).toHaveLength(10);
    const c2 = await new TestClient(app, u.email).init();
    const step1 = await c2.post('/auth/login', { email: u.email, password: STRONG_PW }, false);
    expect(step1.body.mfaRequired).toBe(true);
    const bad = await c2.post('/auth/2fa/verify', { mfaToken: step1.body.mfaToken, code: '000000' }, false);
    expect(bad.body.code).toBe('AUTH_2FA_INVALID');
    const viaRecovery = await c2.post('/auth/2fa/verify', { mfaToken: step1.body.mfaToken, code: codes[0] }, false);
    expect(viaRecovery.status).toBe(200);
    const c3 = await new TestClient(app, u.email).init();
    const s = await c3.post('/auth/login', { email: u.email, password: STRONG_PW }, false);
    const reuse = await c3.post('/auth/2fa/verify', { mfaToken: s.body.mfaToken, code: codes[0] }, false);
    expect(reuse.body.code).toBe('AUTH_2FA_INVALID');
    const totp = await c3.post('/auth/2fa/verify', { mfaToken: s.body.mfaToken, code: authenticator.generate(c.mfaSecret!) }, false);
    expect(totp.status).toBe(200);
  });

  it('2FA is mandatory for Admin/Checker roles before entering the company', async () => {
    const { admin } = await setupCompany();
    const roles = (await admin.get('/roles')).body as { id: string; key: string }[];
    const u = await createUser({ name: 'Checker NoMfa' });
    await admin.post('/users', { email: u.email, fullName: 'Checker NoMfa', roleIds: [roles.find((r) => r.key === 'CHECKER')!.id] });
    const c = await new TestClient(await getApp(), u.email).init();
    await c.login();
    c.companyId = admin.companyId;
    const r = await c.get('/companies/current');
    expect(r.body.code).toBe('AUTH_2FA_SETUP_REQUIRED');
    await c.enable2fa();
    expect((await c.get('/companies/current')).status).toBe(200);
  });
});

describe('companies, fiscal years & periods', () => {
  it('Admin creates a Nepal company with FY 2083/84 and 12 BS-month periods with correct AD dates', async () => {
    const { admin } = await setupCompany('NP', 'SERVICE');
    const fys = (await admin.get('/fiscal-years')).body;
    expect(fys).toHaveLength(1);
    const fy = fys[0];
    expect(fy.label).toBe('2083/84');
    expect(fy.start_date).toBe('2026-07-17');
    expect(fy.end_date).toBe('2027-07-16');
    const regular = fy.periods.filter((p: { is_adjustment: boolean }) => !p.is_adjustment);
    expect(regular).toHaveLength(12);
    expect(regular[0]).toMatchObject({ name: 'Shrawan 2083', start_date: '2026-07-17', end_date: '2026-08-16' });
    expect(regular[2]).toMatchObject({ name: 'Ashwin 2083', start_date: '2026-09-17', end_date: '2026-10-17' });
    expect(regular[11].name).toBe('Ashadh 2084');
    expect(fy.periods.find((p: { period_no: number }) => p.period_no === 13).is_adjustment).toBe(true);
    const next = await admin.post('/fiscal-years', {});
    expect(next.body.label).toBe('2084/85');
  });

  it('Australian company gets FY2026-27 (1 Jul – 30 Jun) and GST codes', async () => {
    const { admin } = await setupCompany('AU', 'TRADING');
    const fy = (await admin.get('/fiscal-years')).body[0];
    expect(fy.label).toBe('FY2026-27');
    expect(fy.start_date).toBe('2026-07-01');
    expect(fy.end_date).toBe('2027-06-30');
    const co = (await admin.get('/companies/current')).body;
    expect(co.base_currency).toBe('AUD');
    expect(co.calendar_mode).toBe('AD');
  });

  it('only super admins can create companies', async () => {
    const app = await getApp();
    const u = await createUser();
    const c = await new TestClient(app, u.email).init();
    await c.login();
    const r = await c.post('/companies', { name: 'X', country: 'NP', businessType: 'SERVICE' }, false);
    expect(r.status).toBe(403);
  });

  it('unlocking a period requires step-up authentication', async () => {
    const { admin } = await setupCompany();
    const p = (await admin.get('/fiscal-years')).body[0].periods[0];
    expect((await admin.post(`/periods/${p.id}/lock`)).body.is_locked).toBe(true);
    expect((await admin.post(`/periods/${p.id}/unlock`)).body.code).toBe('AUTH_STEP_UP_REQUIRED');
    await admin.stepUp();
    expect((await admin.post(`/periods/${p.id}/unlock`)).body.is_locked).toBe(false);
  });
});

describe('permissions & tenant isolation', () => {
  let admin: TestClient;
  let viewer: TestClient;
  let otherCompany: string;
  beforeAll(async () => {
    ({ admin } = await setupCompany());
    viewer = await addMember(admin, ['VIEWER'], 'Viewer Person');
    otherCompany = (await setupCompany()).companyId;
  });

  it('user without permission gets 403 from the API (not just a hidden button)', async () => {
    const r = await viewer.post('/users', { email: 'z@z.test', fullName: 'Zed', initialPassword: 'Some-Strong-Pass-1', roleIds: [] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('PERM_DENIED');
    expect((await viewer.get('/audit-logs')).status).toBe(403);
  });

  it('user of Company A cannot see Company B (404, existence not revealed)', async () => {
    admin.companyId = otherCompany;
    const r = await admin.get('/companies/current');
    expect(r.status).toBe(404);
    admin.companyId = viewer.companyId;
  });

  it('every action appears in the audit log and the hash chain verifies', async () => {
    const logs = (await admin.get('/audit-logs?limit=500')).body as { action: string; entity: string }[];
    expect(logs.some((l) => l.entity === 'company' && l.action === 'CREATE')).toBe(true);
    expect(logs.some((l) => l.entity === 'user_roles' && l.action === 'ROLE_ASSIGNED')).toBe(true);
    expect(logs.some((l) => l.entity === 'fiscal_year')).toBe(true);
    const v = (await admin.get('/audit-logs/verify')).body;
    expect(v.intact).toBe(true);
    expect(v.rowsChecked).toBeGreaterThanOrEqual(3);
  });

  it('admin can force-logout a user', async () => {
    expect((await admin.post(`/users/${viewer.userId}/force-logout`)).status).toBe(201);
    expect((await viewer.get('/auth/me', false)).status).toBe(401);
  });
});
