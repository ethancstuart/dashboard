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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo from THIS FILE, not from process.cwd(). An independent
// review caught the CWD version: `node /path/to/scripts/run-guards.mjs` from
// anywhere else would read a different package.json — running the wrong
// project's guards, or none, while reporting on this one. `npm run` happens to
// set CWD to the package root, so it worked and would have kept working right
// up until the first direct invocation.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
const guards = Object.keys(scripts).filter((k) => k.startsWith('check:'));

if (guards.length === 0) {
  console.error('[guards] no check:* scripts found — refusing to report success');
  process.exit(1);
}

console.log(`[guards] running ${guards.length} derived from package.json: ${guards.join(', ')}\n`);

const failed = [];
for (const g of guards) {
  console.log(`--- ${g} ---`);
  // cwd: ROOT for the same reason — a guard must run against the repo this
  // script belongs to, whatever directory the caller happened to be in.
  const r = spawnSync('npm', ['run', '--silent', g], { stdio: 'inherit', shell: false, cwd: ROOT });
  if (r.status !== 0) failed.push(g);
  console.log('');
}

if (failed.length > 0) {
  console.error(`[guards] FAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`[guards] OK — ${guards.length} guards passed.`);
