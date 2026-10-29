/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
-- Bank reconciliation (docs/16). Statements point straight at the bank/cash/wallet ledger account.
-- Reconciliation never writes journal entries; it only links statement lines to existing journal lines.

CREATE TABLE bank_statement_imports (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  account_id    uuid NOT NULL REFERENCES accounts(id),
  file_name     varchar(200),
  rows_total    int NOT NULL DEFAULT 0,
  rows_imported int NOT NULL DEFAULT 0,
  rows_skipped  int NOT NULL DEFAULT 0,        -- duplicates
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE bank_statement_lines (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  import_id        uuid NOT NULL REFERENCES bank_statement_imports(id),
  account_id       uuid NOT NULL REFERENCES accounts(id),
  txn_date         date NOT NULL,
  description      text NOT NULL DEFAULT '',
  reference        varchar(100),
  cheque_no        varchar(40),
  money_in         numeric(18,2) NOT NULL DEFAULT 0 CHECK (money_in >= 0),
  money_out        numeric(18,2) NOT NULL DEFAULT 0 CHECK (money_out >= 0),
  balance          numeric(18,2),
  line_hash        char(64) NOT NULL,
  status           varchar(12) NOT NULL DEFAULT 'UNMATCHED' CHECK (status IN ('UNMATCHED','MATCHED','IGNORED')),
  ignore_reason    varchar(200),
  pending_doc_type varchar(30),                 -- document created from this line, waiting to be posted
  pending_doc_id   uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((money_in = 0) <> (money_out = 0)),
  UNIQUE (company_id, account_id, line_hash)
);
CREATE INDEX ix_bsl_account_status ON bank_statement_lines (company_id, account_id, status, txn_date);

CREATE TABLE reconciliations (
  id                       uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id               uuid NOT NULL REFERENCES companies(id),
  account_id               uuid NOT NULL REFERENCES accounts(id),
  statement_date           date NOT NULL,
  statement_balance        numeric(18,2) NOT NULL,
  book_balance             numeric(18,2) NOT NULL,   -- ledger balance of the account at statement_date
  unmatched_book_net       numeric(18,2) NOT NULL,   -- book items up to that date not matched (money in positive)
  unmatched_statement_net  numeric(18,2) NOT NULL,   -- statement lines up to that date not matched
  difference               numeric(18,2) NOT NULL CHECK (difference = 0),
  note                     text,
  details                  jsonb NOT NULL DEFAULT '{}',   -- snapshot for the printed Bank Reconciliation Statement
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE bank_match_groups (
  id                uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  method            varchar(10) NOT NULL CHECK (method IN ('AUTO','MANUAL','LINKED')),
  reconciliation_id uuid REFERENCES reconciliations(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL REFERENCES users(id)
);

-- Items of a group: a statement line OR a journal line, with its signed bank-side amount (money in = +).
CREATE TABLE reconciliation_matches (
  id                uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  group_id          uuid NOT NULL REFERENCES bank_match_groups(id),
  statement_line_id uuid REFERENCES bank_statement_lines(id),
  journal_line_id   uuid REFERENCES journal_lines(id),
  amount            numeric(18,2) NOT NULL CHECK (amount <> 0),
  CHECK ((statement_line_id IS NULL) <> (journal_line_id IS NULL))
);
CREATE UNIQUE INDEX ux_rm_statement_line ON reconciliation_matches (statement_line_id) WHERE statement_line_id IS NOT NULL;
CREATE UNIQUE INDEX ux_rm_journal_line ON reconciliation_matches (journal_line_id) WHERE journal_line_id IS NOT NULL;
CREATE INDEX ix_rm_group ON reconciliation_matches (group_id);

-- The stored amount must equal the real amount of the line it points at, and the line must belong to the group's account.
CREATE OR REPLACE FUNCTION check_match_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g bank_match_groups; real_amt numeric(18,2); acct uuid;
BEGIN
  SELECT * INTO g FROM bank_match_groups WHERE id = NEW.group_id;
  IF NEW.statement_line_id IS NOT NULL THEN
    SELECT money_in - money_out, account_id INTO real_amt, acct FROM bank_statement_lines WHERE id = NEW.statement_line_id;
  ELSE
    SELECT debit - credit, account_id INTO real_amt, acct FROM journal_lines WHERE id = NEW.journal_line_id;
  END IF;
  IF acct IS DISTINCT FROM g.account_id THEN PERFORM raise_app_error('VAL_FIELD', 'Item belongs to a different bank account'); END IF;
  IF real_amt IS DISTINCT FROM NEW.amount THEN PERFORM raise_app_error('VAL_FIELD', 'Match amount does not equal the line amount'); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_rm_check BEFORE INSERT ON reconciliation_matches FOR EACH ROW EXECUTE FUNCTION check_match_item();

-- At commit every group must balance: statement side = book side (and have both sides).
CREATE OR REPLACE FUNCTION check_group_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gid uuid; s numeric; b numeric; ns int; nb int;
BEGIN
  gid := COALESCE(NEW.group_id, OLD.group_id);
  IF NOT EXISTS (SELECT 1 FROM bank_match_groups WHERE id = gid) THEN RETURN NULL; END IF;
  SELECT COALESCE(SUM(amount) FILTER (WHERE statement_line_id IS NOT NULL), 0), COALESCE(SUM(amount) FILTER (WHERE journal_line_id IS NOT NULL), 0),
         COUNT(*) FILTER (WHERE statement_line_id IS NOT NULL), COUNT(*) FILTER (WHERE journal_line_id IS NOT NULL)
    INTO s, b, ns, nb FROM reconciliation_matches WHERE group_id = gid;
  IF ns = 0 OR nb = 0 OR s <> b THEN PERFORM raise_app_error('BANK_MATCH_UNBALANCED', 'Statement and book amounts of a match must be equal'); END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER trg_rm_balanced AFTER INSERT ON reconciliation_matches DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_group_balanced();

-- Finished reconciliations are locked: matches/groups can only be removed after the API sets app.unreconcile (permission-checked, audit-logged).
CREATE OR REPLACE FUNCTION protect_reconciled() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
  IF TG_TABLE_NAME = 'bank_match_groups' THEN rid := OLD.reconciliation_id;
  ELSE SELECT reconciliation_id INTO rid FROM bank_match_groups WHERE id = OLD.group_id; END IF;
  IF rid IS NOT NULL AND COALESCE(current_setting('app.unreconcile', true), '') <> 'on' THEN
    PERFORM raise_app_error('BANK_ALREADY_RECONCILED', 'This item is in a finished reconciliation — un-reconcile first');
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_rm_protect BEFORE DELETE ON reconciliation_matches FOR EACH ROW EXECUTE FUNCTION protect_reconciled();
CREATE TRIGGER trg_bmg_protect BEFORE DELETE ON bank_match_groups FOR EACH ROW EXECUTE FUNCTION protect_reconciled();

-- Statement lines are immutable except for status / ignore / pending-document fields.
CREATE OR REPLACE FUNCTION guard_statement_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'UNMATCHED' THEN PERFORM raise_app_error('ACC_IMMUTABLE', 'Only unmatched statement lines can be deleted'); END IF;
    RETURN OLD;
  END IF;
  IF (NEW.txn_date, NEW.description, NEW.reference, NEW.cheque_no, NEW.money_in, NEW.money_out, NEW.balance, NEW.line_hash, NEW.account_id, NEW.import_id)
     IS DISTINCT FROM (OLD.txn_date, OLD.description, OLD.reference, OLD.cheque_no, OLD.money_in, OLD.money_out, OLD.balance, OLD.line_hash, OLD.account_id, OLD.import_id) THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'Imported statement lines cannot be edited');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bsl_guard BEFORE UPDATE OR DELETE ON bank_statement_lines FOR EACH ROW EXECUTE FUNCTION guard_statement_line();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_statement_imports','bank_statement_lines','reconciliations','bank_match_groups','reconciliation_matches']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;

-- Reconciliations are history: the app role cannot change or delete them.
REVOKE UPDATE, DELETE ON reconciliations FROM ledger_app;
