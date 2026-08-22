import { describe, it, expect } from 'vitest';
import {
  brierScore,
  baseRate,
  brierSkillScore,
  calibrationBins,
  murphyDecomposition,
  resolveOutcome,
  historicalRate,
  clampProbability,
  blendRates,
  formatLedgerLine,
  type ScoredCall,
  type Call,
} from './calls.js';

const c = (probability: number, outcome: 0 | 1): ScoredCall => ({ probability, outcome });

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

describe('brierSkillScore — the number that gets published either way', () => {
  it('is positive when the forecaster beats the base rate', () => {
    // Base rate 0.5, and the forecaster called each one correctly and confidently.
    const calls = [c(0.9, 1), c(0.1, 0), c(0.9, 1), c(0.1, 0)];
    expect(brierSkillScore(calls)).toBeGreaterThan(0);
  });

  it('is 0 for a forecaster who just states the base rate', () => {
    const calls = [c(0.5, 1), c(0.5, 0), c(0.5, 1), c(0.5, 0)];
    expect(brierSkillScore(calls)).toBeCloseTo(0, 10);
  });

  it('goes NEGATIVE when the forecaster is worse than the base rate', () => {
    // Confidently wrong every time.
    const calls = [c(0.9, 0), c(0.1, 1), c(0.9, 0), c(0.1, 1)];
    expect(brierSkillScore(calls)).toBeLessThan(0);
  });

  it('is undefined rather than misleading when every outcome is identical', () => {
    // With no variance there is no baseline to have skill against. Reporting a
    // number here would be the same class of error as the closed-loop ledger.
    expect(Number.isNaN(brierSkillScore([c(0.7, 1), c(0.8, 1)]))).toBe(true);
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

describe('formatLedgerLine', () => {
  const call = (status: Call['status']): Call => ({
    madeOn: '2026-08-01',
    kind: 'censorship_event',
    countryCode: 'RU',
    probability: 0.7,
    horizonDays: 14,
    resolvesOn: '2026-08-15',
    claim: 'x',
    resolver: 'OONI',
    status,
  });

  it('says so plainly when nothing resolved', () => {
    expect(formatLedgerLine([], [])).toBe('No calls resolved today.');
  });

  it('reports count, hits, Brier and skill', () => {
    const line = formatLedgerLine([call('hit'), call('miss')], [c(0.9, 1), c(0.1, 0)]);
    expect(line).toContain('2 calls resolved');
    expect(line).toContain('1 hit');
    expect(line).toContain('Brier');
  });

  it('reports a negative skill score rather than hiding it', () => {
    const line = formatLedgerLine([call('miss'), call('hit')], [c(0.9, 0), c(0.1, 1)]);
    expect(line).toContain('-');
    expect(line).toContain('vs base rate');
  });
});

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
