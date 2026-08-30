/**
 * Run every `check:*` guard, DERIVED from package.json.
 *
 * WHY. The guard list was enumerated in three places and two of them were
 * already stale on 2026-08-30: `npm run validate` named four of the five
 * `check:*` scripts, and `.github/workflows/ci.yml` ran only TWO of them —
 * `check:cron-auth` and `check:style-attr` did not run in CI at all, despite
 * both being written, committed and believed to be enforced. Only
 * `.githooks/pre-push` derived its list, which is why the drift was invisible:
 * the guards did run, on push, from a machine that had the hook installed.
 *
 * This is rule 5 applied to the guard runner itself. A new `check:*` script is
 * enforced everywhere the moment it is defined, rather than in whichever of
 * three lists someone remembered to edit.
 *
 * It is deliberately NOT named `check:*` — it would match its own filter.
 *
 * Refuses to report success on an empty list: a filter that silently matches
 * nothing is how a runner passes while running no guards at all. An earlier
 * inline-shell version of this did exactly that, and exited 0.
 *
 * Usage: npm run guards
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts ?? {};
const guards = Object.keys(scripts).filter((k) => k.startsWith('check:'));

if (guards.length === 0) {
  console.error('[guards] no check:* scripts found — refusing to report success');
  process.exit(1);
}

console.log(`[guards] running ${guards.length} derived from package.json: ${guards.join(', ')}\n`);

const failed = [];
for (const g of guards) {
  console.log(`--- ${g} ---`);
  const r = spawnSync('npm', ['run', '--silent', g], { stdio: 'inherit', shell: false });
  if (r.status !== 0) failed.push(g);
  console.log('');
}

if (failed.length > 0) {
  console.error(`[guards] FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`[guards] OK — ${guards.length} guards passed.`);
