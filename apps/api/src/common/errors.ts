import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { AppError, ERROR_CATALOGUE, ErrorCode, ProblemDetails } from '@ledgerpro/shared';
import { ZodError } from 'zod';
import type { Request, Response } from 'express';
import { logger } from './logger';

const DB_CODE_RE = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s;

/** Convert any thrown error into an RFC 7807 problem (error-handling.md §2). */
export function toProblem(err: unknown, requestId?: string): ProblemDetails {
  let code: ErrorCode = 'SYS_UNEXPECTED';
  let detail: string = ERROR_CATALOGUE.SYS_UNEXPECTED.title;
  let fields: ProblemDetails['fields'];
  let meta: Record<string, unknown> | undefined;

  if (err instanceof AppError) {
    code = err.code;
    detail = err.message;
    fields = err.fields;
    meta = err.meta;
  } else if (err instanceof ZodError) {
    code = 'VAL_FIELD';
    detail = 'Please correct the highlighted fields';
    fields = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof HttpException) {
    const s = err.getStatus();
    code = s === 404 ? 'NOT_FOUND' : s === 429 ? 'RATE_LIMITED' : s === 403 ? 'PERM_DENIED' : s === 401 ? 'AUTH_UNAUTHENTICATED' : s < 500 ? 'VAL_FIELD' : 'SYS_UNEXPECTED';
    detail = s < 500 ? err.message : detail;
  } else if (err && typeof err === 'object' && 'code' in err && typeof (err as { message?: unknown }).message === 'string') {
    // PostgreSQL errors
    const pg = err as { code: string; message: string; constraint?: string };
    const m = DB_CODE_RE.exec(pg.message);
    if (pg.code === 'P0001' && m && m[1] in ERROR_CATALOGUE) {
      code = m[1] as ErrorCode;
      detail = m[2];
    } else if (pg.code === '23505') {
      code = pg.constraint === 'ux_bill_supplier_invoice' ? 'DOC_DUPLICATE_INVOICE' : 'DOC_DUPLICATE';
      detail = ERROR_CATALOGUE[code].title;
      if (process.env.NODE_ENV !== 'production') meta = { constraint: pg.constraint };
    } else if (pg.code === '23P01') {
      code = 'VAL_FIELD';
      detail = 'This overlaps an existing date range';
    } else if (pg.code === '42501') {
      code = 'PERM_DENIED';
      detail = ERROR_CATALOGUE.PERM_DENIED.title;
    } else if (pg.code === '23514' || pg.code === '23503' || pg.code === '22P02') {
      code = 'VAL_FIELD';
      detail = 'The data is not valid for this operation';
    }
  }
  const status = ERROR_CATALOGUE[code].status;
  return {
    type: `https://docs.ledgerpro.app/errors/${code}`,
    title: ERROR_CATALOGUE[code].title,
    status,
    code,
    detail,
    requestId,
    ...(fields ? { fields } : {}),
    ...(meta ? { meta } : {}),
  };
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request & { requestId?: string; ctx?: { userId?: string; companyId?: string | null } }>();
    const p = toProblem(err, req.requestId);
    const logCtx = { requestId: req.requestId, userId: req.ctx?.userId, companyId: req.ctx?.companyId, path: req.path, code: p.code };
    if (p.status >= 500) logger.error({ ...logCtx, err }, 'unexpected error');
    else logger.info(logCtx, 'request failed');
    res.status(p.status).type('application/problem+json').json(p);
  }
}
