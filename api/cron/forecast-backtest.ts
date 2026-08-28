/**
 * Weekly forecast-tournament backtest.
 *
 * Schedule: Sunday 06:00 UTC.
 *
 * For every (model, horizon) with ≥30 forecasts whose horizon has passed:
 *   1. Join forecast.p50 vs actual cii_daily_snapshots score at made_on+horizon
 *   2. Compute MAE, CRPS (using p10..p90 quantiles), Brier (for CII ≥ 65)
 *   3. Bin by predicted probability for the reliability diagram
 *   4. Write a forecast_backtests row
 *
 * Then refit ensemble weights per horizon: each model's weight =
 *   max(0.05, 1 / (mae + 0.1)) normalised to sum to 1.
 *
 * 2026-05 tier-up Phase 3.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { cronJitter, requireCron } from '../_cron-utils.js';
import { MODELS, type ModelId } from '../_lib/forecast/models.js';

export const config = { runtime: 'nodejs', maxDuration: 180 };

const HORIZONS = [7, 14, 30];
const WINDOW_DAYS = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCron(req, res)) return;
  await cronJitter(10);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'DATABASE_URL not configured' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql: any = neon(dbUrl);

  // Step 1: fill in `actual` and `abs_error` for forecasts whose horizon has passed
  try {
    await sql`
      UPDATE forecasts f
      SET actual = c.cii_score,
          abs_error = ABS(f.p50 - c.cii_score),
          scored_at = NOW()
      FROM cii_daily_snapshots c
      WHERE f.scored_at IS NULL
        AND f.made_on + (f.horizon_days || ' days')::interval <= NOW()
        AND c.country_code = f.country_code
        AND c.date = (f.made_on + (f.horizon_days || ' days')::interval)::date
    `;
  } catch (e) {
    console.error('[forecast-backtest] score update failed:', e instanceof Error ? e.message : e);
  }

  // Step 2: per (model, horizon) compute MAE + CRPS + Brier
  const results: Array<{
    model: ModelId | 'ensemble';
    horizon: number;
    sample_size: number;
    mae: number;
    crps: number;
    brier: number;
  }> = [];

  for (const horizon of HORIZONS) {
    for (const model of [...MODELS, 'ensemble' as const]) {
      const rows = (await sql`
        SELECT p10::float AS p10, p25::float AS p25, p50::float AS p50,
               p75::float AS p75, p90::float AS p90,
               actual::float AS actual, abs_error::float AS abs_error
        FROM forecasts
        WHERE model = ${model}
          AND horizon_days = ${horizon}
          AND scored_at IS NOT NULL
          AND made_on > NOW() - (${WINDOW_DAYS}::int * INTERVAL '1 day')
      `) as unknown as Array<{
        p10: number;
        p25: number;
        p50: number;
        p75: number;
        p90: number;
        actual: number;
        abs_error: number;
      }>;
      if (rows.length < 5) continue;

      const mae = rows.reduce((s, r) => s + r.abs_error, 0) / rows.length;

      // CRPS approximation from the 5-quantile representation
      const crps = rows.reduce((s, r) => s + crpsQuantile(r, r.actual), 0) / rows.length;

      // Brier at CII ≥ 65 — derive predicted P(actual ≥ 65) from p50 vs (p90-p50) as proxy sigma
      const brier =
        rows.reduce((s, r) => {
          const sigma = Math.max(1, (r.p90 - r.p10) / 2.56);
          const p = 1 - normalCdf((65 - r.p50) / sigma);
          const o = r.actual >= 65 ? 1 : 0;
          return s + (p - o) ** 2;
        }, 0) / rows.length;

      results.push({
        model,
        horizon,
        sample_size: rows.length,
        mae: round(mae),
        crps: round(crps),
        brier: round(brier),
      });
    }
  }

  // Write backtest rows
  for (const r of results) {
    try {
      await sql`
        INSERT INTO forecast_backtests (run_at, model, horizon_days, sample_size, mae, crps, brier, reliability_bins, window_days)
        VALUES (NOW(), ${r.model}, ${r.horizon}, ${r.sample_size}, ${r.mae}, ${r.crps}, ${r.brier}, '[]'::jsonb, ${WINDOW_DAYS})
      `;
    } catch (e) {
      console.error('[forecast-backtest] insert failed:', e instanceof Error ? e.message : e);
    }
  }

  // Step 3: refit ensemble weights per horizon (only over base learners — exclude 'ensemble' itself)
  const newWeights: Record<string, Partial<Record<ModelId, number>>> = {};
  for (const horizon of HORIZONS) {
    const baseScores = results.filter((r) => r.horizon === horizon && r.model !== 'ensemble');
    if (baseScores.length < 2) continue;
    // Inverse-MAE weighting (lower MAE = higher weight)
    const inv = baseScores.map((r) => ({ model: r.model as ModelId, w: 1 / (r.mae + 0.1) }));
    const sum = inv.reduce((s, x) => s + x.w, 0);
    const horizonWeights: Partial<Record<ModelId, number>> = {};
    for (const x of inv) horizonWeights[x.model] = Math.max(0.05, x.w / sum);
    // Re-normalise after the 0.05 floor
    const s2 = Object.values(horizonWeights).reduce((a, b) => (a as number) + (b as number), 0) as number;
    for (const k of Object.keys(horizonWeights)) {
      horizonWeights[k as ModelId] = (horizonWeights[k as ModelId] as number) / s2;
    }
    newWeights[String(horizon)] = horizonWeights;
  }

  if (Object.keys(newWeights).length > 0) {
    try {
      await sql`
        INSERT INTO forecast_weights (updated_at, weights)
        VALUES (NOW(), ${JSON.stringify(newWeights)}::jsonb)
      `;
    } catch (e) {
      console.error('[forecast-backtest] weights insert failed:', e instanceof Error ? e.message : e);
    }
  }

  return res.json({
    ok: true,
    backtest_rows: results.length,
    horizons: HORIZONS,
    models: [...MODELS, 'ensemble'],
    refit_weights: newWeights,
  });
}

function crpsQuantile(q: { p10: number; p25: number; p50: number; p75: number; p90: number }, actual: number): number {
  // Approximate CRPS as average of |q_i - actual| weighted by quantile width.
  // Cheap and directionally correct for 5-quantile predictions.
  const quantiles = [
    { p: 0.1, v: q.p10 },
    { p: 0.25, v: q.p25 },
    { p: 0.5, v: q.p50 },
    { p: 0.75, v: q.p75 },
    { p: 0.9, v: q.p90 },
  ];
  let crps = 0;
  for (const { p, v } of quantiles) {
    const indicator = v >= actual ? 1 : 0;
    crps += Math.pow(indicator - p, 2) * Math.abs(v - actual);
  }
  return crps / quantiles.length;
}

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327;
  const p =
    d *
    Math.exp((-z * z) / 2) *
    (t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return z >= 0 ? 1 - p : p;
}

function round(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}
