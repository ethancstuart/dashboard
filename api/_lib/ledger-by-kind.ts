/**
 * Per-kind ledger figures, assembled so the COUNTS and the SCORES cannot be
 * confused for each other.
 *
 * WHY THIS IS ITS OWN MODULE. Until 2026-08-30 `api/calls/ledger.ts` built
 * `by_kind` by iterating the paged `open` and `resolved` arrays. The deployed
 * API therefore published `censorship_event.open: 3` against 312 real pending
 * censorship calls — six days before 39 of them resolved — `fx_devaluation`
 * at 197 against 523, and no `seismicity_window` entry at all, because none of
 * its 14 rows reached the first page. The per-kind numbers summed to exactly
 * 200: the page size.
 *
 * The file already carried the lesson thirty lines below the defect
 * ("COUNTS COME FROM COUNT(*), NEVER FROM THE PAGE"). It had been applied to
 * `counts` and not to `by_kind`, which is the ordinary way a fix half-lands.
 *
 * The distinction this module enforces:
 *
 *   COUNTS come from a GROUP BY over the whole table. A tally needs no row
 *   detail, so there is never a reason to derive one from a page.
 *
 *   SCORES come from fetched rows, because a Brier score needs each row's
 *   probability and base rate. That fetch may be truncated — so the result
 *   reports how many rows it used and whether that was all of them, rather
 *   than printing a score beside a count and letting a reader assume they
 *   share a denominator.
 */
import { brierScore, independentUnits, resolutionBatches, publishableSkill, type ScoredCall } from './calls.js';

/** One row of the per-kind GROUP BY over `calls`. Counts, no row detail. */
export interface KindCountRow {
  kind: string;
  open: number;
  resolved: number;
  hits: number;
  unscored: number;
}

/** A fetched, scored call — carries what a Brier score needs. */
export interface ScoredRow {
  kind: string;
  countryCode: string;
  probability: number;
  baseRate?: number;
  outcome: 0 | 1;
  resolvedOn: string;
}

export interface KindFigures {
  open: number;
  resolved: number;
  hits: number;
  unscored: number;
  brier: number | null;
  skill_vs_base_rate: number | null;
  units: number;
  batches: number;
  scored_rows_used: number;
  scoring_complete: boolean;
}

const num = (v: number) => (Number.isFinite(v) ? v : null);

export function assembleByKind(counts: KindCountRow[], scoredRows: ScoredRow[]): Record<string, KindFigures> {
  const out: Record<string, KindFigures> = {};

  // Seeded from the COUNTS, so every kind in the table appears whether or not
  // its rows reached a page. Seeding from the fetched rows is what made
  // seismicity_window vanish from the response entirely.
  for (const r of counts) {
    out[r.kind] = {
      open: r.open,
      resolved: r.resolved,
      hits: r.hits,
      unscored: r.unscored,
      brier: null,
      skill_vs_base_rate: null,
      units: 0,
      batches: 0,
      scored_rows_used: 0,
      scoring_complete: true,
    };
  }

  for (const kind of Object.keys(out)) {
    const rows = scoredRows.filter((r) => r.kind === kind);
    const calls: ScoredCall[] = rows.map((r) => ({
      probability: r.probability,
      outcome: r.outcome,
      baseRate: r.baseRate,
    }));
    out[kind].units = independentUnits(rows.map((r) => r.countryCode));
    out[kind].batches = resolutionBatches(rows.map((r) => r.resolvedOn));
    out[kind].brier = calls.length > 0 ? num(brierScore(calls)) : null;
    // Withheld until the kind has resolved in enough independent batches for
    // the number to separate skill from one fortnight's weather.
    out[kind].skill_vs_base_rate = num(publishableSkill({ calls, batches: out[kind].batches }));
    out[kind].scored_rows_used = rows.length;
    out[kind].scoring_complete = rows.length >= out[kind].resolved;
  }

  return out;
}
