-- Phase 1 — Core ledger: chart of accounts, cost centres, contacts, tax codes & rates, TDS codes,
-- journal entries/lines with DB-level guarantees, posting rules, balances, maker–checker,
-- manual journals, opening balances. See docs/02-accounting-rules.md and docs/database.md §3.

-- ---------------------------------------------------------------------------
-- Chart of accounts
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  code             varchar(20) NOT NULL,
  name             varchar(150) NOT NULL,
  class            varchar(10) NOT NULL CHECK (class IN ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  parent_id        uuid REFERENCES accounts(id),
  is_postable      boolean NOT NULL DEFAULT true,   -- false = heading (Class / Group / Sub-group)
  is_control       boolean NOT NULL DEFAULT false,  -- AR, AP, Inventory, VAT: post via sub-ledgers only
  requires_contact boolean NOT NULL DEFAULT false,  -- lines must carry a customer/supplier/employee
  is_system        boolean NOT NULL DEFAULT false,  -- protected (cannot be renamed/deactivated/deleted)
  system_key       varchar(40),                     -- e.g. AR_CONTROL, OUTPUT_VAT, RETAINED_EARNINGS
  subtype          varchar(30),                     -- CASH, BANK, WALLET, RECEIVABLE, CURRENT_ASSET, ... (statements)
  cash_flow_category varchar(20) CHECK (cash_flow_category IN ('OPERATING','INVESTING','FINANCING','CASH')),
  currency_code    char(3) REFERENCES currencies(code),
  description      text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  version          int NOT NULL DEFAULT 1,
  UNIQUE (company_id, code),
  UNIQUE (company_id, system_key),
  UNIQUE (company_id, id)
);
CREATE INDEX ix_accounts_parent ON accounts (company_id, parent_id);
CREATE TRIGGER trg_accounts_touch BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE OR REPLACE FUNCTION protect_system_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN PERFORM raise_app_error('VAL_FIELD', 'System accounts cannot be deleted'); END IF;
    RETURN OLD;
  END IF;
  IF OLD.is_system AND (NEW.is_active IS DISTINCT FROM OLD.is_active OR NEW.system_key IS DISTINCT FROM OLD.system_key
      OR NEW.class IS DISTINCT FROM OLD.class OR NEW.is_postable IS DISTINCT FROM OLD.is_postable
      OR NEW.is_control IS DISTINCT FROM OLD.is_control OR NEW.is_system IS DISTINCT FROM OLD.is_system
      OR NEW.code IS DISTINCT FROM OLD.code OR NEW.name IS DISTINCT FROM OLD.name) THEN
    PERFORM raise_app_error('VAL_FIELD', 'System account ' || OLD.code || ' is protected');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_accounts_protect BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION protect_system_account();

CREATE TABLE cost_centres (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  code        varchar(20) NOT NULL,
  name        varchar(150) NOT NULL,
  parent_id   uuid REFERENCES cost_centres(id),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users(id),
  version     int NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);
CREATE TRIGGER trg_cc_touch BEFORE UPDATE ON cost_centres FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------
-- Contacts (customers / suppliers / employees)
-- ---------------------------------------------------------------------------
CREATE TABLE contacts (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  type               varchar(10) NOT NULL CHECK (type IN ('CUSTOMER','SUPPLIER','BOTH','EMPLOYEE')),
  code               varchar(30) NOT NULL,
  name               varchar(200) NOT NULL,
  pan                varchar(20),
  vat_no             varchar(20),
  abn                varchar(20),
  email              varchar(254),
  phone              varchar(40),
  address            text,
  credit_limit       numeric(18,2) CHECK (credit_limit IS NULL OR credit_limit >= 0),
  payment_terms_days int NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  currency_code      char(3) REFERENCES currencies(code),
  notes              text,
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);
CREATE INDEX ix_contacts_name_trgm ON contacts USING gin (name gin_trgm_ops);
CREATE TRIGGER trg_contacts_touch BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------
-- Tax codes & effective-dated rates (Admin only), TDS codes
-- ---------------------------------------------------------------------------
CREATE TABLE tax_codes (
  id                uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  code              varchar(20) NOT NULL,
  name              varchar(80) NOT NULL,
  type              varchar(20) NOT NULL CHECK (type IN ('STANDARD','ZERO_RATED','EXEMPT','OUT_OF_SCOPE','REVERSE_CHARGE')),
  output_account_id uuid REFERENCES accounts(id),
  input_account_id  uuid REFERENCES accounts(id),
  is_claimable      boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id),
  version           int NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);
