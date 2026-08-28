/**
 * Daily forecast-recording cron.
 *
 * Schedule: 11:00 UTC daily (after compute-cii at 09:00).
 * Writes one row per (country, model, horizon) into `forecasts`. Backfilled
 * with actual outcomes by the weekly forecast-backtest cron once the
 * horizon expires.
 *
 * Per country: pulls 90d CII history + 30d ACLED daily counts (for the
 * acled_slope model) + neighbor regional delta. Forecasts at horizons 7,
 * 14, 30. All 6 base learners + the ensemble.
 *
 * 2026-05 tier-up Phase 3.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { cronJitter, requireCron } from '../_cron-utils.js';
import { combine, DEFAULT_WEIGHTS } from '../_lib/forecast/ensemble.js';
import { MODELS, type ModelInputs } from '../_lib/forecast/models.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };

const HORIZONS = [7, 14, 30];

interface Row {
  country: string;
  scores: number[]; // oldest first
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  await cronJitter(15);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);

  // Load all countries' history in one round trip
  const histRows = (await sql`
    SELECT country_code, cii_score::float AS score, date
    FROM cii_daily_snapshots
    WHERE date > (SELECT MAX(date) - INTERVAL '90 days' FROM cii_daily_snapshots)
    ORDER BY country_code, date
  `) as unknown as Array<{ country_code: string; score: number; date: string }>;

  const byCountry = new Map<string, Row>();
  for (const r of histRows) {
    let entry = byCountry.get(r.country_code);
    if (!entry) {
      entry = { country: r.country_code, scores: [] };
      byCountry.set(r.country_code, entry);
    }
    entry.scores.push(Number(r.score));
  }

  // Pre-load ACLED daily counts (last 30 days) per country
  const acledRows = (await sql`
    SELECT country, DATE(occurred_at) AS d, COUNT(*)::int AS n
    FROM acled_events
    WHERE occurred_at > NOW() - INTERVAL '30 days'
    GROUP BY country, DATE(occurred_at)
    ORDER BY country, d
  `.catch(() => [] as unknown)) as unknown as Array<{ country: string; d: string; n: number }>;
  const acledByCountry = new Map<string, number[]>();
  if (Array.isArray(acledRows)) {
    for (const r of acledRows) {
      let arr = acledByCountry.get(r.country);
      if (!arr) {
        arr = [];
        acledByCountry.set(r.country, arr);
      }
      arr.push(r.n);
    }
  }

  // Compute global regional-delta proxy: mean CII delta over last 7 days
  // across all countries. (Real per-region neighbors require an adjacency
  // map — that's a future enhancement; for now everyone shares the global delta.)
  const allDeltas: number[] = [];
  for (const c of byCountry.values()) {
    const n = c.scores.length;
    if (n >= 8) allDeltas.push(c.scores[n - 1] - c.scores[n - 8]);
  }
  const globalDelta7 = allDeltas.length > 0 ? allDeltas.reduce((s, v) => s + v, 0) / allDeltas.length : 0;

  // Determine today's snapshot date (for made_on)
  const today = new Date().toISOString().slice(0, 10);

  const writes: Array<Promise<unknown>> = [];
  let rowCount = 0;

  for (const c of byCountry.values()) {
    if (c.scores.length < 7) continue;
    const cii_now = c.scores[c.scores.length - 1];
    const acledDaily = acledByCountry.get(c.country);

    for (const horizon of HORIZONS) {
      const inputs: ModelInputs = {
        ciiHistory: c.scores,
        horizon,
        acledDaily,
        neighborDelta7: globalDelta7,
      };
      const out = combine(inputs, DEFAULT_WEIGHTS);

      // Write per-model rows + ensemble row
      const allRows: Array<{
        model: string;
        point: number;
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        meta: Record<string, unknown>;
      }> = [
        {
          model: 'ensemble',
          point: out.ensemble.point,
          p10: out.ensemble.p10,
          p25: out.ensemble.p25,
          p50: out.ensemble.p50,
          p75: out.ensemble.p75,
          p90: out.ensemble.p90,
          meta: { variance: out.ensemble.variance },
        },
      ];
      for (const m of out.perModel) {
        const sigma = Number.isFinite(m.variance) ? Math.sqrt(m.variance) : null;
        if (sigma == null) continue;
        const clip = (v: number): number => Math.max(0, Math.min(100, v));
        allRows.push({
          model: m.model,
          point: m.point,
          p10: clip(m.point - 1.28 * sigma),
          p25: clip(m.point - 0.67 * sigma),
          p50: clip(m.point),
          p75: clip(m.point + 0.67 * sigma),
          p90: clip(m.point + 1.28 * sigma),
          meta: { variance: m.variance, hint: m.hint, weight: m.weight },
        });
      }

      for (const r of allRows) {
        rowCount++;
        writes.push(
          sql`
            INSERT INTO forecasts
              (country_code, made_at, made_on, horizon_days, model, p10, p25, p50, p75, p90, cii_now, meta)
            VALUES
              (${c.country}, NOW(), ${today}::date, ${horizon}, ${r.model},
               ${r.p10}, ${r.p25}, ${r.p50}, ${r.p75}, ${r.p90},
               ${cii_now}, ${JSON.stringify(r.meta)}::jsonb)
            ON CONFLICT (country_code, model, made_on, horizon_days) DO UPDATE
              SET p10 = EXCLUDED.p10, p25 = EXCLUDED.p25, p50 = EXCLUDED.p50,
                  p75 = EXCLUDED.p75, p90 = EXCLUDED.p90,
                  cii_now = EXCLUDED.cii_now, meta = EXCLUDED.meta, made_at = NOW()
          `,
        );
      }
    }
  }

  const settled = await Promise.allSettled(writes);
  const ok = settled.filter((s) => s.status === 'fulfilled').length;
  const failed = settled.length - ok;

  return res.json({
    ok: true,
    countries: byCountry.size,
    forecasts_written: ok,
    failed,
    models: MODELS,
    horizons: HORIZONS,
    global_delta7: round(globalDelta7),
    rowCount,
  });
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
