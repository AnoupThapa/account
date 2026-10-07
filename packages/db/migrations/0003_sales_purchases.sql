/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
-- Phase 2 — Sales & purchases: items, quotations, sales orders, invoices, credit notes, receipts,
-- customer advances, POs, goods receipts, bills, debit notes, payments, expenses & claims, allocations.

CREATE TABLE uoms (
  code varchar(10) PRIMARY KEY,
  name varchar(40) NOT NULL
);

CREATE TABLE items (
  id                   uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  sku                  varchar(40) NOT NULL,
  name                 varchar(200) NOT NULL,
  description          text,
  type                 varchar(20) NOT NULL CHECK (type IN ('INVENTORY','NON_INVENTORY','SERVICE','RAW_MATERIAL','FINISHED_GOOD','FIXED_ASSET')),
  uom_code             varchar(10) NOT NULL DEFAULT 'PCS' REFERENCES uoms(code),
  tax_applicability    varchar(15) NOT NULL CHECK (tax_applicability IN ('TAXABLE','ZERO_RATED','EXEMPT','OUT_OF_SCOPE')),
  default_tax_code_id  uuid REFERENCES tax_codes(id),
  sales_price          numeric(18,4) NOT NULL DEFAULT 0 CHECK (sales_price >= 0),
  purchase_price       numeric(18,4) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  sales_account_id     uuid REFERENCES accounts(id),
  purchase_account_id  uuid REFERENCES accounts(id),
  inventory_account_id uuid REFERENCES accounts(id),
  cogs_account_id      uuid REFERENCES accounts(id),
  is_stock_tracked     boolean NOT NULL DEFAULT false,
  reorder_level        numeric(18,4),
  hs_code              varchar(20),
  barcode              varchar(60),
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id),
  version              int NOT NULL DEFAULT 1,
  UNIQUE (company_id, sku),
  CHECK (tax_applicability <> 'TAXABLE' OR default_tax_code_id IS NOT NULL)
);
CREATE INDEX ix_items_name_trgm ON items USING gin (name gin_trgm_ops);
CREATE TRIGGER trg_items_touch BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION touch_row();
ALTER TABLE journal_lines ADD CONSTRAINT fk_jl_item FOREIGN KEY (item_id) REFERENCES items(id);

-- ---------------------------------------------------------------------------
-- Common column sets are repeated explicitly per table for clarity.
-- Document status: DRAFT → SUBMITTED → APPROVED → POSTED, plus REJECTED, CANCELLED, REVERSED
-- ---------------------------------------------------------------------------

-- Generic line table shape (used by quotes, orders, invoices, credit notes, POs, bills, debit notes, expenses)
-- quantity NUMERIC(18,4), prices NUMERIC(18,4) entered, amounts NUMERIC(18,2) computed.

-- ---------------- Sales quotations & orders (non-posting) --------------------
CREATE TABLE sales_quotes (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  branch_id          uuid REFERENCES branches(id),
  doc_no             varchar(40) NOT NULL,
  quote_date         date NOT NULL,
  valid_until        date,
  contact_id         uuid NOT NULL REFERENCES contacts(id),
  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  price_includes_tax boolean NOT NULL DEFAULT false,
  subtotal           numeric(18,2) NOT NULL DEFAULT 0,
  tax_total          numeric(18,2) NOT NULL DEFAULT 0,
  grand_total        numeric(18,2) NOT NULL DEFAULT 0,
  notes              text,
  status             varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','ACCEPTED','DECLINED','CONVERTED','CANCELLED')),
  converted_to_id    uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);
