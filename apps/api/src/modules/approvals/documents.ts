import { Injectable } from '@nestjs/common';
import { AppError, DocType, DOC_TYPES } from '@ledgerpro/shared';
import { sql } from 'kysely';
import type { Tx } from '../../common/database.service';
import type { CompanyContext } from '../../common/context';
import type { BuiltLine } from '../ledger/ledger.service';

/** Any row of a posting-document table (manual_journals, sales_invoices, …). */
export type DocRow = Record<string, any> & {
  id: string;
  company_id: string;
  status: string;
  created_by: string;
  version: number;
  doc_no: string | null;
  journal_entry_id: string | null;
};

export interface PostResult {
  entryId: string | null;
}

/**
 * A financial document type that goes through maker–checker and posts to the ledger.
 * Each module (journals, sales, purchases, …) registers one handler per document type.
 */
export interface DocHandler {
  docType: DocType;
  table: string;
  dateField: string;
  amountField: string;
  /** Short human reference for queues/audit, e.g. "Invoice to ACME 12,000.00" */
  describe(doc: DocRow): string;
  /** Business validation before submission (balanced, period open, tax, allocations …). */
  validate(trx: Tx, ctx: CompanyContext, doc: DocRow): Promise<void>;
  /** Journal preview shown on the approval screen. */
  preview(trx: Tx, ctx: CompanyContext, doc: DocRow): Promise<BuiltLine[]>;
  /** Post to the ledger. Called inside the approval transaction AFTER the gapless doc_no is assigned. */
  post(trx: Tx, ctx: CompanyContext, doc: DocRow, approvedBy: string | null): Promise<PostResult>;
  /** Cancellation / reversal support (docs/02 §10). */
  correction?: {
    kind: 'CANCEL' | 'REVERSE';
    check(trx: Tx, ctx: CompanyContext, doc: DocRow): Promise<void>;
    /** Extra work after the ledger reversal (e.g. release allocations, restore amounts due). */
    after?(trx: Tx, ctx: CompanyContext, doc: DocRow): Promise<void>;
  };
}

@Injectable()
export class DocumentRegistry {
  private readonly handlers = new Map<string, DocHandler>();

  register(h: DocHandler) {
    this.handlers.set(h.docType, h);
  }

  get(docType: string): DocHandler {
    const h = this.handlers.get(docType);
    if (!h) throw new AppError('NOT_FOUND', `Unknown document type ${docType}`);
    return h;
  }

  has(docType: string) {
    return this.handlers.has(docType);
  }

  perm(docType: string): string {
    return (DOC_TYPES as Record<string, { perm: string }>)[docType].perm;
  }

  async lock(trx: Tx, docType: string, id: string): Promise<DocRow> {
    const h = this.get(docType);
    const r = await sql<DocRow>`SELECT * FROM ${sql.table(h.table)} WHERE id = ${id} FOR UPDATE`.execute(trx);
    if (!r.rows[0]) throw new AppError('NOT_FOUND');
    return r.rows[0];
  }

  async load(trx: Tx, docType: string, id: string): Promise<DocRow> {
    const h = this.get(docType);
    const r = await sql<DocRow>`SELECT * FROM ${sql.table(h.table)} WHERE id = ${id}`.execute(trx);
    if (!r.rows[0]) throw new AppError('NOT_FOUND');
    return r.rows[0];
  }

  async update(trx: Tx, docType: string, id: string, values: Record<string, unknown>) {
    const h = this.get(docType);
    const sets = Object.entries(values).map(([k, v]) => sql`${sql.ref(k)} = ${v}`);
    await sql`UPDATE ${sql.table(h.table)} SET ${sql.join(sets)} WHERE id = ${id}`.execute(trx);
  }
}