CREATE TRIGGER trg_tax_codes_touch BEFORE UPDATE ON tax_codes FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE tax_rates (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  tax_code_id    uuid NOT NULL REFERENCES tax_codes(id),
  rate           numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  effective_from date NOT NULL,
  effective_to   date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  EXCLUDE USING gist (tax_code_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)
);

CREATE TABLE tds_codes (
  id                     uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id             uuid NOT NULL REFERENCES companies(id),
  code                   varchar(20) NOT NULL,
  name                   varchar(120) NOT NULL,
  rate                   numeric(7,4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  payable_account_id     uuid NOT NULL REFERENCES accounts(id),
  receivable_account_id  uuid REFERENCES accounts(id),
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid REFERENCES users(id),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid REFERENCES users(id),
  version                int NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);
CREATE TRIGGER trg_tds_touch BEFORE UPDATE ON tds_codes FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------
-- Ledger (ONLY the ledger module writes here — enforced via app.ledger_writer flag)
-- ---------------------------------------------------------------------------
CREATE TABLE journal_entries (
  id                   uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  branch_id            uuid REFERENCES branches(id),
  entry_no             varchar(40) NOT NULL,
  entry_date           date NOT NULL,
  period_id            uuid NOT NULL REFERENCES accounting_periods(id),
  source_type          varchar(40) NOT NULL,
  source_id            uuid,
  source_no            varchar(40),
  narration            text,
  is_opening           boolean NOT NULL DEFAULT false,
  status               varchar(12) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED','REVERSED')),
  reversal_of          uuid REFERENCES journal_entries(id),
  reversed_by_entry_id uuid REFERENCES journal_entries(id),
  total                numeric(18,2) NOT NULL CHECK (total > 0),
  posted_by            uuid NOT NULL REFERENCES users(id),
  approved_by          uuid REFERENCES users(id),
  posted_at            timestamptz NOT NULL DEFAULT now(),
  created_txid         bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (company_id, entry_no)
);
CREATE INDEX ix_je_company_date ON journal_entries (company_id, entry_date);
CREATE INDEX ix_je_source ON journal_entries (source_type, source_id);
CREATE UNIQUE INDEX ux_je_one_reversal ON journal_entries (reversal_of) WHERE reversal_of IS NOT NULL;

CREATE TABLE journal_lines (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  entry_id       uuid NOT NULL REFERENCES journal_entries(id),
  company_id     uuid NOT NULL REFERENCES companies(id),
  line_no        int NOT NULL,
  account_id     uuid NOT NULL REFERENCES accounts(id),
  debit          numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency_code  char(3) NOT NULL REFERENCES currencies(code),
  fx_rate        numeric(18,6) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
  amount_fc      numeric(18,2),
  contact_id     uuid REFERENCES contacts(id),
  item_id        uuid,               -- FK added in 0003 (items)
  cost_centre_id uuid REFERENCES cost_centres(id),
  project_id     uuid,               -- FK added in Phase 6 (projects)
  tax_code_id    uuid REFERENCES tax_codes(id),
  description    text,
  entry_date     date NOT NULL,       -- denormalised from the entry for fast GL/TB queries
  CHECK ((debit = 0) <> (credit = 0)),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX ix_jl_acct_date ON journal_lines (company_id, account_id, entry_date);
CREATE INDEX ix_jl_contact ON journal_lines (company_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX ix_jl_project ON journal_lines (company_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX ix_jl_entry ON journal_lines (entry_id);

-- 1) Only the ledger module may write (it sets app.ledger_writer = 'on' inside its transaction)
CREATE OR REPLACE FUNCTION require_ledger_writer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('app.ledger_writer', true), '') <> 'on' THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Journal entries can only be written by the ledger service');
  END IF;
  RETURN NEW;
END $$;

-- 2) Period / fiscal year guarantee + date consistency
CREATE OR REPLACE FUNCTION check_period_open() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p accounting_periods;
  fy_status text;
BEGIN
  SELECT * INTO p FROM accounting_periods WHERE id = NEW.period_id AND company_id = NEW.company_id;
  IF NOT FOUND THEN PERFORM raise_app_error('ACC_NO_FISCAL_YEAR', 'No accounting period for this entry'); END IF;
  IF NEW.entry_date < p.start_date OR NEW.entry_date > p.end_date THEN
    PERFORM raise_app_error('ACC_NO_FISCAL_YEAR', 'Entry date is outside its accounting period');
  END IF;
  SELECT status INTO fy_status FROM fiscal_years WHERE id = p.fiscal_year_id;
  IF fy_status = 'CLOSED' THEN PERFORM raise_app_error('ACC_YEAR_CLOSED', 'Fiscal year is closed'); END IF;
  IF p.is_locked THEN PERFORM raise_app_error('ACC_PERIOD_LOCKED', p.name || ' is locked'); END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_je_writer BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION require_ledger_writer();
CREATE TRIGGER trg_je_period BEFORE INSERT ON journal_entries FOR EACH ROW EXECUTE FUNCTION check_period_open();
CREATE TRIGGER trg_jl_writer BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION require_ledger_writer();

-- 3) Immutability: lines never change; entries only POSTED → REVERSED (linking the reversal)
CREATE OR REPLACE FUNCTION block_ledger_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM raise_app_error('ACC_IMMUTABLE', 'Posted ledger rows are immutable; use a reversal');
  RETURN NULL;
