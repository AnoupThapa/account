/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
/** Editing one field must never reset other stored fields (Zod 4 `.partial()` would re-apply defaults). */
import { describe, it, expect, afterAll } from 'vitest';
import { addMember, closeApp, setupCompany } from './helpers';

afterAll(closeApp);

describe('PATCH edits only change the fields that were sent', () => {
  it('editing an item’s name keeps its prices, unit and purchase-side tax', async () => {
    const { admin } = await setupCompany('NP');
    const maker = await addMember(admin, ['ACCOUNTANT'], 'Mira Maker');
    const item = (await maker.post('/items', { sku: 'P-1', name: 'Original', type: 'NON_INVENTORY', uomCode: 'BOX', taxApplicability: 'TAXABLE', salesPrice: '123.45', purchasePrice: '99' })).body;
    const edited = await maker.patch(`/items/${item.id}`, { name: 'Renamed', version: item.version });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ name: 'Renamed', uom_code: 'BOX', sales_price: '123.4500', purchase_price: '99.0000' });
  });

  it('editing a contact keeps its payment terms', async () => {
    const { admin } = await setupCompany('NP');
    const maker = await addMember(admin, ['ACCOUNTANT'], 'Mira Maker');
    const c = (await maker.post('/contacts', { type: 'CUSTOMER', name: 'Terms Co', paymentTermsDays: 45 })).body;
    const edited = await maker.patch(`/contacts/${c.id}`, { phone: '9800000000', version: c.version });
    expect(edited.status).toBe(200);
    expect(edited.body.payment_terms_days).toBe(45);
  });

  it('changing a role’s approval limit keeps its permissions and 2FA setting', async () => {
    const { admin } = await setupCompany('NP');
    const checker = await addMember(admin, ['CHECKER'], 'Kiran Checker');
    await admin.stepUp();
    const roles = (await admin.get('/roles')).body as { id: string; key: string; requires_2fa: boolean }[];
    const chk = roles.find((r) => r.key === 'CHECKER')!;
    expect((await admin.patch(`/roles/${chk.id}`, { approvalLimit: '1000' })).status).toBe(200);
    expect((await admin.get('/roles')).body.find((r: { key: string }) => r.key === 'CHECKER').requires_2fa).toBe(true);
    expect((await checker.get('/approvals')).status).toBe(200); // still has approval.view
  });
});
