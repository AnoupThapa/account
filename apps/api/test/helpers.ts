import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { authenticator } from 'otplib';
import { Client } from 'pg';
import { loadTestEnv } from './env';

loadTestEnv();

let app: INestApplication | null = null;
export async function getApp(): Promise<INestApplication> {
  if (!app) {
    const { createApp } = await import('../src/bootstrap');
    app = await createApp();
    await app.init();
  }
  return app;
}
export async function closeApp() {
  await app?.close();
  app = null;
}

export async function adminDb(): Promise<Client> {
  const c = new Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  await c.connect();
  return c;
}

let seq = 0;
export const uniq = (p = 'u') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
export const STRONG_PW = 'Correct-Horse-Battery-9';

/** A browser-like client: keeps cookies, sends CSRF header, optional company header. */
export class TestClient {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  companyId: string | null = null;
  mfaSecret: string | null = null;
  userId: string | null = null;
  constructor(app: INestApplication, public email = '', public password = STRONG_PW) {
    this.agent = request.agent(app.getHttpServer());
  }
  async init() {
    const r = await this.agent.get('/auth/csrf');
    this.csrf = r.body.csrfToken;
    return this;
  }
  private h(req: request.Test, company = true) {
    req.set('X-CSRF-Token', this.csrf);
    if (company && this.companyId) req.set('X-Company-Id', this.companyId);
    return req;
  }
  get(url: string, company = true) {
    return this.h(this.agent.get(url), company);
  }
  post(url: string, body?: unknown, company = true) {
    return this.h(this.agent.post(url), company).send(body as object);
  }
  patch(url: string, body?: unknown, company = true) {
    return this.h(this.agent.patch(url), company).send(body as object);
  }
  del(url: string, company = true) {
    return this.h(this.agent.delete(url), company);
  }
  async login(email = this.email, password = this.password) {
    this.email = email;
    this.password = password;
    const r = await this.post('/auth/login', { email, password }, false);
    if (r.body.mfaRequired) {
      const v = await this.post('/auth/2fa/verify', { mfaToken: r.body.mfaToken, code: authenticator.generate(this.mfaSecret!) }, false);
      if (v.status !== 200) throw new Error('2FA verify failed: ' + JSON.stringify(v.body));
      return v;
    }
    return r;
  }
  async enable2fa() {
    const s = await this.post('/auth/2fa/setup', {}, false);
    this.mfaSecret = s.body.secret;
    const e = await this.post('/auth/2fa/enable', { code: authenticator.generate(this.mfaSecret!) }, false);
    if (e.status !== 200) throw new Error('2FA enable failed: ' + JSON.stringify(e.body));
    return e.body.recoveryCodes as string[];
  }
  async stepUp() {
    const r = await this.post('/auth/step-up', { password: this.password, code: this.mfaSecret ? authenticator.generate(this.mfaSecret) : undefined }, false);
    if (r.status !== 200) throw new Error('step-up failed: ' + JSON.stringify(r.body));
  }
}

/** Insert a user directly (test fixture). */
export async function createUser(opts: { email?: string; name?: string; superAdmin?: boolean; password?: string } = {}) {
  const { hashPassword } = await import('../src/modules/auth/auth.service');
  const db = await adminDb();
  const email = opts.email ?? `${uniq('user')}@test.local`;
  const r = await db.query('INSERT INTO users (email, full_name, password_hash, is_super_admin) VALUES ($1,$2,$3,$4) RETURNING id', [
    email,
    opts.name ?? 'Test User',
    await hashPassword(opts.password ?? STRONG_PW),
    !!opts.superAdmin,
  ]);
  await db.end();
  return { id: r.rows[0].id as string, email };
}

/** Super admin, logged in with 2FA, who creates a company and is its Company Admin. */
export async function setupCompany(country: 'NP' | 'AU' = 'NP', businessType = 'MIXED', name = uniq('Co')) {
  const a = await getApp();
  const u = await createUser({ superAdmin: true, name: 'Owner Admin' });
  const admin = await new TestClient(a, u.email).init();
  admin.userId = u.id;
  await admin.login();
  await admin.enable2fa();
  const r = await admin.post('/companies', { name, country, businessType, firstFiscalYearDate: country === 'NP' ? '2026-10-01' : '2026-10-01' }, false);
  if (r.status !== 201) throw new Error('company create failed: ' + JSON.stringify(r.body));
  admin.companyId = r.body.id;
  return { admin, companyId: r.body.id as string, company: r.body };
}

/** Add a user with the given role keys to the admin's company and return a logged-in client (2FA set up if needed). */
export async function addMember(admin: TestClient, roleKeys: string[], name = 'Member') {
  const a = await getApp();
  const roles = (await admin.get('/roles')).body as { id: string; key: string; requires_2fa: boolean }[];
  const roleIds = roleKeys.map((k) => roles.find((r) => r.key === k)!.id);
  const u = await createUser({ name });
  const r = await admin.post('/users', { email: u.email, fullName: name, roleIds });
  if (r.status !== 201) throw new Error('add member failed: ' + JSON.stringify(r.body));
  const c = await new TestClient(a, u.email).init();
  c.userId = u.id;
  await c.login();
  if (roles.filter((x) => roleKeys.includes(x.key)).some((x) => x.requires_2fa)) await c.enable2fa();
  c.companyId = admin.companyId;
  return c;
}
