import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * THE CENSORSHIP THRESHOLD MEANS "DAYS", AND ONLY BECAUSE OF THE COLLECTOR.
 *
 * `resolve-calls.ts` counts censorship evidence as
 * `COUNT(DISTINCT measurement_date)` — blocked DAYS. Every censorship call on
 * the book carries `threshold = 1`, and the claim text says "at least N
 * confirmed blocking events", so days and events must not silently diverge.
 *
 * Today they cannot: `ooni_measurements` is keyed
 * (country_code, test_name, measurement_date) and the collector requests
 * exactly ONE test_name, so there is at most one row per country-day. Verified
 * against production 2026-08-29: for confirmed_blocked > 0, COUNT(*) = 742 and
 * COUNT(DISTINCT (country_code, measurement_date)) = 742, across 1 test_name.
 *
 * An independent review flagged the count change as a silent semantic shift,
 * and it was right that nothing enforced the assumption — the equivalence was
 * true, measured, and completely unguarded. A measurement in a commit message
 * protects nothing; the day someone adds `whatsapp` or `telegram` to the
 * collector (which its own docstring promises), rows-per-country-day becomes
 * 2 or 3 and every threshold in the book would quietly multiply.
 *
 * So the guard lives at the ASSUMPTION, not at the arithmetic: if the collector
 * stops being single-test, this fails and names the resolver that depends on
 * it. Derived from what the collector actually requests, so a new test added by
 * anyone fails by default rather than passing by omission.
 */
describe('censorship evidence unit', () => {
  const collector = readFileSync(join(API, 'cron/source-ooni.ts'), 'utf8');
  const resolver = readFileSync(join(API, 'cron/resolve-calls.ts'), 'utf8');

  it('the OONI collector still requests exactly one test_name', () => {
    const requested = [...collector.matchAll(/test_name=([\w-]+)/g)].map((m) => m[1]);
    expect(requested.length, 'no test_name found — the URL shape changed').toBeGreaterThan(0);
    const distinct = [...new Set(requested)];
    expect(
      distinct,
      'The collector now ingests more than one OONI test, so ooni_measurements holds ' +
        'multiple rows per country-day. resolve-calls.ts counts DISTINCT measurement_date, ' +
        'so a call threshold now means "blocked days" where the claim text may mean "events". ' +
        'Revisit resolve-calls.ts and the claim wording together before shipping this.',
    ).toEqual(['web_connectivity']);
  });

  it('the resolver still counts days, not rows', () => {
    // If someone reverts this to COUNT(*), the threshold silently starts
    // meaning rows again the moment a second test lands.
    expect(resolver).toContain('COUNT(DISTINCT measurement_date)::int AS n');
  });

  it('the two files stay linked, so the dependency is discoverable', () => {
    // A guard nobody can trace back to its reason gets deleted by the next
    // person who finds it inconvenient.
    expect(resolver).toMatch(/source-ooni|test_name|distinct/i);
  });
});
