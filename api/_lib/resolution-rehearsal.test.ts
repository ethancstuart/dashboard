import { describe, it, expect } from 'vitest';
import {
  brierScore,
  brierSkillScore,
  baseRate,
  calibrationBins,
  murphyDecomposition,
  independentUnits,
  resolutionBatches,
  MIN_RESOLUTION_BATCHES,
  type ScoredCall,
} from './calls.js';

/**
 * THE 5 SEPTEMBER REHEARSAL.
 *
 * At 09:45 UTC on 2026-09-05, resolve-calls.ts runs unattended and marks the
 * first real cohort hit or miss. Every scoring path below it has never once
 * executed against resolved data — `brierSkillScore` under the batch
 * withholding, the per-kind split, the calibration bins, the Murphy
 * decomposition. A path that has never run is a path nobody has seen fail.
 *
 * The intended rehearsal was a Neon branch, which is unavailable from this
 * environment (the database lives in an account this tooling cannot reach).
 * This is the better substitute and it is permanent: the REAL cohort, exported
 * from production on 2026-08-28, driven through the real scoring stack under
 * several outcome scenarios, asserting that nothing produces NaN, Infinity or
 * a number we promised to withhold.
 *
 * THE COHORT IS THE POINT. It is not a tidy fixture — it is 39 calls of which
 * 25 are the identical claim at the identical price, 7 are near-certain
 * blockers priced BELOW their base rate, and 3 are numerically identical to
 * their base rate and therefore contribute exactly zero skill by construction.
 * Any test written against invented data would miss all three pathologies.
 */

/** [country, probability, base_rate] — exported from production 2026-08-28. */
const COHORT: Array<[string, number, number]> = [
  ['AF', 0.16, 0.1],
  ['AZ', 0.16, 0.1],
  ['BD', 0.32, 0.5],
  ['BF', 0.16, 0.1],
  ['BY', 0.16, 0.1],
  ['CD', 0.16, 0.1],
  ['CF', 0.16, 0.1],
  ['CN', 0.84, 0.9],
  ['CU', 0.24, 0.3],
  ['EG', 0.16, 0.1],
  ['ET', 0.16, 0.1],
  ['HT', 0.16, 0.1],
  ['IN', 0.84, 0.9],
  ['IQ', 0.16, 0.1],
  ['IR', 0.84, 0.9],
  ['KE', 0.2, 0.2],
  ['KZ', 0.16, 0.1],
  ['LB', 0.2, 0.2],
  ['LY', 0.16, 0.1],
  ['ML', 0.16, 0.1],
  ['MM', 0.84, 0.9],
  ['NE', 0.16, 0.1],
  ['NG', 0.16, 0.1],
  ['PK', 0.16, 0.1],
  ['RU', 0.84, 0.9],
  ['SA', 0.84, 0.9],
  ['SD', 0.16, 0.1],
  ['SO', 0.16, 0.1],
  ['SS', 0.16, 0.1],
  ['SY', 0.16, 0.1],
  ['TD', 0.16, 0.1],
  ['TH', 0.52, 0.7],
  ['TR', 0.84, 0.9],
  ['TZ', 0.16, 0.1],
  ['UG', 0.16, 0.1],
  ['UZ', 0.52, 0.4],
  ['VE', 0.16, 0.1],
  ['VN', 0.4, 0.4],
  ['YE', 0.16, 0.1],
];

/** Countries observed already blocking inside the window on 2026-08-28. */
const ALREADY_HIT = new Set(['IN', 'IR', 'RU', 'TR', 'CN', 'MM', 'SA', 'KZ', 'LB']);

/** Countries with zero OONI coverage — the resolver leaves these pending. */
const NO_COVERAGE = new Set(['CF', 'ML', 'TD']);

const score = (outcomeOf: (cc: string) => 0 | 1, exclude: Set<string> = new Set()): ScoredCall[] =>
  COHORT.filter(([cc]) => !exclude.has(cc)).map(([cc, p, b]) => ({
    probability: p,
    outcome: outcomeOf(cc),
    baseRate: b,
  }));

/** Every published statistic must be a real number or an explicit null. */
function assertPublishable(calls: ScoredCall[]) {
  const brier = brierScore(calls);
  expect(Number.isFinite(brier)).toBe(true);
  expect(Number.isFinite(baseRate(calls))).toBe(true);

  const m = murphyDecomposition(calls);
  for (const v of Object.values(m)) {
    expect(Number.isFinite(v as number)).toBe(true);
  }
  for (const bin of calibrationBins(calls)) {
    expect(Number.isFinite(bin.meanPredicted)).toBe(true);
    expect(Number.isFinite(bin.observed)).toBe(true);
    expect(bin.count).toBeGreaterThan(0);
  }
}

