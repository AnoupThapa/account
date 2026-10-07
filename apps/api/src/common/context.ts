/** Per-request identity & tenant context, passed explicitly to every service method. */
export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  userId: string;
  sessionId: string;
  isSuperAdmin: boolean;
  companyId: string | null;
  permissions: Set<string>;
  roleIds: string[];
  stepUpAt: Date | null;
}

export interface CompanyContext extends RequestContext {
  companyId: string;
}

export function hasPerm(ctx: RequestContext, p: string): boolean {
  return ctx.permissions.has(p);
}
