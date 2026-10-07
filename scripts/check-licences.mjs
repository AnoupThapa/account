/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
// Blocks copyleft licences (CLAUDE.md: never add AGPL/GPL dependencies).
import { execSync } from 'node:child_process';
const out = JSON.parse(execSync('pnpm licenses list --json --prod', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const bad = Object.keys(out).filter((l) => /(^|[^L])GPL|AGPL|SSPL/i.test(l) && !/LGPL/i.test(l));
if (bad.length) {
  console.error('Forbidden licences found: ' + bad.map((l) => `${l}: ${out[l].map((p) => p.name).join(', ')}`).join('; '));
  process.exit(1);
}
console.log('Licences OK: ' + Object.keys(out).join(', '));
