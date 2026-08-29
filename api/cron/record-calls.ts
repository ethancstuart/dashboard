import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { blendRates, historicalRate, fxThreshold, shouldIssue, RECENCY_WEIGHT, type CallKind } from '../_lib/calls.js';
import { SEISMIC_REGIONS, SEISMIC_REGION_BOXES, SEISMIC_HORIZON_DAYS } from '../_lib/seismicity.js';

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

const FX_KIND: CallKind = 'fx_devaluation';
const SEIS_KIND: CallKind = 'seismicity_window';
const FX_RESOLVER = 'fx_rates (daily USD reference rates)';
/** Recent window for the FX signal, in 14-day horizons. */
const FX_RECENT_WINDOWS = 3;

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

    // RETIRED 2026-08-29, and the rule is general rather than a censorship
    // special case: a generator that cannot state a probability differing from
    // its own base rate issues nothing, unless it is a declared calibration
    // harness whose job is to sit on climatology.
    //
    // Censorship has had a recency weight of zero since 2026-08-23, set there
    // because a walk-forward backtest measured recency at -7.1% skill on this
    // domain. The tuning was right; continuing to issue under it was not. Every
    // call written since has had probability bit-identical to base_rate, so its
    // skill is exactly 0.000 by algebra — and each one dilutes the pooled score
    // when the three-batch gate opens.
    //
    // The 273 calls already on the book are NOT touched. They were made, and
    // they resolve as made. This stops adding to them.
    let written = 0;
    const issuing = shouldIssue(KIND);
    if (!issuing) {
      console.log(
        `[record-calls] ${KIND} not issued — this generator states its own base rate, ` +
          `so every call would score exactly 0.000 by construction. Rule published on /ledger.`,
      );
    }
    for (const r of issuing ? rows : []) {
      const longRun = historicalRate(r.long_hits, longWindows);
      const recent = historicalRate(r.recent_hits, recentWindows);
      const probability = blendRates(recent, longRun, RECENCY_WEIGHT[KIND]);

      const claim =
        `OONI records at least ${THRESHOLD} confirmed website or app blocking event ` +
        `in ${r.country_code} within ${HORIZON_DAYS} days.`;

      await sql`
        INSERT INTO calls
          (made_on, kind, country_code, claim, probability, horizon_days,
           resolves_on, resolver, threshold, base_rate)
        VALUES
          (CURRENT_DATE, ${KIND}, ${r.country_code}, ${claim}, ${probability}, ${HORIZON_DAYS},
           CURRENT_DATE + (${HORIZON_DAYS}::int), ${RESOLVER}, ${THRESHOLD}, ${longRun})
        ON CONFLICT (made_on, kind, country_code) DO UPDATE
          SET probability = EXCLUDED.probability,
              base_rate   = EXCLUDED.base_rate,
              claim       = EXCLUDED.claim
      `;
      written++;
    }

    // === FX depreciation calls ===
    // A market price is the best resolver material available: it settles
    // itself, on a fixed date, with no threshold anyone can argue about after
    // the fact. And it is a genuinely independent second domain, so the
    // aggregate score is not one narrow signal wearing a track record's
    // clothes.
    let fxWritten = 0;
    let fxSkippedPegs = 0;
    // The SAME rule, applied to every generator rather than only the one it was
    // written for. An independent review caught that: a rule claimed to be
    // general, gating one loop, is a censorship-shaped fix wearing a general
    // rule's language. FX passes today (weight 0.4, so it can depart), which is
    // exactly why applying it here is safe and why it belongs here — the guard
    // has to be structural before it can protect a kind nobody has written yet.
    if (!shouldIssue(FX_KIND)) {
      console.log(`[record-calls] ${FX_KIND} not issued — generator states its own base rate.`);
    }
    try {
      // FORWARD PEAK depreciation from each anchor day — deliberately the same
      // quantity the resolver measures, and the fix for a real defect.
      //
      // This previously used LAG(), i.e. endpoint-to-endpoint depreciation over
      // the trailing 14 days, while resolve-calls.ts resolves on MAX() across
      // the window. Peak exceedance is strictly greater than endpoint
      // exceedance — for a driftless walk the reflection principle puts it at
      // about 2x — so the threshold was calibrated to one event and the call
      // was settled on another. Measured over 5,270 currency-days: endpoint
      // exceedance 24.3%, peak exceedance 38.2%, against a mean stated
      // probability of 0.190. The 52 calls written under the old threshold
      // would have resolved at roughly double their stated probability, about
      // twenty confident misses all in the same direction, from construction
      // alone and nothing to do with forecasting.
      //
      // CURRENT ROW is included because the resolver's window is inclusive of
      // made_on and reference_value is that day's rate, so depreciation is
      // measured from it. rate_vs_usd is units-per-USD (AED sits at its 3.6725
      // peg), so a RISING rate is a WEAKER currency.
      const series = (await sql`
        WITH m AS (
          SELECT currency_code, country_code, date, rate_vs_usd,
                 MAX(rate_vs_usd) OVER (
                   PARTITION BY currency_code ORDER BY date
                   ROWS BETWEEN CURRENT ROW AND ${HORIZON_DAYS} FOLLOWING
                 ) AS fwd_peak,
                 COUNT(*) OVER (
                   PARTITION BY currency_code ORDER BY date
                   ROWS BETWEEN CURRENT ROW AND ${HORIZON_DAYS} FOLLOWING
                 ) AS window_rows
          FROM fx_rates
        )
        SELECT currency_code, country_code, date::text AS date,
               ((fwd_peak - rate_vs_usd) / NULLIF(rate_vs_usd, 0) * 100)::float AS dep
        FROM m
        -- Only anchors with a COMPLETE forward window. A truncated window at the
        -- end of the series understates the peak and would drag the threshold down.
        WHERE window_rows = ${HORIZON_DAYS} + 1
        ORDER BY currency_code, date
      `) as unknown as Array<{ currency_code: string; country_code: string; date: string; dep: number }>;

      const latest = (await sql`
        SELECT DISTINCT ON (currency_code) currency_code, country_code, rate_vs_usd::float AS rate
        FROM fx_rates ORDER BY currency_code, date DESC
      `) as unknown as Array<{ currency_code: string; country_code: string; rate: number }>;
      const rateOf = new Map(latest.map((r) => [r.currency_code, r]));

      const byCurrency = new Map<string, number[]>();
      for (const r of series) {
        const arr = byCurrency.get(r.currency_code);
        if (arr) arr.push(r.dep);
        else byCurrency.set(r.currency_code, [r.dep]);
      }

      for (const [code, deps] of byCurrency) {
        const meta = rateOf.get(code);
        if (!meta || deps.length < HORIZON_DAYS) continue;

        const sorted = [...deps].sort((a, b) => a - b);
        const p75 = sorted[Math.floor(sorted.length * 0.75)];
        const threshold = fxThreshold(p75);
        if (threshold === null) {
          fxSkippedPegs++;
          continue;
        }

        // Long-run rate is ~0.25 BY CONSTRUCTION, since the threshold is the
        // 75th percentile. Computed rather than assumed so it stays honest if
        // the percentile ever moves.
        const longRun = historicalRate(deps.filter((d) => d >= threshold).length, deps.length);
        const recentDeps = deps.slice(-HORIZON_DAYS * FX_RECENT_WINDOWS);
        const recent = historicalRate(recentDeps.filter((d) => d >= threshold).length, recentDeps.length);
        const probability = blendRates(recent, longRun, RECENCY_WEIGHT[FX_KIND]);

        const claim =
          `${code} depreciates ${threshold.toFixed(2)}% or more against USD ` +
          `at any point within ${HORIZON_DAYS} days, from ${meta.rate.toPrecision(6)}.`;

        await sql`
          INSERT INTO calls
            (made_on, kind, country_code, claim, probability, horizon_days,
             resolves_on, resolver, threshold, threshold_pct, reference_value, base_rate)
          VALUES
            (CURRENT_DATE, ${FX_KIND}, ${meta.country_code}, ${claim}, ${probability}, ${HORIZON_DAYS},
             CURRENT_DATE + (${HORIZON_DAYS}::int), ${FX_RESOLVER}, 1, ${threshold}, ${meta.rate}, ${longRun})
          ON CONFLICT (made_on, kind, country_code) DO UPDATE
            SET probability = EXCLUDED.probability, base_rate = EXCLUDED.base_rate,
                claim = EXCLUDED.claim, threshold_pct = EXCLUDED.threshold_pct,
                reference_value = EXCLUDED.reference_value
        `;
        fxWritten++;
      }
    } catch (fxErr) {
      console.error('[record-calls] fx pass failed (non-fatal):', fxErr instanceof Error ? fxErr.message : fxErr);
    }

    // === Seismicity calibration harness ===
    // One call per tectonic region with NON-OVERLAPPING windows: a new call is
    // issued only when the region has no pending one, so consecutive calls
    // never share days and n_eff ≈ n (the political domains, recorded daily,
    // can't have that). The stated probability IS the tuned Poisson base rate
    // — the harness is supposed to score ≈ 0 skill; what it validates is the
    // machinery. The region box and magnitude are frozen into resolver_params
    // at issue, so re-tuning the region table can never move a live call's
    // criterion.
    let seisWritten = 0;
    // The harness is expected to pass — its whole purpose is to sit on
    // climatology — but it is checked by the same rule rather than exempted by
    // position in the file. An exemption that works because of where the code
    // sits is not a rule.
    if (!shouldIssue(SEIS_KIND)) {
      console.log(`[record-calls] ${SEIS_KIND} not issued — generator states its own base rate.`);
    }
    try {
      const pending = (await sql`
        SELECT country_code FROM calls
        WHERE kind = 'seismicity_window' AND status = 'pending'
      `) as unknown as Array<{ country_code: string }>;
      const pendingRegions = new Set(pending.map((r) => r.country_code));

      for (const region of shouldIssue(SEIS_KIND) ? SEISMIC_REGIONS : []) {
        if (pendingRegions.has(region.code)) continue;
        const box = SEISMIC_REGION_BOXES[region.code];
        if (!box) continue; // tuned entry without a box cannot state a criterion
        const claim =
          `USGS records at least 1 earthquake of magnitude ${region.mag.toFixed(2)} or greater ` +
          `in the ${region.code} region within ${SEISMIC_HORIZON_DAYS} days.`;
        await sql`
          INSERT INTO calls
            (made_on, kind, country_code, claim, probability, horizon_days,
             resolves_on, resolver, threshold, base_rate, resolver_params)
          VALUES
            (CURRENT_DATE, 'seismicity_window', ${region.code}, ${claim}, ${region.baseRate},
             ${SEISMIC_HORIZON_DAYS}, CURRENT_DATE + (${SEISMIC_HORIZON_DAYS}::int),
             'USGS fdsnws event count', 1, ${region.baseRate},
             ${JSON.stringify({ box, mag: region.mag })})
          ON CONFLICT (made_on, kind, country_code) DO NOTHING
        `;
        seisWritten++;
      }
    } catch (seisErr) {
      console.error(
        '[record-calls] seismicity pass failed (non-fatal):',
        seisErr instanceof Error ? seisErr.message : seisErr,
      );
    }

    console.log(
      `[record-calls] wrote ${written} censorship + ${fxWritten} fx calls + ${seisWritten} seismicity (${fxSkippedPegs} pegs skipped)`,
    );
    return res.status(200).json({
      ok: true,
      written,
      fx_written: fxWritten,
      fx_skipped_pegs: fxSkippedPegs,
      seismicity_written: seisWritten,
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
