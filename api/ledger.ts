import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import {
  brierScore,
  baseRate,
  independentUnits,
  resolutionBatches,
  MIN_RESOLUTION_BATCHES,
  publishableSkill,
  coverageRequirement,
  isScored,
  type ScoredCall,
} from './_lib/calls.js';
import { shell, esc, pct } from './_lib/ssr-shell.js';

export const config = { runtime: 'nodejs', maxDuration: 20 };

/**
 * Server-rendered /ledger.
 *
 * WHY THIS EXISTS ALONGSIDE src/pages/ledger.ts. The SPA renders the ledger
 * beautifully and a crawler sees none of it: /ledger returns index.html with the
 * generic site title and no content, because every route in this app is
 * client-rendered. The ledger is the one page the whole repositioning depends on
 * being findable — "the only geopolitical platform that publishes its own track
 * record" is worth nothing if the record is invisible to search.
 *
 * Both paths coexist the way /brief/:date already does: an in-app navigation
 * pushState's and the SPA renders, while a direct load or a crawl hits this
 * function and gets real HTML with no JavaScript required.
 *
 * THE PALETTE COMES FROM src/styles/email-tokens.ts, the same source the daily
 * brief and the dossier theme read. A server renderer that cannot use CSS custom
 * properties is exactly where a private copy of the palette gets made, and a
 * private copy is how an identity change strands the most public surface you
 * have. There are no colour literals below.
 */

interface CallRow {
  id: number;
  kind: string;
  country_code: string;
  claim: string;
  probability: number;
  base_rate: number | null;
  resolves_on: string;
  status: string;
  void_reason?: string | null;
}

