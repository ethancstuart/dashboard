/**
 * Every scheduled endpoint must authenticate — derived from the schedule
 * itself, never from a list someone remembered to update.
 *
 * WHY. An audit on 2026-08-28 found 53 cron handlers using four different
 * authorization idioms, two of which PASS when CRON_SECRET is unset (because
 * `token !== process.env.CRON_SECRET` compares undefined to undefined), and
 * ~20 with no check at all. Nine of those were the marketing dispatchers,
 * which reach a paid Claude generation and a paid voice evaluation — while
 * MARKETING_AUTOMATION_ENABLED was verified `'true'` in production.
 *
 * THE DERIVATION IS THE POINT (rule 5). The set of things that must be
 * authenticated is read from `vercel.json`'s cron manifest, so a cron added
 * tomorrow is in scope the moment it is scheduled, and a cron deleted stops
 * being checked. A hand-kept list of "the protected ones" is out of date the
 * day someone adds the next handler.
 *
 * An endpoint may opt out only with an explicit, reasoned marker:
 *     // cron-auth-exempt: <why this is safe unauthenticated>
 *
 * Usage: npx tsx scripts/check-cron-auth.ts
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const EXEMPT_RE = /\/\/\s*cron-auth-exempt:\s*(.+)/;

interface Cron {
  path: string;
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { crons?: Cron[] };
const crons = manifest.crons ?? [];
if (crons.length === 0) {
  console.error('[check-cron-auth] no crons found in vercel.json — the derivation is broken, not the code');
  process.exit(1);
}

const violations: string[] = [];
const exempt: Array<{ path: string; reason: string }> = [];
const missing: string[] = [];
const legacy: string[] = [];
let checked = 0;

for (const cron of crons) {
  // "/api/cron/foo" -> "api/cron/foo.ts"
  const rel = `${cron.path.replace(/^\//, '')}.ts`;
  const file = join(ROOT, rel);
  if (!existsSync(file)) {
    missing.push(`${cron.path} -> ${rel} (scheduled but the handler does not exist)`);
    continue;
  }
  checked++;
  const src = readFileSync(file, 'utf8');

  const exemption = src.match(EXEMPT_RE);
  if (exemption) {
    exempt.push({ path: cron.path, reason: exemption[1].trim() });
    continue;
  }

  // The property: the handler must CALL the shared fail-closed check. Merely
  // importing it is not enough — that is the mistake check-llm-spend.ts made
  // by testing for the presence of a string rather than its use.
  if (/requireCron\s*\(/.test(src)) continue;

  // TWO CLASSES, and conflating them would make this guard a liar. On its
  // first run it reported 24 endpoints as "do not authenticate" — but most of
  // them DO, using an older idiom. A guard whose message is false is one
  // nobody trusts the second time.
  //
  //  - No mention of CRON_SECRET at all: genuinely open to the internet today.
  //    That FAILS.
  //  - A legacy idiom: authenticated in practice, because CRON_SECRET is set
  //    in production — but it accepts the secret via ?token= (logged in Vercel
  //    access logs and leaked in Referer headers) and it passes when the
  //    secret is UNSET, because `undefined !== undefined` is false. That is a
  //    migration WARNING, not a build break.
  if (!src.includes('CRON_SECRET')) {
    violations.push(`${cron.path}  (${rel})`);
  } else {
    legacy.push(cron.path);
  }
}

if (missing.length > 0) {
  console.error(`\n[check-cron-auth] ${missing.length} scheduled path(s) have no handler:\n`);
  for (const m of missing) console.error(`  ${m}`);
}

if (violations.length > 0) {
  console.error(`\n[check-cron-auth] FAILED — ${violations.length} scheduled endpoint(s) do not authenticate:\n`);
  for (const v of violations) console.error(`  ${v}`);
  console.error(`
Every scheduled endpoint is a PUBLIC URL. Vercel calls it on a timer; so can
anyone else. Add as the first statement of the handler:

    import { requireCron } from '../_cron-utils.js';
    ...
    if (!requireCron(req, res)) return;

Or, if it is genuinely safe to call unauthenticated, say why in the file:

    // cron-auth-exempt: <reason>
`);
  process.exit(1);
}

if (legacy.length > 0) {
  console.warn(
    `\n[check-cron-auth] ${legacy.length} endpoint(s) still use the legacy idiom. They authenticate ` +
      `today only because CRON_SECRET is set; they accept the secret as a query parameter and they ` +
      `PASS when it is unset. Migrate to requireCron():\n`,
  );
  for (const l of legacy) console.warn(`  ${l}`);
}

console.log(
  `[check-cron-auth] OK — ${checked} scheduled endpoint(s) authenticate` +
    (legacy.length ? ` (${legacy.length} via the legacy idiom — migrate)` : '') +
    (exempt.length ? `, ${exempt.length} exempt with a recorded reason` : '') +
    (missing.length ? `, ${missing.length} scheduled path(s) missing a handler` : ''),
);
for (const e of exempt) console.log(`  exempt: ${e.path} — ${e.reason}`);
if (missing.length > 0) process.exit(1);
