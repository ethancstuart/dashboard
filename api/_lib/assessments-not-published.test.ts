import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const API = join(ROOT, 'api');

/**
 * NOTHING PUBLIC MAY SERVE A FIGURE DERIVED FROM `assessments`.
 *
 * `assessments` is a CLOSED LOOP. `record-assessments.ts:85` predicts
 * `0.6*score + 0.4*(score + delta7)` — a mechanical extrapolation of the CII —
 * and `score-assessments.ts:62` scores it against the CII itself, counting a
 * row "accurate" when the index moved less than 5 points.
 *
 * Until 2026-08-31 `/api/accuracy/stats` published that as
 * `accuracy_rate: 90.3` over 10,895 rows. Measured against a naive no-change
 * baseline on those same rows:
 *
 *     model MAE  2.2108   (matches the endpoint's own mean_abs_error, 2.21)
 *     naive MAE  1.8889
 *     skill     -17.0%
 *
 * So the number published as 90.3% accuracy described a system 17% WORSE than
 * assuming nothing changes. `/ledger` — resolved against sources outside
 * NexusWatch — is the replacement, and two surfaces claiming different
 * accuracies is worse than one.
 *
 * THE GUARD DERIVES ITS SCOPE. It does not name the deleted file. It walks
 * every handler under api/ that is NOT a cron and fails on any reference to
 * the table, so a NEW endpoint reading `assessments` fails by default rather
 * than passing because nobody remembered to forbid it. The crons are exempt
 * BY LOCATION, not by name: they write the table and publish nothing.
 */
function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'worktrees') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.ts$/.test(p) && !/\.test\.ts$/.test(p)) acc.push(p);
  }
  return acc;
}

describe('the closed-loop assessments figures stay unpublished', () => {
  it('no non-cron api handler reads the assessments table', () => {
    const offenders: string[] = [];

    for (const file of walk(API)) {
      const rel = relative(ROOT, file);
      // Crons write and score the table. They publish nothing.
      if (rel.startsWith('api/cron/')) continue;
      // SCOPED TO ACTUAL SQL, and that is not fussiness.
      //
      // The first version of this guard scanned the whole file for
      // /(FROM|INTO|UPDATE)\s+assessments/i and reported two offenders on its
      // first run. Both were English: api/_lib/personas.ts carries the prompt
      // line "Distinguish facts (CONFIRMED) from assessments (ASSESSED)"
      // inside a template string, where comment-stripping cannot reach it.
      // Nine fictional findings from a first-run guard is a pattern this repo
      // has paid for twice; two is the same pattern, smaller.
      //
      // So the scan reads only the contents of sql`...` tagged templates. A
      // table can only be queried from inside one, and prose cannot get in.
      const src = readFileSync(file, 'utf8');
      const queries = [...src.matchAll(/\bsql`([\s\S]*?)`/g)].map((m) => m[1]).join('\n');
      if (/\b(FROM|INTO|UPDATE|JOIN)\s+assessments\b/i.test(queries)) {
        offenders.push(rel);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('scans a real, non-trivial set of handlers — not vacuously green', () => {
    // Without this, deleting api/ entirely would satisfy the assertion above.
    const nonCron = walk(API).filter((f) => !relative(ROOT, f).startsWith('api/cron/'));
    expect(nonCron.length).toBeGreaterThan(20);
  });
});
