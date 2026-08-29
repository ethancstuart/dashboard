import { describe, it, expect } from 'vitest';
import {
  brierScore,
  baseRate,
  brierSkillScore,
  brierSkillScoreVsPooled,
  effectiveSampleSize,
  calibrationBins,
  murphyDecomposition,
  resolveOutcome,
  historicalRate,
  clampProbability,
  blendRates,
  fxThreshold,
  fxDepreciationPct,
  formatLedgerSummary,
  type LedgerSummaryRow,
  type ScoredCall,
  type Call,
  independentUnits,
  resolutionBatches,
  MIN_RESOLUTION_BATCHES,
} from './calls.js';

const c = (probability: number, outcome: 0 | 1): ScoredCall => ({ probability, outcome });
/** A call carrying the unit's own climatology — required for a real skill score. */
const cb = (probability: number, outcome: 0 | 1, baseRate: number): ScoredCall => ({
  probability,
  outcome,
  baseRate,
});

describe('brierScore', () => {
  it('is 0 for a perfect forecaster', () => {
    expect(brierScore([c(1, 1), c(0, 0)])).toBe(0);
  });

  it('is 1 for a perfectly wrong forecaster', () => {
    expect(brierScore([c(1, 0), c(0, 1)])).toBe(1);
  });

  it('is 0.25 for always saying 50%', () => {
    expect(brierScore([c(0.5, 1), c(0.5, 0), c(0.5, 1)])).toBeCloseTo(0.25, 10);
  });

  it('rewards confidence only when it is correct', () => {
    expect(brierScore([c(0.9, 1)])).toBeLessThan(brierScore([c(0.6, 1)]));
    expect(brierScore([c(0.9, 0)])).toBeGreaterThan(brierScore([c(0.6, 0)]));
  });
});

describe('baseRate', () => {
  it('is the observed frequency', () => {
    expect(baseRate([c(0.5, 1), c(0.5, 0), c(0.5, 0), c(0.5, 0)])).toBe(0.25);
  });
});

describe("brierSkillScore — scored against each unit's OWN climatology", () => {
  it("is positive when the forecaster beats that unit's base rate", () => {
    // Base rate 0.5 for each; forecaster called each correctly and confidently.
    const calls = [cb(0.9, 1, 0.5), cb(0.1, 0, 0.5), cb(0.9, 1, 0.5), cb(0.1, 0, 0.5)];
    expect(brierSkillScore(calls)).toBeGreaterThan(0);
  });

  it('is 0 for a forecaster who just restates the base rate', () => {
    const calls = [cb(0.5, 1, 0.5), cb(0.5, 0, 0.5), cb(0.5, 1, 0.5), cb(0.5, 0, 0.5)];
    expect(brierSkillScore(calls)).toBeCloseTo(0, 10);
  });

  it('goes NEGATIVE when the forecaster is worse than climatology', () => {
    const calls = [cb(0.9, 0, 0.5), cb(0.1, 1, 0.5), cb(0.9, 0, 0.5), cb(0.1, 1, 0.5)];
    expect(brierSkillScore(calls)).toBeLessThan(0);
  });

  it('REFUSES to score a call with no base rate rather than falling back to pooled', () => {
    // Returning a number here would reintroduce exactly the flattery this removes.
    expect(Number.isNaN(brierSkillScore([c(0.9, 1), c(0.1, 0)]))).toBe(true);
    expect(Number.isNaN(brierSkillScore([cb(0.9, 1, 0.5), c(0.1, 0)]))).toBe(true);
  });

  it('is undefined rather than misleading when the reference was already perfect', () => {
    expect(Number.isNaN(brierSkillScore([cb(0.7, 1, 1), cb(0.8, 1, 1)]))).toBe(true);
  });
});

