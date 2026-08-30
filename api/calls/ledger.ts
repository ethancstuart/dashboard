import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import {
  independentUnits,
  resolutionBatches,
  MIN_RESOLUTION_BATCHES,
  baseRate,
  calibrationBins,
  murphyDecomposition,
  CALIBRATION_KINDS,
  isScored,
  SCORED_STATUSES,
  type ScoredCall,
} from '../_lib/calls.js';
import { assembleByKind } from '../_lib/ledger-by-kind.js';

export const config = { runtime: 'nodejs', maxDuration: 20 };

/**
 * GET /api/calls/ledger — everything the public ledger page renders.
 *
 * This replaces what /api/accuracy/stats reports, and the difference is the
 * whole point. That endpoint scores `assessments`, whose "predictions" are
 * 0.6*cii + 0.4*(cii + delta7) measured against the cii — the system marking
 * its own homework, at -37.3% skill against a naive no-change baseline. Every
 * number below comes from calls resolved against something outside NexusWatch:
 * OONI blocking measurements and daily FX reference rates.
 *
 * Reports skill EVEN WHEN NEGATIVE. A ledger that only publishes its wins is
 * not a ledger, and "the naive baseline is beating us" is a real result in a
 * domain where nobody has ever checked — not an embarrassment to hide.
 */

