import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { AppError, loginSchema, zPassword } from '@ledgerpro/shared';
import { AllowDuringMfaSetup, Ctx, NoCompany, Public, Zod } from '../../common/decorators';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE } from '../../common/guards';
import type { RequestContext } from '../../common/context';
import { randomToken } from '../../common/crypto';
import { config } from '../../config';
import { AuthService, ClientInfo, IssuedTokens } from './auth.service';

const mfaVerifySchema = z.object({ mfaToken: z.string().min(10), code: z.string().min(6).max(12) });
const codeSchema = z.object({ code: z.string().min(6).max(12) });
const disableSchema = z.object({ password: z.string().min(1), code: z.string().min(6).max(12) });
const stepUpSchema = z.object({ password: z.string().min(1), code: z.string().max(12).optional() });
const changePwSchema = z.object({ currentPassword: z.string().min(1), newPassword: zPassword });
const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(20), newPassword: zPassword });

function client(req: Request & { requestId?: string }): ClientInfo {
  return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null, requestId: req.requestId ?? '' };
}

export function setAuthCookies(res: Response, t: IssuedTokens) {
  const secure = config().COOKIE_SECURE;
  res.cookie(ACCESS_COOKIE, t.accessToken, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: config().ACCESS_TOKEN_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, t.refreshToken, { httpOnly: true, secure, sameSite: 'strict', path: '/', expires: t.refreshExpires });
}

function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
}

function publicClaims(t: IssuedTokens) {
  return { mfaSetupRequired: t.claims.su, mustChangePassword: t.claims.pw, mfaVerified: t.claims.mfa };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Issues the CSRF double-submit cookie; the web app echoes it in X-CSRF-Token. */
  @Public()
  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    let token = req.cookies?.[CSRF_COOKIE];
    if (!token) {
      token = randomToken(24);
      res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: config().COOKIE_SECURE, sameSite: 'strict', path: '/' });
    }
    return { csrfToken: token };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new Zod(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.email, body.password, client(req));
    if (r.mfaRequired) return { mfaRequired: true, mfaToken: r.mfaToken };
    setAuthCookies(res, r.tokens);
    return { mfaRequired: false, ...publicClaims(r.tokens) };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('2fa/verify')
  @HttpCode(200)
  async verify2fa(@Body(new Zod(mfaVerifySchema)) body: z.infer<typeof mfaVerifySchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.verifyMfaLogin(body.mfaToken, body.code, client(req));
    setAuthCookies(res, t);
    return publicClaims(t);
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rt = req.cookies?.[REFRESH_COOKIE];
    if (!rt) throw new AppError('AUTH_UNAUTHENTICATED');
    try {
      const t = await this.auth.refresh(rt, client(req));
      setAuthCookies(res, t);
      return publicClaims(t);
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }

  @NoCompany()
  @AllowDuringMfaSetup()
  @Post('logout')
  @HttpCode(200)
  async logout(@Ctx() ctx: RequestContext, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(ctx.sessionId, ctx.userId, client(req));
    clearAuthCookies(res);
    return { ok: true };
  }

  /** Activity ping from the web app (keeps the 30-minute idle timer honest). */
  @NoCompany()
  @AllowDuringMfaSetup()
  @Post('activity')
  @HttpCode(200)
  async activity(@Ctx() ctx: RequestContext) {
    await this.auth.touch(ctx.sessionId);
    return { ok: true };
  }

  @NoCompany()
  @AllowDuringMfaSetup()
  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx.userId);
  }

  @NoCompany()
  @AllowDuringMfaSetup()
  @Post('2fa/setup')
  @HttpCode(200)
  setup(@Ctx() ctx: RequestContext) {
    return this.auth.beginMfaSetup(ctx.userId);
  }

  @NoCompany()
  @AllowDuringMfaSetup()
  @Post('2fa/enable')
  @HttpCode(200)
  async enable(@Ctx() ctx: RequestContext, @Body(new Zod(codeSchema)) body: { code: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.enableMfa(ctx.userId, ctx.sessionId, body.code, client(req));
    setAuthCookies(res, r.tokens);
    return { recoveryCodes: r.recoveryCodes, ...publicClaims(r.tokens) };
  }

  @NoCompany()
  @Post('2fa/disable')
  @HttpCode(200)
  async disable(@Ctx() ctx: RequestContext, @Body(new Zod(disableSchema)) body: z.infer<typeof disableSchema>, @Req() req: Request) {
    await this.auth.disableMfa(ctx.userId, body.password, body.code, client(req));
    return { ok: true };
  }

  @NoCompany()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('step-up')
  @HttpCode(200)
  async stepUp(@Ctx() ctx: RequestContext, @Body(new Zod(stepUpSchema)) body: z.infer<typeof stepUpSchema>, @Req() req: Request) {
    await this.auth.stepUp(ctx.userId, ctx.sessionId, body.password, body.code, client(req));
    return { ok: true, validForSeconds: 300 };
  }

  @NoCompany()
  @AllowDuringMfaSetup()
  @Post('password/change')
  @HttpCode(200)
  async changePassword(@Ctx() ctx: RequestContext, @Body(new Zod(changePwSchema)) body: z.infer<typeof changePwSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.changePassword(ctx.userId, ctx.sessionId, body.currentPassword, body.newPassword, client(req));
    setAuthCookies(res, t);
    return publicClaims(t);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(200)
  async forgot(@Body(new Zod(forgotSchema)) body: { email: string }, @Req() req: Request) {
    await this.auth.forgotPassword(body.email, client(req), config().WEB_ORIGIN);
    return { ok: true, message: 'If that email is registered, a reset link has been sent.' };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(200)
  async reset(@Body(new Zod(resetSchema)) body: z.infer<typeof resetSchema>, @Req() req: Request) {
    await this.auth.resetPassword(body.token, body.newPassword, client(req));
    return { ok: true };
  }

  @NoCompany()
  @Get('sessions')
  sessions(@Ctx() ctx: RequestContext) {
    return this.auth.listSessions(ctx.userId, ctx.sessionId);
  }

  @NoCompany()
  @Delete('sessions/:id')
  async revoke(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    await this.auth.revokeSession(ctx.userId, id);
    return { ok: true };
  }

  @NoCompany()
  @Post('sessions/revoke-others')
  @HttpCode(200)
  async revokeOthers(@Ctx() ctx: RequestContext) {
    await this.auth.revokeOtherSessions(ctx.userId, ctx.sessionId);
    return { ok: true };
  }
}