END $$;
CREATE TRIGGER trg_jl_immutable BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION block_ledger_change();
CREATE TRIGGER trg_jl_no_truncate BEFORE TRUNCATE ON journal_lines FOR EACH STATEMENT EXECUTE FUNCTION block_ledger_change();
CREATE TRIGGER trg_je_no_truncate BEFORE TRUNCATE ON journal_entries FOR EACH STATEMENT EXECUTE FUNCTION block_ledger_change();

CREATE OR REPLACE FUNCTION guard_entry_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Posted entries cannot be deleted; use a reversal');
  END IF;
  IF coalesce(current_setting('app.ledger_writer', true), '') <> 'on' THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Journal entries can only be changed by the ledger service');
  END IF;
  IF NOT (OLD.status = 'POSTED' AND NEW.status = 'REVERSED' AND NEW.reversed_by_entry_id IS NOT NULL
          AND (to_jsonb(NEW) - 'status' - 'reversed_by_entry_id') = (to_jsonb(OLD) - 'status' - 'reversed_by_entry_id')) THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Posted entries are immutable; only reversal is allowed');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_je_guard BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION guard_entry_update();

-- 4) Line validation: same company, active postable account, contact on control accounts,
--    lines only added in the transaction that created the entry, entry_date copied from entry.
CREATE OR REPLACE FUNCTION check_journal_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  e journal_entries;
  a accounts;
