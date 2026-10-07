-- Phase 0 — Foundation: tenancy, identity, RBAC, audit log (hash chain), BS calendar,
-- fiscal years & periods, number series. See docs/database.md.
-- Runs as the schema owner (ledger_owner). The API/worker connect as ledger_app (RLS enforced).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Time-ordered UUID v7 (database.md §1)
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
              PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
              FROM 1 FOR 6),
      52, 1), 53, 1), 'hex')::uuid
$$;

-- Tenant context, set per transaction by the API: SELECT set_config('app.company_id', $1, true)
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION app_is_platform() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.platform', true), '') = 'on'
$$;

-- Raise a business error the API maps to RFC 7807: message is "<CODE>: <detail>"
CREATE OR REPLACE FUNCTION raise_app_error(code text, detail text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: %', code, detail USING ERRCODE = 'P0001';
END $$;

-- updated_at / version maintenance
CREATE OR REPLACE FUNCTION touch_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF to_jsonb(NEW) ? 'version' THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Global reference data (no tenant)
-- ---------------------------------------------------------------------------
CREATE TABLE currencies (
  code      char(3) PRIMARY KEY,
  name      varchar(60) NOT NULL,
  symbol    varchar(8),
  decimals  smallint NOT NULL DEFAULT 2
);

CREATE TABLE bs_calendar (
  bs_year        smallint NOT NULL,
  bs_month       smallint NOT NULL CHECK (bs_month BETWEEN 1 AND 12),
  days           smallint NOT NULL CHECK (days BETWEEN 29 AND 32),
  ad_start       date NOT NULL,
  is_provisional boolean NOT NULL DEFAULT false,
  verified_by    uuid,
  verified_at    timestamptz,
  PRIMARY KEY (bs_year, bs_month),
  UNIQUE (ad_start)
);

CREATE TABLE permissions (
  code        varchar(80) PRIMARY KEY,
  description text NOT NULL
);

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                    uuid PRIMARY KEY DEFAULT uuid_v7(),
  email                 varchar(254) NOT NULL,
  full_name             varchar(150) NOT NULL,
  password_hash         text NOT NULL,
  is_super_admin        boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  failed_attempts       int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  password_changed_at   timestamptz NOT NULL DEFAULT now(),
  mfa_enabled           boolean NOT NULL DEFAULT false,
  mfa_secret_enc        text,
  mfa_pending_secret_enc text,
  mfa_recovery_hashes   jsonb NOT NULL DEFAULT '[]',
  must_change_password  boolean NOT NULL DEFAULT false,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX ux_users_email ON users (lower(email));
CREATE TRIGGER trg_users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id       uuid NOT NULL REFERENCES users(id),
  family_id     uuid NOT NULL,
  refresh_hash  char(64) NOT NULL UNIQUE,
  mfa_verified  boolean NOT NULL DEFAULT false,
  step_up_at    timestamptz,
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoke_reason varchar(40)
);
CREATE INDEX ix_sessions_user ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX ix_sessions_family ON sessions (family_id);

