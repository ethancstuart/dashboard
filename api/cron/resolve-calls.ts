import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import {
  resolveOutcome,
  fxDepreciationPct,
  coverageRequirement,
  daysSinceResolution,
  UNRESOLVABLE_GRACE_DAYS,
} from '../_lib/calls.js';
import { usgsCountUrl, type RegionBox } from '../_lib/seismicity.js';
import { raiseAlert } from '../_lib/alert.js';

/**
 * EVIDENCE UNITS ARE PER KIND, and the column is an INTEGER — a fact this
 * file learned on 2026-09-06, the first FX resolution day, when it wrote the
 * measured move (e.g. "1.12") into evidence_count and threw
 * `invalid input syntax for type integer` on SIXTY-THREE of sixty-six calls.
 * The three that "resolved" were the ones whose move happened to round to a
 * whole number. Every failure was caught by the per-call isolation, counted
 * in `errored`, reported in a response body nobody reads, and the run said
 * ok:true. Resolution day two, and the machine was broken in a way that
 * looked exactly like working.
 *
 *   censorship_event  → days with a confirmed block   (integer, natural)
 *   fx_devaluation    → peak depreciation in BASIS POINTS (integer, exact:
 *                       1.12% → 112; no float ever meets the column)
 *   seismicity_window → qualifying USGS events        (integer, natural)
 *
 * Display code renders each kind in its own units (api/call.ts).
 */
