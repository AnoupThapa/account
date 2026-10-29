/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Testing phase: 2FA and the forced password change are OPTIONAL (ENFORCE_2FA=false, FORCE_PASSWORD_CHANGE=false) but still available. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { closeApp, createUser, getApp, TestClient, STRONG_PW, uniq } from './helpers';
import { resetConfigForTests, securityWarnings, config } from '../src/config';

beforeAll(() => {
  process.env.ENFORCE_2FA = 'false';
  process.env.FORCE_PASSWORD_CHANGE = 'false';
  resetConfigForTests();
});
afterAll(async () => {
  process.env.ENFORCE_2FA = 'true';
  process.env.FORCE_PASSWORD_CHANGE = 'true';
  resetConfigForTests();
  await closeApp();
});

async function addPlain(admin: TestClient, roleKey: string, extra: Record<string, unknown> = {}) {
  const roles = (await admin.get('/roles')).body as { id: string; key: string }[];
  const email = `${uniq('opt')}@test.local`;
  const r = await admin.post('/users', { email, fullName: 'Optional Person', roleIds: [roles.find((x) => x.key === roleKey)!.id], ...extra });
  if (r.status !== 201) throw new Error(JSON.stringify(r.body));
  return { email, id: r.body.id as string };
}

describe('2FA and temporary-password change are optional in the testing phase', () => {
  it('the defaults are OFF, and start-up warns about it in plain English', () => {
    expect(config().ENFORCE_2FA).toBe(false);
    expect(config().FORCE_PASSWORD_CHANGE).toBe(false);
    expect(securityWarnings().join(' ')).toMatch(/OPTIONAL.*before real company data/s);
  });

  it('a Checker / Admin can work without ever setting up 2FA', async () => {
    const a = await getApp();
    const owner = await createUser({ superAdmin: true });
    const admin = await new TestClient(a, owner.email).init();
    await admin.login(); // no 2FA set up
    const co = await admin.post('/companies', { name: uniq('NoMfa'), country: 'NP', businessType: 'SERVICE', firstFiscalYearDate: '2026-10-01' }, false);
    expect(co.status).toBe(201);
    admin.companyId = co.body.id;
    expect((await admin.get('/me/access')).status).toBe(200);
    const u = await createUser({});
    const roles = (await admin.get('/roles')).body as { id: string; key: string }[];
    await admin.post('/users', { email: u.email, fullName: 'Kiran Checker', roleIds: [roles.find((x) => x.key === 'CHECKER')!.id] });
    const checker = await new TestClient(a, u.email).init();
    await checker.login();
    checker.companyId = co.body.id;
    expect((await checker.get('/approvals')).status).toBe(200);
  });

  it('a temporary password does not have to be changed: the user can sign in and work straight away', async () => {
    const a = await getApp();
    const { admin } = await setupCompanyNoMfa();
    const email = `${uniq('tmp')}@test.local`;
    const roles = (await admin.get('/roles')).body as { id: string; key: string }[];
    expect((await admin.post('/users', { email, fullName: 'Temp Password', initialPassword: STRONG_PW, roleIds: [roles.find((x) => x.key === 'VIEWER')!.id] })).status).toBe(201);
    const c = await new TestClient(a, email).init();
    const login = await c.login();
    expect(login.body.mustChangePassword).toBe(false);
    c.companyId = admin.companyId;
    const me = (await c.get('/auth/me', false)).body;
    expect(me.must_change_password).toBe(false); // nothing forces a change
    expect(me.has_temporary_password).toBe(true); // …but the Security page can still suggest one
    expect((await c.get('/me/access')).status).toBe(200);
  });

  it('users can still choose to change their password and to switch 2FA on; once on, it is asked for at sign-in', async () => {
    const a = await getApp();
    const { admin } = await setupCompanyNoMfa();
    const email = `${uniq('vol')}@test.local`;
    const roles = (await admin.get('/roles')).body as { id: string; key: string }[];
    await admin.post('/users', { email, fullName: 'Voluntary User', initialPassword: STRONG_PW, roleIds: [roles.find((x) => x.key === 'VIEWER')!.id] });
    const c = await new TestClient(a, email).init();
    await c.login();
    c.companyId = admin.companyId;
    const NEW_PW = 'Another-Strong-Pass-77';
    expect((await c.post('/auth/password/change', { currentPassword: STRONG_PW, newPassword: NEW_PW }, false)).status).toBe(200);
    expect((await c.get('/auth/me', false)).body.has_temporary_password).toBe(false);
    c.password = NEW_PW;
    await c.enable2fa();
    const again = await new TestClient(a, email).init();
    const r = await again.post('/auth/login', { email, password: NEW_PW }, false);
    expect(r.body.mfaRequired).toBe(true); // voluntary 2FA is honoured
  });
});

async function setupCompanyNoMfa() {
  const a = await getApp();
  const owner = await createUser({ superAdmin: true });
  const admin = await new TestClient(a, owner.email).init();
  await admin.login();
  const co = await admin.post('/companies', { name: uniq('Opt'), country: 'NP', businessType: 'SERVICE', firstFiscalYearDate: '2026-10-01' }, false);
  admin.companyId = co.body.id;
  return { admin };
}
