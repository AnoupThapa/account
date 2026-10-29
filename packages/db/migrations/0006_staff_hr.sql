/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
-- Staff portal & HR (docs/15 §12): employees, salary structures, attendance, payslips, TDS certificates.
-- No ledger posting in this step. Money is NUMERIC(18,2); every table has company_id + RLS.

CREATE TABLE employees (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  code               varchar(30) NOT NULL,
  full_name          varchar(150) NOT NULL,
  email              varchar(254),
  phone              varchar(40),
  address            text,
  designation        varchar(100),
  department         varchar(100),
  branch_id          uuid REFERENCES branches(id),
  employment_type    varchar(12) NOT NULL DEFAULT 'PERMANENT' CHECK (employment_type IN ('PERMANENT','CONTRACT','PART_TIME','CASUAL','INTERN')),
  join_date          date,
  exit_date          date,
  pan                varchar(20),
  ssf_no             varchar(30),
  bank_name          varchar(100),
  bank_account       varchar(40),
  emergency_contact  varchar(200),
  notes              text,
  status             varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  user_id            uuid REFERENCES users(id),           -- the login of this staff member (self-service portal)
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES users(id),
  version            int NOT NULL DEFAULT 1,
  UNIQUE (company_id, code),
  CHECK (exit_date IS NULL OR join_date IS NULL OR exit_date >= join_date)
);
CREATE UNIQUE INDEX ux_employees_user ON employees (company_id, user_id) WHERE user_id IS NOT NULL;
CREATE TRIGGER trg_employees_touch BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Effective-dated salary structure: a raise is a new row, history is kept.
CREATE TABLE salary_structures (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  employee_id      uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  effective_from   date NOT NULL,
  basic_salary     numeric(18,2) NOT NULL CHECK (basic_salary >= 0),
  allowance        numeric(18,2) NOT NULL DEFAULT 0 CHECK (allowance >= 0),
  other_allowance  numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_allowance >= 0),
  other_deductions numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  ssf_applicable   boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  UNIQUE (employee_id, effective_from)
);

-- Company HR settings (one row per company, created on first use)
CREATE TABLE hr_settings (
  company_id        uuid PRIMARY KEY REFERENCES companies(id),
  work_start        time NOT NULL DEFAULT '10:00',
  grace_minutes     int NOT NULL DEFAULT 15 CHECK (grace_minutes BETWEEN 0 AND 240),
  standard_minutes  int NOT NULL DEFAULT 480 CHECK (standard_minutes BETWEEN 60 AND 1440),
  half_day_minutes  int NOT NULL DEFAULT 240 CHECK (half_day_minutes BETWEEN 30 AND 1440),
  weekly_off        smallint[] NOT NULL DEFAULT '{6}',      -- 0 = Sunday … 6 = Saturday
  ssf_employee_pct  numeric(7,4) NOT NULL DEFAULT 11 CHECK (ssf_employee_pct BETWEEN 0 AND 100),   -- unverified default (docs/15 §8)
  ssf_employer_pct  numeric(7,4) NOT NULL DEFAULT 20 CHECK (ssf_employer_pct BETWEEN 0 AND 100),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES users(id)
);

CREATE TABLE attendance_days (
  id             uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  employee_id    uuid NOT NULL REFERENCES employees(id),
  work_date      date NOT NULL,
  status         varchar(12) NOT NULL CHECK (status IN ('PRESENT','LATE','HALF_DAY','ABSENT','LEAVE','HOLIDAY','WEEKLY_OFF')),
  check_in       timestamptz,
  check_out      timestamptz,
  worked_minutes int NOT NULL DEFAULT 0 CHECK (worked_minutes >= 0),
  source         varchar(10) NOT NULL CHECK (source IN ('WEB','MANUAL')),
  remarks        text,
  edited_by      uuid REFERENCES users(id),
  edited_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date),
  CHECK (check_out IS NULL OR check_in IS NULL OR check_out >= check_in)
);
CREATE INDEX ix_attendance_company_date ON attendance_days (company_id, work_date);

