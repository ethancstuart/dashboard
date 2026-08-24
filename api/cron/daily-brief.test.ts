import { describe, it, expect } from 'vitest';
import { buildFallbackText, type BriefData } from './daily-brief.js';
import { validateBriefStructure } from '../_lib/brief-structure.js';

/**
 * The one fixture that must never break: the deterministic fallback is the
 * publish gate's safe harbor, so IT must satisfy the same structural contract
 * the gate enforces on the model. A fallback that fails its own gate's spec
 * means a refused draft has nowhere safe to fall.
 */

const base: BriefData = {
  date: '2026-08-23',
  utcTime: '10:00 UTC',
  topRiskCountries: [
    {
      name: 'Sudan',
      code: 'SD',
      score: 71,
      prevScore: 62,
      components: { conflict: 17, disasters: 3, governance: 8, marketExposure: 4 },
    },
    {
      name: 'Yemen',
      code: 'YE',
      score: 66,
      prevScore: 66,
      components: { conflict: 15, disasters: 2, governance: 7, marketExposure: 3 },
    },
  ] as BriefData['topRiskCountries'],
  totalCountries: 85,
  earthquakeCount: 31,
  significantQuakes: ['M5.1 off Honshu'],
  diseaseCount: 4,
  recentOutbreaks: [],
  conflictHeadlines: [],
  markets: [{ symbol: 'Crude oil ETF (USO)', price: '78.12', change: '+0.8%' }] as BriefData['markets'],
  yesterdayEqCount: 28,
  weeklyTrends: [
    {
      name: 'Sudan',
      code: 'SD',
      scores: [{ date: '2026-08-17', score: 60 }],
      currentScore: 71,
      weekAgoScore: 60,
      direction: 'rising',
    },
  ] as BriefData['weeklyTrends'],
  correlations: [],
  newsHeadlines: [{ title: 'Ceasefire talks stall in Port Sudan', source: 'Reuters' }],
  openCallLines: [
    'Iran (IR): 62% chance of a confirmed censorship event by 2026-09-05 — +18pts vs its base rate of 44%',
  ],
};

describe('buildFallbackText — the safe harbor honours the structure contract', () => {
  it('passes the daily structure gate with full data', () => {
    const r = validateBriefStructure(buildFallbackText(base), false);
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual([]);
    expect(r.pass).toBe(true);
  });

  it('passes the gate even with empty feeds and no open calls', () => {
    const empty: BriefData = {
      ...base,
      topRiskCountries: [],
      markets: [],
      newsHeadlines: [],
      weeklyTrends: [],
      openCallLines: [],
    };
    const text = buildFallbackText(empty);
    expect(validateBriefStructure(text, false).pass).toBe(true);
    expect(text).toContain('No open calls today.');
  });

  it("leads Today's Call with the first (most divergent) open call, verbatim", () => {
    expect(buildFallbackText(base)).toContain(base.openCallLines[0]);
  });

  it('never attributes a driver — every mover line says so explicitly', () => {
    const text = buildFallbackText(base);
    expect(text).toContain("driver not identified in today's data.");
  });
});