CREATE TRIGGER trg_sq_touch BEFORE UPDATE ON sales_quotes FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE sales_orders (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  branch_id          uuid REFERENCES branches(id),
  doc_no             varchar(40) NOT NULL,
  order_date         date NOT NULL,
  expected_date      date,
  contact_id         uuid NOT NULL REFERENCES contacts(id),
  quote_id           uuid REFERENCES sales_quotes(id),
  customer_ref       varchar(60),
  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  price_includes_tax boolean NOT NULL DEFAULT false,
  subtotal           numeric(18,2) NOT NULL DEFAULT 0,
  tax_total          numeric(18,2) NOT NULL DEFAULT 0,
  grand_total        numeric(18,2) NOT NULL DEFAULT 0,
  notes              text,
  status             varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CONFIRMED','INVOICED','CLOSED','CANCELLED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);
CREATE TRIGGER trg_so_touch BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------- Sales invoices ---------------------------------------------
CREATE TABLE sales_invoices (
  id                  uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  branch_id           uuid REFERENCES branches(id),
  doc_no              varchar(40),                       -- assigned on POST (gapless)
  invoice_date        date NOT NULL,
  due_date            date,
  contact_id          uuid NOT NULL REFERENCES contacts(id),
  buyer_name          varchar(200),
  buyer_pan           varchar(20),
  buyer_address       text,
  sales_order_id      uuid REFERENCES sales_orders(id),
  customer_ref        varchar(60),
  currency_code       char(3) NOT NULL REFERENCES currencies(code),
  fx_rate             numeric(18,6) NOT NULL DEFAULT 1,
  price_includes_tax  boolean NOT NULL DEFAULT false,
  cash_account_id     uuid REFERENCES accounts(id),      -- set for a cash sale (Dr Cash/Bank instead of AR)
  subtotal            numeric(18,2) NOT NULL DEFAULT 0,
  discount_total      numeric(18,2) NOT NULL DEFAULT 0,
  taxable_total       numeric(18,2) NOT NULL DEFAULT 0,
  zero_rated_total    numeric(18,2) NOT NULL DEFAULT 0,
  exempt_total        numeric(18,2) NOT NULL DEFAULT 0,
  tax_total           numeric(18,2) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(18,2) NOT NULL DEFAULT 0,
  grand_total         numeric(18,2) NOT NULL DEFAULT 0,
  amount_due          numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  is_opening          boolean NOT NULL DEFAULT false,
  notes               text,
  status              varchar(12) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason       text,
  cancelled_at        timestamptz,
  cancelled_by        uuid REFERENCES users(id),
  reversal_entry_id   uuid REFERENCES journal_entries(id),
  reversed_at         timestamptz,
  print_count         int NOT NULL DEFAULT 0,
  last_printed_at     timestamptz,
  project_id          uuid,
  journal_entry_id    uuid REFERENCES journal_entries(id),
  submitted_at        timestamptz,
  approved_at         timestamptz,
  posted_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  approved_by         uuid REFERENCES users(id),
  version             int NOT NULL DEFAULT 1,
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL),
  CHECK (amount_due <= grand_total),
  UNIQUE (company_id, doc_no)
);
CREATE INDEX ix_si_status_date ON sales_invoices (company_id, status, invoice_date);
CREATE INDEX ix_si_contact ON sales_invoices (company_id, contact_id);

-- ---------------- Credit notes (sales returns) -------------------------------
CREATE TABLE credit_notes (
  id                  uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  branch_id           uuid REFERENCES branches(id),
  doc_no              varchar(40),
  note_date           date NOT NULL,
  contact_id          uuid NOT NULL REFERENCES contacts(id),
  original_invoice_id uuid REFERENCES sales_invoices(id),
  reason              text,
  currency_code       char(3) NOT NULL REFERENCES currencies(code),
  fx_rate             numeric(18,6) NOT NULL DEFAULT 1,
  price_includes_tax  boolean NOT NULL DEFAULT false,
  refund_account_id   uuid REFERENCES accounts(id),      -- cash refund instead of AR credit
  subtotal            numeric(18,2) NOT NULL DEFAULT 0,
  discount_total      numeric(18,2) NOT NULL DEFAULT 0,
  taxable_total       numeric(18,2) NOT NULL DEFAULT 0,
  zero_rated_total    numeric(18,2) NOT NULL DEFAULT 0,
  exempt_total        numeric(18,2) NOT NULL DEFAULT 0,
  tax_total           numeric(18,2) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(18,2) NOT NULL DEFAULT 0,
  grand_total         numeric(18,2) NOT NULL DEFAULT 0,
  unallocated_amount  numeric(18,2) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  notes               text,
  status              varchar(12) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason       text, cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id),
  reversal_entry_id   uuid REFERENCES journal_entries(id), reversed_at timestamptz,
  print_count         int NOT NULL DEFAULT 0, last_printed_at timestamptz,
  journal_entry_id    uuid REFERENCES journal_entries(id),
  submitted_at timestamptz, approved_at timestamptz, posted_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  approved_by         uuid REFERENCES users(id),
  version             int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);

