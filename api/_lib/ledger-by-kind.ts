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
 *   probability and base rate rather than a tally. The caller is expected to
 *   pass EVERY scored row, not a display page — `api/calls/ledger.ts` runs a
 *   dedicated unlimited query for exactly this.
 *
 * This module cannot verify that from the inside, so it does not take the
 * caller's word for it: `scoring_complete` is computed by comparing the rows
 * it was given against the count it was told, and **a score computed on an
 * incomplete set is withheld rather than published with a caveat**. That is
 * the same posture as `publishableSkill` — this ledger withholds numbers it
 * cannot stand behind instead of footnoting them, because a footnote does not
 * survive being quoted.
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

  // AN ORPHAN SCORED ROW IS AN INCONSISTENCY, NOT A ROUNDING ERROR.
  //
  // Both inputs are reads of the same table in the same request, so a scored
  // row whose kind is missing from the counts cannot happen — which is exactly
  // why it must not be handled by silently dropping the row. An independent
  // review caught the original: scoring iterated `Object.keys(out)`, seeded
  // only from `counts`, so any such row vanished without a trace.
  //
  // It becomes reachable the moment a caller passes a FILTERED count set — for
  // instance counts excluding calibration kinds beside unfiltered scored rows,
  // which is a plausible next change to this endpoint. At that point the
  // published Brier scores would quietly be computed on fewer rows than the
  // counts beside them claim, and nothing would say so.
  //
  // So it throws. The caller wraps this in a try/catch that returns 500, and
  // the SSR /ledger page does not go through here — so the cost of the loud
  // version is a JSON endpoint that fails visibly, against a silent version
  // that publishes a number nobody can stand behind.
  const known = new Set(Object.keys(out));
  const orphans = [...new Set(scoredRows.map((r) => r.kind))].filter((k) => !known.has(k));
  if (orphans.length > 0) {
    throw new Error(
      `assembleByKind: scored rows for kind(s) absent from the counts: ${orphans.join(', ')}. ` +
        'The two inputs disagree about the same table — refusing to publish per-kind figures ' +
        'that would silently exclude them.',
    );
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
    out[kind].scored_rows_used = rows.length;
    out[kind].scoring_complete = rows.length >= out[kind].resolved;

    // WITHHOLD ON AN INCOMPLETE SET. A Brier over a truncated page is a real
    // number about a subset, and it will be read as a number about the book —
    // it sits on the same line as a whole-table count. An independent review
    // was right that labelling that is weaker than refusing it.
    //
    // Today the caller passes the whole set, so this branch does not fire.
    // That is the reason to write it rather than the reason to skip it: the
    // condition that would make it fire is someone repointing this at a paged
    // query, which is precisely how the defect this module exists to fix was
    // introduced in the first place.
    if (!out[kind].scoring_complete) continue;

    out[kind].brier = calls.length > 0 ? num(brierScore(calls)) : null;
    // Withheld until the kind has resolved in enough independent batches for
    // the number to separate skill from one fortnight's weather.
    out[kind].skill_vs_base_rate = num(publishableSkill({ calls, batches: out[kind].batches }));
  }

  return out;
}