describe('the pooling artefact this replaced — the regression test that matters', () => {
  // A forecaster who knows NOTHING except which country it is: it says each
  // unit's own base rate back, every time. Against per-unit climatology that is
  // by definition zero skill. Against a POOLED base rate it scores positive,
  // purely for knowing that some countries always block and others never do.
  const alwaysBlocks = Array.from({ length: 7 }, () => cb(0.99, 1, 0.99));
  const neverBlocks = Array.from({ length: 24 }, () => cb(0.01, 0, 0.01));
  const uncertain = [cb(0.5, 1, 0.5), cb(0.5, 0, 0.5), cb(0.5, 1, 0.5), cb(0.5, 0, 0.5)];
  const book = [...alwaysBlocks, ...neverBlocks, ...uncertain];

  it('awards essentially ZERO skill against per-unit climatology, correctly', () => {
    expect(Math.abs(brierSkillScore(book))).toBeLessThan(0.02);
  });

  it('awards LARGE positive skill against the pooled base rate, incorrectly', () => {
    expect(brierSkillScoreVsPooled(book)).toBeGreaterThan(0.5);
  });

  it('so the two disagree by a wide margin on a forecaster with no information', () => {
    expect(brierSkillScoreVsPooled(book) - brierSkillScore(book)).toBeGreaterThan(0.5);
  });
});

