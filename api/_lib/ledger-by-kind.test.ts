import { describe, it, expect } from 'vitest';
import { assembleByKind, type KindCountRow, type ScoredRow } from './ledger-by-kind.js';

/**
 * REGRESSION FOR A DEFECT THAT WAS LIVE ON THE PUBLIC API.
 *
 * Measured on https://nexuswatch.dev/api/calls/ledger, 2026-08-30:
 *
 *   by_kind.censorship_event.open = 3     (312 pending in the table)
 *   by_kind.fx_devaluation.open   = 197   (523 pending in the table)
 *   by_kind.seismicity_window            ABSENT (14 pending in the table)
 *   sum of by_kind.*.open         = 200   — exactly the page size
 *
 * Six days before 39 of those censorship calls resolved, the API told a reader
 * there were three. The open page is ordered by DIVERGENCE, so the truncation
 * was not even a random sample — it was the most divergent rows, the worst
 * possible bias for a number read as the book.
 */
describe('by_kind counts come from the table, never from the page', () => {
  // The real shape on 2026-08-30.
  const counts: KindCountRow[] = [
    { kind: 'censorship_event', open: 312, resolved: 0, hits: 0, unscored: 0 },
    { kind: 'fx_devaluation', open: 523, resolved: 0, hits: 0, unscored: 0 },
    { kind: 'seismicity_window', open: 14, resolved: 0, hits: 0, unscored: 0 },
  ];

  it('reports the whole book even when NO rows were fetched', () => {
    // The page contributed nothing. The counts must be unaffected — this is
    // the exact condition under which the old code reported 3.
    const out = assembleByKind(counts, []);
    expect(out.censorship_event.open).toBe(312);
    expect(out.fx_devaluation.open).toBe(523);
  });

  it('includes a kind whose rows never reached a page', () => {
    // seismicity_window vanished from the response entirely because the
    // previous implementation seeded the map from the fetched rows.
    const out = assembleByKind(counts, []);
    expect(Object.keys(out).sort()).toEqual(['censorship_event', 'fx_devaluation', 'seismicity_window']);
    expect(out.seismicity_window.open).toBe(14);
  });

  it('does not sum to the page size', () => {
    const out = assembleByKind(counts, []);
    const sum = Object.values(out).reduce((a, v) => a + v.open, 0);
    expect(sum).toBe(849);
    expect(sum).not.toBe(200);
  });

  it('scores from the fetched rows, and says when they were truncated', () => {
    const withResolved: KindCountRow[] = [{ kind: 'censorship_event', open: 0, resolved: 31, hits: 10, unscored: 8 }];
    // Only 4 of the 31 scored rows were fetched.
    const rows: ScoredRow[] = Array.from({ length: 4 }, (_, i) => ({
      kind: 'censorship_event',
      countryCode: ['TR', 'RU', 'IR', 'IN'][i],
      probability: 0.84,
      baseRate: 0.9,
      outcome: 1 as const,
      resolvedOn: '2026-09-05',
    }));
    const out = assembleByKind(withResolved, rows);

    // The COUNT is the table's.
    expect(out.censorship_event.resolved).toBe(31);
    expect(out.censorship_event.hits).toBe(10);
    expect(out.censorship_event.unscored).toBe(8);
    // The SCORE is the page's, and the response admits the difference rather
    // than printing a Brier beside a count that does not share its denominator.
    expect(out.censorship_event.scored_rows_used).toBe(4);
    expect(out.censorship_event.scoring_complete).toBe(false);
    // ...and the score is WITHHELD, not published with a caveat. A Brier on 4
    // of 31 rows sits on the same line as a whole-table count of 31 and will
    // be read as describing it.
    expect(out.censorship_event.brier).toBeNull();
    expect(out.censorship_event.skill_vs_base_rate).toBeNull();
  });

  it('reports scoring_complete when the page held every scored row', () => {
    const c: KindCountRow[] = [{ kind: 'fx_devaluation', open: 0, resolved: 2, hits: 1, unscored: 0 }];
    const rows: ScoredRow[] = [
      {
        kind: 'fx_devaluation',
        countryCode: 'TR',
        probability: 0.6,
        baseRate: 0.5,
        outcome: 1,
        resolvedOn: '2026-09-06',
      },
      {
        kind: 'fx_devaluation',
        countryCode: 'AR',
        probability: 0.4,
        baseRate: 0.5,
        outcome: 0,
        resolvedOn: '2026-09-07',
      },
    ];
    const out = assembleByKind(c, rows);
    expect(out.fx_devaluation.scored_rows_used).toBe(2);
    expect(out.fx_devaluation.scoring_complete).toBe(true);
  });

  it('withholds skill below the batch threshold, whatever the counts say', () => {
    // One batch. The count says 31 resolved; the skill must still be null.
    const c: KindCountRow[] = [{ kind: 'censorship_event', open: 0, resolved: 31, hits: 10, unscored: 0 }];
    const rows: ScoredRow[] = Array.from({ length: 31 }, (_, i) => ({
      kind: 'censorship_event',
      countryCode: `C${i}`,
      probability: 0.16,
      baseRate: 0.1,
      outcome: (i < 10 ? 1 : 0) as 0 | 1,
      resolvedOn: '2026-09-05',
    }));
    const out = assembleByKind(c, rows);
    expect(out.censorship_event.batches).toBe(1);
    expect(out.censorship_event.skill_vs_base_rate).toBeNull();
    expect(out.censorship_event.brier).not.toBeNull();
  });
});

describe('an orphan scored row is refused, never silently dropped', () => {
  const counts: KindCountRow[] = [{ kind: 'censorship_event', open: 0, resolved: 1, hits: 1, unscored: 0 }];

  it('throws when a scored row names a kind the counts do not carry', () => {
    // Reachable the moment a caller passes a FILTERED count set beside
    // unfiltered scored rows — e.g. counts excluding calibration kinds. The
    // old code iterated Object.keys(seeded-from-counts), so those rows
    // vanished and the published Brier was quietly computed on fewer rows
    // than the count beside it claimed.
    const rows: ScoredRow[] = [
      {
        kind: 'censorship_event',
        countryCode: 'TR',
        probability: 0.8,
        baseRate: 0.9,
        outcome: 1,
        resolvedOn: '2026-09-05',
      },
      {
        kind: 'seismicity_window',
        countryCode: 'JP',
        probability: 0.5,
        baseRate: 0.5,
        outcome: 1,
        resolvedOn: '2026-09-07',
      },
    ];
    expect(() => assembleByKind(counts, rows)).toThrow(/seismicity_window/);
    expect(() => assembleByKind(counts, rows)).toThrow(/absent from the counts/);
  });

  it('does not throw when every scored kind is present', () => {
    const rows: ScoredRow[] = [
      {
        kind: 'censorship_event',
        countryCode: 'TR',
        probability: 0.8,
        baseRate: 0.9,
        outcome: 1,
        resolvedOn: '2026-09-05',
      },
    ];
    expect(() => assembleByKind(counts, rows)).not.toThrow();
  });

  it('does not throw for a counted kind with no scored rows', () => {
    // The common case on 5 September: kinds exist and nothing has resolved.
    const c: KindCountRow[] = [
      { kind: 'censorship_event', open: 312, resolved: 0, hits: 0, unscored: 0 },
      { kind: 'seismicity_window', open: 14, resolved: 0, hits: 0, unscored: 0 },
    ];
    expect(() => assembleByKind(c, [])).not.toThrow();
  });
});