CREATE TABLE auth_events (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id),
  email      varchar(254),
  event      varchar(40) NOT NULL, -- LOGIN_OK, LOGIN_FAIL, LOCKED, LOGOUT, MFA_FAIL, PASSWORD_RESET ...
  ip         inet,
  user_agent text,
  detail     jsonb,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auth_events_user ON auth_events (user_id, at DESC);

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  char(64) NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------
CREATE TABLE companies (
  id                    uuid PRIMARY KEY DEFAULT uuid_v7(),
  name                  varchar(150) NOT NULL,
  legal_name            varchar(200),
  country               varchar(5) NOT NULL CHECK (country IN ('NP','AU','OTHER')),
  base_currency         char(3) NOT NULL REFERENCES currencies(code),
  calendar_mode         varchar(2) NOT NULL CHECK (calendar_mode IN ('BS','AD')),
  fy_start_month        smallint NOT NULL CHECK (fy_start_month BETWEEN 1 AND 12),
  business_type         varchar(20) NOT NULL CHECK (business_type IN ('SERVICE','TRADING','MANUFACTURING','MIXED')),
  coa_template          varchar(10) NOT NULL DEFAULT 'NEPAL' CHECK (coa_template IN ('NEPAL','IFRS')),
  pan                   varchar(20),
  vat_no                varchar(20),
  abn                   varchar(20),
  address               text,
  phone                 varchar(40),
  email                 varchar(254),
  timezone              varchar(60) NOT NULL DEFAULT 'Asia/Kathmandu',
  tax_rounding          varchar(10) NOT NULL DEFAULT 'LINE' CHECK (tax_rounding IN ('LINE','DOCUMENT')),
  self_approval_allowed boolean NOT NULL DEFAULT false,  -- docs/06 §4.8 (single-user companies)
  enforce_2fa_all       boolean NOT NULL DEFAULT false,
  go_live_date          date,
  go_live_status        varchar(10) NOT NULL DEFAULT 'SETUP' CHECK (go_live_status IN ('SETUP','LIVE')),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES users(id),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid REFERENCES users(id),
  version               int NOT NULL DEFAULT 1
);
CREATE TRIGGER trg_companies_touch BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE branches (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  code           varchar(20) NOT NULL,
  name           varchar(150) NOT NULL,
  address        text,
  is_head_office boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users(id),
  version        int NOT NULL DEFAULT 1,
  UNIQUE (company_id, code)
);
CREATE TRIGGER trg_branches_touch BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE user_companies (
  user_id           uuid NOT NULL REFERENCES users(id),
  company_id        uuid NOT NULL REFERENCES companies(id),
  is_active         boolean NOT NULL DEFAULT true,
  default_branch_id uuid REFERENCES branches(id),
  joined_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);
CREATE INDEX ix_user_companies_company ON user_companies (company_id);

CREATE TABLE roles (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  key            varchar(40),
  name           varchar(80) NOT NULL,
  description    text,
  requires_2fa   boolean NOT NULL DEFAULT false,
  approval_limit numeric(18,2) CHECK (approval_limit IS NULL OR approval_limit >= 0),
  is_system      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid REFERENCES users(id),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users(id),
  version        int NOT NULL DEFAULT 1,
  UNIQUE (company_id, name)
);
CREATE TRIGGER trg_roles_touch BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION touch_row();

CREATE TABLE role_permissions (
  company_id      uuid NOT NULL REFERENCES companies(id),
  role_id         uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code varchar(80) NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE user_roles (
  company_id uuid NOT NULL REFERENCES companies(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  role_id    uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id, company_id) REFERENCES user_companies(user_id, company_id)
);
CREATE INDEX ix_user_roles_company ON user_roles (company_id, user_id);

-- ---------------------------------------------------------------------------
-- Audit log — append-only, hash-chained per company (docs/06 §6, security.md §6)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  company_id  uuid REFERENCES companies(id),
  user_id     uuid REFERENCES users(id),
  action      varchar(40) NOT NULL,
  entity      varchar(60) NOT NULL,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          inet,
  user_agent  text,
  request_id  varchar(64),
  at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  prev_hash   char(64),
  hash        char(64) NOT NULL
);
CREATE INDEX ix_audit_entity ON audit_logs (company_id, entity, entity_id);
CREATE INDEX ix_audit_at ON audit_logs (company_id, at);

CREATE OR REPLACE FUNCTION audit_row_hash(prev text, r audit_logs) RETURNS char(64) LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(
    coalesce(prev, '') || '|' || coalesce(r.company_id::text, '') || '|' || coalesce(r.user_id::text, '') || '|' ||
    r.action || '|' || r.entity || '|' || coalesce(r.entity_id::text, '') || '|' ||
    coalesce(r.before::text, '') || '|' || coalesce(r.after::text, '') || '|' ||
    coalesce(host(r.ip), '') || '|' || coalesce(r.request_id, '') || '|' ||
    to_char(r.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
  'sha256'), 'hex')
$$;

-- SECURITY DEFINER so the chain head is found regardless of RLS; serialised per company.
CREATE OR REPLACE FUNCTION audit_chain_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_prev char(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('audit:' || coalesce(NEW.company_id::text, 'platform'), 0));
  SELECT a.hash INTO v_prev FROM audit_logs a
   WHERE a.company_id IS NOT DISTINCT FROM NEW.company_id
   ORDER BY a.id DESC LIMIT 1;
  NEW.at := clock_timestamp();
  NEW.prev_hash := v_prev;
  NEW.hash := audit_row_hash(v_prev, NEW);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_chain_insert();

