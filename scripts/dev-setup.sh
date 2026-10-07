#!/usr/bin/env bash
# One-shot setup for a fresh Linux/cloud VM (Ubuntu): installs & starts PostgreSQL 16 + Redis,
# creates the LedgerPro roles/databases, installs packages, runs migrations.
# Usage:  bash scripts/dev-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -y && sudo apt-get install -y postgresql-16 postgresql-contrib-16 redis-server
fi
(sudo service postgresql start || sudo service postgresql restart) >/dev/null
(redis-cli ping >/dev/null 2>&1) || (sudo service redis-server start >/dev/null 2>&1 || redis-server --daemonize yes)

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ledger_owner'" | grep -q 1; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -f infra/postgres/init.sql
fi

[ -f .env ] || cp .env.example .env
command -v pnpm >/dev/null 2>&1 || npm install -g pnpm@10
pnpm install
pnpm --filter @ledgerpro/shared build
set -a; . ./.env; set +a
pnpm --filter @ledgerpro/db migrate
DATABASE_ADMIN_URL="$TEST_DATABASE_ADMIN_URL" pnpm --filter @ledgerpro/db migrate
echo "✔ Dev environment ready. Start the app with: pnpm dev"
