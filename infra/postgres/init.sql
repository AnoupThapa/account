-- Runs once when the Postgres container is first created (docker-entrypoint-initdb.d).
-- Passwords here are for LOCAL DEVELOPMENT ONLY. Production uses secrets (see docs/dev-environment.md).
CREATE ROLE ledger_owner LOGIN CREATEROLE PASSWORD 'ledger_owner_dev';
CREATE ROLE ledger_app LOGIN PASSWORD 'ledger_app_dev';
CREATE ROLE ledger_readonly LOGIN PASSWORD 'ledger_readonly_dev';
CREATE DATABASE ledgerpro OWNER ledger_owner;
CREATE DATABASE ledgerpro_test OWNER ledger_owner;
\connect ledgerpro
ALTER SCHEMA public OWNER TO ledger_owner;
\connect ledgerpro_test
ALTER SCHEMA public OWNER TO ledger_owner;