describe('5 September rehearsal — the real cohort through the real scoring stack', () => {
  it('the cohort is what production actually holds, pathologies included', () => {
    expect(COHORT).toHaveLength(39);
    const identical = COHORT.filter(([, p, b]) => p === 0.16 && b === 0.1);
    expect(identical).toHaveLength(25); // one claim, one price, 25 countries
    const zeroSkill = COHORT.filter(([, p, b]) => p === b);
    expect(zeroSkill.map(([cc]) => cc).sort()).toEqual(['KE', 'LB', 'VN']);
  });

  it('SCENARIO: the window closes as observed today — 9 hits, 30 misses', () => {
    const calls = score((cc) => (ALREADY_HIT.has(cc) ? 1 : 0));
    assertPublishable(calls);
    const skill = brierSkillScore(calls);
    expect(Number.isFinite(skill)).toBe(true);
    // Verified against production on 2026-08-28: skill ≈ −3.1%.
    expect(skill).toBeLessThan(0);
    expect(skill).toBeGreaterThan(-0.1);
  });

  it('SCENARIO: only the near-certain blockers hit — the modal outcome', () => {
    const nearCertain = new Set(['CN', 'IN', 'IR', 'MM', 'RU', 'SA', 'TR']);
    const calls = score((cc) => (nearCertain.has(cc) ? 1 : 0));
    assertPublishable(calls);
    // The recency blend priced these BELOW their base rate, so the base rate
    // wins on every one of them. Negative skill here is arithmetic, not luck.
    expect(brierSkillScore(calls)).toBeLessThan(0);
  });

  it('SCENARIO: every call misses — the worst case still publishes real numbers', () => {
    const calls = score(() => 0);
    assertPublishable(calls);
    expect(Number.isFinite(brierSkillScore(calls))).toBe(true);
  });

  it('SCENARIO: every call hits — the flattering case is still finite and scoreable', () => {
    const calls = score(() => 1);
    assertPublishable(calls);
    expect(Number.isFinite(brierSkillScore(calls))).toBe(true);
  });

  /**
   * SUPERSEDED 2026-08-29 by the coverage-DENSITY gate. This scenario tested
   * the old boolean rule, under which a single measurement row in a fourteen-
   * day window certified a country as observed. Kept because the arithmetic it
   * asserts is still correct FOR THAT RULE, and because the difference between
   * the two publishing sets is the point:
   *
   *   old zero-coverage gate:  36 of 39 publish (CF, ML, TD held)
   *   density gate as shipped: 31 of 39 publish (CU, NE, SD, SO, SS also held)
   *
   * The five it adds would each have published a MISS on evidence too thin to
   * carry one — Sudan on 1 covered day and 59 measurements, Cuba on a full week
   * of days but 163 measurements, roughly 23 a day for an entire country.
   * The current fixture lives in scored-statuses.test.ts.
   */
  it('SCENARIO (superseded rule): the three zero-coverage calls stay pending — 36 publish, not 39', () => {
    const calls = score((cc) => (ALREADY_HIT.has(cc) ? 1 : 0), NO_COVERAGE);
    expect(calls).toHaveLength(36);
    assertPublishable(calls);
    expect(Number.isFinite(brierSkillScore(calls))).toBe(true);
  });

  it('REFUSES to score when any call is missing its base rate, rather than inventing a reference', () => {
    // MIXED outcomes on purpose. The first version of this test used an
    // all-miss cohort and passed a plant that made brierSkillScore fall back to
    // the POOLED reference — because with every outcome 0 the pooled reference
    // is also 0, so the fallback returned NaN too and the assertion was green
    // for the wrong reason. An expected output has many causes; this fixture
    // makes the pooled fallback return a finite number, so only a genuine
    // refusal produces NaN.
    const calls = score((cc) => (ALREADY_HIT.has(cc) ? 1 : 0));
    expect(Number.isFinite(brierSkillScore(calls))).toBe(true); // baseline: scoreable
    calls[0].baseRate = undefined;
    expect(Number.isNaN(brierSkillScore(calls))).toBe(true); // now it must refuse
  });
});

describe('5 September rehearsal — the withholding must actually engage', () => {
  it('39 calls issued on one day are ONE batch, far below the publish threshold', () => {
    const batches = resolutionBatches(COHORT.map(() => '2026-09-05'));
    expect(batches).toBe(1);
    expect(batches).toBeLessThan(MIN_RESOLUTION_BATCHES);
  });

  it('39 rows are 39 country units — but one batch, which is what withholds the number', () => {
    // Independence across countries is real; independence across TIME is not.
    // The batch count is the binding constraint on 09-05, and it must be.
    expect(independentUnits(COHORT.map(([cc]) => `censorship_event:${cc}`))).toBe(39);
    expect(resolutionBatches(COHORT.map(() => '2026-09-05'))).toBe(1);
  });

  it('three batches is the first moment a skill number may be published', () => {
    const dates = ['2026-09-05', '2026-09-19', '2026-10-03'];
    expect(resolutionBatches(dates)).toBe(MIN_RESOLUTION_BATCHES);
  });
});