-- ---------------- Receipts & customer advances --------------------------------
CREATE TABLE receipts (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  branch_id          uuid REFERENCES branches(id),
  doc_no             varchar(40),
  receipt_date       date NOT NULL,
  contact_id         uuid NOT NULL REFERENCES contacts(id),
  kind               varchar(10) NOT NULL DEFAULT 'RECEIPT' CHECK (kind IN ('RECEIPT','ADVANCE')),
  deposit_account_id uuid NOT NULL REFERENCES accounts(id),   -- bank / cash / wallet
  amount             numeric(18,2) NOT NULL CHECK (amount > 0), -- amount received in bank/cash
  discount_amount    numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tds_code_id        uuid REFERENCES tds_codes(id),
  tds_amount         numeric(18,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  total              numeric(18,2) NOT NULL DEFAULT 0,          -- amount + discount + tds (credited to customer)
  unallocated_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  reference          varchar(60),
  cheque_no          varchar(30),
  narration          text,
  planned_allocations jsonb NOT NULL DEFAULT '[]',  -- [{targetType,targetId,amount}] applied on posting
  status             varchar(12) NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id),
  reversal_entry_id uuid REFERENCES journal_entries(id), reversed_at timestamptz,
  print_count int NOT NULL DEFAULT 0, last_printed_at timestamptz,
  journal_entry_id   uuid REFERENCES journal_entries(id),
  submitted_at timestamptz, approved_at timestamptz, posted_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  approved_by        uuid REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  CHECK (kind = 'RECEIPT' OR (discount_amount = 0 AND tds_amount = 0)),
  UNIQUE (company_id, doc_no)
);

-- Apply a customer/supplier advance to an invoice/bill (Dr Customer Advances, Cr AR / Dr AP, Cr Supplier Advances)
CREATE TABLE advance_adjustments (
  id                uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  doc_no            varchar(40),
  adjustment_date   date NOT NULL,
  side              varchar(10) NOT NULL CHECK (side IN ('CUSTOMER','SUPPLIER')),
  contact_id        uuid NOT NULL REFERENCES contacts(id),
  advance_id        uuid NOT NULL,           -- receipts.id (CUSTOMER) or payments.id (SUPPLIER), kind = ADVANCE
  target_id         uuid NOT NULL,           -- sales_invoices.id or purchase_bills.id
  amount            numeric(18,2) NOT NULL CHECK (amount > 0),
  total             numeric(18,2) NOT NULL DEFAULT 0,
  narration         text,
  status            varchar(12) NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id),
  reversal_entry_id uuid REFERENCES journal_entries(id), reversed_at timestamptz,
  journal_entry_id  uuid REFERENCES journal_entries(id),
  submitted_at timestamptz, approved_at timestamptz, posted_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id),
  approved_by       uuid REFERENCES users(id),
  version           int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);