const KIND_LABEL: Record<string, string> = {
  censorship_event: 'Network interference (OONI)',
  fx_devaluation: 'Currency depreciation (FX reference rates)',
  seismicity_window: 'Seismicity (USGS) — calibration harness',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // The unfurl card for the register's front page. This shell used to declare
  // summary_large_image with no image at all — the one combination that
  // unfurls to NOTHING — so every /ledger link ever posted was a bare url.
  const ogImage = 'https://nexuswatch.dev/api/og?type=ledger';

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('method_not_allowed');
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900');

  const title = 'The Ledger — every call NexusWatch has made, scored';
  const description =
    'Dated, falsifiable calls resolved against external sources on a date fixed in advance, with the score published whether it flatters us or not.';

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return res.send(
      shell('<h1>The Ledger</h1><p class="lede">Temporarily unavailable.</p>', {
        title,
        description,
        canonicalPath: '/ledger',
      }),
    );
  }

  try {
    const sql = neon(dbUrl);
    const open = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, resolves_on::text AS resolves_on, status
      FROM calls WHERE status = 'pending'
      ORDER BY ABS(probability - COALESCE(base_rate, probability)) DESC, probability DESC
      LIMIT 40
    `) as unknown as CallRow[];

    // Display list, capped. The STATISTICS below must not be computed from
    // this — see `scoredRows`.
    const resolved = (await sql`
      SELECT id, kind, country_code, claim, probability::float AS probability,
             base_rate::float AS base_rate, resolves_on::text AS resolves_on, status, void_reason
      FROM calls WHERE status <> 'pending'
      ORDER BY resolved_at DESC LIMIT 40
    `) as unknown as CallRow[];

    // Every resolved call, for scoring. The headline was previously computed
    // from the 40 rows above while being captioned with the un-limited count —
    // and because record-calls.ts writes FX after censorship, those 40 would
    // have been almost entirely one leg presented as the whole book.
    const scoredRows = (await sql`
      SELECT kind, country_code, probability::float AS probability, base_rate::float AS base_rate,
             status, resolved_at::text AS resolved_at
      FROM calls WHERE status IN ('hit','miss') AND kind <> 'seismicity_window'
    `) as unknown as Array<{
      kind: string;
      country_code: string;
      probability: number;
      base_rate: number | null;
      status: string;
      resolved_at: string | null;
    }>;

    const totals = (await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending' AND kind <> 'seismicity_window')::int AS open,
        COUNT(*) FILTER (WHERE status IN ('hit','miss') AND kind <> 'seismicity_window')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'hit' AND kind <> 'seismicity_window')::int AS hits,
        MIN(resolves_on) FILTER (WHERE status = 'pending')::text AS next_resolves,
        MIN(made_on)::text AS first_call
      FROM calls
    `) as unknown as Array<{
      open: number;
      resolved: number;
      hits: number;
      next_resolves: string | null;
      first_call: string | null;
    }>;
    const t = totals[0];

    const scored: ScoredCall[] = scoredRows.map((c) => ({
      probability: c.probability,
      outcome: c.status === 'hit' ? 1 : 0,
      baseRate: c.base_rate ?? undefined,
    }));
    const asOf = new Date().toISOString().slice(0, 10);

    const parts: string[] = [];
    parts.push('<div class="rule"></div><div class="kicker">The Ledger</div>');
    parts.push('<h1>Every call we make, scored against something that isn’t us.</h1>');
    parts.push(
      '<p class="lede">Each call names an external source, a threshold and a resolution date before the outcome is known. ' +
        'The score is published whether it flatters us or not — a record that only reports its wins is not a record.</p>',
    );

    // THE CONSTRUCTION DISCLOSURE, published 2026-08-28 — before the first
    // resolution on 09-05, and deliberately so. record-calls.ts computes
    // probability = blendRates(recent, longRun) while storing base_rate =
    // longRun: the forecast and the baseline are two summaries of the SAME
    // series. Stating that after a bad number would be an excuse, and everyone
    // would know which it was. Stating it first makes it methodology.
    parts.push(
      '<div class="rule"></div><div class="kicker">Read this before the first score</div>' +
        '<h2>How we forecast, and what this first score can and cannot show</h2>' +
        '<p class="lede">Each call’s probability is that country’s own long-run rate, re-weighted toward its ' +
        'recent behaviour. The base rate we score against is that same long-run rate. So this first cohort is ' +
        'not a test of whether we understand the world — it is a narrower and more answerable question: ' +
        '<strong>does weighting recent behaviour beat the long-run average?</strong> A negative score means it ' +
        'does not, and that is a valid result we expect to publish. It is also why we withhold any skill number ' +
        'until three independent resolution batches exist: one fortnight cannot separate a forecasting method ' +
        'from the weather it happened to land in.</p>',
    );

    // THE RETIREMENT, PUBLISHED WITH THE CHANGE THAT CAUSES IT. Not after.
    // A documented retirement is a credibility artifact; an undocumented one is
    // a book that quietly stopped growing and a reader left to guess why.
    parts.push(
      '<div class="rule"></div><div class="kicker">A retired generator</div>' +
        '<h2>We have stopped issuing censorship calls, and this is why</h2>' +
        '<p class="lede">Until 23 August, each censorship call was priced by weighting a country’s ' +
        'recent behaviour against its long-run rate. A walk-forward backtest then measured that ' +
        'weighting at <strong>−7.1% skill</strong> on this domain — worse than using the long-run rate ' +
        'alone — so the weight was set to zero.</p>' +
        '<p class="lede">That correction was right, and it had a consequence we did not act on for ' +
        'six days. With the weight at zero the stated probability <em>is</em> the long-run rate, and ' +
        'the long-run rate is what we score against. Every censorship call issued since has had a ' +
        'skill of exactly zero — <strong>not approximately zero, and not because the forecast was ' +
        'poor, but by arithmetic</strong>. A number divided by itself.</p>' +
        '<p class="lede">So we have stopped issuing them, under a rule that is not specific to ' +
        'censorship: a generator that cannot state a probability different from its own base rate ' +
        'issues nothing, unless it is a declared calibration harness whose entire purpose is to sit on ' +
        'climatology. <strong>State a claim, or be a control.</strong></p>' +
        '<p class="lede">The censorship calls already on the book are untouched. They were made, and ' +
        'they resolve as made — including the 39 due on 5 September. What stops is adding more. We do ' +
        'not have a replacement generator yet, and we will not issue censorship calls again until we ' +
        'have one that is capable of being wrong.</p>',
    );

    // THE UNRESOLVABLE PROJECTION, COMPUTED AT RENDER TIME.
    //
    // Deliberately not a literal. The window for the next cohort is still
    // filling, so any number written into this file today is wrong tomorrow —
    // the delayed-fuse bug this project already has a rule about. Recomputing
    // per request keeps the published figure true as evidence arrives, and it
    // falls silently back to no claim if the query fails rather than printing
    // a stale one.
    let dueProjection: { total: number; held: number; on: string } | null = null;
    try {
      if (t.next_resolves) {
        const due = (await sql`
          SELECT c.country_code, c.horizon_days,
                 COUNT(DISTINCT o.measurement_date)::int AS days,
                 COALESCE(SUM(o.total_measurements), 0)::int AS meas,
                 COUNT(DISTINCT o.measurement_date) FILTER (WHERE o.confirmed_blocked > 0)::int AS blocked_days
          FROM calls c
          LEFT JOIN ooni_measurements o
            ON o.country_code = c.country_code
           AND o.measurement_date >= c.made_on
           AND o.measurement_date <= c.resolves_on
          WHERE c.kind = 'censorship_event' AND c.status = 'pending'
            AND c.resolves_on = ${t.next_resolves}::date
          GROUP BY c.country_code, c.horizon_days
        `) as unknown as Array<{ horizon_days: number; days: number; meas: number; blocked_days: number }>;
        if (due.length > 0) {
          const held = due.filter((r) => {
            // A block we DID observe resolves as a hit regardless of density —
            // the gate governs only the would-be miss.
            if (r.blocked_days >= 1) return false;
            const req = coverageRequirement(r.horizon_days);
            return r.days < req.minDays || r.meas < req.minMeasurements;
          }).length;
          dueProjection = { total: due.length, held, on: t.next_resolves };
        }
      }
    } catch {
      // No claim rather than a stale one.
    }

    parts.push(
      '<div class="rule"></div><div class="kicker">When we cannot score a call</div>' +
        '<h2>Some calls come due against evidence we never got</h2>' +
        '<p class="lede">OONI is a volunteer network, and its coverage is thinnest in precisely the ' +
        'places where running a measurement tool is most dangerous — so the countries we most want to ' +
        'be right about are the ones we have least evidence for.</p>' +
        '<p class="lede">Before a call is scored, we ask whether we looked hard enough to be entitled ' +
        'to an answer. A censorship call is scored only if OONI observed that country on at least half ' +
        'the days in the call’s window, across enough measurements that one volunteer’s network ' +
        'conditions cannot decide a public verdict. Below that line the call is marked ' +
        '<strong>unresolvable</strong>: it stays on the book, it carries the reason, and it is excluded ' +
        'from every number on this page.</p>' +
        '<p class="lede">The rule cuts one way only. <strong>A confirmed block we did observe resolves ' +
        'the call as a hit no matter how thin the coverage</strong> — seeing something happen is ' +
        'evidence that it happened. It is the <em>absence</em> of a block that needs a well-observed ' +
        'window to mean anything.</p>' +
        '<p class="lede">Unresolvable is not the same as void. A call is <strong>void</strong> when our ' +
        'own criterion was unsound — our mistake, withdrawn by us. It is <strong>unresolvable</strong> ' +
        'when the world did not supply enough evidence to judge either way. Neither is ever scored, and ' +
        'neither is ever deleted.</p>' +
        (dueProjection
          ? `<p class="lede">On current data we expect ${dueProjection.held} of the ` +
            `${dueProjection.total} calls resolving on ${esc(dueProjection.on)} to be unresolvable on ` +
            'these grounds. That window is still filling, so the figure will move — it is recomputed ' +
            'every time this page loads, and the exact count and country list are published with the ' +
            'result.</p>'
          : '') +
        '<p class="lede">We are stating this before the first calls resolve, because a rule published ' +
        'afterwards is not a rule — it is an explanation.</p>',
    );

    // The honest hero. With nothing resolved, report the open book rather than
    // borrowing a confident number from somewhere it does not belong.
    parts.push('<div class="grid">');
    if (t.resolved === 0) {
      parts.push(
        `<div class="stat"><div class="v">${t.open}</div><div class="l">calls open</div>` +
          `<div class="d">${t.next_resolves ? `first resolves ${esc(t.next_resolves)}` : ''}</div>` +
          `<div class="p">as of ${asOf} · calls table</div></div>`,
      );
      parts.push(
        '<div class="stat"><div class="v">—</div><div class="l">skill vs base rate</div>' +
          '<div class="d">nothing has resolved yet</div>' +
          '<div class="p">reported from the first resolution onward</div></div>',
      );
    } else {
      // PER-KIND, and no pooled headline. An independent review (2026-08-28)
      // refuted the single mixed "skill vs base rate" tile that used to sit
      // here: censorship and FX have different resolvers, base-rate
      // estimators and dependence structures, so a row-weighted average
      // across them reports whichever kind wrote more rows. And with one
      // resolution batch, no skill number separates forecasting from the
      // fortnight the world happened to have — so it is withheld and SAID to
      // be withheld, which is the more honest artifact anyway.
      const br = baseRate(scored);
      parts.push(
        `<div class="stat"><div class="v">${t.hits}/${t.resolved}</div><div class="l">calls that landed</div>` +
          `<div class="d">${Number.isFinite(br) ? `stated base rate ${pct(br)}` : ''}</div>` +
          `<div class="p">as of ${asOf} · calls table</div></div>`,
      );

      const batches = resolutionBatches(scoredRows.map((r) => (r.resolved_at ?? '').slice(0, 10)));
      const units = independentUnits(scoredRows.map((r) => `${r.kind}:${r.country_code}`));
      parts.push(
        `<div class="stat"><div class="v">${units}</div><div class="l">independent units</div>` +
          `<div class="d">${t.resolved} rows, but one call per country per day overlaps 13 of 14 days</div>` +
          `<div class="p">distinct country × kind · ${batches} resolution batch${batches === 1 ? '' : 'es'}</div></div>`,
      );

      if (batches < MIN_RESOLUTION_BATCHES) {
        parts.push(
          `<div class="stat"><div class="v">—</div><div class="l">skill vs base rate</div>` +
            `<div class="d">withheld until ${MIN_RESOLUTION_BATCHES} independent resolution batches</div>` +
            `<div class="p">one batch cannot separate skill from one fortnight's weather</div></div>`,
        );
      }
      parts.push('</div>');

      // Per-kind table: the honest unit of scoring.
      parts.push('<div class="rule"></div><div class="kicker">By domain</div><h2>Scored separately, on purpose</h2>');
      parts.push(
        '<p class="lede">Each domain has its own resolver, its own base-rate estimator and its own ' +
          'dependence structure. Pooling them would produce one number dominated by whichever domain ' +
          'happened to write more rows, which is not a track record.</p>',
      );
      const kinds = [...new Set(scoredRows.map((r) => r.kind))];
      for (const kind of kinds) {
        const rows = scoredRows.filter((r) => r.kind === kind);
        const ks: ScoredCall[] = rows.map((r) => ({
          probability: r.probability,
          outcome: (r.status === 'hit' ? 1 : 0) as 0 | 1,
          baseRate: r.base_rate ?? undefined,
        }));
        const kBatches = resolutionBatches(rows.map((r) => (r.resolved_at ?? '').slice(0, 10)));
        const kHits = rows.filter((r) => r.status === 'hit').length;
        const kBrier = brierScore(ks);
        const kSkill = publishableSkill({ calls: ks, batches: kBatches });
        const trail = Number.isFinite(kSkill)
          ? `skill ${kSkill >= 0 ? '+' : ''}${Math.round(kSkill * 100)}%`
          : 'skill withheld';
        parts.push(
          `<div class="row pending"><span class="lead">${esc(kind === 'fx_devaluation' ? 'FX' : 'OONI')}</span>` +
            `<span class="det">${esc(KIND_LABEL[kind] ?? kind)} — ${kHits}/${rows.length} landed` +
            `${Number.isFinite(kBrier) ? `, Brier ${kBrier.toFixed(3)}` : ''}, ` +
            `${independentUnits(rows.map((r) => r.country_code))} units, ${kBatches} batch${kBatches === 1 ? '' : 'es'}` +
            `</span><span class="trail">${esc(trail)}</span></div>`,
        );
      }
      parts.push('<div class="grid">');
    }
    parts.push('</div>');

    parts.push('<div class="rule"></div><div class="kicker">What counts</div><h2>Resolved by someone else</h2>');
    parts.push(
      '<p class="lede">Nothing here is scored against a NexusWatch number. That distinction is the whole product: ' +
        'an index that grades its own forecasts can accumulate rows forever without ever being wrong. ' +
        'One domain is deliberately unglamorous: USGS seismicity windows, stated at their own climatology. ' +
        'They are a calibration harness — a domain where the right answer is computable, so a broken scoring ' +
        'pipeline cannot hide — and they are excluded from the claim counts above.</p>',
    );
    const kinds = new Map<string, number>();
    for (const c of open) kinds.set(c.kind, (kinds.get(c.kind) ?? 0) + 1);
    for (const [kind] of kinds) {
      parts.push(
        `<div class="row pending"><span class="lead">${esc(kind === 'fx_devaluation' ? 'FX' : 'OONI')}</span>` +
          `<span class="det">${esc(KIND_LABEL[kind] ?? kind)}</span><span class="trail">open</span></div>`,
      );
    }

    parts.push('<div class="rule"></div><div class="kicker">Open</div><h2>What we are currently claiming</h2>');
    parts.push(
      '<p class="lede">Ordered by how far each call sits from that country’s own base rate — the ones at the top ' +
        'are where we are actually saying something rather than restating how often it happens anyway.</p>',
    );
    for (const c of open) {
      const div = c.base_rate === null ? null : (c.probability - c.base_rate) * 100;
      const trail =
        div === null ? pct(c.probability) : `${pct(c.probability)} (${div >= 0 ? '+' : ''}${div.toFixed(0)}pts)`;
      parts.push(
        `<a class="row pending" href="/call/${c.id}"><span class="lead">${esc(c.country_code)}</span>` +
          `<span class="det">${esc(c.claim)}</span><span class="trail">${esc(trail)}</span></a>`,
      );
    }

    // Scored and unscored are rendered SEPARATELY. Previously this list
    // printed `status === 'hit' ? 'HIT' : 'MISS'` over everything that was not
    // pending, so a void call — and now an unresolvable one — displayed to the
    // public as a MISS. A row we could not score must never be shown as a
    // forecast we got wrong.
    const scoredDisplay = resolved.filter((c) => isScored(c.status));
    const unscoredDisplay = resolved.filter((c) => !isScored(c.status));

    if (scoredDisplay.length > 0) {
      parts.push('<div class="rule"></div><div class="kicker">Resolved</div><h2>Including where we were wrong</h2>');
      // Worst-first, unconditionally. There is no ordering in which this list
      // opens with our best result.
      const ordered = [...scoredDisplay].sort(
        (a, b) =>
          Math.abs((b.status === 'hit' ? 1 : 0) - b.probability) -
          Math.abs((a.status === 'hit' ? 1 : 0) - a.probability),
      );
      for (const c of ordered) {
        parts.push(
          `<a class="row ${c.status === 'hit' ? 'hit' : 'miss'}" href="/call/${c.id}"><span class="lead">${esc(c.country_code)}</span>` +
            `<span class="det">${esc(c.claim)} — said ${pct(c.probability)}</span>` +
            `<span class="trail">${c.status === 'hit' ? 'HIT' : 'MISS'}</span></a>`,
        );
      }
    }

    // Shown, with the reason, and excluded from every number above. Silently
    // dropping a call the resolver could not score is the goalpost-move this
    // system exists to prevent — and from outside it is indistinguishable from
    // dropping one we expected to lose.
    if (unscoredDisplay.length > 0) {
      parts.push(
        '<div class="rule"></div><div class="kicker">Not scored</div>' +
          '<h2>Calls we could not honestly resolve</h2>' +
          '<p class="lede">These carry no outcome and are excluded from every number above. ' +
          'A call is <strong>void</strong> when our own criterion was unsound, and ' +
          '<strong>unresolvable</strong> when the resolver did not observe the country densely ' +
          'enough to score it either way. Neither is a forecast we got wrong, and neither is ' +
          'ever deleted.</p>',
      );
      for (const c of unscoredDisplay) {
        const reason = c.void_reason ? ` — ${c.void_reason}` : '';
        parts.push(
          `<a class="row pending" href="/call/${c.id}"><span class="lead">${esc(c.country_code)}</span>` +
            `<span class="det">${esc(c.claim)} — said ${pct(c.probability)}${esc(reason)}</span>` +
            `<span class="trail">${esc(c.status.toUpperCase())}</span></a>`,
        );
      }
    }

    parts.push(
      `<p class="foot">The brief opens with this ledger, every morning. ` +
        `<a href="https://nexuswatch.dev/briefs">Read the latest issue</a> · ` +
        `<a href="https://nexuswatch.dev/">Subscribe</a>` +
        (t.first_call ? ` · first call recorded ${esc(t.first_call)}` : '') +
        `</p>`,
    );

    return res.send(shell(parts.join('\n'), { title, description, canonicalPath: '/ledger', ogImage }));
  } catch (err) {
    console.error('[ledger] failed:', err instanceof Error ? err.message : err);
    return res.send(
      shell('<h1>The Ledger</h1><p class="lede">The ledger query failed. Nothing is being hidden.</p>', {
        title,
        description,
        canonicalPath: '/ledger',
      }),
    );
  }
}
