import { Injectable } from '@nestjs/common';
import type { Tx } from './database.service';
import type { RequestContext } from './context';

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'SUBMIT' | 'APPROVE' | 'REJECT' | 'WITHDRAW' | 'POST' | 'REVERSE' | 'CANCEL'
  | 'LOCK' | 'UNLOCK' | 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED' | 'ACCOUNT_LOCKED' | 'MFA_ENABLED' | 'MFA_DISABLED'
  | 'PASSWORD_CHANGED' | 'PASSWORD_RESET' | 'ROLE_ASSIGNED' | 'ROLE_REMOVED' | 'FORCE_LOGOUT' | 'EXPORT' | 'PRINT'
  | 'ALLOCATE' | 'UNALLOCATE' | 'GO_LIVE' | 'SETTING_CHANGED' | 'STEP_UP';

const json = (v: unknown) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

/** Append-only, hash-chained audit trail (hash computed by the database trigger). Always written in the same transaction. */
@Injectable()
export class AuditService {
  async log(
    trx: Tx,
    ctx: Pick<RequestContext, 'userId' | 'ip' | 'userAgent' | 'requestId'> & { companyId: string | null },
    action: AuditAction,
    entity: string,
    entityId: string | null,
    before?: unknown,
    after?: unknown,
  ) {
    await trx
      .insertInto('audit_logs')
      .values({
        company_id: ctx.companyId,
        user_id: ctx.userId || null,
        action,
        entity,
        entity_id: entityId,
        before: json(before),
        after: json(after),
        ip: ctx.ip,
        user_agent: ctx.userAgent?.slice(0, 500) ?? null,
        request_id: ctx.requestId,
        hash: '', // set by trg_audit_chain
      })
      .execute();
  }
}
