import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import {
  brierScore,
  brierSkillScore,
  baseRate,
  calibrationBins,
  murphyDecomposition,
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

    const scored: ScoredCall[] = resolved.map((c) => ({
      probability: c.probability,
      outcome: c.status === 'hit' ? 1 : 0,
    }));

    const byKind: Record<string, { open: number; resolved: number; hits: number; brier: number | null }> = {};
    for (const c of [...open, ...resolved]) {
      byKind[c.kind] ??= { open: 0, resolved: 0, hits: 0, brier: null };
      if (c.status === 'pending') byKind[c.kind].open++;
      else {
        byKind[c.kind].resolved++;
        if (c.status === 'hit') byKind[c.kind].hits++;
      }
    }
    for (const kind of Object.keys(byKind)) {
      const s = resolved
        .filter((c) => c.kind === kind)
        .map((c) => ({ probability: c.probability, outcome: (c.status === 'hit' ? 1 : 0) as 0 | 1 }));
      byKind[kind].brier = s.length > 0 ? brierScore(s) : null;
    }

    // NaN is a real answer here — "not enough resolved calls to say" — and it
    // must reach the page as null rather than becoming a confident-looking 0.
    const num = (v: number) => (Number.isFinite(v) ? v : null);

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      counts: {
        open: open.length,
        resolved: resolved.length,
        hits: resolved.filter((c) => c.status === 'hit').length,
        next_resolves_on: open.reduce<string | null>(
          (min, c) => (min === null || c.resolves_on < min ? c.resolves_on : min),
          null,
        ),
        first_call_on: [...open, ...resolved].reduce<string | null>(
          (min, c) => (min === null || c.made_on < min ? c.made_on : min),
          null,
        ),
      },
      scoring: {
        brier: scored.length ? num(brierScore(scored)) : null,
        base_rate: scored.length ? num(baseRate(scored)) : null,
        skill_vs_base_rate: scored.length ? num(brierSkillScore(scored)) : null,
        murphy: scored.length ? murphyDecomposition(scored) : null,
        calibration: scored.length ? calibrationBins(scored) : [],
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
