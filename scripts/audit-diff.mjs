#!/usr/bin/env node
// Compares two findings.json snapshots and prints which (role, viewport, path)
// combinations IMPROVED (resolved an issue) and which REGRESSED (added one).
// Used between phases to make sure each fix landed without breaking adjacent pages.
import { readFileSync } from 'node:fs';

const beforePath = process.argv[2] ?? 'audit-screenshots/findings.baseline.json';
const afterPath = process.argv[3] ?? 'audit-screenshots/findings.json';

const before = JSON.parse(readFileSync(beforePath, 'utf-8'));
const after = JSON.parse(readFileSync(afterPath, 'utf-8'));

const key = (e) => `${e.role}|${e.viewport}|${e.path}`;
const map = (arr) => Object.fromEntries(arr.map((e) => [key(e), e]));

const B = map(before);
const A = map(after);

const flags = (e) => ({
  overflow: e.checks?.hasOverflow ?? false,
  tiny: e.checks?.tinyCount ?? 0,
  offscreen: e.checks?.offscreenCount ?? 0,
  skipped: !!e.skipped
});

let improved = 0, regressed = 0, unchanged = 0;
const lines = [];
for (const k of new Set([...Object.keys(B), ...Object.keys(A)])) {
  const b = B[k];
  const a = A[k];
  if (!b || !a) continue;
  const bf = flags(b), af = flags(a);
  const diff = [];
  if (bf.overflow && !af.overflow) diff.push('OVERFLOW resolved');
  if (!bf.overflow && af.overflow) diff.push('OVERFLOW regressed');
  if (bf.tiny > af.tiny) diff.push(`tiny ${bf.tiny}→${af.tiny}`);
  if (bf.tiny < af.tiny) diff.push(`TINY ${bf.tiny}→${af.tiny} REGRESS`);
  if (bf.offscreen > af.offscreen) diff.push(`offscreen ${bf.offscreen}→${af.offscreen}`);
  if (bf.offscreen < af.offscreen) diff.push(`OFFSCREEN ${bf.offscreen}→${af.offscreen} REGRESS`);
  if (diff.length === 0) { unchanged++; continue; }
  if (diff.some((d) => d.toUpperCase().includes('REGRESS'))) regressed++;
  else improved++;
  lines.push(`  ${k}: ${diff.join(', ')}`);
}
console.log(`\nResult: ${improved} improved, ${regressed} regressed, ${unchanged} unchanged\n`);
for (const l of lines) console.log(l);
process.exit(regressed > 0 ? 1 : 0);
