/**
 * No new hex literal enters src/ — the palette lives in the token sources.
 *
 * WHY. docs/design-system.md rule 2 said "no new hex literals in component
 * CSS" and nothing enforced it, which is how nexuswatch.css accumulated 769
 * before it was deleted. Rule 8's history: a private colour copy is how an
 * identity change strands a public surface.
 *
 * THE RATCHET, and why it is not a stale list (rule 5): the baseline below
 * records the LEGACY tail — files that still carry terminal-era literals
 * awaiting per-site conversion with eyes on the rendered page. The guard
 * fails when ANY file's count EXCEEDS its baseline (a new literal anywhere
 * fails by default, including in a brand-new file, whose baseline is 0), and
 * when a file's count DROPS below baseline it demands the baseline be
 * lowered in the same commit — so the tail can only shrink, and the list can
 * never quietly rot upward. Token sources are exempt BY ROLE: they are where
 * colour is allowed to be a literal.
 *
 * Usage: npx tsx scripts/check-hex-literals.ts
 *        npx tsx scripts/check-hex-literals.ts --write-baseline  (after an
 *        intentional reduction; never to absorb an increase)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, 'scripts', 'hex-baseline.json');
const EXEMPT = new Set([
  'src/styles/tokens.css',
  'src/styles/tokens.ts',
  'src/styles/email-tokens.ts',
  'src/styles/design-tokens.css',
]);
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;

function files(dir: string, acc: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) files(p, acc);
    else if (/\.(ts|css)$/.test(p) && !/\.test\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

const counts: Record<string, number> = {};
for (const f of files(join(ROOT, 'src'))) {
  const rel = relative(ROOT, f);
  if (EXEMPT.has(rel)) continue;
  const n = (readFileSync(f, 'utf8').match(HEX) ?? []).length;
  if (n > 0) counts[rel] = n;
}

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `[check-hex-literals] baseline written: ${Object.keys(counts).length} files, ${Object.values(counts).reduce((a, b) => a + b, 0)} literals`,
  );
  process.exit(0);
}

const baseline: Record<string, number> = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const worse: string[] = [];
const better: string[] = [];
for (const [f, n] of Object.entries(counts)) {
  const b = baseline[f] ?? 0;
  if (n > b) worse.push(`${f}: ${b} → ${n}`);
  else if (n < b) better.push(`${f}: ${b} → ${n}`);
}
for (const f of Object.keys(baseline)) if (!(f in counts)) better.push(`${f}: ${baseline[f]} → 0`);

if (worse.length) {
  console.error('[check-hex-literals] NEW hex literals in src/ — colour belongs in the token sources:');
  for (const w of worse) console.error('  ' + w);
  process.exit(1);
}
if (better.length) {
  console.error('[check-hex-literals] counts DROPPED below baseline — good, now ratchet it in the same commit:');
  for (const b of better) console.error('  ' + b);
  console.error('  run: npx tsx scripts/check-hex-literals.ts --write-baseline');
  process.exit(1);
}
console.log(
  `[check-hex-literals] OK — ${Object.values(counts).reduce((a, b) => a + b, 0)} legacy literals across ${Object.keys(counts).length} files, none new (ratchet holds).`,
);
