import type { NextFunction, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';

/** X-Request-Id on every request/response; shown to users on 500 errors (error-handling.md §7). */
export function requestId(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : 'req_' + randomBytes(9).toString('base64url');
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