BEGIN
  SELECT * INTO e FROM journal_entries WHERE id = NEW.entry_id;
  IF NOT FOUND OR e.company_id <> NEW.company_id THEN
    PERFORM raise_app_error('VAL_FIELD', 'Journal line does not belong to this company''s entry');
  END IF;
  IF e.created_txid <> txid_current() THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Lines cannot be added to an existing posted entry');
  END IF;
  NEW.entry_date := e.entry_date;
  SELECT * INTO a FROM accounts WHERE id = NEW.account_id;
  IF NOT FOUND OR a.company_id <> NEW.company_id THEN
    PERFORM raise_app_error('VAL_FIELD', 'Account does not belong to this company');
  END IF;
  IF NOT a.is_active THEN PERFORM raise_app_error('ACC_ACCOUNT_INACTIVE', 'Account ' || a.code || ' is inactive'); END IF;
  IF NOT a.is_postable THEN PERFORM raise_app_error('ACC_NOT_POSTABLE', 'Account ' || a.code || ' is a heading'); END IF;
  IF a.requires_contact AND NEW.contact_id IS NULL THEN
    PERFORM raise_app_error('ACC_CONTROL_ACCOUNT', 'Account ' || a.code || ' ' || a.name || ' needs a customer/supplier');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_jl_check BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION check_journal_line();

-- 5) Balanced-entry guarantee, checked at COMMIT (database.md §3)
CREATE OR REPLACE FUNCTION check_entry_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_entry uuid;
  v_dr numeric; v_cr numeric; v_n int; v_total numeric;
BEGIN
  v_entry := CASE WHEN TG_TABLE_NAME = 'journal_entries' THEN (to_jsonb(NEW) ->> 'id')::uuid ELSE (to_jsonb(NEW) ->> 'entry_id')::uuid END;
  SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO v_dr, v_cr, v_n
    FROM journal_lines WHERE entry_id = v_entry;
  IF v_n < 2 THEN
    PERFORM raise_app_error('ACC_UNBALANCED', 'Journal entry needs at least two lines');
  END IF;
  IF v_dr <> v_cr THEN
    PERFORM raise_app_error('ACC_UNBALANCED', 'Journal entry is not balanced (difference ' || (v_dr - v_cr)::text || ')');
  END IF;
  SELECT total INTO v_total FROM journal_entries WHERE id = v_entry;
  IF v_total <> v_dr THEN
    PERFORM raise_app_error('ACC_UNBALANCED', 'Journal entry total does not match its lines');
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_entry_balanced AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();
CREATE CONSTRAINT TRIGGER trg_entry_has_lines AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entry_balanced();

-- 6) Balance snapshots (architecture.md §7), maintained automatically on every posted line
CREATE TABLE account_period_balances (
  company_id   uuid NOT NULL REFERENCES companies(id),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  period_id    uuid NOT NULL REFERENCES accounting_periods(id),
  branch_id    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  debit_total  numeric(18,2) NOT NULL DEFAULT 0,
  credit_total numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, account_id, period_id, branch_id)
);
CREATE OR REPLACE FUNCTION apb_add_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e journal_entries;
BEGIN
  SELECT * INTO e FROM journal_entries WHERE id = NEW.entry_id;
  INSERT INTO account_period_balances (company_id, account_id, period_id, branch_id, debit_total, credit_total)
  VALUES (NEW.company_id, NEW.account_id, e.period_id, coalesce(e.branch_id, '00000000-0000-0000-0000-000000000000'), NEW.debit, NEW.credit)
  ON CONFLICT (company_id, account_id, period_id, branch_id)
  DO UPDATE SET debit_total = account_period_balances.debit_total + EXCLUDED.debit_total,
                credit_total = account_period_balances.credit_total + EXCLUDED.credit_total;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_jl_apb AFTER INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION apb_add_line();

-- Posting rules (docs/02 §5) — data, not code. company_id NULL = global default; company rows override.
CREATE TABLE posting_rules (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id  uuid REFERENCES companies(id),
  source_type varchar(40) NOT NULL,
  role        varchar(40) NOT NULL,
  side        varchar(6) NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  account_ref varchar(60) NOT NULL,   -- 'SYSTEM:<system_key>' | 'LINE' (account supplied by the document)
  description text,
  UNIQUE NULLS NOT DISTINCT (company_id, source_type, role)
);

