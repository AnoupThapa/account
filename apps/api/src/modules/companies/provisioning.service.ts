import { Injectable } from '@nestjs/common';
import { AppError, DEFAULT_ROLES, DOC_TYPES, todayAd, companyCreateSchema } from '@ledgerpro/shared';
import { buildCoaTemplate, DEFAULT_TAX_CODES, DEFAULT_TDS_CODES, BusinessType } from '@ledgerpro/db';
import { z } from 'zod';
import { DatabaseService, setTenant, Tx } from '../../common/database.service';
import { AuditService } from '../../common/audit.service';
import type { RequestContext } from '../../common/context';
import { FiscalService } from '../settings/fiscal.service';

export type CompanyCreateInput = z.infer<typeof companyCreateSchema> & { adminUserIds?: string[] };

/** Default 2-step thresholds (open question 11 — editable per company in Settings → Approval workflows). */
const SECOND_STEP_THRESHOLD: Record<string, string> = { NP: '500000', AU: '50000', OTHER: '50000' };
const TWO_STEP_DOCS = ['PAYMENT', 'PURCHASE_BILL', 'MANUAL_JOURNAL', 'EXPENSE', 'CORRECTION'];

@Injectable()
export class ProvisioningService {
  constructor(private readonly dbs: DatabaseService, private readonly audit: AuditService, private readonly fiscal: FiscalService) {}

