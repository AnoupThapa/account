/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '@ledgerpro/shared';
import { jwtVerify } from 'jose';
import type { Request } from 'express';
import { config } from '../config';
import { DatabaseService } from './database.service';
import { ALLOW_MFA_SETUP, IS_PUBLIC, NO_COMPANY, PERMS, STEP_UP, SUPER_ADMIN } from './decorators';
import type { RequestContext } from './context';

export const ACCESS_COOKIE = 'lp_at';
export const REFRESH_COOKIE = 'lp_rt';
export const CSRF_COOKIE = 'lp_csrf';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

export interface AccessClaims {
  sub: string;
  sid: string;
  sa: boolean; // super admin
  mfa: boolean; // session passed 2FA
  su: boolean; // must set up 2FA before doing anything else
  pw: boolean; // must change password
}

type Req = Request & { ctx?: RequestContext; requestId?: string; claims?: AccessClaims };

function meta<T>(r: Reflector, key: string, ctx: ExecutionContext): T | undefined {
  return r.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
}

/** Double-submit CSRF token for every state-changing request (security.md §4). */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Req>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    if (req.headers.authorization?.startsWith('Bearer ')) return true; // non-browser API clients carry no cookies
    const cookie = req.cookies?.[CSRF_COOKIE];
    const header = req.headers['x-csrf-token'];
    if (!cookie || typeof header !== 'string' || header !== cookie) throw new AppError('AUTH_CSRF');
    return true;
  }
}

/** 1) Who is calling? Validates the access token and that its session is still live. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly dbs: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (meta<boolean>(this.reflector, IS_PUBLIC, context)) return true;
    const req = context.switchToHttp().getRequest<Req>();
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const token = bearer ?? req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new AppError('AUTH_UNAUTHENTICATED');
    let claims: AccessClaims;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(config().JWT_ACCESS_SECRET), {
        issuer: 'ledgerpro',
        audience: 'ledgerpro-api',
      });
      claims = payload as unknown as AccessClaims;
    } catch {
      throw new AppError('AUTH_TOKEN_INVALID');
    }
    const session = await this.dbs.db
      .selectFrom('sessions')
      .innerJoin('users', 'users.id', 'sessions.user_id')
      .select(['sessions.revoked_at', 'sessions.expires_at', 'sessions.step_up_at', 'users.is_active'])
      .where('sessions.id', '=', claims.sid)
      .where('sessions.user_id', '=', claims.sub)
      .executeTakeFirst();
    if (!session || session.revoked_at || session.expires_at < new Date() || !session.is_active) {
      throw new AppError('AUTH_TOKEN_INVALID');
    }
    if ((claims.su || claims.pw) && !meta<boolean>(this.reflector, ALLOW_MFA_SETUP, context)) {
      throw new AppError(claims.su ? 'AUTH_2FA_SETUP_REQUIRED' : 'AUTH_WEAK_PASSWORD', claims.su ? undefined : 'Please change your password to continue');
    }
    req.claims = claims;
    req.ctx = {
      requestId: req.requestId ?? '',
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
      userId: claims.sub,
      sessionId: claims.sid,
      isSuperAdmin: !!claims.sa,
      companyId: null,
      permissions: new Set(),
      roleIds: [],
      stepUpAt: session.step_up_at,
    };
    return true;
  }
}

/** 2) Which company? Requires X-Company-Id and active membership; loads the user's permissions there. */
@Injectable()
export class CompanyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly dbs: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (meta<boolean>(this.reflector, IS_PUBLIC, context) || meta<boolean>(this.reflector, NO_COMPANY, context)) return true;
    const req = context.switchToHttp().getRequest<Req>();
    const ctx = req.ctx!;
    const companyId = req.headers['x-company-id'];
    if (typeof companyId !== 'string' || !UUID_RE.test(companyId)) throw new AppError('NOT_FOUND', 'Select a company first');
    const loaded = await this.dbs.tenant(companyId, ctx.userId, async (trx) => {
      const member = await trx
        .selectFrom('user_companies')
        .innerJoin('companies', 'companies.id', 'user_companies.company_id')
        .select(['user_companies.is_active', 'companies.is_active as company_active', 'companies.enforce_2fa_all'])
        .where('user_companies.user_id', '=', ctx.userId)
        .where('user_companies.company_id', '=', companyId)
        .executeTakeFirst();
      if (!member || !member.is_active || !member.company_active) return null;
      const roles = await trx
        .selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .select(['roles.id', 'roles.requires_2fa'])
        .where('user_roles.user_id', '=', ctx.userId)
        .execute();
      const perms = roles.length
        ? await trx.selectFrom('role_permissions').select('permission_code').where('role_id', 'in', roles.map((r) => r.id)).execute()
        : [];
      const user = await trx.selectFrom('users').select('mfa_enabled').where('id', '=', ctx.userId).executeTakeFirstOrThrow();
      return { member, roles, perms, mfaEnabled: user.mfa_enabled };
    });
    // Never reveal that another company exists (error-handling.md §2: 404)
    if (!loaded) throw new AppError('NOT_FOUND');
    const needs2fa = config().ENFORCE_2FA && (loaded.member.enforce_2fa_all || loaded.roles.some((r) => r.requires_2fa));
    if (needs2fa && !loaded.mfaEnabled) throw new AppError('AUTH_2FA_SETUP_REQUIRED');
    if (loaded.mfaEnabled && !req.claims?.mfa) throw new AppError('AUTH_2FA_REQUIRED');
    ctx.companyId = companyId;
    ctx.roleIds = loaded.roles.map((r) => r.id);
    ctx.permissions = new Set(loaded.perms.map((p) => p.permission_code));
    return true;
  }
}

/** 3) Is it allowed? Deny by default: company endpoints must declare @Perm(...). */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (meta<boolean>(this.reflector, IS_PUBLIC, context)) return true;
    const req = context.switchToHttp().getRequest<Req>();
    const ctx = req.ctx!;
    if (meta<boolean>(this.reflector, SUPER_ADMIN, context) && !ctx.isSuperAdmin) throw new AppError('PERM_DENIED');
    const perms = meta<string[]>(this.reflector, PERMS, context);
    const noCompany = meta<boolean>(this.reflector, NO_COMPANY, context);
    if (!noCompany) {
      if (!perms || perms.length === 0) throw new AppError('PERM_DENIED', 'Endpoint has no permission declared');
      // 'member' = any active member of the company (e.g. reading the company's own profile)
      for (const p of perms) if (p !== 'member' && !ctx.permissions.has(p)) throw new AppError('PERM_DENIED', `You need permission "${p}"`);
    }
    if (meta<boolean>(this.reflector, STEP_UP, context)) {
      if (!ctx.stepUpAt || Date.now() - ctx.stepUpAt.getTime() > STEP_UP_WINDOW_MS) throw new AppError('AUTH_STEP_UP_REQUIRED');
    }
    return true;
  }
}
