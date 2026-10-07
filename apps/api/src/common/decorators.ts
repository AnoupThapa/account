import { createParamDecorator, ExecutionContext, PipeTransform, SetMetadata } from '@nestjs/common';
import { ZodSchema } from 'zod';
import type { RequestContext } from './context';

export const IS_PUBLIC = 'lp:public';
export const NO_COMPANY = 'lp:no-company';
export const PERMS = 'lp:perms';
export const STEP_UP = 'lp:step-up';
export const ALLOW_MFA_SETUP = 'lp:allow-mfa-setup';
export const SUPER_ADMIN = 'lp:super-admin';

/** Endpoint needs no login (login, refresh, password reset, health). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Endpoint is user-level, not tied to a company (profile, company list). */
export const NoCompany = () => SetMetadata(NO_COMPANY, true);
/** Required permission(s): user needs ALL listed. Deny by default — company endpoints without @Perm are refused. */
export const Perm = (...perms: string[]) => SetMetadata(PERMS, perms);
/** Sensitive action: requires password/2FA re-confirmation within the last 5 minutes (security.md §2). */
export const StepUp = () => SetMetadata(STEP_UP, true);
/** Reachable while the user still has to set up mandatory 2FA. */
export const AllowDuringMfaSetup = () => SetMetadata(ALLOW_MFA_SETUP, true);
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN, true);

export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  return host.switchToHttp().getRequest().ctx;
});

/** Validate & transform a request body/query with a shared Zod schema. */
export class Zod<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}
  transform(value: unknown): T {
    return this.schema.parse(value ?? {});
  }
}