-- ---------------------------------------------------------------------------
-- Maker–checker (docs/06)
-- ---------------------------------------------------------------------------
CREATE TABLE approval_workflows (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  doc_type     varchar(40) NOT NULL,
  name         varchar(120) NOT NULL,
  auto_approve boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid REFERENCES users(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES users(id),
  version      int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_type)
);
CREATE TRIGGER trg_wf_touch BEFORE UPDATE ON approval_workflows FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE approval_steps (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  workflow_id uuid NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
  step_no     smallint NOT NULL CHECK (step_no >= 1),
  name        varchar(80) NOT NULL,
  role_id     uuid REFERENCES roles(id),               -- NULL = anyone with <doc>.approve
  min_amount  numeric(18,2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0), -- step applies when amount >= min_amount
  UNIQUE (workflow_id, step_no)
);

CREATE TABLE approval_requests (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  doc_type     varchar(40) NOT NULL,
  doc_id       uuid NOT NULL,
  doc_ref      varchar(60),
  amount       numeric(18,2) NOT NULL DEFAULT 0,
  workflow_id  uuid REFERENCES approval_workflows(id),
  current_step int NOT NULL DEFAULT 1,
  total_steps  int NOT NULL DEFAULT 1,
  steps        jsonb NOT NULL DEFAULT '[]',  -- snapshot of the applicable workflow steps at submission
  status       varchar(12) NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  submitted_by uuid NOT NULL REFERENCES users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ix_apr_pending ON approval_requests (company_id, status, doc_type);
CREATE UNIQUE INDEX ux_apr_one_pending ON approval_requests (doc_type, doc_id) WHERE status = 'PENDING';

CREATE TABLE approval_actions (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  request_id  uuid NOT NULL REFERENCES approval_requests(id),
  step_no     int NOT NULL,
  action      varchar(10) NOT NULL CHECK (action IN ('APPROVE','REJECT','RETURN','SUBMIT','WITHDRAW')),
  acted_by    uuid NOT NULL REFERENCES users(id),
  comment     text,
  acted_at    timestamptz NOT NULL DEFAULT now()
);
-- Maker ≠ checker at DB level for approval actions
CREATE OR REPLACE FUNCTION check_approval_action() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r approval_requests; allowed boolean;
BEGIN
  IF NEW.action IN ('APPROVE','REJECT','RETURN') THEN
    SELECT * INTO r FROM approval_requests WHERE id = NEW.request_id;
    SELECT self_approval_allowed INTO allowed FROM companies WHERE id = r.company_id;
    IF NEW.action = 'APPROVE' AND r.submitted_by = NEW.acted_by AND NOT coalesce(allowed, false) THEN
      PERFORM raise_app_error('APR_SELF_APPROVAL', 'You can''t approve your own entry');
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_apr_action_check BEFORE INSERT ON approval_actions FOR EACH ROW EXECUTE FUNCTION check_approval_action();

-- Generic document guards used by every financial document table -------------------------
-- (a) maker ≠ checker: approved_by must differ from created_by unless company allows self-approval
CREATE OR REPLACE FUNCTION check_maker_checker() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean;
BEGIN
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.created_by THEN
    SELECT self_approval_allowed INTO allowed FROM companies WHERE id = NEW.company_id;
    IF NOT coalesce(allowed, false) THEN
      PERFORM raise_app_error('APR_SELF_APPROVAL', 'You can''t approve your own entry');
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- (b) posted / cancelled / reversed documents are immutable except the listed columns (TG_ARGV)
CREATE OR REPLACE FUNCTION protect_posted_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := ARRAY['status','updated_at','updated_by','version','cancel_reason','cancelled_at','cancelled_by',
                          'reversed_at','reversal_entry_id','print_count','last_printed_at'] || TG_ARGV;
  o jsonb; n jsonb; k text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('DRAFT','REJECTED') THEN
      PERFORM raise_app_error('ACC_IMMUTABLE', 'Only draft documents can be deleted; cancel or reverse instead');
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('POSTED','CANCELLED','REVERSED') THEN
    o := to_jsonb(OLD); n := to_jsonb(NEW);
    FOREACH k IN ARRAY allowed LOOP o := o - k; n := n - k; END LOOP;
    IF o <> n THEN
      PERFORM raise_app_error('ACC_IMMUTABLE', 'Posted documents can''t be changed — cancel, reverse or issue a credit/debit note');
    END IF;
    IF OLD.status <> NEW.status AND NOT (OLD.status = 'POSTED' AND NEW.status IN ('CANCELLED','REVERSED')) THEN
      PERFORM raise_app_error('APR_INVALID_STATE', 'Invalid status change ' || OLD.status || ' → ' || NEW.status);
    END IF;
    IF NEW.status = 'CANCELLED' AND NEW.cancel_reason IS NULL THEN
      PERFORM raise_app_error('VAL_FIELD', 'A cancellation reason is required');
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- (c) lines of a non-draft document cannot be inserted/changed/deleted. TG_ARGV: parent table, FK column
CREATE OR REPLACE FUNCTION protect_document_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_parent uuid; v_status text;
BEGIN
  v_parent := CASE WHEN TG_OP = 'DELETE' THEN (to_jsonb(OLD) ->> TG_ARGV[1])::uuid ELSE (to_jsonb(NEW) ->> TG_ARGV[1])::uuid END;
  EXECUTE format('SELECT status FROM %I WHERE id = $1', TG_ARGV[0]) INTO v_status USING v_parent;
  IF v_status IS NOT NULL AND v_status NOT IN ('DRAFT','REJECTED') THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Lines can only be changed while the document is a draft');
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- Attach the three guards to a document table + its lines table (if any)
CREATE OR REPLACE FUNCTION attach_document_guards(p_table text, p_lines text, p_fk text, p_extra_mutable text[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('CREATE TRIGGER trg_%s_mc BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION check_maker_checker()', p_table, p_table);
  EXECUTE format('CREATE TRIGGER trg_%s_protect BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_posted_document(%s)',
                 p_table, p_table, coalesce((SELECT string_agg(quote_literal(x), ',') FROM unnest(p_extra_mutable) x), ''));
  EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_row()', p_table, p_table);
  IF p_lines IS NOT NULL THEN
    EXECUTE format('CREATE TRIGGER trg_%s_protect BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_document_lines(%L, %L)',
                   p_lines, p_lines, p_table, p_fk);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Manual journal vouchers
-- ---------------------------------------------------------------------------
CREATE TABLE manual_journals (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  branch_id        uuid REFERENCES branches(id),
  doc_no           varchar(40),
  journal_date     date NOT NULL,
  reference        varchar(60),
  narration        text NOT NULL,
  total            numeric(18,2) NOT NULL DEFAULT 0,
  status           varchar(12) NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  journal_entry_id uuid REFERENCES journal_entries(id),
  reversal_entry_id uuid REFERENCES journal_entries(id),
  reversed_at      timestamptz,
  cancel_reason    text,
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  submitted_at     timestamptz,
  approved_at      timestamptz,
  posted_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  approved_by      uuid REFERENCES users(id),
  version          int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);
CREATE TABLE manual_journal_lines (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  journal_id     uuid NOT NULL REFERENCES manual_journals(id) ON DELETE CASCADE,
  line_no        int NOT NULL,
  account_id     uuid NOT NULL REFERENCES accounts(id),
  debit          numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  contact_id     uuid REFERENCES contacts(id),
  cost_centre_id uuid REFERENCES cost_centres(id),
  description    text,
  CHECK ((debit = 0) <> (credit = 0)),
  UNIQUE (journal_id, line_no)
);
SELECT attach_document_guards('manual_journals', 'manual_journal_lines', 'journal_id');

-- ---------------------------------------------------------------------------
-- Opening balances (docs/02 §8)
-- ---------------------------------------------------------------------------
CREATE TABLE opening_balances (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  doc_no           varchar(40),
  as_of_date       date NOT NULL,  -- go-live date; opening entry is dated on this day
  narration        text,
  total            numeric(18,2) NOT NULL DEFAULT 0,
  obe_difference   numeric(18,2) NOT NULL DEFAULT 0,  -- amount posted to Opening Balance Equity (Dr +, Cr −)
  status           varchar(12) NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  journal_entry_id uuid REFERENCES journal_entries(id),
  reversal_entry_id uuid REFERENCES journal_entries(id),
  reversed_at      timestamptz,
  cancel_reason    text,
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  submitted_at     timestamptz,
  approved_at      timestamptz,
  posted_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  approved_by      uuid REFERENCES users(id),
  version          int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);
CREATE TABLE opening_balance_lines (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  opening_id   uuid NOT NULL REFERENCES opening_balances(id) ON DELETE CASCADE,
  line_no      int NOT NULL,
  kind         varchar(10) NOT NULL CHECK (kind IN ('ACCOUNT','CUSTOMER','SUPPLIER')),
  account_id   uuid REFERENCES accounts(id),
  contact_id   uuid REFERENCES contacts(id),
  reference    varchar(60),     -- original invoice/bill number for open items
  doc_date     date,
  due_date     date,
  debit        numeric(18,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit       numeric(18,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description  text,
  CHECK ((debit = 0) <> (credit = 0)),
  CHECK ((kind = 'ACCOUNT' AND account_id IS NOT NULL) OR (kind <> 'ACCOUNT' AND contact_id IS NOT NULL)),
  UNIQUE (opening_id, line_no)
);
SELECT attach_document_guards('opening_balances', 'opening_balance_lines', 'opening_id');

-- ---------------------------------------------------------------------------
-- Reversal / cancellation requests (docs/06 §4: reversal & cancel go through maker–checker)
-- ---------------------------------------------------------------------------
CREATE TABLE correction_requests (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  doc_no           varchar(40),
  kind             varchar(10) NOT NULL CHECK (kind IN ('REVERSE','CANCEL')),
  target_type      varchar(40) NOT NULL,
  target_id        uuid NOT NULL,
  target_ref       varchar(60),
  correction_date  date NOT NULL,
  reason           text NOT NULL CHECK (length(trim(reason)) > 0),
  total            numeric(18,2) NOT NULL DEFAULT 0,
  status           varchar(12) NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED','POSTED','CANCELLED','REVERSED')),
  journal_entry_id uuid REFERENCES journal_entries(id),
  reversal_entry_id uuid REFERENCES journal_entries(id),
  reversed_at      timestamptz,
  cancel_reason    text,
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  submitted_at     timestamptz,
  approved_at      timestamptz,
  posted_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  approved_by      uuid REFERENCES users(id),
  version          int NOT NULL DEFAULT 1,
  UNIQUE (company_id, doc_no)
);
SELECT attach_document_guards('correction_requests', NULL, NULL);

-- ---------------------------------------------------------------------------
-- RLS for all tenant tables in this migration
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','cost_centres','contacts','tax_codes','tax_rates','tds_codes','journal_entries',
                           'journal_lines','account_period_balances','approval_workflows','approval_steps',
                           'approval_requests','approval_actions','manual_journals','manual_journal_lines',
                           'opening_balances','opening_balance_lines','correction_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;
ALTER TABLE posting_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY posting_rules_read ON posting_rules FOR SELECT USING (company_id IS NULL OR company_id = app_company_id());
CREATE POLICY posting_rules_write ON posting_rules FOR ALL USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id());