CREATE OR REPLACE FUNCTION audit_block_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM raise_app_error('ACC_IMMUTABLE', 'The audit log is append-only');
  RETURN NULL;
END $$;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_block_change();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION audit_block_change();

-- Verify the chain for one company (NULL = platform chain). Returns the first broken row id, or NULL if intact.
CREATE OR REPLACE FUNCTION verify_audit_chain(p_company uuid) RETURNS TABLE(rows_checked bigint, first_broken_id bigint)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  r audit_logs;
  v_prev char(64) := NULL;
  n bigint := 0;
BEGIN
  FOR r IN SELECT * FROM audit_logs WHERE company_id IS NOT DISTINCT FROM p_company ORDER BY id LOOP
    n := n + 1;
    IF r.prev_hash IS DISTINCT FROM v_prev OR r.hash <> audit_row_hash(v_prev, r) THEN
      rows_checked := n; first_broken_id := r.id; RETURN NEXT; RETURN;
    END IF;
    v_prev := r.hash;
  END LOOP;
  rows_checked := n; first_broken_id := NULL; RETURN NEXT;
END $$;

-- ---------------------------------------------------------------------------
-- Fiscal years, periods, number series (docs/03)
-- ---------------------------------------------------------------------------
CREATE TABLE fiscal_years (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  label       varchar(20) NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      varchar(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  closed_by   uuid REFERENCES users(id),
  closed_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id),
  CHECK (end_date > start_date),
  UNIQUE (company_id, label),
  EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE accounting_periods (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id),
  period_no      smallint NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  name           varchar(40) NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  is_adjustment  boolean NOT NULL DEFAULT false,
  is_locked      boolean NOT NULL DEFAULT false,
  locked_by      uuid REFERENCES users(id),
  locked_at      timestamptz,
  CHECK (end_date >= start_date),
  CHECK (is_adjustment = (period_no = 13)),
  UNIQUE (fiscal_year_id, period_no)
);
CREATE INDEX ix_periods_company_dates ON accounting_periods (company_id, start_date, end_date);

CREATE TABLE number_series (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  doc_type       varchar(40) NOT NULL,
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id),
  prefix         varchar(30) NOT NULL,
  next_no        int NOT NULL DEFAULT 1 CHECK (next_no >= 1),
  padding        smallint NOT NULL DEFAULT 5,
  UNIQUE (company_id, doc_type, fiscal_year_id)
);

-- Idempotency keys for create/post endpoints (error-handling.md §5)
CREATE TABLE idempotency_keys (
  company_id   uuid NOT NULL REFERENCES companies(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  key          varchar(100) NOT NULL,
  request_hash char(64) NOT NULL,
  response     jsonb,
  status_code  int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, user_id, key)
);

-- Integration outbox (architecture.md §3, error-handling.md §6) — emails, webhooks, external adapters
CREATE TABLE integration_outbox (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id      uuid REFERENCES companies(id),
  target          varchar(40) NOT NULL,
  event_type      varchar(60) NOT NULL,
  payload         jsonb NOT NULL,
  status          varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_outbox_pending ON integration_outbox (status, next_attempt_at);

-- ---------------------------------------------------------------------------
-- Row-level security (database.md §9)
-- ---------------------------------------------------------------------------
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY companies_select ON companies FOR SELECT USING (
  id = app_company_id() OR app_is_platform()
  OR id IN (SELECT uc.company_id FROM user_companies uc WHERE uc.user_id = app_user_id() AND uc.is_active)
);
CREATE POLICY companies_insert ON companies FOR INSERT WITH CHECK (app_is_platform());
CREATE POLICY companies_update ON companies FOR UPDATE USING (id = app_company_id()) WITH CHECK (id = app_company_id());

ALTER TABLE user_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_companies_access ON user_companies
  USING (company_id = app_company_id() OR user_id = app_user_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON audit_logs FOR SELECT USING (
  company_id = app_company_id() OR (company_id IS NULL AND app_is_platform())
);
CREATE POLICY audit_insert ON audit_logs FOR INSERT WITH CHECK (company_id IS NULL OR company_id = app_company_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['branches','roles','role_permissions','user_roles','fiscal_years','accounting_periods',
                           'number_series','idempotency_keys']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;

ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_tenant ON integration_outbox
  USING (company_id = app_company_id() OR app_is_platform())
  WITH CHECK (company_id IS NULL OR company_id = app_company_id() OR app_is_platform());
