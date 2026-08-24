import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { resolveOutcome, fxDepreciationPct } from '../_lib/calls.js';
import { usgsCountUrl, type RegionBox } from '../_lib/seismicity.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Resolve matured calls (daily, 09:45 UTC — after record, before the brief).
 *
 * Every call names its resolver and its threshold at creation. This job does
 * one thing: count the qualifying EXTERNAL events inside the window the call
 * declared, and write hit or miss. It never reads a NexusWatch score, never
 * consults the stated probability, and never adjusts a threshold — those are
 * the three ways a track record quietly becomes a closed loop.
 *
 * The window is [made_on, resolves_on], both fixed before the outcome existed.
 *
 * Idempotent by predicate: only `status = 'pending'` rows past `resolves_on`
 * are touched, so re-running does nothing to already-resolved calls. A resolved
 * call is never rewritten — that is the point of a ledger.
 */

interface DueCall {
  id: number;
  kind: string;
  country_code: string;
  made_on: string;
  resolves_on: string;
  threshold: number;
  threshold_pct: number | null;
  reference_value: number | null;
  resolver_params: { box?: RegionBox; mag?: number } | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });
  const sql = neon(dbUrl);

  try {
    const due = (await sql`
      SELECT id, kind, country_code, made_on::text AS made_on, resolves_on::text AS resolves_on,
             threshold, threshold_pct::float AS threshold_pct, reference_value::float AS reference_value,
             resolver_params
      FROM calls
      WHERE status = 'pending' AND resolves_on <= CURRENT_DATE
      ORDER BY resolves_on ASC
      LIMIT 500
    `) as unknown as DueCall[];

    let hits = 0;
    let misses = 0;

    for (const call of due) {
      let count = 0;
      let outcome: 0 | 1;

      if (call.kind === 'fx_devaluation') {
        // Did the currency touch the declared depreciation at ANY point inside
        // the window? The peak matters, not the endpoint — a currency that
        // falls 8% and recovers by day 14 still had the devaluation the call
        // was about. Both the threshold and the reference rate were fixed at
        // creation, so nothing here can move the bar.
        const peak = (await sql`
          SELECT MAX(rate_vs_usd)::float AS peak
          FROM fx_rates
          WHERE country_code = ${call.country_code}
            AND date >= ${call.made_on}::date
            AND date <= ${call.resolves_on}::date
        `) as unknown as Array<{ peak: number | null }>;

        const ref = call.reference_value;
        const pct = call.threshold_pct;
        if (ref === null || pct === null || peak[0]?.peak == null) {
          // Unresolvable through no fault of the call — leave it pending
          // rather than record a miss we cannot justify.
          continue;
        }
        const moved = fxDepreciationPct(ref, peak[0].peak);
        outcome = moved >= pct ? 1 : 0;
        count = Math.round(moved * 100) / 100;
      } else if (call.kind === 'seismicity_window') {
        // Calibration harness: did USGS record a qualifying event inside the
        // frozen box and window? The box and magnitude come from
        // resolver_params, stored at issue — never from the current region
        // table, which may have been re-tuned since.
        const params = call.resolver_params;
        if (!params?.box || typeof params.mag !== 'number') {
          console.error(`[resolve-calls] call ${call.id} seismicity without frozen params — left pending`);
          continue;
        }
        const url = usgsCountUrl(params.box, params.mag, call.made_on, call.resolves_on);
        const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!r.ok) {
          console.error(`[resolve-calls] USGS ${r.status} for call ${call.id} — left pending for retry`);
          continue;
        }
        const d = (await r.json()) as { count: number };
        count = d.count;
        outcome = resolveOutcome(count, call.threshold);
      } else if (call.kind === 'censorship_event') {
        // The only question asked of the outside world: did OONI confirm a block
        // in this country inside the declared window?
        const evidence = (await sql`
          SELECT COUNT(*)::int AS n
          FROM ooni_measurements
          WHERE country_code = ${call.country_code}
            AND confirmed_blocked > 0
            AND measurement_date >= ${call.made_on}::date
            AND measurement_date <= ${call.resolves_on}::date
        `) as unknown as Array<{ n: number }>;

        count = evidence[0]?.n ?? 0;
        outcome = resolveOutcome(count, call.threshold);
      } else {
        // An unknown kind must NEVER fall into another kind's resolver — that
        // is how a wrong criterion resolves a call silently. Before this
        // branch existed, any third kind would have been scored against OONI.
        console.error(`[resolve-calls] call ${call.id} has unknown kind '${call.kind}' — left pending`);
        continue;
      }
      const status = outcome === 1 ? 'hit' : 'miss';

      await sql`
        UPDATE calls
        SET status = ${status}, evidence_count = ${count}, resolved_at = NOW()
        WHERE id = ${call.id} AND status = 'pending'
      `;

      if (outcome === 1) hits++;
      else misses++;
    }

    console.log(`[resolve-calls] resolved ${due.length} — ${hits} hit, ${misses} miss`);
    return res.status(200).json({ ok: true, resolved: due.length, hits, misses });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resolve-calls] failed:', msg);
    return res.status(500).json({ error: 'resolve_failed', message: msg });
  }
}