-- ---------------- Purchase orders & goods receipts (non-posting in Phase 2) ---
CREATE TABLE purchase_orders (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  branch_id          uuid REFERENCES branches(id),
  doc_no             varchar(40) NOT NULL,
  order_date         date NOT NULL,
  expected_date      date,
  contact_id         uuid NOT NULL REFERENCES contacts(id),
  currency_code      char(3) NOT NULL REFERENCES currencies(code),
  price_includes_tax boolean NOT NULL DEFAULT false,
  subtotal           numeric(18,2) NOT NULL DEFAULT 0,
  tax_total          numeric(18,2) NOT NULL DEFAULT 0,
  grand_total        numeric(18,2) NOT NULL DEFAULT 0,
  notes              text,
  status             varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ISSUED','PARTIAL','RECEIVED','BILLED','CLOSED','CANCELLED')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);
CREATE TRIGGER trg_po_touch BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE goods_receipts (
  id                uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  branch_id         uuid REFERENCES branches(id),
  doc_no            varchar(40) NOT NULL,
  receipt_date      date NOT NULL,
  contact_id        uuid NOT NULL REFERENCES contacts(id),
  purchase_order_id uuid REFERENCES purchase_orders(id),
  supplier_ref      varchar(60),
  notes             text,
  status            varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','RECEIVED','BILLED','CANCELLED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id),
  version           int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);
CREATE TRIGGER trg_grn_touch BEFORE UPDATE ON goods_receipts FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------- Purchase bills ---------------------------------------------
CREATE TABLE purchase_bills (
  id                  uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  branch_id           uuid REFERENCES branches(id),
  doc_no              varchar(40),
  bill_date           date NOT NULL,
  due_date            date,
  contact_id          uuid NOT NULL REFERENCES contacts(id),
  supplier_invoice_no varchar(60) NOT NULL,
  supplier_invoice_date date,
  supplier_pan        varchar(20),
  purchase_order_id   uuid REFERENCES purchase_orders(id),
  goods_receipt_id    uuid REFERENCES goods_receipts(id),
  currency_code       char(3) NOT NULL REFERENCES currencies(code),
  fx_rate             numeric(18,6) NOT NULL DEFAULT 1,
  price_includes_tax  boolean NOT NULL DEFAULT false,
  subtotal            numeric(18,2) NOT NULL DEFAULT 0,
  discount_total      numeric(18,2) NOT NULL DEFAULT 0,
  taxable_total       numeric(18,2) NOT NULL DEFAULT 0,
  zero_rated_total    numeric(18,2) NOT NULL DEFAULT 0,
  exempt_total        numeric(18,2) NOT NULL DEFAULT 0,
  tax_total           numeric(18,2) NOT NULL DEFAULT 0,
  non_claimable_tax   numeric(18,2) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(18,2) NOT NULL DEFAULT 0,
  grand_total         numeric(18,2) NOT NULL DEFAULT 0,
  amount_due          numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  is_opening          boolean NOT NULL DEFAULT false,
  source_document_id  uuid,     -- FK to documents in Phase 5 (OCR original)
  ocr_job_id          uuid,     -- FK to ocr_jobs in Phase 5
  notes               text,
  status              varchar(12) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id),
  reversal_entry_id uuid REFERENCES journal_entries(id), reversed_at timestamptz,
  print_count int NOT NULL DEFAULT 0, last_printed_at timestamptz,
  project_id          uuid,
  journal_entry_id    uuid REFERENCES journal_entries(id),
  submitted_at timestamptz, approved_at timestamptz, posted_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  approved_by         uuid REFERENCES users(id),
  version             int NOT NULL DEFAULT 1,
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL),
  CHECK (amount_due <= grand_total),
  UNIQUE (company_id, doc_no)
);
-- Duplicate supplier-invoice guard (cancelled bills don't block re-entry)
CREATE UNIQUE INDEX ux_bill_supplier_invoice ON purchase_bills (company_id, contact_id, lower(supplier_invoice_no))
  WHERE status <> 'CANCELLED';
CREATE INDEX ix_pb_status_date ON purchase_bills (company_id, status, bill_date);

-- ---------------- Debit notes (purchase returns) -----------------------------
CREATE TABLE debit_notes (
  id                  uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  branch_id           uuid REFERENCES branches(id),
  doc_no              varchar(40),
  note_date           date NOT NULL,
  contact_id          uuid NOT NULL REFERENCES contacts(id),
  original_bill_id    uuid REFERENCES purchase_bills(id),
  supplier_ref        varchar(60),
  reason              text,
  currency_code       char(3) NOT NULL REFERENCES currencies(code),
  fx_rate             numeric(18,6) NOT NULL DEFAULT 1,
  price_includes_tax  boolean NOT NULL DEFAULT false,
  refund_account_id   uuid REFERENCES accounts(id),
  subtotal            numeric(18,2) NOT NULL DEFAULT 0,
  discount_total      numeric(18,2) NOT NULL DEFAULT 0,
  taxable_total       numeric(18,2) NOT NULL DEFAULT 0,
  zero_rated_total    numeric(18,2) NOT NULL DEFAULT 0,
  exempt_total        numeric(18,2) NOT NULL DEFAULT 0,
  tax_total           numeric(18,2) NOT NULL DEFAULT 0,
  non_claimable_tax   numeric(18,2) NOT NULL DEFAULT 0,
  rounding_adjustment numeric(18,2) NOT NULL DEFAULT 0,
  grand_total         numeric(18,2) NOT NULL DEFAULT 0,
  unallocated_amount  numeric(18,2) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  notes               text,
  status              varchar(12) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id),
  reversal_entry_id uuid REFERENCES journal_entries(id), reversed_at timestamptz,
  print_count int NOT NULL DEFAULT 0, last_printed_at timestamptz,
  journal_entry_id    uuid REFERENCES journal_entries(id),
  submitted_at timestamptz, approved_at timestamptz, posted_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid NOT NULL REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES users(id),
  approved_by         uuid REFERENCES users(id),
  version             int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);