export function fxEvidenceBasisPoints(movedPct: number): number {
  return Math.round(movedPct * 100);
}

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
  /** Frozen at issue. The coverage requirement is derived from it, not hardcoded. */
  horizon_days: number;
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
             horizon_days, threshold, threshold_pct::float AS threshold_pct,
             reference_value::float AS reference_value, resolver_params
      FROM calls
      WHERE status = 'pending' AND resolves_on <= CURRENT_DATE
      ORDER BY resolves_on ASC
      LIMIT 500
    `) as unknown as DueCall[];

    let hits = 0;
    let misses = 0;
    let unresolvable = 0;
    // Thin coverage, but inside the grace window — still pending, not settled.
    let stillWaiting = 0;
    let errored = 0;

    for (const call of due) {
      try {
        // Per-call isolation: one malformed upstream body used to throw out of
        // the loop and abort the whole batch after earlier rows had already
        // been written. A bad row now costs its own call, not the run.
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
          count = fxEvidenceBasisPoints(moved);
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
          const d = (await r.json()) as { count?: unknown };
          if (typeof d.count !== 'number' || !Number.isFinite(d.count)) {
            console.error(`[resolve-calls] USGS returned no numeric count for call ${call.id} — left pending`);
            // Left PENDING, so it is awaiting evidence — not settled. Counting
            // it as unresolvable made the completion log call a pending row
            // "settled", which a reader would act on.
            stillWaiting++;
            continue;
          }
          count = d.count;
          outcome = resolveOutcome(count, call.threshold);
        } else if (call.kind === 'censorship_event') {
          // The only question asked of the outside world: did OONI confirm a block
          // in this country inside the declared window?
          //
          // COVERAGE FIRST — absence of evidence is not evidence of absence.
          // This query used to count blocking rows and score zero as a MISS,
          // which meant a country OONI simply had not measured resolved as
          // "we said it would be censored and it wasn't". Verified 2026-08-28:
          // 39 countries carried pending calls while only 37 had any OONI rows
          // in the last fortnight, so real misses would have been manufactured
          // out of a collector gap on the very first resolution day. A call is
          // only resolvable if the resolver actually observed the country.
          // AND THE GATE IS A DENSITY, NOT A BOOLEAN. It used to test `=== 0`,
          // so a SINGLE measurement row anywhere in a fourteen-day window
          // certified the country as observed, and a call with no block seen
          // was then written as an irreversible public MISS.
          //
          // Measured against the live 2026-09-05 cohort on 2026-08-28: SD and
          // SS each had exactly ONE covered day and would have resolved MISS.
          // Sudan and South Sudan are among the most shutdown-affected
          // countries on earth; publishing "no censorship event" for them off
          // one probe-day is wrong on the facts.
          //
          // Day count alone is not enough either: Cuba had 15 of 15 days
          // covered on 479 measurements against Russia's 95,531, a 200x spread.
          // So both dimensions, and BOTH DERIVED FROM THE WINDOW, so a future
          // kind with a different horizon is in scope by construction rather
          // than by someone remembering to add it to a list.
          //
          // The structural finding underneath, which belongs on /methodology:
          // the thin countries are CF, ML, TD, SS, NE, SD — Sahel and Horn
          // conflict states. OONI's coverage is ANTI-CORRELATED with the thing
          // it measures, because volunteers are thinnest where running a
          // measurement tool is most dangerous. The countries we most want to
          // be right about are the ones we have least evidence for.

          // EVIDENCE FIRST, AND THE ASYMMETRY IS THE WHOLE POINT.
          //
          // An independent review caught the previous ordering: the coverage
          // gate ran before the evidence query, so a sparse country that DID
          // record a confirmed block was withheld instead of scored as a hit.
          // That is wrong, because the two directions are not epistemically
          // symmetric:
          //
          //   a confirmed block OBSERVED is positive evidence. The event
          //   happened. Thin coverage does not weaken it — we saw it.
          //
          //   NO block observed is only evidence of ABSENCE if we looked hard
          //   enough. That is the case the coverage gate exists for, and the
          //   only case it may govern.
          //
          // So a hit resolves on the evidence alone, and the density gate
          // applies solely to the would-be miss.
          const evidence = (await sql`
          SELECT COUNT(DISTINCT measurement_date)::int AS n
          FROM ooni_measurements
          WHERE country_code = ${call.country_code}
            AND confirmed_blocked > 0
            AND measurement_date >= ${call.made_on}::date
            AND measurement_date <= ${call.resolves_on}::date
        `) as unknown as Array<{ n: number }>;

          const blockedDays = evidence[0]?.n ?? 0;
          const wouldBeHit = resolveOutcome(blockedDays, call.threshold) === 1;

          // Coverage is queried ONLY here, inside the would-be-miss branch.
          // It cannot gate a hit even by failing, and we do not pay for a query
          // whose result the hit path ignores.
          if (wouldBeHit) {
            count = blockedDays;
            outcome = 1;
          } else {
            const coverage = (await sql`
          SELECT COUNT(DISTINCT measurement_date)::int AS covered_days,
                 COALESCE(SUM(total_measurements), 0)::int AS measurements
          FROM ooni_measurements
          WHERE country_code = ${call.country_code}
            AND measurement_date >= ${call.made_on}::date
            AND measurement_date <= ${call.resolves_on}::date
        `) as unknown as Array<{ covered_days: number; measurements: number }>;

            const coveredDays = coverage[0]?.covered_days ?? 0;
            const observed = coverage[0]?.measurements ?? 0;
            const req = coverageRequirement(call.horizon_days);

            if (coveredDays < req.minDays || observed < req.minMeasurements) {
              const why =
                `resolver coverage ${coveredDays}/${req.minDays} days, ` +
                `${observed}/${req.minMeasurements} measurements in [${call.made_on}, ${call.resolves_on}]`;
              console.error(`[resolve-calls] call ${call.id} (${call.country_code}) unresolvable — ${why}`);

              // GRACE FIRST. Marking terminally on the resolution day removes the
              // call from the retry set forever, because this job only ever
              // selects status='pending'. OONI's ingest lags ~24h and
              // source-ooni.ts fetches only `since = yesterday`, so late evidence
              // and manual backfills are both real.
              const overdueBy = daysSinceResolution(call.resolves_on);
              if (overdueBy < UNRESOLVABLE_GRACE_DAYS) {
                stillWaiting++;
                continue;
              }

              // DEPLOY-ORDER SAFE. `unresolvable` needs the CHECK constraint from
              // docs/migrations/2026-08-28-calls-unresolvable-status.sql, applied
              // by hand, while pushing to main deploys. If the write is rejected
              // we fall back to leaving it pending — still not scored as a miss,
              // which is the property that matters. A missing migration must
              // never become a false public verdict.
              try {
                await sql`
                UPDATE calls
                SET status = 'unresolvable', void_reason = ${why}, resolved_at = NOW()
                WHERE id = ${call.id} AND status = 'pending'
              `;
                unresolvable++;
              } catch (e) {
                console.error(
                  `[resolve-calls] could not mark call ${call.id} unresolvable (migration not applied?) — ` +
                    `left pending, still NOT scored: ${e instanceof Error ? e.message : String(e)}`,
                );
                stillWaiting++;
              }
              continue;
            }
            count = blockedDays;
            outcome = 0;
          }
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
      } catch (callErr) {
        errored++;
        console.error(
          `[resolve-calls] call ${call.id} (${call.kind}) threw — left pending:`,
          callErr instanceof Error ? callErr.message : callErr,
        );
      }
    }

    console.log(
      `[resolve-calls] due ${due.length} — ${hits} hit, ${misses} miss, ` +
        `${unresolvable} unresolvable (settled, never scored), ` +
        `${stillWaiting} awaiting late evidence (still pending), ${errored} errored`,
    );
    if (errored > 0) {
      // A resolver error is a resolution that silently didn't happen, on the
      // one job whose whole point is happening unattended. 63 of these hid in
      // a response body on 2026-09-06; now they wake a human. Fails open —
      // the alert path must never break resolution itself.
      try {
        await raiseAlert({
          title: `[resolve-calls] ${errored} call(s) threw and were left pending`,
          severity: 'critical',
          key: 'resolve-calls-errored',
          body:
            `due=${due.length >= 500 ? '500+ (page-capped)' : due.length} resolved=${hits + misses} unresolvable=${unresolvable} ` +
            `still_waiting=${stillWaiting} errored=${errored}. Per-call errors are in the ` +
            'function logs. Rows stay pending, so a rerun after the fix resolves them.',
        });
      } catch (alertErr) {
        console.error('[resolve-calls] alert failed (non-fatal):', alertErr);
      }
    }

    return res.status(200).json({
      ok: true,
      due: due.length,
      resolved: hits + misses,
      hits,
      misses,
      /** Settled: past the grace window with too little evidence. Never scored. */
      unresolvable,
      /** Still pending: matured but inside the grace window, or awaiting retry. */
      still_waiting: stillWaiting,
      errored,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[resolve-calls] failed:', msg);
    return res.status(500).json({ error: 'resolve_failed', message: msg });
  }
}
