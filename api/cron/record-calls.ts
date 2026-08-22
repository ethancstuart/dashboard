import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { blendRates, historicalRate, type CallKind } from '../_lib/calls.js';

export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * Record today's calls (daily, 09:30 UTC — before the brief at 10:00).
 *
 * A call is a dated, falsifiable claim about something OUTSIDE NexusWatch,
 * written down before the outcome is known. That is the whole distinction from
 * `record-assessments.ts`, which predicts our own CII from our own CII and is
 * therefore unfalsifiable no matter how many rows it writes (measured skill
 * against a no-change baseline: −37.3%).
 *
 * THE FORECAST, stated plainly so it can be argued with: a country's chance of
 * a confirmed censorship event in the next 14 days is a blend of its recent
 * rate and its long-run rate, leaning recent. That is a real claim about the
 * domain — that recent activity predicts near-term activity — and it is exactly
 * the kind of claim that can lose. If it has no predictive power the Brier
 * skill score against the long-run base rate comes out at or below zero, and
 * that number gets published as it falls out. A model too complicated to be
 * legibly wrong would be worse here, not better.
 *
 * Idempotent: `calls_unique_daily` means re-running on the same day updates the
 * existing row rather than duplicating it.
 */

/** How far ahead each call looks. */
const HORIZON_DAYS = 14;
// Both lookbacks are EXACT multiples of the horizon, and that is load-bearing.
// A 120-day lookback bucketed by FLOOR(days_ago / 14) spans buckets 0..8 —
// NINE windows — while floor(120/14) computes eight. Verified against live OONI
// data before shipping: seven countries came back with long_hits = 9 out of a
// claimed 8 windows, which drove historicalRate to a clamped 0.99 for every one
// of them. Exact multiples make the bucket count and the denominator the same
// number by construction, so the off-by-one cannot come back.
/** Long-run history window — 8 horizons. */
const LONG_RUN_DAYS = 8 * 14;
/** Recent window — 3 horizons. */
const RECENT_DAYS = 3 * 14;
/** Confirmed blocking events required in the window for a hit. */
const THRESHOLD = 1;

const KIND: CallKind = 'censorship_event';
const RESOLVER = 'OONI (ooni.org) confirmed_blocked > 0';

interface RateRow {
  country_code: string;
  long_hits: number;
  recent_hits: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (token !== process.env.CRON_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return res.status(500).json({ error: 'database_not_configured' });
  const sql = neon(dbUrl);

  try {
    // Count DISTINCT horizon-length buckets containing a confirmed block, per
    // country. Buckets rather than raw event counts because the call is "does
    // it happen at all in a 14-day window", which is what we will resolve.
    //
    // The denominators are the number of windows the lookback CONTAINS, not the
    // number that happen to have OONI rows — using the latter would silently
    // drop quiet windows and bias every rate upward.
    const rows = (await sql`
      SELECT
        country_code,
        COUNT(DISTINCT CASE WHEN confirmed_blocked > 0 THEN
          FLOOR(EXTRACT(EPOCH FROM (NOW() - measurement_date)) / 86400 / ${HORIZON_DAYS})
        END)::int AS long_hits,
        COUNT(DISTINCT CASE WHEN confirmed_blocked > 0
                             AND measurement_date > NOW() - make_interval(days => ${RECENT_DAYS}) THEN
          FLOOR(EXTRACT(EPOCH FROM (NOW() - measurement_date)) / 86400 / ${HORIZON_DAYS})
        END)::int AS recent_hits
      FROM ooni_measurements
      WHERE measurement_date > NOW() - make_interval(days => ${LONG_RUN_DAYS})
      GROUP BY country_code
      ORDER BY country_code
    `) as unknown as RateRow[];

    const longWindows = LONG_RUN_DAYS / HORIZON_DAYS;
    const recentWindows = RECENT_DAYS / HORIZON_DAYS;

    let written = 0;
    for (const r of rows) {
      const longRun = historicalRate(r.long_hits, longWindows);
      const recent = historicalRate(r.recent_hits, recentWindows);
      const probability = blendRates(recent, longRun);

      const claim =
        `OONI records at least ${THRESHOLD} confirmed website or app blocking event ` +
        `in ${r.country_code} within ${HORIZON_DAYS} days.`;

      await sql`
        INSERT INTO calls
          (made_on, kind, country_code, claim, probability, horizon_days,
           resolves_on, resolver, threshold, base_rate)
        VALUES
          (CURRENT_DATE, ${KIND}, ${r.country_code}, ${claim}, ${probability}, ${HORIZON_DAYS},
           CURRENT_DATE + ${HORIZON_DAYS}, ${RESOLVER}, ${THRESHOLD}, ${longRun})
        ON CONFLICT (made_on, kind, country_code) DO UPDATE
          SET probability = EXCLUDED.probability,
              base_rate   = EXCLUDED.base_rate,
              claim       = EXCLUDED.claim
      `;
      written++;
    }

    console.log(`[record-calls] wrote ${written} calls across ${rows.length} countries`);
    return res.status(200).json({
      ok: true,
      written,
      horizon_days: HORIZON_DAYS,
      long_windows: longWindows,
      recent_windows: recentWindows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[record-calls] failed:', msg);
    // Loudly, not silently: a call ledger that quietly stops recording is the
    // failure mode this whole module exists to replace.
    return res.status(500).json({ error: 'record_failed', message: msg });
  }
}