-- ---------------- Payments & supplier advances --------------------------------
CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  branch_id            uuid REFERENCES branches(id),
  doc_no               varchar(40),
  payment_date         date NOT NULL,
  contact_id           uuid NOT NULL REFERENCES contacts(id),
  kind                 varchar(10) NOT NULL DEFAULT 'PAYMENT' CHECK (kind IN ('PAYMENT','ADVANCE','CLAIM')),
  paid_from_account_id uuid NOT NULL REFERENCES accounts(id),
  amount               numeric(18,2) NOT NULL CHECK (amount > 0),  -- paid out of bank/cash
  discount_amount      numeric(18,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tds_code_id          uuid REFERENCES tds_codes(id),
  tds_amount           numeric(18,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  total                numeric(18,2) NOT NULL DEFAULT 0,             -- amount + discount + tds (debited to supplier)
  unallocated_amount   numeric(18,2) NOT NULL DEFAULT 0 CHECK (unallocated_amount >= 0),
  reference            varchar(60),
  cheque_no            varchar(30),
  narration            text,
  planned_allocations  jsonb NOT NULL DEFAULT '[]',
  status               varchar(12) NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id),
  reversal_entry_id uuid REFERENCES journal_entries(id), reversed_at timestamptz,
  print_count int NOT NULL DEFAULT 0, last_printed_at timestamptz,
  journal_entry_id     uuid REFERENCES journal_entries(id),
  submitted_at timestamptz, approved_at timestamptz, posted_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id),
  approved_by          uuid REFERENCES users(id),
  version              int NOT NULL DEFAULT 1,
  CHECK (kind = 'PAYMENT' OR (discount_amount = 0 AND tds_amount = 0)),
  UNIQUE (company_id, doc_no)
);

