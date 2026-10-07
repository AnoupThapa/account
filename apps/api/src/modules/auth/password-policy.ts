/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
import { AppError } from '@ledgerpro/shared';

// Small built-in list of the most common breached passwords (security.md §1).
// TODO(Phase 9): optional k-anonymity check against the HaveIBeenPwned range API.
const COMMON = new Set(
  `password password1 password12 password123 password1234 1234567890 12345678910 qwertyuiop qwerty12345 qwerty123456
  iloveyou123 welcome123 welcome1234 admin12345 administrator letmein123 football123 baseball123 abc1234567 1q2w3e4r5t
  1qaz2wsx3edc zaq12wsx 11111111111 0000000000 123123123123 passw0rd123 p@ssw0rd123 changeme123 trustno1234 sunshine123
  princess123 dragon12345 monkey12345 nepal12345 kathmandu123 australia1 sydney12345 melbourne1 ledgerpro123 company123
  mustang1234 shadow12345 master12345 superman123 batman12345 michael123 jennifer123 starwars123 computer123`.split(/\s+/),
);

export function assertStrongPassword(pw: string, email?: string, name?: string): void {
  const problems: string[] = [];
  if (pw.length < 10) problems.push('at least 10 characters');
  if (pw.length > 200) problems.push('at most 200 characters');
  if (COMMON.has(pw.toLowerCase())) problems.push('not a commonly used password');
  if (/^(.)\1+$/.test(pw)) problems.push('not a single repeated character');
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && pw.toLowerCase().includes(local)) problems.push('must not contain your email name');
  if (name && name.length >= 4 && pw.toLowerCase().includes(name.toLowerCase().split(' ')[0])) problems.push('must not contain your name');
  if (problems.length) {
    throw new AppError('AUTH_WEAK_PASSWORD', 'Password must be ' + problems.join(', '), undefined, [
      { field: 'password', message: 'Password must be ' + problems.join(', ') },
    ]);
  }
}
