/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
-- Database roles & least-privilege grants (database.md §10).
-- ledger_app: used by API & worker; no UPDATE/DELETE on ledger lines or audit log; RLS applies (not owner).
-- ledger_readonly: SELECT only (reporting/BI/auditor exports).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN CREATE ROLE ledger_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_readonly') THEN CREATE ROLE ledger_readonly NOLOGIN; END IF;
END $$;

GRANT USAGE ON SCHEMA public TO ledger_app, ledger_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ledger_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ledger_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ledger_readonly;

-- Ledger & audit: append-only for the app role
REVOKE UPDATE, DELETE, TRUNCATE ON journal_lines, audit_logs FROM ledger_app;
REVOKE UPDATE, DELETE, TRUNCATE ON journal_entries FROM ledger_app;
GRANT UPDATE (status, reversed_by_entry_id) ON journal_entries TO ledger_app;
REVOKE DELETE, TRUNCATE ON account_period_balances, allocations FROM ledger_app;
REVOKE INSERT, UPDATE, DELETE ON permissions, currencies, uoms, posting_rules FROM ledger_app;
GRANT INSERT, UPDATE, DELETE ON posting_rules TO ledger_app; -- company-level overrides only (RLS restricts to own rows)
REVOKE INSERT, DELETE ON bs_calendar FROM ledger_app;   -- admin may correct/verify month lengths (UPDATE)
REVOKE DELETE ON companies, users FROM ledger_app;        -- soft-deactivate only

-- Tables created by future migrations inherit app grants (each migration still reviews ledger tables)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ledger_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ledger_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ledger_readonly;