-- ---------------- Expenses & claims -------------------------------------------
CREATE TABLE expenses (
  id                   uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  branch_id            uuid REFERENCES branches(id),
  doc_no               varchar(40),
  expense_date         date NOT NULL,
  kind                 varchar(10) NOT NULL CHECK (kind IN ('PAID','CLAIM')), -- PAID = direct from bank/cash; CLAIM = owed to employee
  contact_id           uuid REFERENCES contacts(id),        -- optional supplier (PAID) / required employee (CLAIM)
  paid_from_account_id uuid REFERENCES accounts(id),
  supplier_invoice_no  varchar(60),
  supplier_pan         varchar(20),
  currency_code        char(3) NOT NULL REFERENCES currencies(code),
  fx_rate              numeric(18,6) NOT NULL DEFAULT 1,
  price_includes_tax   boolean NOT NULL DEFAULT false,
  subtotal             numeric(18,2) NOT NULL DEFAULT 0,
  discount_total       numeric(18,2) NOT NULL DEFAULT 0,
  taxable_total        numeric(18,2) NOT NULL DEFAULT 0,
  zero_rated_total     numeric(18,2) NOT NULL DEFAULT 0,
  exempt_total         numeric(18,2) NOT NULL DEFAULT 0,
  tax_total            numeric(18,2) NOT NULL DEFAULT 0,
  non_claimable_tax    numeric(18,2) NOT NULL DEFAULT 0,
  rounding_adjustment  numeric(18,2) NOT NULL DEFAULT 0,
  grand_total          numeric(18,2) NOT NULL DEFAULT 0,
  amount_due           numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  narration            text,
  status               varchar(12) NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  cancel_reason text, cancelled_at timestamptz, cancelled_by uuid REFERENCES users(id),
  reversal_entry_id uuid REFERENCES journal_entries(id), reversed_at timestamptz,
  print_count int NOT NULL DEFAULT 0, last_printed_at timestamptz,
  project_id           uuid,
  journal_entry_id     uuid REFERENCES journal_entries(id),
  submitted_at timestamptz, approved_at timestamptz, posted_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id),
  approved_by          uuid REFERENCES users(id),
  version              int NOT NULL DEFAULT 1,
  CHECK ((kind = 'PAID' AND paid_from_account_id IS NOT NULL) OR (kind = 'CLAIM' AND contact_id IS NOT NULL)),
  UNIQUE (company_id, doc_no)
);

-- ---------------- Line tables (one shape) --------------------------------------
DO $$
DECLARE
  spec text[];
  specs text[][] := ARRAY[
    ARRAY['sales_quote_lines','sales_quotes','quote_id'],
    ARRAY['sales_order_lines','sales_orders','order_id'],
    ARRAY['sales_invoice_lines','sales_invoices','invoice_id'],
    ARRAY['credit_note_lines','credit_notes','note_id'],
    ARRAY['purchase_order_lines','purchase_orders','order_id'],
    ARRAY['purchase_bill_lines','purchase_bills','bill_id'],
    ARRAY['debit_note_lines','debit_notes','note_id'],
    ARRAY['expense_lines','expenses','expense_id']
  ];
