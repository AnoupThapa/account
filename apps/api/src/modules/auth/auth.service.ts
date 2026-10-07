/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '@ledgerpro/shared';
import * as argon2 from 'argon2';
import { SignJWT, jwtVerify } from 'jose';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { config } from '../../config';
import { DatabaseService, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import { decryptSecret, encryptSecret, randomToken, sha256 } from '../../common/crypto';
import type { AccessClaims } from '../../common/guards';
import { assertStrongPassword } from './password-policy';

authenticator.options = { window: 1, step: 30, digits: 6 };

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpires: Date;
  claims: AccessClaims;
}

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Pre-computed hash used to keep timing uniform when the email doesn't exist
let DUMMY_HASH: string | null = null;

export const ARGON2_OPTS: argon2.Options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

export async function hashPassword(pw: string): Promise<string> {
  return argon2.hash(pw, ARGON2_OPTS);
}

@Injectable()
export class AuthService {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService) {}

  private get secret() {
    return new TextEncoder().encode(config().JWT_ACCESS_SECRET);
  }

  private platformCtx(c: ClientInfo, userId: string | null) {
    return { companyId: null, userId: userId ?? '', ip: c.ip, userAgent: c.userAgent, requestId: c.requestId };
  }

  private async authEvent(trx: Tx, event: string, c: ClientInfo, userId: string | null, email: string | null, detail?: unknown) {
    await trx
      .insertInto('auth_events')
      .values({ event, user_id: userId, email, ip: c.ip, user_agent: c.userAgent?.slice(0, 500) ?? null, detail: detail ? JSON.stringify(detail) : null })
      .execute();
  }

  // ------------------------------------------------------------------ login
  async login(emailRaw: string, password: string, c: ClientInfo): Promise<{ mfaRequired: true; mfaToken: string } | { mfaRequired: false; tokens: IssuedTokens }> {
    const email = emailRaw.trim().toLowerCase();
    const user = await this.dbs.db.selectFrom('users').selectAll().where(sql`lower(email)`, '=', email).executeTakeFirst();
    if (!DUMMY_HASH) DUMMY_HASH = await hashPassword(randomToken());

    if (user?.locked_until && user.locked_until > new Date()) {
      await this.dbs.user(user.id, (trx) => this.authEvent(trx, 'LOGIN_BLOCKED_LOCKED', c, user.id, email));
      throw new AppError('AUTH_ACCOUNT_LOCKED', `Account locked until ${user.locked_until.toISOString()} after too many failed attempts`);
    }
    const ok = await argon2.verify(user?.password_hash ?? DUMMY_HASH, password).catch(() => false);
    if (!user || !ok || !user.is_active) {
      if (user) {
        await this.dbs.user(user.id, async (trx) => {
          const attempts = user.failed_attempts + 1;
          if (attempts >= MAX_FAILED) {
            await trx
              .updateTable('users')
              .set({ failed_attempts: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000) })
              .where('id', '=', user.id)
              .execute();
            await this.authEvent(trx, 'LOCKED', c, user.id, email);
            await this.audit.log(trx, this.platformCtx(c, user.id), 'ACCOUNT_LOCKED', 'user', user.id);
            await trx
              .insertInto('integration_outbox')
              .values({
                company_id: null,
                target: 'EMAIL',
                event_type: 'ACCOUNT_LOCKED',
                payload: JSON.stringify({ to: user.email, name: user.full_name, minutes: LOCK_MINUTES, ip: c.ip }),
              })
              .execute();
          } else {
            await trx.updateTable('users').set({ failed_attempts: attempts }).where('id', '=', user.id).execute();
            await this.authEvent(trx, 'LOGIN_FAIL', c, user.id, email);
          }
        });
      } else {
        await this.dbs.user(null, (trx) => this.authEvent(trx, 'LOGIN_FAIL', c, null, email));
      }
      throw new AppError('AUTH_INVALID_CREDENTIALS');
    }

    if (user.mfa_enabled) {
      const mfaToken = await new SignJWT({ purpose: 'mfa' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer('ledgerpro')
        .setAudience('ledgerpro-mfa')
        .setExpirationTime('5m')
        .sign(this.secret);
      return { mfaRequired: true, mfaToken };
    }
    const tokens = await this.dbs.user(user.id, async (trx) => {
      await trx.updateTable('users').set({ failed_attempts: 0, locked_until: null, last_login_at: new Date() }).where('id', '=', user.id).execute();
      await this.authEvent(trx, 'LOGIN_OK', c, user.id, email);
      await this.audit.log(trx, this.platformCtx(c, user.id), 'LOGIN', 'user', user.id);
      return this.createSession(trx, user.id, randomUUID(), false, c);
    });
    return { mfaRequired: false, tokens };
  }

  async verifyMfaLogin(mfaToken: string, code: string, c: ClientInfo): Promise<IssuedTokens> {
    let userId: string;
    try {
      const { payload } = await jwtVerify(mfaToken, this.secret, { issuer: 'ledgerpro', audience: 'ledgerpro-mfa' });
      if (payload.purpose !== 'mfa' || !payload.sub) throw new Error();
      userId = payload.sub;
    } catch {
      throw new AppError('AUTH_TOKEN_INVALID', 'The sign-in step expired — please sign in again');
    }
    return this.dbs.user(userId, async (trx) => {
      const user = await trx.selectFrom('users').selectAll().where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (user.locked_until && user.locked_until > new Date()) throw new AppError('AUTH_ACCOUNT_LOCKED');
      const valid = await this.checkMfaCode(trx, user, code);
      if (!valid) {
        const attempts = user.failed_attempts + 1;
        await trx
          .updateTable('users')
          .set(attempts >= MAX_FAILED ? { failed_attempts: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60_000) } : { failed_attempts: attempts })
          .where('id', '=', userId)
          .execute();
        await this.authEvent(trx, 'MFA_FAIL', c, userId, user.email);
        return null;
      }
      await trx.updateTable('users').set({ failed_attempts: 0, locked_until: null, last_login_at: new Date() }).where('id', '=', userId).execute();
      await this.authEvent(trx, 'LOGIN_OK', c, userId, user.email, { mfa: true });
      await this.audit.log(trx, this.platformCtx(c, userId), 'LOGIN', 'user', userId, null, { mfa: true });
      return this.createSession(trx, userId, randomUUID(), true, c);
    }).then((t) => {
      if (!t) throw new AppError('AUTH_2FA_INVALID');
      return t;
    });
  }

  /** TOTP code or one-time recovery code (consumed). */
  private async checkMfaCode(trx: Tx, user: { id: string; mfa_secret_enc: string | null; mfa_recovery_hashes: unknown }, code: string): Promise<boolean> {
    const clean = code.trim().toUpperCase();
    if (/^\d{6}$/.test(clean) && user.mfa_secret_enc) {
      return authenticator.check(clean, decryptSecret(user.mfa_secret_enc));
    }
    if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) {
      const hashes = (user.mfa_recovery_hashes as string[]) ?? [];
      const h = sha256(clean);
      if (hashes.includes(h)) {
        await trx
          .updateTable('users')
          .set({ mfa_recovery_hashes: JSON.stringify(hashes.filter((x) => x !== h)) })
          .where('id', '=', user.id)
          .execute();
        return true;
      }
    }
    return false;
  }

  // --------------------------------------------------------------- sessions
  private async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('ledgerpro')
      .setAudience('ledgerpro-api')
      .setIssuedAt()
      .setExpirationTime(`${config().ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  private async claimsFor(trx: Tx, userId: string, sessionId: string, mfaVerified: boolean): Promise<AccessClaims> {
    const u = await trx.selectFrom('users').select(['is_super_admin', 'mfa_enabled', 'must_change_password']).where('id', '=', userId).executeTakeFirstOrThrow();
    return {
      sub: userId,
      sid: sessionId,
      sa: u.is_super_admin,
      mfa: mfaVerified,
      su: config().ENFORCE_2FA && u.is_super_admin && !u.mfa_enabled,
      pw: u.must_change_password,
    };
  }

  private async createSession(trx: Tx, userId: string, familyId: string, mfaVerified: boolean, c: ClientInfo, stepUpAt: Date | null = null): Promise<IssuedTokens> {
    const refreshToken = randomToken(32);
    const refreshExpires = new Date(Date.now() + config().REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const s = await trx
      .insertInto('sessions')
      .values({
        user_id: userId,
        family_id: familyId,
        refresh_hash: sha256(refreshToken),
        mfa_verified: mfaVerified,
        ip: c.ip,
        user_agent: c.userAgent?.slice(0, 500) ?? null,
        expires_at: refreshExpires,
        step_up_at: stepUpAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const claims = await this.claimsFor(trx, userId, s.id, mfaVerified);
    return { accessToken: await this.signAccess(claims), refreshToken, refreshExpires, claims };
  }

  /** Refresh-token rotation with reuse detection (security.md §1). */
  async refresh(refreshToken: string, c: ClientInfo): Promise<IssuedTokens> {
    const hash = sha256(refreshToken);
    const s = await this.dbs.db.selectFrom('sessions').selectAll().where('refresh_hash', '=', hash).executeTakeFirst();
    if (!s) throw new AppError('AUTH_TOKEN_INVALID');
    return this.dbs.user(s.user_id, async (trx) => {
      const cur = await trx.selectFrom('sessions').selectAll().where('id', '=', s.id).forUpdate().executeTakeFirstOrThrow();
      if (cur.revoked_at) {
        if (cur.revoke_reason === 'ROTATED') {
          // A rotated token was replayed → assume theft, kill the whole family
          await trx.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: 'REUSE_DETECTED' }).where('family_id', '=', cur.family_id).where('revoked_at', 'is', null).execute();
          await this.authEvent(trx, 'REFRESH_REUSE', c, cur.user_id, null, { family: cur.family_id });
          return null;
        }
        return null;
      }
      const idleMs = config().IDLE_TIMEOUT_MINUTES * 60_000;
      if (cur.expires_at < new Date() || Date.now() - cur.last_used_at.getTime() > idleMs) {
        await trx.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: 'IDLE_OR_EXPIRED' }).where('id', '=', cur.id).execute();
        return null;
      }
      const user = await trx.selectFrom('users').select('is_active').where('id', '=', cur.user_id).executeTakeFirstOrThrow();
      if (!user.is_active) return null;
      await trx.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: 'ROTATED' }).where('id', '=', cur.id).execute();
      return this.createSession(trx, cur.user_id, cur.family_id, cur.mfa_verified, c, cur.step_up_at);
    }).then((t) => {
      if (!t) throw new AppError('AUTH_TOKEN_INVALID');
      return t;
    });
  }

  /** Called by the web app on user activity so the idle timer counts real use, not token age. */
  async touch(sessionId: string) {
    await this.dbs.db.updateTable('sessions').set({ last_used_at: new Date() }).where('id', '=', sessionId).where('revoked_at', 'is', null).execute();
  }

  async logout(sessionId: string, userId: string, c: ClientInfo) {
    await this.dbs.user(userId, async (trx) => {
      const s = await trx.selectFrom('sessions').select('family_id').where('id', '=', sessionId).executeTakeFirst();
      if (s) await trx.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: 'LOGOUT' }).where('family_id', '=', s.family_id).where('revoked_at', 'is', null).execute();
      await this.authEvent(trx, 'LOGOUT', c, userId, null);
      await this.audit.log(trx, this.platformCtx(c, userId), 'LOGOUT', 'user', userId);
    });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const rows = await this.dbs.db
      .selectFrom('sessions')
      .select(['id', 'family_id', 'ip', 'user_agent', 'created_at', 'last_used_at', 'expires_at'])
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', new Date())
      .orderBy('last_used_at', 'desc')
      .execute();
    return rows.map((r) => ({ ...r, current: r.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string, reason = 'USER_REVOKED') {
    await this.dbs.db.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: reason }).where('user_id', '=', userId).where('id', '=', sessionId).where('revoked_at', 'is', null).execute();
  }

  async revokeOtherSessions(userId: string, currentSessionId: string) {
    const cur = await this.dbs.db.selectFrom('sessions').select('family_id').where('id', '=', currentSessionId).executeTakeFirst();
    await this.dbs.db
      .updateTable('sessions')
      .set({ revoked_at: new Date(), revoke_reason: 'LOGOUT_OTHERS' })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .$if(!!cur, (q) => q.where('family_id', '<>', cur!.family_id))
      .execute();
  }

  async revokeAllSessions(trx: Tx, userId: string, reason: string) {
    await trx.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: reason }).where('user_id', '=', userId).where('revoked_at', 'is', null).execute();
  }

  // ----------------------------------------------------------------- profile
  async me(userId: string) {
    const u = await this.dbs.db
      .selectFrom('users')
      .select(['id', 'email', 'full_name', 'is_super_admin', 'mfa_enabled', 'must_change_password', 'last_login_at'])
      .where('id', '=', userId)
      .executeTakeFirstOrThrow();
    const companies = await this.dbs.user(userId, (trx) =>
      trx
        .selectFrom('user_companies')
        .innerJoin('companies', 'companies.id', 'user_companies.company_id')
        .select(['companies.id', 'companies.name', 'companies.country', 'companies.base_currency', 'companies.calendar_mode', 'companies.go_live_status'])
        .where('user_companies.user_id', '=', userId)
        .where('user_companies.is_active', '=', true)
        .where('companies.is_active', '=', true)
        .orderBy('companies.name')
        .execute(),
    );
    return { ...u, recoveryCodesLeft: undefined, companies };
  }

  // -------------------------------------------------------------------- 2FA
  async beginMfaSetup(userId: string) {
    const u = await this.dbs.db.selectFrom('users').select(['email', 'mfa_enabled']).where('id', '=', userId).executeTakeFirstOrThrow();
    const secret = authenticator.generateSecret(20);
    await this.dbs.db.updateTable('users').set({ mfa_pending_secret_enc: encryptSecret(secret) }).where('id', '=', userId).execute();
    const otpauth = authenticator.keyuri(u.email, 'LedgerPro', secret);
    return { otpauthUrl: otpauth, secret, qrDataUrl: await QRCode.toDataURL(otpauth), alreadyEnabled: u.mfa_enabled };
  }

  async enableMfa(userId: string, sessionId: string, code: string, c: ClientInfo): Promise<{ recoveryCodes: string[]; tokens: IssuedTokens }> {
    return this.dbs.user(userId, async (trx) => {
      const u = await trx.selectFrom('users').select(['mfa_pending_secret_enc']).where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (!u.mfa_pending_secret_enc) throw new AppError('VAL_FIELD', 'Start 2FA setup first');
      const secret = decryptSecret(u.mfa_pending_secret_enc);
      if (!authenticator.check(code.trim(), secret)) throw new AppError('AUTH_2FA_INVALID');
      const codes = Array.from({ length: 10 }, () => {
        const raw = randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
        return `${raw.slice(0, 4)}-${raw.slice(4)}`;
      });
      await trx
        .updateTable('users')
        .set({ mfa_enabled: true, mfa_secret_enc: encryptSecret(secret), mfa_pending_secret_enc: null, mfa_recovery_hashes: JSON.stringify(codes.map(sha256)) })
        .where('id', '=', userId)
        .execute();
      await this.audit.log(trx, this.platformCtx(c, userId), 'MFA_ENABLED', 'user', userId);
      // upgrade the current session to "2FA verified"
      const cur = await trx.selectFrom('sessions').select('family_id').where('id', '=', sessionId).executeTakeFirstOrThrow();
      await trx.updateTable('sessions').set({ revoked_at: new Date(), revoke_reason: 'ROTATED' }).where('id', '=', sessionId).execute();
      const tokens = await this.createSession(trx, userId, cur.family_id, true, c);
      return { recoveryCodes: codes, tokens };
    });
  }

  async disableMfa(userId: string, password: string, code: string, c: ClientInfo) {
    await this.dbs.user(userId, async (trx) => {
      const u = await trx.selectFrom('users').selectAll().where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (!(await argon2.verify(u.password_hash, password))) throw new AppError('AUTH_INVALID_CREDENTIALS');
      if (!(await this.checkMfaCode(trx, u, code))) throw new AppError('AUTH_2FA_INVALID');
      await trx.updateTable('users').set({ mfa_enabled: false, mfa_secret_enc: null, mfa_recovery_hashes: '[]' }).where('id', '=', userId).execute();
      await this.audit.log(trx, this.platformCtx(c, userId), 'MFA_DISABLED', 'user', userId);
    });
  }

  /** Step-up auth: re-confirm password (and 2FA code if enabled) before sensitive actions. */
  async stepUp(userId: string, sessionId: string, password: string, code: string | undefined, c: ClientInfo) {
    await this.dbs.user(userId, async (trx) => {
      const u = await trx.selectFrom('users').selectAll().where('id', '=', userId).executeTakeFirstOrThrow();
      if (!(await argon2.verify(u.password_hash, password))) throw new AppError('AUTH_INVALID_CREDENTIALS');
      if (u.mfa_enabled && !(code && (await this.checkMfaCode(trx, u, code)))) throw new AppError('AUTH_2FA_INVALID');
      await trx.updateTable('sessions').set({ step_up_at: new Date() }).where('id', '=', sessionId).execute();
      await this.audit.log(trx, this.platformCtx(c, userId), 'STEP_UP', 'session', sessionId);
    });
  }

  // --------------------------------------------------------------- passwords
  async changePassword(userId: string, sessionId: string, current: string, next: string, c: ClientInfo): Promise<IssuedTokens> {
    return this.dbs.user(userId, async (trx) => {
      const u = await trx.selectFrom('users').selectAll().where('id', '=', userId).forUpdate().executeTakeFirstOrThrow();
      if (!(await argon2.verify(u.password_hash, current))) throw new AppError('AUTH_INVALID_CREDENTIALS', 'Current password is incorrect');
      if (current === next) throw new AppError('AUTH_WEAK_PASSWORD', 'Choose a different password');
      assertStrongPassword(next, u.email, u.full_name);
      await trx.updateTable('users').set({ password_hash: await hashPassword(next), password_changed_at: new Date(), must_change_password: false }).where('id', '=', userId).execute();
      const cur = await trx.selectFrom('sessions').select(['mfa_verified']).where('id', '=', sessionId).executeTakeFirst();
      await this.revokeAllSessions(trx, userId, 'PASSWORD_CHANGED');
      await this.audit.log(trx, this.platformCtx(c, userId), 'PASSWORD_CHANGED', 'user', userId);
      return this.createSession(trx, userId, randomUUID(), cur?.mfa_verified ?? false, c);
    });
  }

  async forgotPassword(emailRaw: string, c: ClientInfo, webOrigin: string) {
    const email = emailRaw.trim().toLowerCase();
    const u = await this.dbs.db.selectFrom('users').select(['id', 'email', 'full_name', 'is_active']).where(sql`lower(email)`, '=', email).executeTakeFirst();
    await this.dbs.user(u?.id ?? null, async (trx) => {
      await this.authEvent(trx, 'PASSWORD_RESET_REQUESTED', c, u?.id ?? null, email);
      if (!u || !u.is_active) return; // same response either way (no account enumeration)
      const token = randomToken(32);
      await trx.insertInto('password_resets').values({ user_id: u.id, token_hash: sha256(token), expires_at: new Date(Date.now() + 60 * 60_000) }).execute();
      await trx
        .insertInto('integration_outbox')
        .values({
          company_id: null,
          target: 'EMAIL',
          event_type: 'PASSWORD_RESET',
          payload: JSON.stringify({ to: u.email, name: u.full_name, link: `${webOrigin}/reset-password?token=${token}` }),
        })
        .execute();
    });
  }

  async resetPassword(token: string, next: string, c: ClientInfo) {
    const hash = sha256(token);
    const r = await this.dbs.db.selectFrom('password_resets').selectAll().where('token_hash', '=', hash).executeTakeFirst();
    if (!r || r.used_at || r.expires_at < new Date()) throw new AppError('AUTH_RESET_INVALID');
    await this.dbs.user(r.user_id, async (trx) => {
      const u = await trx.selectFrom('users').select(['email', 'full_name']).where('id', '=', r.user_id).executeTakeFirstOrThrow();
      assertStrongPassword(next, u.email, u.full_name);
      const used = await trx.updateTable('password_resets').set({ used_at: new Date() }).where('id', '=', r.id).where('used_at', 'is', null).executeTakeFirst();
      if (Number(used.numUpdatedRows) !== 1) throw new AppError('AUTH_RESET_INVALID');
      await trx
        .updateTable('users')
        .set({ password_hash: await hashPassword(next), password_changed_at: new Date(), failed_attempts: 0, locked_until: null, must_change_password: false })
        .where('id', '=', r.user_id)
        .execute();
      await this.revokeAllSessions(trx, r.user_id, 'PASSWORD_RESET');
      await this.audit.log(trx, this.platformCtx(c, r.user_id), 'PASSWORD_RESET', 'user', r.user_id);
    });
  }
}
