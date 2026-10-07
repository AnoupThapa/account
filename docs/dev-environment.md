# Development & run environment

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. See [LICENSE](../LICENSE).

## A. Easiest: run everything on your Windows PC with Docker Desktop (no coding)

1. Install **Docker Desktop** for Windows (docker.com → Download → Windows). Start it and wait until it says *Engine running*.
2. Open the `ledgerpro` folder in File Explorer. Copy `.env.example` and rename the copy to `.env` (keep it in the same folder).
   For your own PC you may open `.env` in Notepad and set `ENFORCE_2FA=false` so the demo users can sign in without an authenticator app. **Never do this on a server.**
3. Open **PowerShell** in the `ledgerpro\infra` folder (Shift + right-click inside the folder → *Open PowerShell window here*) and run:
   ```
   docker compose up -d --build
   ```
   The first build takes 5–15 minutes. It starts the database, Redis, applies the database migrations, then starts the API, the background worker and the website.
4. Load the demo companies and users (once):
   ```
   docker compose run --rm api node dist/scripts/seed-demo.js
   ```
5. Open **http://localhost:3000** and sign in, e.g. `accountant.np@ledgerpro.local` / `Demo-Ledger-2026!`
   (other demo users: `checker.np@…`, `finance.np@…`, `auditor.np@…`, the `.au` equivalents, and `owner@ledgerpro.local`).
6. To stop: `docker compose down`. Your data stays in the Docker volume `pgdata`. `docker compose down -v` deletes it.

## B. Developer setup (Linux / cloud session)

```
bash scripts/dev-setup.sh      # installs PostgreSQL 16 + Redis if missing, creates roles & databases, installs packages, migrates
pnpm build                      # builds shared, db, api, worker, web
pnpm test                       # 368 automated tests (needs the ledgerpro_test database created by dev-setup)
pnpm --filter @ledgerpro/api seed:demo
pnpm dev                        # API :4000, web :3000, worker
```

### Claude Code cloud sessions — paste this into the environment's *setup script* box
```
cd /workspace/accx 2>/dev/null || cd "$(git rev-parse --show-toplevel)"
bash scripts/dev-setup.sh
```

## Database roles
| Role | Used by | Rights |
|---|---|---|
| `ledger_owner` | migrations only (`DATABASE_ADMIN_URL`) | owns the schema |
| `ledger_app` | API & worker (`DATABASE_URL`) | read/write business tables, **insert-only** on ledger lines and audit log; row-level security applies |
| `ledger_readonly` | reporting / auditors | SELECT only |

Local passwords are in `infra/postgres/init.sql` and `.env.example` and are for development only. Production: create the roles with strong passwords (`ALTER ROLE … PASSWORD …`) and put them only in the server's `.env`.

## Useful commands
| Command | What it does |
|---|---|
| `pnpm db:migrate` | apply new migrations + reference data (safe to repeat) |
| `pnpm --filter @ledgerpro/db codegen` | regenerate TypeScript types after a migration |
| `pnpm --filter @ledgerpro/db reset` | **dev only**: wipe and rebuild the database |
| `node apps/web/e2e/smoke.mjs` | click through the main flow in a real browser (needs demo data) |
| `node scripts/check-headers.mjs` | every source file has the copyright header |
| `node scripts/check-licences.mjs` | no GPL/AGPL dependencies |