BEGIN
  FOREACH spec SLICE 1 IN ARRAY specs LOOP
    EXECUTE format($f$
      CREATE TABLE %1$I (
        id               uuid PRIMARY KEY DEFAULT uuid_v7(),
        company_id       uuid NOT NULL REFERENCES companies(id),
        %3$I             uuid NOT NULL REFERENCES %2$I(id) ON DELETE CASCADE,
        line_no          int NOT NULL,
        item_id          uuid REFERENCES items(id),
        account_id       uuid REFERENCES accounts(id),
        description      text,
        quantity         numeric(18,4) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
        unit_price       numeric(18,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
        discount_percent numeric(7,4) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
        discount_amount  numeric(18,2) NOT NULL DEFAULT 0,
        tax_code_id      uuid REFERENCES tax_codes(id),
        tax_type         varchar(20) NOT NULL DEFAULT 'OUT_OF_SCOPE',
        tax_rate         numeric(7,4) NOT NULL DEFAULT 0,
        is_claimable     boolean NOT NULL DEFAULT true,
        net_amount       numeric(18,2) NOT NULL DEFAULT 0,
        tax_amount       numeric(18,2) NOT NULL DEFAULT 0,
        total_amount     numeric(18,2) NOT NULL DEFAULT 0,
        cost_centre_id   uuid REFERENCES cost_centres(id),
        project_id       uuid,
        UNIQUE (%3$I, line_no),
        CHECK (item_id IS NOT NULL OR account_id IS NOT NULL)
      )$f$, spec[1], spec[2], spec[3]);
  END LOOP;
END $$;

CREATE TABLE goods_receipt_lines (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  receipt_id       uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  line_no          int NOT NULL,
  po_line_id       uuid REFERENCES purchase_order_lines(id),
  item_id          uuid NOT NULL REFERENCES items(id),
  description      text,
  quantity         numeric(18,4) NOT NULL CHECK (quantity > 0),
  UNIQUE (receipt_id, line_no)
);

-- Guards on posting documents
SELECT attach_document_guards('sales_invoices', 'sales_invoice_lines', 'invoice_id', ARRAY['amount_due']);
SELECT attach_document_guards('credit_notes', 'credit_note_lines', 'note_id', ARRAY['unallocated_amount']);
SELECT attach_document_guards('receipts', NULL, NULL, ARRAY['unallocated_amount']);
SELECT attach_document_guards('advance_adjustments', NULL, NULL);
SELECT attach_document_guards('purchase_bills', 'purchase_bill_lines', 'bill_id', ARRAY['amount_due']);
SELECT attach_document_guards('debit_notes', 'debit_note_lines', 'note_id', ARRAY['unallocated_amount']);
SELECT attach_document_guards('payments', NULL, NULL, ARRAY['unallocated_amount']);
SELECT attach_document_guards('expenses', 'expense_lines', 'expense_id', ARRAY['amount_due']);

-- ---------------- Allocations (sub-ledger matching) ----------------------------
-- source: RECEIPT | CREDIT_NOTE (customer side)  PAYMENT | DEBIT_NOTE (supplier side)
-- target: SALES_INVOICE | PURCHASE_BILL | EXPENSE (claim)
CREATE TABLE allocations (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  contact_id   uuid NOT NULL REFERENCES contacts(id),
  source_type  varchar(20) NOT NULL CHECK (source_type IN ('RECEIPT','CREDIT_NOTE','PAYMENT','DEBIT_NOTE','ADVANCE_ADJUSTMENT')),
  source_id    uuid NOT NULL,
  target_type  varchar(20) NOT NULL CHECK (target_type IN ('SALES_INVOICE','PURCHASE_BILL','EXPENSE')),
  target_id    uuid NOT NULL,
  amount       numeric(18,2) NOT NULL CHECK (amount > 0),
  allocated_on date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid NOT NULL REFERENCES users(id),
  reversed_at  timestamptz,
  reversed_by  uuid REFERENCES users(id)
);
CREATE INDEX ix_alloc_source ON allocations (company_id, source_type, source_id);
CREATE INDEX ix_alloc_target ON allocations (company_id, target_type, target_id);
CREATE OR REPLACE FUNCTION guard_allocation_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN PERFORM raise_app_error('ACC_IMMUTABLE', 'Allocations are un-allocated, never deleted'); END IF;
  IF (to_jsonb(NEW) - 'reversed_at' - 'reversed_by') <> (to_jsonb(OLD) - 'reversed_at' - 'reversed_by') OR OLD.reversed_at IS NOT NULL THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Allocations can only be reversed once');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_alloc_guard BEFORE UPDATE OR DELETE ON allocations FOR EACH ROW EXECUTE FUNCTION guard_allocation_update();

-- ---------------- RLS ---------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['items','sales_quotes','sales_quote_lines','sales_orders','sales_order_lines','sales_invoices',
                           'sales_invoice_lines','credit_notes','credit_note_lines','receipts','advance_adjustments',
                           'purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines',
                           'purchase_bills','purchase_bill_lines','debit_notes','debit_note_lines','payments',
                           'expenses','expense_lines','allocations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;
