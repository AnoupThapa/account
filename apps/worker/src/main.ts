/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { Queue, Worker } from 'bullmq';
import { Pool, PoolClient } from 'pg';
import nodemailer from 'nodemailer';
import pino from 'pino';

/**
 * Background jobs (architecture.md §3, error-handling.md §6):
 *  - outbox: delivers queued emails/notifications with retry (1m, 5m, 30m, 2h, 12h) then FAILED + admin alert
 *  - integrity: nightly checks (database.md §6) per company — ledger balances, snapshots, audit hash chain
 */
const log = pino({ base: { service: 'ledgerpro-worker' } });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const redisUrl = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), password: redisUrl.password || undefined, maxRetriesPerRequest: null };
const BACKOFF_MIN = [1, 5, 30, 120, 720];

const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined })
  : null;

async function platform<T>(fn: (c: PoolClient) => Promise<T>, companyId: string | null = null): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.platform','on',true), set_config('app.company_id',$1,true)", [companyId ?? '']);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

function render(event: string, p: any): { to: string; subject: string; text: string } | null {
  switch (event) {
    case 'PASSWORD_RESET':
      return { to: p.to, subject: 'Reset your LedgerPro password', text: `Hello ${p.name},\n\nUse this link within 1 hour to choose a new password:\n${p.link}\n\nIf you did not ask for this, ignore this email.` };
    case 'ACCOUNT_LOCKED':
      return { to: p.to, subject: 'LedgerPro: your account was locked', text: `Hello ${p.name},\n\nAfter 5 failed sign-in attempts your account is locked for ${p.minutes} minutes (last attempt from ${p.ip ?? 'unknown IP'}). If this wasn't you, change your password and tell your administrator.` };
    case 'INTEGRITY_ALERT':
      return { to: p.to, subject: `CRITICAL: integrity check failed for ${p.company}`, text: p.text };
    default:
      return null; // in-app notifications (APPROVAL_REQUESTED etc.) are read by the web app; nothing to email yet
  }
}

async function processOutbox() {
  const rows = await platform((c) => c.query(`SELECT * FROM integration_outbox WHERE status = 'PENDING' AND next_attempt_at <= now() ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`).then((r) => r.rows));
  for (const row of rows) {
    try {
      if (row.target === 'EMAIL' || row.event_type === 'INTEGRITY_ALERT') {
        const m = render(row.event_type, row.payload);
        if (m) {
          if (mailer) await mailer.sendMail({ from: process.env.MAIL_FROM, ...m });
          else log.info({ to: m.to, subject: m.subject, body: m.text }, 'EMAIL (SMTP not configured — printed instead)');
        }
      }
      await platform((c) => c.query(`UPDATE integration_outbox SET status='SENT', attempts=attempts+1 WHERE id=$1`, [row.id]));
    } catch (e) {
      const attempts = row.attempts + 1;
      const failed = attempts >= BACKOFF_MIN.length;
      await platform((c) =>
        c.query(`UPDATE integration_outbox SET attempts=$2, last_error=$3, status=$4, next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id=$1`, [row.id, attempts, String((e as Error).message).slice(0, 500), failed ? 'FAILED' : 'PENDING', String(BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length - 1)])]),
      );
      log.error({ id: row.id, attempts, err: (e as Error).message }, failed ? 'outbox delivery FAILED permanently' : 'outbox delivery failed, will retry');
    }
  }
}

async function integrity() {
  const companies = await platform((c) => c.query('SELECT id, name FROM companies WHERE is_active').then((r) => r.rows));
  for (const co of companies) {
    const problems = await platform(async (c) => {
      const out: string[] = [];
      const t = await c.query('SELECT coalesce(sum(debit),0) dr, coalesce(sum(credit),0) cr FROM journal_lines');
      if (t.rows[0].dr !== t.rows[0].cr) out.push(`Ledger out of balance: ${t.rows[0].dr} vs ${t.rows[0].cr}`);
      const apb = await c.query(`SELECT count(*) n FROM (SELECT jl.account_id, je.period_id, sum(jl.debit) dr, sum(jl.credit) cr FROM journal_lines jl JOIN journal_entries je ON je.id=jl.entry_id GROUP BY 1,2) x
        FULL JOIN (SELECT account_id, period_id, sum(debit_total) dr, sum(credit_total) cr FROM account_period_balances GROUP BY 1,2) y USING (account_id, period_id)
        WHERE coalesce(x.dr,0)<>coalesce(y.dr,0) OR coalesce(x.cr,0)<>coalesce(y.cr,0)`);
      if (Number(apb.rows[0].n)) out.push(`${apb.rows[0].n} balance snapshot mismatches`);
      const a = await c.query('SELECT * FROM verify_audit_chain($1::uuid)', [co.id]);
      if (a.rows[0].first_broken_id) out.push(`Audit hash chain broken at entry ${a.rows[0].first_broken_id}`);
      if (out.length) {
        const admins = await c.query(`SELECT DISTINCT u.email FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id WHERE r.key='COMPANY_ADMIN'`);
        for (const ad of admins.rows) {
          await c.query(`INSERT INTO integration_outbox (company_id, target, event_type, payload) VALUES ($1,'EMAIL','INTEGRITY_ALERT',$2)`, [co.id, JSON.stringify({ to: ad.email, company: co.name, text: out.join('\n') })]);
        }
      }
      return out;
    }, co.id);
    if (problems.length) log.error({ company: co.name, problems }, 'INTEGRITY CHECK FAILED');
    else log.info({ company: co.name }, 'integrity ok');
  }
}

async function main() {
  const q = new Queue('ledgerpro', { connection });
  await q.upsertJobScheduler('outbox', { every: 30_000 }, { name: 'outbox' });
  await q.upsertJobScheduler('integrity', { pattern: '30 2 * * *', tz: 'Asia/Kathmandu' }, { name: 'integrity' });
  new Worker(
    'ledgerpro',
    async (job) => {
      if (job.name === 'outbox') await processOutbox();
      if (job.name === 'integrity') await integrity();
    },
    { connection, concurrency: 1 },
  ).on('failed', (job, err) => log.error({ job: job?.name, err: err.message }, 'job failed'));
  log.info('LedgerPro worker started (outbox every 30s, integrity nightly 02:30 Nepal time)');
  if (process.argv.includes('--once')) {
    await processOutbox();
    await integrity();
    process.exit(0);
  }
}
main().catch((e) => {
  log.error(e);
  process.exit(1);
});
