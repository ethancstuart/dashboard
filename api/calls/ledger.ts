import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import {
  brierScore,
  brierSkillScore,
  independentUnits,
  resolutionBatches,
  MIN_RESOLUTION_BATCHES,
  baseRate,
  calibrationBins,
  murphyDecomposition,
  CALIBRATION_KINDS,
  type ScoredCall,
} from '../_lib/calls.js';

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

  try {
    const resolved = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, made_on::text AS made_on, resolves_on::text AS resolves_on,
             status, evidence_count, resolved_at::text AS resolved_at
      FROM calls WHERE status <> 'pending'
      ORDER BY resolved_at DESC
      LIMIT 500
    `) as unknown as CallRow[];

    const open = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, made_on::text AS made_on, resolves_on::text AS resolves_on,
             status, evidence_count, resolved_at::text AS resolved_at
      FROM calls WHERE status = 'pending'
      ORDER BY ABS(probability - COALESCE(base_rate, probability)) DESC, probability DESC
      LIMIT 200
    `) as unknown as CallRow[];

    // baseRate is REQUIRED for a publishable skill score — without it
    // brierSkillScore returns NaN rather than silently falling back to the
    // pooled reference, which is the flattery this rewrite removes.
    // Headline scoring EXCLUDES calibration-harness kinds: their stated
    // probability is the climatology, so folding them in would drag the
    // aggregate toward zero skill and count earthquake windows as
    // geopolitical claims. They still score inside by_kind, where the
    // harness's ≈0 skill is the point.
    const claimResolved = resolved.filter((c) => !CALIBRATION_KINDS.has(c.kind));
    const claimOpen = open.filter((c) => !CALIBRATION_KINDS.has(c.kind));
    const scored: ScoredCall[] = claimResolved.map((c) => ({
      probability: c.probability,
      outcome: c.status === 'hit' ? 1 : 0,
      baseRate: c.base_rate ?? undefined,
    }));

    // NaN is a real answer here — "not enough resolved calls to say" — and it
    // must reach the page as null rather than becoming a confident-looking 0.
    const num = (v: number) => (Number.isFinite(v) ? v : null);

    // PER-KIND scoring only. An independent review (2026-08-28) refuted the
    // single mixed aggregate: censorship and FX have different resolvers,
    // different base-rate estimators, different dependence structures and
    // different counts, so a row-weighted average across them is dominated by
    // whichever kind happened to write more rows — not a track record.
    const byKind: Record<
      string,
      {
        open: number;
        resolved: number;
        hits: number;
        brier: number | null;
        skill_vs_base_rate: number | null;
        units: number;
        batches: number;
      }
    > = {};
    for (const c of [...open, ...resolved]) {
      byKind[c.kind] ??= {
        open: 0,
        resolved: 0,
        hits: 0,
        brier: null,
        skill_vs_base_rate: null,
        units: 0,
        batches: 0,
      };
      if (c.status === 'pending') byKind[c.kind].open++;
      else {
        byKind[c.kind].resolved++;
        if (c.status === 'hit') byKind[c.kind].hits++;
      }
    }
    for (const kind of Object.keys(byKind)) {
      const rows = resolved.filter((c) => c.kind === kind);
      const s: ScoredCall[] = rows.map((c) => ({
        probability: c.probability,
        outcome: (c.status === 'hit' ? 1 : 0) as 0 | 1,
        baseRate: c.base_rate ?? undefined,
      }));
      byKind[kind].units = independentUnits(rows.map((c) => c.country_code));
      byKind[kind].batches = resolutionBatches(rows.map((c) => (c.resolved_at ?? '').slice(0, 10)));
      byKind[kind].brier = s.length > 0 ? num(brierScore(s)) : null;
      // Skill is withheld until the kind has resolved in enough independent
      // batches for the number to separate skill from one fortnight's weather.
      byKind[kind].skill_vs_base_rate =
        s.length > 0 && byKind[kind].batches >= MIN_RESOLUTION_BATCHES ? num(brierSkillScore(s)) : null;
    }

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      counts: {
        open: claimOpen.length,
        resolved: claimResolved.length,
        hits: claimResolved.filter((c) => c.status === 'hit').length,
        calibration_open: open.length - claimOpen.length,
        calibration_resolved: resolved.length - claimResolved.length,
        next_resolves_on: open.reduce<string | null>(
          (min, c) => (min === null || c.resolves_on < min ? c.resolves_on : min),
          null,
        ),
        first_call_on: [...open, ...resolved].reduce<string | null>(
          (min, c) => (min === null || c.made_on < min ? c.made_on : min),
          null,
        ),
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
      resolved: resolved.slice(0, 100),
    });
  } catch (err) {
    console.error('[calls/ledger] failed:', err instanceof Error ? err.message : err);
    return res.status(500).json({ error: 'ledger_unavailable' });
  }
}
