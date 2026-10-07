# Development & run environment

> **CONFIDENTIAL & PROPRIETARY** — © 2026 Anoup Kumar Thapa. All rights reserved. See [LICENSE](../LICENSE).

## A. Easiest without Docker: run on your Windows PC with a double-click

You install two free programs once, then double-click a file. This is for trying LedgerPro on your own PC; real company data belongs on a proper server later.

**One-time installs**
1. **Node.js 22 LTS** — go to https://nodejs.org , download the *LTS* version for Windows, run it and click *Next* through every screen (the defaults are fine).
2. **PostgreSQL 16** (the database) — go to https://www.postgresql.org/download/windows/ → *Download the installer* (EDB) → choose **16.x for Windows x86-64**. Run it and click *Next* through the screens. It will ask you to **choose a password for the "postgres" user — write it down**, you need it once. Keep port **5432**. Untick *Stack Builder* at the end (not needed).

**Start LedgerPro**
3. Open the `ledgerpro` folder in File Explorer and double-click **`Start LedgerPro.cmd`**.
   - If Windows shows a blue *"Windows protected your PC"* box, click *More info* → *Run anyway* (it is your own file).
   - The **first time** it asks for the PostgreSQL password from step 2 (typing is hidden — that's normal), then installs and builds everything. This takes **5–15 minutes** and needs internet. Later starts take under a minute.
4. Two windows called *LedgerPro API* and *LedgerPro Website* open — **leave them open**. Your browser opens **http://localhost:3000** by itself.
5. Sign in with `accountant.np@ledgerpro.local` / `Demo-Ledger-2026!`
   (other demo users: `checker.np@…`, `finance.np@…`, `auditor.np@…`, the `.au` equivalents, and `owner@ledgerpro.local`, all with the same password).

**Every day:** double-click `Start LedgerPro.cmd`. **To stop:** close the two LedgerPro windows. Your data stays in PostgreSQL on your PC.
**After you receive a new version of the code:** double-click `Update and Start LedgerPro.cmd` once (reinstalls and rebuilds).

What the start file sets up for this PC only (in the `.env` file it creates): new random secret keys, 2FA *not* forced so the demo users can sign in without an authenticator app, and Microsoft Edge for making PDF invoices. Background emails (the worker) are not started on Windows — not needed for trying the app. **Never copy this `.env` to a server.**

If something fails, the window says **PROBLEM:** and what to do; if it isn't clear, copy the messages into a Claude session.

## A3. Online (free trial): Vercel (website) + Render (server) + Neon (database)

- **Neon:** create a project (region Sydney or Singapore). Nothing else to do there — the server creates its tables itself.
- **Render** (Web Service from the GitHub repo, runtime *Docker*, default Dockerfile — its last stage is the API). Environment variables:
  - `DATABASE_ADMIN_URL` = the Neon connection string (Neon → Connect; the `neondb_owner` one).
  - `LOAD_DEMO_DATA` = `true` (trial only: loads the demo companies/users; remove it before real use).
  - Optional but recommended: `JWT_ACCESS_SECRET` and `ENCRYPTION_KEY` (Render → *Generate*; ENCRYPTION_KEY must be 32 bytes base64). If left out they are derived from the database password — changing that password later would then sign everyone out and require 2FA to be set up again.
  - Do **not** set `DATABASE_URL` to the owner string: on start the server creates a restricted `ledger_app` login so row-level security applies (`apps/api/src/scripts/cloud-start.ts`).
- **Vercel** (project root `apps/web`): environment variable `API_INTERNAL_URL` = the Render address (e.g. `https://accfinx.onrender.com`), then **Redeploy** (it is baked in at build time).
- The free Render server sleeps after 15 minutes; the first visit afterwards takes about a minute.

## A2. Alternative: Docker Desktop

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
