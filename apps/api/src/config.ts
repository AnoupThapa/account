/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  DATABASE_ADMIN_URL: z.string().optional(),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY must be 32 bytes, base64'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('true').transform((v) => v === 'true'),
  // TESTING PHASE: 2FA and the forced first-login password change are OPTIONAL (users can still switch 2FA on and change
  // their password themselves on the Security page). Set both to true before real company data goes in (docs/security.md).
  ENFORCE_2FA: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  FORCE_PASSWORD_CHANGE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(7),
  IDLE_TIMEOUT_MINUTES: z.coerce.number().default(30),
  CHROMIUM_PATH: z.string().optional(),
  LOG_LEVEL: z.string().default('info'),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;
export function config(): AppConfig {
  if (!cached) {
    const r = schema.safeParse(process.env);
    if (!r.success) {
      throw new Error('Invalid configuration: ' + r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
    }
    if (r.data.NODE_ENV === 'production') {
      if (r.data.JWT_ACCESS_SECRET.startsWith('dev-only')) throw new Error('Set a real JWT_ACCESS_SECRET in production');
      if (!r.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
    }
    cached = r.data;
  }
  return cached;
}
export function resetConfigForTests() {
  cached = null;
}

/** Plain-English warnings shown in the server log at start-up while security settings are relaxed. */
export function securityWarnings(c: AppConfig = config()): string[] {
  const w: string[] = [];
  if (!c.ENFORCE_2FA) w.push('2FA is OPTIONAL (ENFORCE_2FA=false). Set ENFORCE_2FA=true before real company data goes in.');
  if (!c.FORCE_PASSWORD_CHANGE) w.push('Temporary passwords are NOT forced to change (FORCE_PASSWORD_CHANGE=false). Set it to true before real use.');
  return w;
}
