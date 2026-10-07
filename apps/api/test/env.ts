/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Load ../../.env and point the app at the TEST database. */
export function loadTestEnv() {
  const p = join(__dirname, '..', '..', '..', '.env');
  const src = existsSync(p) ? readFileSync(p, 'utf8') : readFileSync(p + '.example', 'utf8');
  for (const line of src.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
  process.env.ENFORCE_2FA = 'true';
  process.env.COOKIE_SECURE = 'false';
  if (!process.env.CHROMIUM_PATH && existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) {
    process.env.CHROMIUM_PATH = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  }
}