interface CallRow {
  id: number;
  kind: string;
  country_code: string;
  claim: string;
  probability: number;
  base_rate: number | null;
  made_on: string;
  resolves_on: string;
  status: string;
  evidence_count: number | null;
  resolved_at: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });
  const sql = neon(dbUrl);

  // The daily GitHub snapshot must archive the WHOLE book, not a page of it.
  // Until 2026-08-28 it stored a LIMIT-200 response, so 440 of 680 calls were
  // never attested while /call/:id told every reader to "diff any two dated
  // files" — a verification procedure that could not be performed for most of
  // the book. `?all=1` returns everything; browsers keep the paged default.
  const wantsAll = req.query.all === '1' || req.query.all === 'true';
  const openLimit = wantsAll ? 100000 : 200;
  const resolvedLimit = wantsAll ? 100000 : 500;

  try {
    const resolved = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, made_on::text AS made_on, resolves_on::text AS resolves_on,
             status, evidence_count, resolved_at::text AS resolved_at
      FROM calls WHERE status <> 'pending'
      ORDER BY resolved_at DESC
      LIMIT ${resolvedLimit}
    `) as unknown as CallRow[];

    const open = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, made_on::text AS made_on, resolves_on::text AS resolves_on,
             status, evidence_count, resolved_at::text AS resolved_at
      FROM calls WHERE status = 'pending'
      ORDER BY ABS(probability - COALESCE(base_rate, probability)) DESC, probability DESC
      LIMIT ${openLimit}
    `) as unknown as CallRow[];

    // baseRate is REQUIRED for a publishable skill score — without it
    // brierSkillScore returns NaN rather than silently falling back to the
    // pooled reference, which is the flattery this rewrite removes.
    // Headline scoring EXCLUDES calibration-harness kinds: their stated
    // probability is the climatology, so folding them in would drag the
    // aggregate toward zero skill and count earthquake windows as
    // geopolitical claims. They still score inside by_kind, where the
    // harness's ≈0 skill is the point.
    // isScored, not `status !== 'pending'`. The resolved SELECT deliberately
    // still returns void and unresolvable rows so a reader can SEE them — but
    // they carry no outcome, and mapping them through `status === 'hit' ? 1 : 0`
    // scored every one of them as a MISS. That is the false miss this change
    // exists to prevent, and it was already happening to `void`.
    const claimResolved = resolved.filter((c) => !CALIBRATION_KINDS.has(c.kind) && isScored(c.status));
    const claimOpen = open.filter((c) => !CALIBRATION_KINDS.has(c.kind));
    const scored: ScoredCall[] = claimResolved.map((c) => ({
      probability: c.probability,
      outcome: c.status === 'hit' ? 1 : 0,
      baseRate: c.base_rate ?? undefined,
    }));

    // The whole book, from the table — the source of every published count.
    const totalsRows = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending' AND kind <> 'seismicity_window')::int AS open,
        COUNT(*) FILTER (WHERE status IN ('hit','miss') AND kind <> 'seismicity_window')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'hit' AND kind <> 'seismicity_window')::int AS hits,
        COUNT(*) FILTER (WHERE status = 'pending' AND kind = 'seismicity_window')::int AS calibration_open,
        COUNT(*) FILTER (WHERE status IN ('hit','miss') AND kind = 'seismicity_window')::int AS calibration_resolved,
        MIN(resolves_on) FILTER (WHERE status = 'pending')::text AS next_resolves_on,
        MIN(made_on)::text AS first_call_on
      FROM calls
    `) as unknown as Array<{
      open: number;
      resolved: number;
      hits: number;
      calibration_open: number;
      calibration_resolved: number;
      next_resolves_on: string | null;
      first_call_on: string | null;
    }>;
    const tot = totalsRows[0];

    // PER-KIND COUNTS COME FROM THE TABLE TOO. This is the same lesson as the
    // block below, applied thirty lines later than it should have been: until
    // 2026-08-30 `by_kind` was built by iterating the PAGED arrays, so the
    // deployed API published `censorship_event.open: 3` against 312 real
    // pending censorship calls — six days before 39 of them resolved — and
    // `fx_devaluation.open: 197` against 523. The per-kind numbers summed to
    // exactly 200, the page size, and `seismicity_window` was absent
    // altogether because none of its 14 rows reached the first page.
    //
    // The open page is ordered by DIVERGENCE, so the truncation was not even
    // a random sample of the book: it was the most divergent rows, which is
    // the worst possible bias for a count a reader treats as the book.
    //
    // The scored-status filter is DERIVED from SCORED_STATUSES rather than
    // spelled out here, so a new status is excluded by default and has to
    // prove itself in scope — the same allow-list direction as isScored().
    const scoredStatuses = [...SCORED_STATUSES];
    const kindRows = (await sql`
      SELECT kind,
        COUNT(*) FILTER (WHERE status = 'pending')::int AS open,
        COUNT(*) FILTER (WHERE status = ANY(${scoredStatuses}))::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'hit')::int AS hits,
        COUNT(*) FILTER (WHERE status <> 'pending' AND status <> ALL(${scoredStatuses}))::int AS unscored
      FROM calls
      GROUP BY kind
    `) as unknown as Array<{ kind: string; open: number; resolved: number; hits: number; unscored: number }>;

    // NaN is a real answer here — "not enough resolved calls to say" — and it
    // must reach the page as null rather than becoming a confident-looking 0.
    const num = (v: number) => (Number.isFinite(v) ? v : null);

    // PER-KIND scoring only. An independent review (2026-08-28) refuted the
    // single mixed aggregate: censorship and FX have different resolvers,
    // different base-rate estimators, different dependence structures and
    // different counts, so a row-weighted average across them is dominated by
    // whichever kind happened to write more rows — not a track record.
    // Assembled in api/_lib/ledger-by-kind.ts, where the counts/scores
    // distinction is stated and unit-tested. PER-KIND scoring only: an
    // independent review (2026-08-28) refuted the single mixed aggregate —
    // censorship and FX have different resolvers, base-rate estimators and
    // dependence structures, so a row-weighted average across them is
    // dominated by whichever kind wrote more rows, not a track record.
    const byKind = assembleByKind(
      kindRows,
      resolved
        .filter((c) => isScored(c.status))
        .map((c) => ({
          kind: c.kind,
          countryCode: c.country_code,
          probability: c.probability,
          baseRate: c.base_rate ?? undefined,
          outcome: (c.status === 'hit' ? 1 : 0) as 0 | 1,
          resolvedOn: (c.resolved_at ?? '').slice(0, 10),
        })),
    );

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      // COUNTS COME FROM COUNT(*), NEVER FROM THE PAGE. Three deep-dive lanes
      // independently converged on this: `open` was the length of a
      // LIMIT-200 result, so the API reported 200 while the SSR /ledger said
      // 666 and a brief's meta description said 562 — three surfaces, three
      // numbers, none of them the book. The landing hero read the truncated
      // one. Paging is a display concern; the count is a fact.
      counts: {
        open: tot.open,
        resolved: tot.resolved,
        hits: tot.hits,
        calibration_open: tot.calibration_open,
        calibration_resolved: tot.calibration_resolved,
        returned_open: claimOpen.length,
        returned_resolved: claimResolved.length,
        complete: claimOpen.length >= tot.open && claimResolved.length >= tot.resolved,
        next_resolves_on: tot.next_resolves_on,
        first_call_on: tot.first_call_on,
      },
      // n is NOT the number of independent observations: record-calls.ts writes
      // a fresh 14-day call per country every day, so consecutive calls share 13
      // of 14 days and all resolve against one set of external data.
      // The honest sample size: distinct (kind, country) units and distinct
      // resolution batches. A rho-discounted row count used to sit here; it
      // turned 273 correlated rows into "6.5 effective observations", a
      // number with a decimal point and no defence.
      independent_units: independentUnits(claimResolved.map((c) => `${c.kind}:${c.country_code}`)),
      resolution_batches: resolutionBatches(claimResolved.map((c) => (c.resolved_at ?? '').slice(0, 10))),
      min_batches_for_skill: MIN_RESOLUTION_BATCHES,
      // No mixed-kind aggregate is published. `by_kind` carries the scores;
      // this block carries only what is defensible across the whole book plus
      // the reason the headline number is absent.
      scoring: {
        note:
          'Scores are published PER KIND, never pooled: censorship and FX have different resolvers, ' +
          'base-rate estimators and dependence structures, so a row-weighted average across them is ' +
          'dominated by whichever wrote more rows. Skill is withheld for any kind until it has resolved ' +
          `in at least ${MIN_RESOLUTION_BATCHES} independent batches — with one batch there is no way to ` +
          'separate forecasting skill from the fortnight the world happened to have.',
        base_rate: scored.length ? num(baseRate(scored)) : null,
        calibration: scored.length ? calibrationBins(scored) : [],
        murphy: scored.length ? murphyDecomposition(scored) : null,
      },
      by_kind: byKind,
      open,
      resolved: wantsAll ? resolved : resolved.slice(0, 100),
    });
  } catch (err) {
    console.error('[calls/ledger] failed:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'ledger_unavailable' });
  }
}