-- Payslips (amount columns are locked once sent)
CREATE TABLE payslips (
  id               uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id       uuid NOT NULL REFERENCES companies(id),
  employee_id      uuid NOT NULL REFERENCES employees(id),
  period_id        uuid NOT NULL REFERENCES accounting_periods(id),
  period_label     varchar(60) NOT NULL,
  period_start     date NOT NULL,
  period_end       date NOT NULL,
  payslip_no       varchar(40),                       -- assigned when sent (gapless)
  basic_salary     numeric(18,2) NOT NULL CHECK (basic_salary >= 0),
  allowance        numeric(18,2) NOT NULL DEFAULT 0 CHECK (allowance >= 0),
  other_allowance  numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_allowance >= 0),
  gross_pay        numeric(18,2) NOT NULL,
  tds_amount       numeric(18,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  ssf_employee     numeric(18,2) NOT NULL DEFAULT 0 CHECK (ssf_employee >= 0),
  ssf_employer     numeric(18,2) NOT NULL DEFAULT 0 CHECK (ssf_employer >= 0),   -- employer cost, not deducted from pay
  other_deductions numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  total_deductions numeric(18,2) NOT NULL,
  net_pay          numeric(18,2) NOT NULL,
  notes            text,
  status           varchar(10) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SENT','CANCELLED')),
  sent_at          timestamptz,
  sent_by          uuid REFERENCES users(id),
  viewed_at        timestamptz,
  acknowledged_at  timestamptz,
  cancel_reason    text,
  cancelled_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  print_count      int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES users(id),
  version          int NOT NULL DEFAULT 1,
  CHECK (gross_pay = basic_salary + allowance + other_allowance),
  CHECK (total_deductions = tds_amount + ssf_employee + other_deductions),
  CHECK (net_pay = gross_pay - total_deductions),
  CHECK (net_pay >= 0),
  CHECK (status = 'DRAFT' OR payslip_no IS NOT NULL OR status = 'CANCELLED'),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
CREATE UNIQUE INDEX ux_payslip_no ON payslips (company_id, payslip_no) WHERE payslip_no IS NOT NULL;
CREATE UNIQUE INDEX ux_payslip_active ON payslips (employee_id, period_id) WHERE status <> 'CANCELLED';
CREATE INDEX ix_payslips_employee ON payslips (employee_id, period_start);
CREATE TRIGGER trg_payslips_touch BEFORE UPDATE ON payslips FOR EACH ROW EXECUTE FUNCTION touch_row();

-- TDS certificates for staff remuneration, issued manually by Admin / HR Manager
CREATE TABLE tds_certificates (
  id                   uuid PRIMARY KEY DEFAULT uuid_v7(),
  company_id           uuid NOT NULL REFERENCES companies(id),
  employee_id          uuid NOT NULL REFERENCES employees(id),
  cert_no              varchar(40) NOT NULL,
  fiscal_year_id       uuid REFERENCES fiscal_years(id),
  period_from          date NOT NULL,
  period_to            date NOT NULL,
  basic_salary         numeric(18,2) NOT NULL CHECK (basic_salary >= 0),
  allowance            numeric(18,2) NOT NULL DEFAULT 0 CHECK (allowance >= 0),
  other_allowance      numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_allowance >= 0),
  total_remuneration   numeric(18,2) NOT NULL,
  tds_deducted         numeric(18,2) NOT NULL DEFAULT 0 CHECK (tds_deducted >= 0),
  ssf_employee         numeric(18,2) NOT NULL DEFAULT 0 CHECK (ssf_employee >= 0),
  ssf_employer         numeric(18,2) NOT NULL DEFAULT 0 CHECK (ssf_employer >= 0),
  other_deductions     numeric(18,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  total_receivable     numeric(18,2) NOT NULL,
  tds_deposit_ref      varchar(100),                  -- IRD deposit voucher / receipt no. (optional)
  tds_deposit_date     date,
  source               varchar(10) NOT NULL CHECK (source IN ('MANUAL','PAYSLIPS')),
  notes                text,
  status               varchar(10) NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','CANCELLED')),
  cancel_reason        text,
  cancelled_at         timestamptz,
  cancelled_by         uuid REFERENCES users(id),
  print_count          int NOT NULL DEFAULT 0,
  issued_at            timestamptz NOT NULL DEFAULT now(),
  issued_by            uuid REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id),
  version              int NOT NULL DEFAULT 1,
  UNIQUE (company_id, cert_no),
  CHECK (period_to >= period_from),
  CHECK (total_remuneration = basic_salary + allowance + other_allowance),
  CHECK (total_receivable = total_remuneration - tds_deducted - ssf_employee - other_deductions),
  CHECK (total_receivable >= 0),
  CHECK (status <> 'CANCELLED' OR cancel_reason IS NOT NULL)
);
CREATE INDEX ix_tdsc_employee ON tds_certificates (employee_id);
CREATE TRIGGER trg_tdsc_touch BEFORE UPDATE ON tds_certificates FOR EACH ROW EXECUTE FUNCTION touch_row();

-- ---------------------------------------------------------------------------
-- Immutability: a sent payslip / issued certificate can only be cancelled, viewed, acknowledged or printed
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_payslip_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status','sent_at','sent_by','payslip_no','viewed_at','acknowledged_at','cancel_reason','cancelled_at','cancelled_by','print_count','updated_at','updated_by','version'];
BEGIN
  IF OLD.status = 'CANCELLED' THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'A cancelled payslip cannot be changed');
  END IF;
  IF OLD.status = 'SENT' THEN
    IF NEW.status NOT IN ('SENT','CANCELLED') THEN
      PERFORM raise_app_error('APR_INVALID_STATE', 'Invalid payslip status change ' || OLD.status || ' → ' || NEW.status);
    END IF;
    IF (to_jsonb(NEW) - mutable) <> (to_jsonb(OLD) - mutable) OR NEW.payslip_no IS DISTINCT FROM OLD.payslip_no THEN
      PERFORM raise_app_error('ACC_IMMUTABLE', 'A sent payslip cannot be edited — cancel it and issue a new one');
    END IF;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT','SENT','CANCELLED') THEN
    PERFORM raise_app_error('APR_INVALID_STATE', 'Invalid payslip status change');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payslips_guard BEFORE UPDATE ON payslips FOR EACH ROW EXECUTE FUNCTION guard_payslip_update();

CREATE OR REPLACE FUNCTION guard_tdsc_update() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status','cancel_reason','cancelled_at','cancelled_by','print_count','updated_at','updated_by','version'];
BEGIN
  IF OLD.status = 'CANCELLED' THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'A cancelled certificate cannot be changed');
  END IF;
  IF (to_jsonb(NEW) - mutable) <> (to_jsonb(OLD) - mutable) THEN
    PERFORM raise_app_error('ACC_IMMUTABLE', 'An issued certificate cannot be edited — cancel it and issue a new one');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tdsc_guard BEFORE UPDATE ON tds_certificates FOR EACH ROW EXECUTE FUNCTION guard_tdsc_update();

-- Nothing is ever deleted: cancel instead
REVOKE DELETE, TRUNCATE ON payslips, tds_certificates, attendance_days FROM ledger_app;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','salary_structures','hr_settings','attendance_days','payslips','tds_certificates']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())', t);
  END LOOP;
END $$;
