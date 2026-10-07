import { Injectable } from '@nestjs/common';
import { AppError, DOC_TYPES, NONPOSTING_DOC_TYPES } from '@ledgerpro/shared';
import { sql } from 'kysely';
import type { Tx } from '../../common/database.service';

const PREFIXES: Record<string, string> = {
  JOURNAL_ENTRY: 'JE',
  ...Object.fromEntries(Object.entries(DOC_TYPES).map(([k, v]) => [k, v.prefix])),
  ...Object.fromEntries(Object.entries(NONPOSTING_DOC_TYPES).map(([k, v]) => [k, v.prefix])),
};

/**
 * Gapless document numbering per series per fiscal year (docs/02 §2.6), e.g. SI-2083/84-00001.
 * The counter row is incremented inside the caller's transaction, so a rollback returns the number:
 * no gaps, no duplicates (the UPDATE takes a row lock until commit).
 */
@Injectable()
export class NumberingService {
  async next(trx: Tx, companyId: string, docType: string, adDate: string): Promise<string> {
    const fy = await trx
      .selectFrom('fiscal_years')
      .select(['id', 'label'])
      .where('company_id', '=', companyId)
      .where('start_date', '<=', adDate)
      .where('end_date', '>=', adDate)
      .executeTakeFirst();
    if (!fy) throw new AppError('ACC_NO_FISCAL_YEAR', 'No fiscal year covers this date — create the fiscal year first');
    const prefix = PREFIXES[docType] ?? docType.slice(0, 4);
    await trx
      .insertInto('number_series')
      .values({ company_id: companyId, doc_type: docType, fiscal_year_id: fy.id, prefix, next_no: 1, padding: 5 })
      .onConflict((oc) => oc.columns(['company_id', 'doc_type', 'fiscal_year_id']).doNothing())
      .execute();
    const row = await trx
      .updateTable('number_series')
      .set({ next_no: sql`next_no + 1` })
      .where('company_id', '=', companyId)
      .where('doc_type', '=', docType)
      .where('fiscal_year_id', '=', fy.id)
      .returning(['prefix', 'padding', sql<number>`next_no - 1`.as('n')])
      .executeTakeFirstOrThrow();
    return `${row.prefix}-${fy.label}-${String(row.n).padStart(row.padding, '0')}`;
  }
}
