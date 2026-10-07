/*
 * LedgerPro
 * Copyright (c) 2026 Anoup Kumar Thapa. All rights reserved.
 * PROPRIETARY AND CONFIDENTIAL. Unauthorised copying, use or distribution
 * of this file, via any medium, is strictly prohibited. See LICENSE.
 */
// Fails if any source file lacks the proprietary copyright header (docs/ip-protection.md §2).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const ROOTS = ['apps', 'packages', 'scripts'];
const SKIP = /node_modules|dist|\.next|\.turbo|generated\.ts$|next-env\.d\.ts$/;
const EXT = /\.(ts|tsx|js|mjs|sql)$/;
const missing = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (SKIP.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (EXT.test(f) && !readFileSync(p, 'utf8').slice(0, 400).includes('Copyright (c) 2026 Anoup Kumar Thapa')) missing.push(p);
  }
};
ROOTS.forEach(walk);
if (missing.length) {
  console.error('Missing copyright header:\n' + missing.join('\n'));
  process.exit(1);
}
console.log('Copyright headers OK');
