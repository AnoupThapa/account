/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
-- Phase 2B — Tax engine v2 (docs/14): any country, tax regimes, group (compound) tax codes,
-- purchase-side item tax, per-line tax breakdown and override reason.
-- Additive: existing Nepal/Australia companies are migrated to a regime automatically.

-- Any country (ISO 3166-1 alpha-2) or the generic 'OTHER'
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_country_check;
ALTER TABLE companies ADD CONSTRAINT companies_country_check CHECK (country ~ '^[A-Z]{2}$' OR country = 'OTHER');
ALTER TABLE companies ADD COLUMN tax_id varchar(30);                       -- GSTIN / EIN / TRN / UTR … (generic tax registration no.)
ALTER TABLE companies ADD COLUMN tax_override_reason_required boolean NOT NULL DEFAULT true;
ALTER TABLE contacts  ADD COLUMN tax_id varchar(30);

CREATE TABLE tax_regimes (
  id                         uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id                 uuid NOT NULL REFERENCES companies(id),
  key                        varchar(40) NOT NULL,                 -- pack key (e.g. NP_VAT) or CUSTOM
  name                       varchar(120) NOT NULL,
  country                    varchar(5) NOT NULL,
  model                      varchar(12) NOT NULL CHECK (model IN ('CREDIT_VAT','SALES_TAX','COMPOUND','NONE')),
  tax_label                  varchar(30) NOT NULL DEFAULT 'VAT',   -- VAT / GST / Sales Tax …
  tax_id_label               varchar(30) NOT NULL DEFAULT 'Tax ID',-- PAN / ABN / GSTIN …
  invoice_title              varchar(40) NOT NULL DEFAULT 'Tax Invoice',
  prices_include_tax_default boolean NOT NULL DEFAULT false,
  return_period              varchar(10) NOT NULL DEFAULT 'MONTHLY' CHECK (return_period IN ('MONTHLY','QUARTERLY','ANNUAL','NONE')),
  non_taxable_code           varchar(20),                          -- tax code used for the "Non-taxable" choice
  default_standard_code      varchar(20),                          -- code suggested for new taxable items
  source_pack                varchar(40),
  pack_version               varchar(20),
  pack_as_of                 date,
  is_active                  boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid REFERENCES users(id),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid REFERENCES users(id),
  version                    int NOT NULL DEFAULT 1,
  UNIQUE (company_id, key)
);
CREATE TRIGGER trg_tax_regimes_touch BEFORE UPDATE ON tax_regimes FOR EACH ROW EXECUTE FUNCTION touch_row();
ALTER TABLE companies ADD COLUMN tax_regime_id uuid REFERENCES tax_regimes(id);

-- Tax codes belong to a regime; a code may be a GROUP made of component codes (e.g. CGST+SGST, GST+PST)
ALTER TABLE tax_codes ADD COLUMN regime_id uuid REFERENCES tax_regimes(id);
ALTER TABLE tax_codes ADD COLUMN is_group boolean NOT NULL DEFAULT false;
CREATE TABLE tax_code_components (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  group_id      uuid NOT NULL REFERENCES tax_codes(id) ON DELETE CASCADE,
  component_id  uuid NOT NULL REFERENCES tax_codes(id),
  seq           int NOT NULL,
  stacked       boolean NOT NULL DEFAULT false,   -- true: this component is charged on (base + earlier components)
  UNIQUE (group_id, component_id),
  UNIQUE (group_id, seq),
  CHECK (group_id <> component_id)
);

-- Purchase side of an item can differ from the sales side (NULL = same as sales side)
ALTER TABLE items ADD COLUMN purchase_tax_applicability varchar(15) CHECK (purchase_tax_applicability IN ('TAXABLE','ZERO_RATED','EXEMPT','OUT_OF_SCOPE'));
ALTER TABLE items ADD COLUMN purchase_default_tax_code_id uuid REFERENCES tax_codes(id);
ALTER TABLE items ADD CONSTRAINT items_purchase_tax_code_chk CHECK (purchase_tax_applicability IS DISTINCT FROM 'TAXABLE' OR purchase_default_tax_code_id IS NOT NULL);

-- Per-line component breakdown + override reason on every line table
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_quote_lines','sales_order_lines','sales_invoice_lines','credit_note_lines','purchase_order_lines','purchase_bill_lines','debit_note_lines','expense_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN tax_breakdown jsonb, ADD COLUMN tax_override_reason text', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['tax_regimes','tax_code_components']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;

-- Migrate existing companies to a regime (Nepal VAT / Australia GST / custom)
INSERT INTO tax_regimes (company_id, key, name, country, model, tax_label, tax_id_label, invoice_title, non_taxable_code, default_standard_code, return_period, source_pack, pack_version, pack_as_of)
SELECT id,
       CASE country WHEN 'NP' THEN 'NP_VAT' WHEN 'AU' THEN 'AU_GST' ELSE 'CUSTOM' END,
       CASE country WHEN 'NP' THEN 'Nepal VAT' WHEN 'AU' THEN 'Australia GST' ELSE 'Custom tax system' END,
       country, 'CREDIT_VAT',
       CASE country WHEN 'AU' THEN 'GST' ELSE 'VAT' END,
       CASE country WHEN 'NP' THEN 'PAN/VAT No.' WHEN 'AU' THEN 'ABN' ELSE 'Tax ID' END,
       'Tax Invoice',
       CASE country WHEN 'NP' THEN 'EXEMPT' WHEN 'AU' THEN 'N-T' ELSE 'NONE' END,
       CASE country WHEN 'NP' THEN 'VAT13' WHEN 'AU' THEN 'GST' ELSE 'STD' END,
       CASE country WHEN 'AU' THEN 'QUARTERLY' ELSE 'MONTHLY' END,
       CASE country WHEN 'NP' THEN 'NP_VAT' WHEN 'AU' THEN 'AU_GST' END,
       CASE WHEN country IN ('NP','AU') THEN '2026.1' END,
       CASE WHEN country IN ('NP','AU') THEN DATE '2026-10-01' END
FROM companies;
UPDATE companies c SET tax_regime_id = r.id FROM tax_regimes r WHERE r.company_id = c.id;
UPDATE tax_codes t SET regime_id = c.tax_regime_id FROM companies c WHERE c.id = t.company_id;