describe('effectiveSampleSize — 91 correlated calls are not 91 observations', () => {
  it('returns n when observations are independent', () => {
    expect(effectiveSampleSize(91, 0)).toBe(91);
  });

  it('collapses hard under realistic correlation', () => {
    // A fresh 14-day call per country per day shares 13 of 14 days with
    // yesterday's, and all of them resolve against one set of external data.
    expect(effectiveSampleSize(91, 0.15)).toBeLessThan(8);
  });

  it('never exceeds n and never goes below 1 for a non-empty book', () => {
    for (const n of [1, 5, 39, 52, 91, 1274]) {
      const e = effectiveSampleSize(n, 0.15);
      expect(e).toBeLessThanOrEqual(n);
      expect(e).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles degenerate inputs without returning nonsense', () => {
    expect(effectiveSampleSize(0)).toBe(0);
    expect(effectiveSampleSize(1)).toBe(1);
  });
});

describe('calibrationBins', () => {
  it('groups by stated probability and reports observed frequency', () => {
    const calls = [c(0.15, 0), c(0.15, 0), c(0.85, 1), c(0.85, 1)];
    const bins = calibrationBins(calls);
    expect(bins).toHaveLength(2);
    expect(bins[0].observed).toBe(0);
    expect(bins[1].observed).toBe(1);
  });

  it('omits empty bins rather than reporting them as zero', () => {
    // "we never said 90%" and "we said 90% and were always wrong" are opposite
    // facts and must not render identically.
    const bins = calibrationBins([c(0.05, 0)]);
    expect(bins).toHaveLength(1);
    expect(bins[0].count).toBe(1);
  });

  it('puts a stated 1.0 in the top bin, not out of range', () => {
    const bins = calibrationBins([c(1, 1)]);
    expect(bins).toHaveLength(1);
    expect(bins[0].to).toBe(1);
  });

  it('a well-calibrated forecaster sits on the diagonal', () => {
    // 10 calls at 70%, 7 of which happen.
    const calls: ScoredCall[] = [
      ...Array.from({ length: 7 }, () => c(0.7, 1)),
      ...Array.from({ length: 3 }, () => c(0.7, 0)),
    ];
    const [bin] = calibrationBins(calls);
    expect(bin.meanPredicted).toBeCloseTo(0.7, 10);
    expect(bin.observed).toBeCloseTo(0.7, 10);
  });
});

describe('murphyDecomposition', () => {
  it('satisfies the identity Brier = reliability - resolution + uncertainty', () => {
    const calls = [c(0.9, 1), c(0.2, 0), c(0.6, 1), c(0.3, 0), c(0.8, 1), c(0.1, 1)];
    const d = murphyDecomposition(calls);
    expect(d.reliability - d.resolution + d.uncertainty).toBeCloseTo(brierScore(calls), 10);
  });

  it('reports near-zero reliability error for a well-calibrated forecaster', () => {
    const calls: ScoredCall[] = [
      ...Array.from({ length: 7 }, () => c(0.7, 1)),
      ...Array.from({ length: 3 }, () => c(0.7, 0)),
    ];
    expect(murphyDecomposition(calls).reliability).toBeCloseTo(0, 10);
  });

  it('reports zero resolution for a forecaster who never discriminates', () => {
    const calls = [c(0.5, 1), c(0.5, 0), c(0.5, 1), c(0.5, 0)];
    expect(murphyDecomposition(calls).resolution).toBeCloseTo(0, 10);
  });

  it('uncertainty depends on the base rate, not on the forecaster', () => {
    const even = murphyDecomposition([c(0.3, 1), c(0.3, 0)]);
    const skewed = murphyDecomposition([c(0.3, 1), c(0.3, 0), c(0.3, 0), c(0.3, 0)]);
    expect(even.uncertainty).toBeCloseTo(0.25, 10);
    expect(skewed.uncertainty).toBeLessThan(even.uncertainty);
  });
});

describe('resolveOutcome', () => {
  it('resolves on external evidence only, never on our confidence', () => {
    expect(resolveOutcome(0)).toBe(0);
    expect(resolveOutcome(1)).toBe(1);
    expect(resolveOutcome(9)).toBe(1);
  });

  it('honours a threshold fixed before the window opened', () => {
    expect(resolveOutcome(2, 3)).toBe(0);
    expect(resolveOutcome(3, 3)).toBe(1);
  });
});

describe('historicalRate', () => {
  it('gives an unseen country 50%, not a confident 0', () => {
    expect(historicalRate(0, 0)).toBeCloseTo(0.5, 10);
  });

  it('moves toward the evidence as history accumulates', () => {
    expect(historicalRate(0, 20)).toBeLessThan(0.1);
    expect(historicalRate(20, 20)).toBeGreaterThan(0.9);
  });

  it('never returns an unfalsifiable 0 or 1', () => {
    expect(historicalRate(0, 10_000)).toBeGreaterThan(0);
    expect(historicalRate(10_000, 10_000)).toBeLessThan(1);
  });
});

describe('clampProbability', () => {
  it('keeps a stated certainty falsifiable', () => {
    expect(clampProbability(0)).toBe(0.01);
    expect(clampProbability(1)).toBe(0.99);
  });

  it('falls back to 50% for a non-finite input rather than throwing', () => {
    expect(clampProbability(NaN)).toBe(0.5);
  });
});

/*
 * `formatLedgerLine` and its four tests were DELETED, not updated.
 *
 * It computed a pooled brierSkillScore with no batch gate and printed it beside
 * a raw hit count — the same defect as formatLedgerSummary's. It had no
 * production caller, which was luck, not design. Gating it would have left a
 * second path to the number the ledger withholds; deleting it leaves one.
 */

describe('blendRates', () => {
  it('leans on the recent rate by default', () => {
    expect(blendRates(1, 0)).toBeCloseTo(0.6, 10);
    expect(blendRates(0, 1)).toBeCloseTo(0.4, 10);
  });

  it('returns the shared value when both agree', () => {
    expect(blendRates(0.3, 0.3)).toBeCloseTo(0.3, 10);
  });

  it('honours an explicit weight', () => {
    expect(blendRates(1, 0, 0)).toBe(0.01); // pure long-run, clamped off zero
    expect(blendRates(1, 0, 1)).toBe(0.99); // pure recent, clamped off one
  });

  it('never states an unfalsifiable certainty', () => {
    expect(blendRates(1, 1)).toBeLessThan(1);
    expect(blendRates(0, 0)).toBeGreaterThan(0);
  });
});

describe('formatLedgerSummary — the standing line at the top of the brief', () => {
  const mk = (status: Call['status']): Call => ({
    madeOn: '2026-08-08',
    kind: 'censorship_event',
    countryCode: 'IR',
    probability: 0.84,
    horizonDays: 14,
    resolvesOn: '2026-08-22',
    claim: 'x',
    resolver: 'OONI',
    status,
  });

  const row = (
    kind: string,
    probability: number,
    outcome: 0 | 1,
    baseRate: number | undefined,
    resolvedOn: string,
  ): LedgerSummaryRow => ({ kind, probability, outcome, baseRate, resolvedOn });

  it('is honest on day one instead of inventing a record', () => {
    expect(formatLedgerSummary({ resolvedToday: [], scored: [], openCount: 0 })).toBe('No calls on the book yet.');
  });

  it('reports the open book before anything has resolved', () => {
    const line = formatLedgerSummary({
      resolvedToday: [],
      scored: [],
      openCount: 39,
      nextResolvesOn: '2026-09-05',
    });
    expect(line).toBe('39 open, next resolves 2026-09-05');
  });

  /**
   * THE 5 SEPTEMBER CASE, and the reason this function was rewritten.
   *
   * A test previously named `it('prints a negative skill score rather than
   * omitting it')` asserted the OPPOSITE of this, and it passed. That is how
   * the defect survived: the brief pooled every kind, applied no batch gate,
   * and printed a skill figure that /ledger and /api/calls/ledger both
   * correctly withheld. On 2026-09-05 that would have published, to
   * subscribers, a cross-kind number from a SINGLE resolution batch.
   *
   * Publishing a negative number IS right — when it means something. One batch
   * cannot separate a forecasting method from the fortnight it landed in, so
   * the honest output is the refusal and its reason.
   */
  it('withholds skill from a single resolution batch, and says why', () => {
    const line = formatLedgerSummary({
      resolvedToday: [mk('miss')],
      scored: [row('censorship_event', 0.9, 0, 0.5, '2026-09-05'), row('censorship_event', 0.1, 1, 0.5, '2026-09-05')],
      openCount: 1,
    });
    expect(line).toContain('skill withheld (1 of 3 batches)');
    expect(line).not.toContain('vs base rate');
    expect(line).toContain('Brier');
  });

  it('publishes skill — negative included — once enough batches exist', () => {
    const line = formatLedgerSummary({
      resolvedToday: [mk('miss')],
      scored: [
        row('censorship_event', 0.9, 0, 0.5, '2026-09-05'),
        row('censorship_event', 0.1, 1, 0.5, '2026-09-19'),
        row('censorship_event', 0.9, 0, 0.5, '2026-10-03'),
      ],
      openCount: 1,
    });
    expect(line).toContain('vs base rate');
    expect(line).toContain('-');
  });

  it('never pools across kinds', () => {
    const line = formatLedgerSummary({
      resolvedToday: [],
      scored: [row('censorship_event', 0.9, 0, 0.5, '2026-09-05'), row('fx_devaluation', 0.2, 1, 0.25, '2026-09-06')],
      openCount: 0,
    });
    // Two kinds, two separate readings, and no third combined figure.
    expect(line).toContain('OONI Brier');
    expect(line).toContain('FX Brier');
    expect(line.match(/Brier/g)?.length).toBe(2);
  });

  it('refuses to call a climatology cohort a forecast', () => {
    // Every row stated AT its base rate: skill is 0.000 by algebra. Printing a
    // hard zero would read as a measurement. This is the live state of every
    // censorship call issued from 2026-08-23 on.
    const line = formatLedgerSummary({
      resolvedToday: [],
      scored: [
        row('censorship_event', 0.1, 0, 0.1, '2026-09-05'),
        row('censorship_event', 0.9, 1, 0.9, '2026-09-19'),
        row('censorship_event', 0.1, 0, 0.1, '2026-10-03'),
      ],
      openCount: 0,
    });
    expect(line).toContain('stated at climatology — not a forecast');
    expect(line).not.toContain('vs base rate');
    expect(line).not.toContain('0%');
  });

  it('says nothing about skill when base rates are missing', () => {
    const line = formatLedgerSummary({
      resolvedToday: [mk('miss')],
      scored: [
        row('censorship_event', 0.9, 0, undefined, '2026-09-05'),
        row('censorship_event', 0.1, 1, undefined, '2026-09-19'),
        row('censorship_event', 0.9, 0, undefined, '2026-10-03'),
      ],
      openCount: 1,
    });
    expect(line).not.toContain('vs base rate');
    expect(line).not.toContain('NaN');
  });

  it("reports today's resolutions as a count, never as an accuracy rate", () => {
    const line = formatLedgerSummary({
      resolvedToday: [mk('hit'), mk('miss')],
      scored: [],
      openCount: 37,
      nextResolvesOn: '2026-09-06',
    });
    expect(line).toContain('2 resolved today, 1 hit');
    expect(line).not.toContain('%');
    expect(line).toContain('37 open');
  });
});

describe('fxThreshold — calibrated per currency, not a fixed percentage', () => {
  it("uses the currency's own p75 depreciation as the bar", () => {
    expect(fxThreshold(3.584)).toBe(3.58);
    expect(fxThreshold(7.883)).toBe(7.88);
  });

  it('returns NO CALL for a pegged currency', () => {
    // 28 of 80 currencies have volatility_7d of exactly 0.0000. A vol-multiple
    // threshold would give them zero — "any move at all" — which is degenerate,
    // not uncertain. There is no honest call to make about a hard peg.
    expect(fxThreshold(0)).toBeNull();
    expect(fxThreshold(0.1)).toBeNull();
  });

  it('honours an explicit floor', () => {
    expect(fxThreshold(0.4, 0.5)).toBeNull();
    expect(fxThreshold(0.6, 0.5)).toBe(0.6);
  });

  it('returns null for missing history rather than inventing a bar', () => {
    expect(fxThreshold(null)).toBeNull();
    expect(fxThreshold(NaN)).toBeNull();
  });

  it('makes a lira call and a franc call comparably hard by construction', () => {
    // Both thresholds sit at each currency's own 75th percentile, so both
    // events have a ~25% base rate and the aggregate Brier is meaningful.
    const lira = fxThreshold(3.2);
    const franc = fxThreshold(0.9);
    expect(lira).not.toBeNull();
    expect(franc).not.toBeNull();
    expect(lira).toBeGreaterThan(franc as number);
  });
});

describe('fxDepreciationPct — rate is units-per-USD, so UP is weaker', () => {
  it('reports depreciation as positive', () => {
    // TRY 48.05 -> 50.00 is a weaker lira.
    expect(fxDepreciationPct(48.05, 50.0)).toBeCloseTo(4.058, 2);
  });

  it('reports appreciation as negative', () => {
    expect(fxDepreciationPct(50, 48)).toBeCloseTo(-4, 6);
  });

  it('is zero for no move', () => {
    expect(fxDepreciationPct(3.6725, 3.6725)).toBe(0);
  });

  it('does not divide by zero', () => {
    expect(fxDepreciationPct(0, 5)).toBe(0);
  });
});

describe('honest sample size — clusters, not a rho-discounted row count', () => {
  it('counts distinct units, so seven daily calls for one country are ONE unit', () => {
    const week = ['censorship:IR', 'censorship:IR', 'censorship:IR', 'censorship:IR'];
    expect(independentUnits(week)).toBe(1);
    expect(independentUnits([...week, 'censorship:RU', 'fx_devaluation:IR'])).toBe(3);
  });

  it('counts distinct resolution batches and ignores missing dates', () => {
    expect(resolutionBatches(['2026-09-05', '2026-09-05', '2026-09-19', '', ''])).toBe(2);
  });

  it('the first batch falls below the honesty threshold, so skill stays withheld', () => {
    expect(resolutionBatches(['2026-09-05'])).toBeLessThan(MIN_RESOLUTION_BATCHES);
  });
});
