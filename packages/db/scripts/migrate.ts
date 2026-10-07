import { runMigrations, seedGlobal } from '../src';

async function main() {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is not set (see .env.example)');
  const r = await runMigrations(url);
  console.log(`Migrations: ${r.applied.length} applied, ${r.skipped.length} already up to date`);
  await seedGlobal(url);
  console.log('Reference data seeded (currencies, UoMs, permissions, BS calendar, posting rules)');
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
