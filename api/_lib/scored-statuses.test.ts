import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SCORED_STATUSES,
  isScored,
  coverageRequirement,
  MIN_MEASUREMENTS_PER_REQUIRED_DAY,
  daysSinceResolution,
  UNRESOLVABLE_GRACE_DAYS,
} from './calls.js';

const API_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('scored statuses', () => {
  it('excludes every status that carries no outcome', () => {
    expect(isScored('hit')).toBe(true);
    expect(isScored('miss')).toBe(true);
    // The whole point. Before 2026-08-28 every scoring surface selected
    // `status <> 'pending'` and mapped `status === 'hit' ? 1 : 0`, so a void
    // call — one we could NOT honestly resolve — was scored as a wrong forecast.
    expect(isScored('void')).toBe(false);
    expect(isScored('unresolvable')).toBe(false);
    expect(isScored('pending')).toBe(false);
  });

  it('excludes a status nobody has invented yet, by default', () => {
    // An allow-list means a NEW status has to prove itself in scope. A
    // deny-list would score it by omission the day someone adds one.
    expect(isScored('some_future_status')).toBe(false);
  });

  /**
   * THE DIVERGENCE GUARD, and it derives rather than enumerates.
   *
   * The SQL scoring filters spell their statuses as literals because a neon
   * tagged template cannot interpolate an identifier list. That is a second
   * copy of the truth, and a second copy is how these drift. So: scan the
   * source for every `status IN (...)` filter and assert that each one names
   * exactly the SCORED_STATUSES set.
   *
   * If someone adds a status to the TypeScript set and forgets the SQL — or
   * writes a new scoring query with a hand-typed list — this fails. It is
   * derived from the property (what the code actually queries) rather than
   * from a list of files someone remembered to check.
   */
  it('every `status IN (...)` filter ON THE CALLS TABLE matches SCORED_STATUSES exactly', () => {
    // Scoped to the calls table on purpose. The first version of this guard
    // matched any `status IN (...)` anywhere in api/ and immediately reported
    // two offenders — marketing-medium.ts querying a POST status and
    // self-heal-log.ts querying a HEALTH status. Neither has anything to do
    // with the ledger. That is the repo's own lesson: a new guard reporting
    // findings on its first run has probably found itself, so fix the guard,
    // not the code.
    const expected = [...SCORED_STATUSES].sort().join(',');
    const offenders: string[] = [];
    let found = 0;

    for (const file of walk(API_DIR)) {
      const src = readFileSync(file, 'utf8');
      // Each backtick-delimited chunk is roughly one SQL template. Only those
      // that actually address `calls` are in scope.
      for (const chunk of src.split('`')) {
        if (!/\b(FROM|UPDATE|INTO)\s+calls\b/i.test(chunk)) continue;
        for (const m of chunk.matchAll(/status\s+IN\s*\(([^)]*)\)/gi)) {
          found++;
          const listed = m[1]
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
            .sort()
            .join(',');
          if (listed !== expected) {
            offenders.push(`${file.replace(API_DIR, 'api')}: status IN (${m[1].trim()})`);
          }
        }
      }
    }

    // Assert the guard can actually see something. A scan that silently matches
    // nothing is a green result with no mechanism behind it — the exact failure
    // this repo has already been bitten by.
    expect(found).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});

describe('coverageRequirement', () => {
  it('derives from the window rather than hardcoding a count', () => {
    // Half the window, rounded up. A kind with a different horizon is in scope
    // by construction, not because someone extended a list.
    expect(coverageRequirement(14).minDays).toBe(7);
    expect(coverageRequirement(30).minDays).toBe(15);
    expect(coverageRequirement(7).minDays).toBe(4);
    expect(coverageRequirement(60).minDays).toBe(30);
  });

  it('scales the measurement floor with the requirement', () => {
    const r = coverageRequirement(14);
    expect(r.minMeasurements).toBe(r.minDays * MIN_MEASUREMENTS_PER_REQUIRED_DAY);
  });

  it('never returns a zero requirement, which would restore the boolean gate', () => {
    for (const h of [0, -1, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = coverageRequirement(h);
      expect(r.minDays).toBeGreaterThanOrEqual(1);
      expect(r.minMeasurements).toBeGreaterThanOrEqual(MIN_MEASUREMENTS_PER_REQUIRED_DAY);
    }
  });

  it('would have held the calls that were about to resolve as false misses', () => {
    // Live figures for the 2026-09-05 cohort, re-measured 2026-08-29 over the
    // real window [2026-08-22, 2026-09-05] with data through that date. The
    // density gate holds EIGHT countries, not the three the old zero-coverage
    // gate caught — and every one of the five it adds would otherwise have
    // published a MISS on evidence too thin to carry one.
    const req = coverageRequirement(14);
    const observed = [
      { cc: 'CF', days: 0, measurements: 0 },
      { cc: 'ML', days: 0, measurements: 0 },
      { cc: 'TD', days: 0, measurements: 0 },
      { cc: 'SD', days: 1, measurements: 59 },
      { cc: 'SS', days: 2, measurements: 162 },
      { cc: 'NE', days: 4, measurements: 315 },
      { cc: 'SO', days: 4, measurements: 302 },
      // The one the DAY count alone would have waved through: a full week of
      // coverage on 163 measurements, ~23 a day for an entire country.
      { cc: 'CU', days: 7, measurements: 163 },
    ];
    for (const o of observed) {
      const passes = o.days >= req.minDays && o.measurements >= req.minMeasurements;
      expect(passes, `${o.cc} must not be scorable on ${o.days}d/${o.measurements} measurements`).toBe(false);
    }
    // And a densely-observed country must still resolve, or the gate is just
    // a way of never being wrong.
    expect(15 >= req.minDays && 95531 >= req.minMeasurements).toBe(true);
  });
});

describe('unresolvable grace period', () => {
  it('counts whole days since maturity, in UTC', () => {
    const now = new Date('2026-09-12T00:00:00Z');
    expect(daysSinceResolution('2026-09-05', now)).toBe(7);
    expect(daysSinceResolution('2026-09-12', now)).toBe(0);
    expect(daysSinceResolution('2026-09-13', now)).toBe(-1);
  });

  it('keeps a freshly-matured thin call PENDING rather than settling it', () => {
    // An independent review caught this: resolve-calls only ever selects
    // status='pending', so writing a terminal status on the resolution day
    // removes the call from the retry set permanently — and OONI's ingest lags
    // ~24h, so late evidence is real.
    const onTheDay = daysSinceResolution('2026-09-05', new Date('2026-09-05T09:45:00Z'));
    expect(onTheDay).toBe(0);
    expect(onTheDay < UNRESOLVABLE_GRACE_DAYS).toBe(true);
  });

  it('settles it once the evidence is genuinely not coming', () => {
    const later = daysSinceResolution('2026-09-05', new Date('2026-09-13T09:45:00Z'));
    expect(later).toBe(8);
    expect(later >= UNRESOLVABLE_GRACE_DAYS).toBe(true);
  });

  it('never throws on a malformed date, which would abort the batch', () => {
    expect(daysSinceResolution('not-a-date')).toBe(0);
    expect(daysSinceResolution('')).toBe(0);
  });
});