  /** Create a company with branch, roles, COA, tax codes, workflows and its first fiscal year (Phase 0/1). */
  async createCompany(ctx: RequestContext, input: CompanyCreateInput) {
    if (!ctx.isSuperAdmin) throw new AppError('PERM_DENIED', 'Only a platform Super Admin can create companies');
    const country = input.country;
    const defaults = {
      NP: { currency: 'NPR', calendar: 'BS', fyStart: 4, tz: 'Asia/Kathmandu' },
      AU: { currency: 'AUD', calendar: 'AD', fyStart: 7, tz: 'Australia/Sydney' },
      OTHER: { currency: 'USD', calendar: 'AD', fyStart: 1, tz: 'UTC' },
    }[country];

    return this.dbs.platform(ctx.userId, null, async (trx) => {
      const company = await trx
        .insertInto('companies')
        .values({
          name: input.name,
          legal_name: input.legalName ?? input.name,
          country,
          base_currency: input.baseCurrency ?? defaults.currency,
          calendar_mode: input.calendarMode ?? defaults.calendar,
          fy_start_month: input.fyStartMonth ?? defaults.fyStart,
          business_type: input.businessType,
          coa_template: input.coaTemplate ?? (country === 'NP' ? 'NEPAL' : 'IFRS'),
          pan: input.pan ?? null,
          vat_no: input.vatNo ?? null,
          abn: input.abn ?? null,
          address: input.address ?? null,
          phone: input.phone ?? null,
          email: input.email || null,
          timezone: input.timezone ?? defaults.tz,
          created_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await setTenant(trx, company.id);
      const cctx = { ...ctx, companyId: company.id };

      await trx.insertInto('branches').values({ company_id: company.id, code: 'HO', name: 'Head Office', is_head_office: true, created_by: ctx.userId }).execute();

      // Roles & permissions
      const roleIds: Record<string, string> = {};
      for (const r of DEFAULT_ROLES) {
        const role = await trx
          .insertInto('roles')
          .values({ company_id: company.id, key: r.key, name: r.name, description: r.description, requires_2fa: r.requires2fa, is_system: true, created_by: ctx.userId })
          .returning('id')
          .executeTakeFirstOrThrow();
        roleIds[r.key] = role.id;
        if (r.permissions.length) {
          await trx.insertInto('role_permissions').values(r.permissions.map((p) => ({ company_id: company.id, role_id: role.id, permission_code: p }))).execute();
        }
      }

      // Admin membership (creator by default)
      const admins = input.adminUserIds?.length ? input.adminUserIds : [ctx.userId];
      for (const uid of admins) {
        await trx.insertInto('user_companies').values({ user_id: uid, company_id: company.id }).execute();
        await trx.insertInto('user_roles').values({ company_id: company.id, user_id: uid, role_id: roleIds.COMPANY_ADMIN }).execute();
      }

      const accountIds = await this.loadCoa(trx, company.id, company.business_type as BusinessType, company.coa_template as 'NEPAL' | 'IFRS', ctx.userId);
      await this.loadTax(trx, company.id, country, accountIds, ctx.userId);
      await this.loadWorkflows(trx, company.id, country, roleIds, ctx.userId);
      await this.fiscal.ensureFiscalYear(trx, cctx, input.firstFiscalYearDate ?? todayAd(company.timezone));

      await this.audit.log(trx, cctx, 'CREATE', 'company', company.id, null, { name: company.name, country, businessType: company.business_type });
      return company;
    });
  }

  private async loadCoa(trx: Tx, companyId: string, bt: BusinessType, layout: 'NEPAL' | 'IFRS', userId: string) {
    const tpl = buildCoaTemplate(bt, layout);
    const ids: Record<string, string> = {}; // code → id
    for (const a of tpl) {
      const row = await trx
        .insertInto('accounts')
        .values({
          company_id: companyId,
          code: a.code,
          name: a.name,
          class: a.class,
          parent_id: a.parent ? ids[a.parent] ?? null : null,
          is_postable: a.postable !== false,
          is_control: !!a.control,
          requires_contact: !!a.requiresContact,
          is_system: !!a.systemKey,
          system_key: a.systemKey ?? null,
          subtype: a.subtype ?? null,
          cash_flow_category: a.cashFlow ?? null,
          created_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      ids[a.code] = row.id;
    }
    const byKey: Record<string, string> = {};
    for (const a of tpl) if (a.systemKey) byKey[a.systemKey] = ids[a.code];
    return byKey;
  }

  private async loadTax(trx: Tx, companyId: string, country: 'NP' | 'AU' | 'OTHER', acct: Record<string, string>, userId: string) {
    for (const t of DEFAULT_TAX_CODES[country]) {
      const tc = await trx
        .insertInto('tax_codes')
        .values({
          company_id: companyId,
          code: t.code,
          name: t.name,
          type: t.type,
          output_account_id: acct.OUTPUT_TAX,
          input_account_id: acct.INPUT_TAX,
          is_claimable: t.claimable,
          created_by: userId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('tax_rates').values({ company_id: companyId, tax_code_id: tc.id, rate: t.rate, effective_from: '1943-04-14', created_by: userId }).execute();
    }
    if (country === 'NP') {
      for (const t of DEFAULT_TDS_CODES) {
        await trx
          .insertInto('tds_codes')
          .values({ company_id: companyId, code: t.code, name: t.name, rate: t.rate, payable_account_id: acct.TDS_PAYABLE, receivable_account_id: acct.TDS_RECEIVABLE, created_by: userId })
          .execute();
      }
    }
  }

  private async loadWorkflows(trx: Tx, companyId: string, country: string, roles: Record<string, string>, userId: string) {
    for (const [docType, def] of Object.entries(DOC_TYPES)) {
      const wf = await trx
        .insertInto('approval_workflows')
        .values({ company_id: companyId, doc_type: docType, name: `${def.label} approval`, created_by: userId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await trx.insertInto('approval_steps').values({ company_id: companyId, workflow_id: wf.id, step_no: 1, name: 'Checker review', role_id: null, min_amount: '0' }).execute();
      if (TWO_STEP_DOCS.includes(docType)) {
        await trx
          .insertInto('approval_steps')
          .values({ company_id: companyId, workflow_id: wf.id, step_no: 2, name: 'Finance Manager approval', role_id: roles.FINANCE_MANAGER, min_amount: SECOND_STEP_THRESHOLD[country] })
          .execute();
      }
    }
  }
}
